const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdtempSync, realpathSync, lstatSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { createProcessLifecycle, cleanupAfterClose } = require('./validation-process-lifecycle.cjs');

const startupMarker = '[packaged-smoke] database-ready';
const nativeIntegrationMarker = '[packaged-smoke] native-integrations-ready';
const preloadMarker = '[packaged-smoke] preload-ready';
const nativeModuleFailure = /cannot find module|could not locate the bindings file|better[-_]sqlite3|node_module_version|module did not self-register|specified module could not be found/i;
const packagedAssetFailure = /enoent|no such file or directory|nativeimage.*(?:failed|empty|error)|tray icon failed to load/i;

function executableCandidates() {
  const configured = process.env.BUG_POCKET_SMOKE_EXE?.trim();
  if (configured) return [resolve(configured)];
  if (process.platform === 'win32') return [resolve('release-build', 'win-unpacked', 'Bug Pocket.exe')];
  if (process.platform === 'darwin') return [resolve('release-build', 'mac', 'Bug Pocket.app', 'Contents', 'MacOS', 'Bug Pocket')];
  return [resolve('release-build', 'linux-unpacked', 'bug-pocket')];
}

function findExecutable() {
  const candidates = executableCandidates();
  const executable = candidates.find(candidate => existsSync(candidate));
  assert.ok(executable,
    `Packaged application not found. Build it first with "npm run test:packaged-smoke:build". Checked: ${candidates.join(', ')}`);
  return executable;
}

function assertNativeBindingIsUnpacked(executable) {
  const resourcesPath = process.platform === 'darwin'
    ? resolve(dirname(executable), '..', 'Resources') : join(dirname(executable), 'resources');
  const bindingPath = join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  assert.ok(existsSync(bindingPath), `Packaged better-sqlite3 binding is missing from the ASAR-unpacked directory: ${bindingPath}`);
  const iconPath = join(resourcesPath, 'assets', 'icon.ico');
  assert.ok(existsSync(iconPath), `Packaged Tray icon is missing from the resources directory: ${iconPath}`);
}

function allocateSmokeProfile() {
  const parent = realpathSync.native(tmpdir());
  const profile = mkdtempSync(join(parent, 'bug-pocket-packaged-smoke-'));
  const identity = lstatSync(profile);
  return { profile, assertOwned(candidate) {
    assert.equal(resolve(candidate), profile, 'Smoke cleanup must target its own freshly allocated profile');
    assert.equal(dirname(profile), parent);
    const current = lstatSync(profile);
    assert.equal(current.isSymbolicLink(), false, 'Refuse a replaced smoke profile link');
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    assert.equal(realpathSync.native(profile), profile, 'Smoke profile resolved outside its original directory');
  } };
}

// Dependency injection exists only for deterministic process/filesystem fixtures.
// The ordinary CLI still launches the real packaged executable and assertions.
async function runSmokeTest({
  executable = findExecutable(), assertUnpacked = assertNativeBindingIsUnpacked,
  allocateProfile = allocateSmokeProfile, spawnChild = spawn, pathExists = existsSync,
  lifecycleOptions = {}, cleanupOptions = {},
  timeoutMs = Number(process.env.BUG_POCKET_SMOKE_TIMEOUT_MS || 30_000), log = console.log
} = {}) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'Smoke timeout must be positive and finite');
  assertUnpacked(executable);
  const { profile: userDataPath, assertOwned } = allocateProfile();
  const lifecycle = createProcessLifecycle({ label: 'Packaged smoke', ...lifecycleOptions });
  let stdout = '';
  let stderr = '';
  let failure;
  try {
    const child = spawnChild(executable, [], {
      env: { ...process.env, BUG_POCKET_PACKAGED_SMOKE_TEST: '1',
        BUG_POCKET_SMOKE_USER_DATA: userDataPath, ELECTRON_ENABLE_LOGGING: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    lifecycle.trackChild(child, { label: 'packaged app' });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    if (!await lifecycle.waitForClosed(timeoutMs)) {
      throw new Error(`Packaged application did not finish its startup smoke check within ${timeoutMs}ms.`);
    }
    const result = lifecycle.snapshot()[0];
    const combinedOutput = `${stdout}\n${stderr}`;
    assert.doesNotMatch(combinedOutput, nativeModuleFailure,
      `Packaged application reported a native module load failure.\n${combinedOutput.trim()}`);
    assert.doesNotMatch(combinedOutput, packagedAssetFailure,
      `Packaged application reported a static asset or nativeImage failure.\n${combinedOutput.trim()}`);
    assert.equal(result.exitCode, 0,
      `Packaged application exited abnormally (code=${result.exitCode}, signal=${result.signal}).\n${combinedOutput.trim()}`);
    assert.ok(stdout.includes(startupMarker), `Packaged application exited without confirming SQLite initialization.\n${combinedOutput.trim()}`);
    assert.ok(stdout.includes(nativeIntegrationMarker), `Packaged application exited without confirming Tray initialization.\n${combinedOutput.trim()}`);
    assert.ok(stdout.includes(preloadMarker), `Packaged application exited without confirming its isolated preload bridge.\n${combinedOutput.trim()}`);
    assert.ok(pathExists(join(userDataPath, 'local.sqlite')),
      `Packaged application did not create local.sqlite in its isolated production user-data directory: ${userDataPath}`);
  } catch (error) { failure = error; }

  const receipt = await lifecycle.finish({ error: failure });
  receipt.stdout = stdout; receipt.stderr = stderr;
  await cleanupAfterClose(receipt, { profile: userDataPath, assertOwned, ...cleanupOptions });
  if (receipt.error) {
    receipt.error.stdout = stdout; receipt.error.stderr = stderr;
    receipt.error.processes = receipt.processes;
    throw receipt.error;
  }
  log(`Packaged smoke test passed: ${basename(executable)}`);
  log(stdout.trim());
  return receipt;
}

if (require.main === module) runSmokeTest().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  for (const diagnostic of error.diagnostics ?? []) console.error(diagnostic);
  if (error.retainedProfile) console.error(`Retained smoke profile: ${error.retainedProfile}`);
  process.exitCode = 1;
});

module.exports = { runSmokeTest, assertNativeBindingIsUnpacked, allocateSmokeProfile };
