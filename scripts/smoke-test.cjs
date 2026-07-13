const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');

const startupMarker = '[packaged-smoke] database-ready';
const nativeIntegrationMarker = '[packaged-smoke] native-integrations-ready';
const nativeModuleFailure = /cannot find module|could not locate the bindings file|better[-_]sqlite3|node_module_version|module did not self-register|specified module could not be found/i;
const packagedAssetFailure = /enoent|no such file or directory|nativeimage.*(?:failed|empty|error)|tray icon failed to load/i;
const timeoutMs = Number(process.env.BUG_POCKET_SMOKE_TIMEOUT_MS || 30_000);

function executableCandidates() {
  const configured = process.env.BUG_POCKET_SMOKE_EXE?.trim();
  if (configured) return [resolve(configured)];

  if (process.platform === 'win32') {
    return [resolve('release-build', 'win-unpacked', 'Bug Pocket.exe')];
  }
  if (process.platform === 'darwin') {
    return [resolve('release-build', 'mac', 'Bug Pocket.app', 'Contents', 'MacOS', 'Bug Pocket')];
  }
  return [resolve('release-build', 'linux-unpacked', 'bug-pocket')];
}

function findExecutable() {
  const candidates = executableCandidates();
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert.ok(
    executable,
    `Packaged application not found. Build it first with "npm run test:packaged-smoke:build". Checked: ${candidates.join(', ')}`
  );
  return executable;
}

function assertNativeBindingIsUnpacked(executable) {
  const resourcesPath = process.platform === 'darwin'
    ? resolve(dirname(executable), '..', 'Resources')
    : join(dirname(executable), 'resources');
  const bindingPath = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  );
  assert.ok(
    existsSync(bindingPath),
    `Packaged better-sqlite3 binding is missing from the ASAR-unpacked directory: ${bindingPath}`
  );
  const iconPath = join(resourcesPath, 'assets', 'icon.ico');
  assert.ok(
    existsSync(iconPath),
    `Packaged Tray icon is missing from the resources directory: ${iconPath}`
  );
}

async function runSmokeTest() {
  const executable = findExecutable();
  assertNativeBindingIsUnpacked(executable);

  const userDataPath = join(
    tmpdir(),
    `bug-pocket-packaged-smoke-${process.pid}-${Date.now()}`
  );
  let stdout = '';
  let stderr = '';

  try {
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn(executable, [], {
        env: {
          ...process.env,
          BUG_POCKET_PACKAGED_SMOKE_TEST: '1',
          BUG_POCKET_SMOKE_USER_DATA: userDataPath,
          ELECTRON_ENABLE_LOGGING: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Packaged application did not finish its startup smoke check within ${timeoutMs}ms.`));
      }, timeoutMs);

      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        resolveResult({ code, signal });
      });
    });

    const combinedOutput = `${stdout}\n${stderr}`;
    assert.doesNotMatch(
      combinedOutput,
      nativeModuleFailure,
      `Packaged application reported a native module load failure.\n${combinedOutput.trim()}`
    );
    assert.doesNotMatch(
      combinedOutput,
      packagedAssetFailure,
      `Packaged application reported a static asset or nativeImage failure.\n${combinedOutput.trim()}`
    );
    assert.equal(
      result.code,
      0,
      `Packaged application exited abnormally (code=${result.code}, signal=${result.signal}).\n${combinedOutput.trim()}`
    );
    assert.ok(
      stdout.includes(startupMarker),
      `Packaged application exited without confirming SQLite initialization.\n${combinedOutput.trim()}`
    );
    assert.ok(
      stdout.includes(nativeIntegrationMarker),
      `Packaged application exited without confirming Tray initialization.\n${combinedOutput.trim()}`
    );
    assert.ok(
      existsSync(join(userDataPath, 'local.sqlite')),
      `Packaged application did not create local.sqlite in its isolated production user-data directory: ${userDataPath}`
    );

    console.log(`Packaged smoke test passed: ${basename(executable)}`);
    console.log(stdout.trim());
  } finally {
    rmSync(userDataPath, { force: true, recursive: true });
  }
}

runSmokeTest().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
