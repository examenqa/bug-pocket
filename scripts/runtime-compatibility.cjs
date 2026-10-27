// Component checks in the real Electron runtime. Requires `npm run build`.
// This is not the application startup path or an installed-package acceptance test.
// BUG_POCKET_COMPAT_WRITE_EXE optionally selects an older writer for upgrade checks.
// Both launches use current source code and a disposable synthetic profile.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { runHarnessChild, withProfileCleanup } = require('./runtime-compatibility-driver.cjs');
const root = resolve(__dirname, '..');
const sessionKey = 'runtime-compatibility-session';
const sessionValue = JSON.stringify({ access_token: 'synthetic-runtime-session', refresh_token: 'synthetic-refresh' });
const apiKey = 'synthetic-runtime-api-key';

async function runChild(executable, profile, phase) {
  const env = { ...process.env, BUG_POCKET_COMPAT_PROFILE: profile, BUG_POCKET_COMPAT_PHASE: phase };
  delete env.ELECTRON_RUN_AS_NODE;
  await runHarnessChild(
    () => spawn(executable, [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }),
    { phase }
  );
}

async function runDriver() {
  assert.equal(process.platform, 'win32', 'These checks target Windows DPAPI and desktop integrations');
  assert.ok(existsSync(join(root, 'out/preload/index.mjs')), 'Run npm run build first');
  const profile = mkdtempSync(join(tmpdir(), 'bug-pocket-runtime-compat-'));
  await withProfileCleanup(profile, async () => {
    const executable = require('electron');
    const configuredWriter = process.env.BUG_POCKET_COMPAT_WRITE_EXE?.trim();
    const writeExecutable = configuredWriter ? resolve(configuredWriter) : executable;
    assert.ok(existsSync(writeExecutable), `Writer executable not found: ${writeExecutable}`);
    console.log(`[runtime-compatibility] synthetic profile writer: ${writeExecutable}`);
    console.log(`[runtime-compatibility] synthetic profile reader: ${executable}`);
    await runChild(writeExecutable, profile, 'write');
    for (const name of ['local.sqlite', 'local.sqlite-wal']) {
      const file = join(profile, name);
      if (existsSync(file)) {
        const bytes = readFileSync(file);
        assert.equal(bytes.includes(Buffer.from(apiKey)), false, 'API key persisted in plaintext');
        assert.equal(bytes.includes(Buffer.from(sessionValue)), false, 'Auth session persisted in plaintext');
      }
    }
    await runChild(executable, profile, 'read');
    console.log('[runtime-compatibility] two-process persistence and native component checks passed');
  });
}

async function runElectron() {
  const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, safeStorage, Tray } = require('electron');
  const profile = process.env.BUG_POCKET_COMPAT_PROFILE;
  const phase = process.env.BUG_POCKET_COMPAT_PHASE;
  assert.ok(profile && ['write', 'read'].includes(phase), 'Launch through the Node driver');
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
      console.log(`[runtime-compatibility] ${phase} passed`);
      app.quit();
    }).catch(fail);
  });
  function fail(error) {
    console.error(error.stack || error);
    globalShortcut.unregisterAll();
    if (database?.isOpen()) database.close();
    tray?.destroy(); window?.destroy();
    app.exit(1);
  }
  try {
    await app.whenReady();
    const deadline = Date.now() + 10_000;
    while (!safeStorage.isEncryptionAvailable() && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 50));
    assert.equal(safeStorage.isEncryptionAvailable(), true, 'Windows secure storage unavailable');
    database = new BugPocketDatabase();
    const adapter = new SafeStorageAdapter(database);
    if (phase === 'write') {
      adapter.setItem(sessionKey, sessionValue);
      saveByokAiConfig(database, { provider: 'OpenRouter', baseUrl: 'https://example.invalid/v1', modelId: 'synthetic-model', customSystemPrompt: '', apiKeyOperation: { action: 'replace', value: apiKey } });
    }
    assert.equal(adapter.getItem(sessionKey), sessionValue);
    const encryptedSession = database.getEncryptedSupabaseAuthItem(sessionKey);
    assert.ok(encryptedSession && !encryptedSession.equals(Buffer.from(sessionValue)));
    assert.equal(decryptStoredApiKey(database.getEncryptedByokAiApiKey('OpenRouter'), safeStorage), apiKey);
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
    console.log('[runtime-compatibility] desktop capture thumbnail + PNG/JPEG + tray + shortcut + startup settings read');
    console.log(`[runtime-compatibility] versions ${JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8, modules: process.versions.modules, arch: process.arch })}`);
    void barrier.acquire(async () => {
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
      database.setSetting('runtime_compat_drained', phase);
    });
    app.quit();
  } catch (error) { fail(error); }
}

(process.versions.electron ? runElectron() : runDriver()).catch(error => {
  console.error(error.stack || error);
  for (const diagnostic of error.diagnostics ?? []) console.error(diagnostic);
  if (error.output) console.error(error.output);
  process.exitCode = 1;
});
