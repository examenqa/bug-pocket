'use strict';
// Component checks in the real Electron runtime, only after separate execution
// authorization. Host imports/tests load no Electron wrapper or native addon.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { existsSync, readFileSync } = fs;
const { join, resolve } = require('node:path');
const { runHarnessChild, withProfileCleanup } = require('./runtime-compatibility-driver.cjs');
const { prepareValidationPaths, assertOwnedProfile, createPathGuard, resolveVerifiedElectron, assertMeasuredVersions, readNativeIdentity, hashFile } = require('./validation-paths.cjs');
const root = resolve(__dirname, '..');
const sessionKey = 'runtime-compatibility-session';
const sessionValue = JSON.stringify({ access_token: 'synthetic-runtime-session', refresh_token: 'synthetic-refresh' });
const apiKey = 'synthetic-runtime-api-key';

function parseArguments(args) {
  const options = {};
  for (const argument of args) {
    const match = /^--(profile-root|evidence|electron|verification)=(.+)$/.exec(argument);
    assert.ok(match, `Unknown or incomplete argument: ${argument}`);
    assert.equal(options[match[1]], undefined, `Duplicate argument: ${match[1]}`);
    options[match[1]] = match[2];
  }
  for (const key of ['profile-root', 'evidence', 'electron', 'verification']) assert.ok(options[key], `Pass --${key}=<absolute path>`);
  return options;
}
function assertNoPlaintext(profile) {
  for (const name of ['local.sqlite', 'local.sqlite-wal']) {
    const file = join(profile, name);
    if (existsSync(file)) {
      const bytes = readFileSync(file);
      for (const value of [apiKey, sessionValue, 'synthetic-runtime-session', 'synthetic-refresh']) assert.equal(bytes.includes(Buffer.from(value)), false, `Synthetic credential plaintext found in ${name}`);
    }
  }
}
function errorEvidence(error) {
  return { message: error.message, stack: error.stack, diagnostics: error.diagnostics ?? [], terminationConfirmed: error.terminationConfirmed, retainedProfile: error.retainedProfile };
}
async function runRecordedChild({ executable, profile, profileRoot, ownerToken, verification, phase, record, startChild = spawn }) {
  const env = { ...process.env, BUG_POCKET_COMPAT_PROFILE: profile, BUG_POCKET_COMPAT_PROFILE_ROOT: profileRoot, BUG_POCKET_COMPAT_OWNER: ownerToken, BUG_POCKET_COMPAT_PHASE: phase, BUG_POCKET_COMPAT_EXE: executable, BUG_POCKET_COMPAT_VERIFICATION: verification };
  delete env.ELECTRON_RUN_AS_NODE;
  record.phase = phase; record.executable = executable; record.startedAt = new Date().toISOString(); record.closureConfirmed = false; record.output = '';
  try {
    await runHarnessChild(() => {
      const child = startChild(executable, [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      record.pid = child.pid ?? null;
      child.once('close', (code, signal) => { record.closureConfirmed = true; record.exitCode = code; record.signal = signal; record.closedAt = new Date().toISOString(); });
      return child;
    }, { phase, stdout: chunk => { record.output += chunk; process.stdout.write(chunk); }, stderr: chunk => { record.output += chunk; process.stderr.write(chunk); } });
  } catch (error) { record.error = errorEvidence(error); throw error; }
}
async function runDriver(args = process.argv.slice(2), dependencies = {}) {
  assert.equal(process.platform, 'win32', 'These checks target Windows DPAPI and desktop integrations');
  for (const key of ['BUG_POCKET_COMPAT_WRITE_EXE', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_RUN_AS_NODE']) assert.ok(!process.env[key], `Unexpected runtime override: ${key}`);
  const options = parseArguments(args);
  (dependencies.checkBuild ?? (() => assert.ok(existsSync(join(root, 'out/preload/index.mjs')), 'Run npm run build first under separate authorization')))();
  const identity = (dependencies.resolveVerifiedElectron ?? resolveVerifiedElectron)({ repositoryRoot: root, executable: options.electron, verification: options.verification });
  const native = (dependencies.readNativeIdentity ?? readNativeIdentity)(root);
  const context = (dependencies.prepareValidationPaths ?? prepareValidationPaths)({ repositoryRoot: root, profileRoot: options['profile-root'], evidence: options.evidence, label: 'runtime-compatibility' });
  const result = { capturedAt: new Date().toISOString(), status: 'RUNNING', scope: 'Synthetic component checks; both phases use the same verified45.2.1 executable. No old-ABI writer, normal-startup, installed or release acceptance.', profile: context.profile, profileRoot: context.profileRoot, identity, native, phases: [], cleanup: 'PENDING', skipped: [{ check: 'normal dev/start/unpacked application preload and IPC', reason: 'Separate normal-startup runner required; this is the accepted data-page component harness.' }, { check: 'actual startup registration/logon, interactive snip/annotation/DPI/multi-monitor and installed/Store behavior', reason: 'Separate authorized interactive validation gates.' }, { check: 'live provider/BYOC', reason: 'Separately authorized disposable inputs required.' }] };
  context.writeEvidence(result);
  let primaryError;
  try {
    await withProfileCleanup(context.profile, async () => {
      for (const phase of ['write', 'read']) {
        context.assertOwned();
        assert.equal(hashFile(identity.executable), identity.sha256, 'Verified executable changed between phases');
        assert.equal(hashFile(native.binding), native.sha256, 'Native binding changed between phases');
        if (phase === 'read') { assertNoPlaintext(context.profile); assert.ok(existsSync(join(context.profile, 'local.sqlite')), 'Writer database missing before unseeded reader'); }
        const record = {}; result.phases.push(record); context.writeEvidence(result);
        let phaseError;
        try {
          await (dependencies.runRecordedChild ?? runRecordedChild)({ ...context, executable: identity.executable, verification: identity.verification, phase, record });
          context.assertOwned();
          const phaseFile = join(context.profile, `runtime-compatibility-${phase}.json`);
          const phaseResult = JSON.parse(readFileSync(phaseFile, 'utf8'));
          assert.equal(phaseResult.status, 'PASSED', 'Child evidence did not pass');
          assert.equal(phaseResult.phase, phase); assert.equal(phaseResult.pid, record.pid, 'Child PID evidence differs');
          assert.equal(phaseResult.executable.sha256, identity.sha256, 'Child executable hash differs');
          assert.equal(phaseResult.native.sha256, native.sha256, 'Child native hash differs');
          assertMeasuredVersions(phaseResult.versions, phaseResult);
          if (phase === 'read') assert.equal(phaseResult.readerSeeded, false, 'Reader seeded credential values');
          record.result = phaseResult;
        } catch (error) { phaseError = error; throw error; }
        finally {
          try { context.writeEvidence(result); }
          catch (error) {
            if (phaseError) (phaseError.diagnostics ??= []).push(`Phase evidence failed: ${error.message}`);
            else throw error;
          }
        }
      }
      assertNoPlaintext(context.profile);
      result.status = 'PASSED'; context.writeEvidence(result);
    }, { remove: async (target, options) => {
      assert.ok(result.phases.every(phase => phase.closureConfirmed), 'Cannot clean a profile before all owned child processes close');
      await context.removeProfile(target, options); result.cleanup = 'REMOVED_AFTER_CONFIRMED_CLOSE';
    } });
  } catch (error) {
    primaryError = error; result.status = 'FAILED'; result.error = errorEvidence(error); result.cleanup = error.retainedProfile ? 'RETAINED' : result.cleanup;
  }
  try { context.writeEvidence(result); }
  catch (error) {
    if (primaryError) (primaryError.diagnostics ??= []).push(`Evidence finalization failed: ${error.message}`);
    else primaryError = error;
  }
  if (primaryError) throw primaryError;
  console.log('[runtime-compatibility] same45 two-process persistence and native component checks passed');
  return result;
}

// Pure probe interface: host regressions use fakes; only the Electron entry
// creates a real SQLite connection. A close failure must not mask a read/check.
function inspectSqliteProbe(probe, databasePath) {
  let metadata;
  let primaryError;
  try {
    metadata = {
      libraryVersion: probe.prepare('SELECT sqlite_version() AS version').get().version,
      integrity: probe.pragma('integrity_check', { simple: true }),
      userVersion: probe.pragma('user_version', { simple: true }),
      databasePath,
      nativeLoad: true
    };
    assert.equal(metadata.integrity, 'ok', 'Fresh profile database integrity failed');
  } catch (error) { primaryError = error; }
  try { probe.close(); }
  catch (closeError) {
    if (primaryError) (primaryError.diagnostics ??= []).push(`SQLite probe close failed: ${closeError.message}`);
    else primaryError = closeError;
  }
  if (primaryError) throw primaryError;
  return metadata;
}
async function runElectron() {
  assertMeasuredVersions(process.versions);
  const profile = process.env.BUG_POCKET_COMPAT_PROFILE;
  const phase = process.env.BUG_POCKET_COMPAT_PHASE;
  assert.ok(profile && ['write', 'read'].includes(phase), 'Launch through the Node driver');
  const ownership = { profile, profileRoot: process.env.BUG_POCKET_COMPAT_PROFILE_ROOT, ownerToken: process.env.BUG_POCKET_COMPAT_OWNER, repositoryRoot: root, label: 'runtime-compatibility' };
  assertOwnedProfile(ownership);
  const identity = resolveVerifiedElectron({ repositoryRoot: root, executable: process.env.BUG_POCKET_COMPAT_EXE, verification: process.env.BUG_POCKET_COMPAT_VERIFICATION });
  assert.equal(resolve(process.execPath).toLowerCase(), identity.executable.toLowerCase(), 'Child is not the verified executable');
  const native = readNativeIdentity(root);
  const phaseResult = { phase, pid: process.pid, profile, platform: process.platform, arch: process.arch, versions: { ...process.versions }, executable: identity, native, readerSeeded: phase === 'read' ? false : null, status: 'RUNNING', assertions: [] };
  const phaseFile = join(profile, `runtime-compatibility-${phase}.json`);
  function writePhaseEvidence() {
    assertOwnedProfile(ownership);
    createPathGuard({ repositoryRoot: root }).check(phaseFile);
    fs.writeFileSync(phaseFile, JSON.stringify(phaseResult, null, 2) + '\n', { flag: 'wx' });
  }
  const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, safeStorage, Tray } = require('electron');
  app.setPath('userData', profile);
  app.setName('Bug Pocket Runtime Compatibility');
  require('tsx/cjs');
  const { BugPocketDatabase } = require('../src/main/database.ts');
  const { SafeStorageAdapter } = require('../src/main/sync/SafeStorageAdapter.ts');
  const { saveByokAiConfig } = require('../src/main/ai/byokIssueProcessor.ts');
  const { decryptStoredApiKey } = require('../src/main/ai/byokConfigResponse.ts');
  const { runGracefulShutdown } = require('../src/main/lifecycle.ts');
  const { OperationBarrier } = require('../src/main/OperationBarrier.ts');
  let database;
  let window;
  let tray;
  let shutdownComplete = false;
  const barrier = new OperationBarrier();
  const shutdownOrder = [];
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    void runGracefulShutdown({
      pauseRenderer: () => { globalShortcut.unregisterAll(); shutdownOrder.push('pause'); },
      collectDrafts: async () => { shutdownOrder.push('drafts'); },
      drainOperations: async () => { await barrier.drain(); shutdownOrder.push('drain'); },
      stopAndDrain: async () => { shutdownOrder.push('stop'); },
      disconnectWorkspace: () => {
        assert.equal(database.getSetting('runtime_compat_drained'), phase);
        database.checkpoint(); database.disconnectWorkspace(true); database.close();
        shutdownOrder.push('close');
      }
    }).then(() => {
      assert.deepEqual(shutdownOrder, ['pause', 'drafts', 'drain', 'stop', 'close']);
      assert.equal(globalShortcut.isRegistered('Control+Alt+Shift+F12'), false);
      assert.equal(database.isOpen(), false);
      tray.destroy(); window.destroy(); shutdownComplete = true;
      phaseResult.shutdown = { order: shutdownOrder, databaseClosed: !database.isOpen(), shortcutUnregistered: !globalShortcut.isRegistered('Control+Alt+Shift+F12') };
      phaseResult.status = 'PASSED'; writePhaseEvidence();
      console.log(`[runtime-compatibility] ${phase} passed`);
      app.quit();
    }).catch(fail);
  });
  function fail(error) {
    phaseResult.status = 'FAILED'; phaseResult.error = errorEvidence(error);
    console.error(error.stack || error);
    for (const diagnostic of error.diagnostics ?? []) console.error(diagnostic);
    for (const cleanup of [() => globalShortcut.unregisterAll(), () => { if (database?.isOpen()) database.close(); }, () => tray?.destroy(), () => window?.destroy(), () => { if (!existsSync(phaseFile)) writePhaseEvidence(); }]) {
      try { cleanup(); } catch (cleanupError) { console.error(`Additional child cleanup/evidence error: ${cleanupError.message}`); }
    }
    app.exit(1);
  }
  try {
    await app.whenReady();
    const deadline = Date.now() + 10_000;
    while (!safeStorage.isEncryptionAvailable() && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 50));
    assert.equal(safeStorage.isEncryptionAvailable(), true, 'Windows secure storage unavailable');
    if (phase === 'read') assert.ok(existsSync(join(profile, 'local.sqlite')), 'Unseeded reader requires writer database');
    database = new BugPocketDatabase();
    assert.equal(resolve(database.databasePath).toLowerCase(), join(profile, 'local.sqlite').toLowerCase(), 'Database escaped the disposable profile');
    if (phase === 'read') assert.equal(database.getSetting('runtime_compat_drained'), 'write', 'Reader did not recover the closed writer state');
    const SQLite = require('better-sqlite3');
    const probe = new SQLite(database.databasePath, { readonly: true, fileMustExist: true });
    phaseResult.sqlite = inspectSqliteProbe(probe, database.databasePath);
    const adapter = new SafeStorageAdapter(database);
    if (phase === 'write') {
      adapter.setItem(sessionKey, sessionValue);
      saveByokAiConfig(database, { provider: 'OpenRouter', baseUrl: 'https://example.invalid/v1', modelId: 'synthetic-model', customSystemPrompt: '', apiKeyOperation: { action: 'replace', value: apiKey } });
    }
    assert.equal(adapter.getItem(sessionKey), sessionValue);
    const encryptedSession = database.getEncryptedSupabaseAuthItem(sessionKey);
    assert.ok(encryptedSession && !encryptedSession.equals(Buffer.from(sessionValue)));
    assert.equal(decryptStoredApiKey(database.getEncryptedByokAiApiKey('OpenRouter'), safeStorage), apiKey);
    phaseResult.assertions.push('SQLite integrity and encrypted session/BYOK persistence; reader does not seed credentials');
    console.log(`[runtime-compatibility] ${phase}: SQLite + Windows safeStorage session/BYOK persistence`);

    ipcMain.handle('settings:get', () => database.getSettings());
    window = new BrowserWindow({ show: false, webPreferences: { preload: join(root, 'out/preload/index.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    let preloadError;
    window.webContents.on('preload-error', (_event, _path, error) => { preloadError = error; });
    await window.loadURL('data:text/html;charset=utf-8,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>Runtime compatibility</title>');
    const bridge = await window.webContents.executeJavaScript(`(async () => ({ node: typeof require, rawIpc: typeof window.ipcRenderer, bridge: typeof window.bugPocket?.getSettings, settings: await window.bugPocket.getSettings() }))()`);
    assert.ifError(preloadError);
    assert.equal(bridge.node, 'undefined'); assert.equal(bridge.rawIpc, 'undefined'); assert.equal(bridge.bridge, 'function');
    assert.ok(Array.isArray(bridge.settings.shortcuts));
    phaseResult.assertions.push('Built sandboxed preload and isolated component IPC round trip');
    console.log('[runtime-compatibility] built sandboxed preload + isolated IPC round-trip');

    const image = nativeImage.createFromPath(join(root, 'assets/icon.ico'));
    assert.equal(image.isEmpty(), false);
    const resized = image.resize({ width: 32, height: 32 });
    assert.equal(nativeImage.createFromBuffer(resized.toPNG()).isEmpty(), false);
    assert.equal(nativeImage.createFromBuffer(resized.toJPEG(80)).isEmpty(), false);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 64 } });
    assert.ok(sources.length > 0, 'No desktop screen source');
    assert.ok(sources.some(source => !source.thumbnail.isEmpty()), 'Desktop thumbnails empty');
    // Desktop thumbnails stay in memory and are neither retained nor sent anywhere.
    tray = new Tray(image); tray.setToolTip('Bug Pocket runtime compatibility');
    assert.equal(tray.isDestroyed(), false);
    assert.equal(globalShortcut.register('Control+Alt+Shift+F12', () => {}), true, 'Disposable shortcut registration failed');
    assert.equal(globalShortcut.isRegistered('Control+Alt+Shift+F12'), true);
    const startup = app.getLoginItemSettings();
    assert.equal(typeof startup.openAtLogin, 'boolean');
    phaseResult.assertions.push('Screen thumbnail, PNG/JPEG conversion, tray and shortcut registration, startup settings read only');
    console.log('[runtime-compatibility] desktop capture thumbnail + PNG/JPEG + tray + shortcut + startup settings read');
    console.log(`[runtime-compatibility] versions ${JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8, modules: process.versions.modules, arch: process.arch })}`);
    void barrier.acquire(async () => {
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
      database.setSetting('runtime_compat_drained', phase);
    });
    app.quit();
  } catch (error) { fail(error); }
}

module.exports = { parseArguments, assertNoPlaintext, runRecordedChild, runDriver, inspectSqliteProbe };
if (require.main === module) (process.versions.electron ? runElectron() : runDriver()).catch(error => {
  console.error(error.stack || error);
  for (const diagnostic of error.diagnostics ?? []) console.error(diagnostic);
  if (error.output) console.error(error.output);
  process.exitCode = 1;
});
