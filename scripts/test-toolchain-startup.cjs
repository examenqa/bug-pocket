// Windows normal-startup acceptance. This intentionally enables loopback-only
// debuggers for disposable test processes; it does not change app security flags.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { createConnection, createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { dirname, join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const modes = process.argv.slice(2).filter(arg => !arg.startsWith('--output='));
assert.ok(modes.length && modes.every(mode => ['dev', 'start', 'packaged'].includes(mode)),
  'usage: node scripts/test-toolchain-startup.cjs dev|start|packaged [...] [--output=path.json]');
assert.equal(process.platform, 'win32', 'This acceptance runner exercises Windows behavior.');
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function portClosed(port) {
  return new Promise((resolveClosed, reject) => {
    const socket = createConnection({ host: 'localhost', port });
    socket.once('connect', () => { socket.destroy(); resolveClosed(false); });
    socket.once('error', error => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolveClosed(true);
      else reject(error);
    });
    socket.setTimeout(1000, () => { socket.destroy(); resolveClosed(false); });
  });
}

async function until(check, description, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 20_000);
      this.pending.set(id, { resolve: resolveCommand, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP closed')); }
    this.pending.clear();
    this.socket.close();
  }
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
  assert.equal(response.status, 200);
  return response.json();
}

function stopTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // The PID is from this runner's own spawn. Never search for/kill an app by name.
  spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
}

async function inspectBeforeStartup(mainPort, userData, child) {
  const target = await until(async () => {
    if (child.exitCode !== null) throw new Error(`startup process exited with ${child.exitCode}`);
    return (await listTargets(mainPort)).find(item => item.webSocketDebuggerUrl);
  }, 'main inspector');
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  const scripts = new Map();
  cdp.on('Debugger.scriptParsed', script => scripts.set(script.scriptId, script.url));
  let resolvePaused;
  let rejectPaused;
  const paused = new Promise((resolvePause, rejectPause) => { resolvePaused = resolvePause; rejectPaused = rejectPause; });
  cdp.on('Debugger.paused', async event => {
    try {
      const frame = event.callFrames[0];
      const url = scripts.get(frame.location.scriptId) || frame.url;
      // Unpackaged Electron first pauses in default_app.asar's ESM bootstrap.
      // Run only as far as our CJS entry breakpoint, before its imports/DB setup.
      if (!/\/out\/main\/index\.js$/.test(url)) { await cdp.send('Debugger.resume'); return; }
      const result = await cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frame.callFrameId,
        returnByValue: true,
        expression: `(() => {
          const electron = require('electron');
          const actual = electron.app.getPath('userData');
          if (actual !== ${JSON.stringify(userData)}) throw new Error('Refusing startup outside isolated userData: ' + actual);
          globalThis.__exa70Electron = electron;
          globalThis.__exa70StartupPreference = null;
          // Do not change the user's real Windows Run registry while checking a
          // fresh synthetic profile. IPC, windows, SQLite and preload stay real.
          electron.app.setLoginItemSettings = value => { globalThis.__exa70StartupPreference = value; };
          return { pid: process.pid, parentPid: process.ppid,
            userData: actual, sessionData: electron.app.getPath('sessionData'),
            isPackaged: electron.app.isPackaged, versions: process.versions };
        })()`
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      resolvePaused(result.result.value);
    } catch (error) { rejectPaused(error); }
  });
  await cdp.send('Debugger.enable');
  const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/out/main/index\\.js$', lineNumber: 0 });
  await cdp.send('Runtime.runIfWaitingForDebugger');
  let pauseTimeout;
  const isolation = await Promise.race([paused, new Promise((_, reject) => {
    pauseTimeout = setTimeout(() => reject(new Error('Did not reach app entry isolation breakpoint')), 30_000);
  })]).finally(() => clearTimeout(pauseTimeout));
  await cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
  await cdp.send('Debugger.resume');
  return { cdp, isolation };
}

async function runMode(mode) {
  const temporary = mkdtempSync(join(tmpdir(), 'bug-pocket-exa70-startup-'));
  const profile = join(temporary, 'profile');
  mkdirSync(profile);
  const expectedUserData = mode === 'packaged' ? profile : `${profile}-dev`;
  mkdirSync(expectedUserData, { recursive: true });
  const mainPort = await freePort();
  const rendererPort = await freePort();
  const devPort = mode === 'dev' ? await freePort() : null;
  const devConfig = mode === 'dev' ? join(root, `.exa70-startup-${randomUUID()}.mjs`) : null;
  const electronFlags = [`--inspect-brk=127.0.0.1:${mainPort}`, `--remote-debugging-port=${rendererPort}`,
    '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`];
  let executable = process.execPath;
  let args;
  if (mode === 'dev') {
    assert.ok(existsSync(npmCli), `npm CLI not found: ${npmCli}`);
    // The CLI has no --port option and Vite treats port:0 as 5173. Import the
    // actual config and override only the fixture's port, leaving it untouched.
    writeFileSync(devConfig, `import config from './electron.vite.config.ts';\nexport default { ...config, renderer: { ...config.renderer, server: { ...config.renderer.server, port: ${devPort}, strictPort: true } } };\n`);
    args = [npmCli, 'run', 'dev', '--', '--config', devConfig, '--inspectBrk', String(mainPort), '--remoteDebuggingPort', String(rendererPort),
      '--', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`];
  } else if (mode === 'start') {
    assert.ok(existsSync(npmCli), `npm CLI not found: ${npmCli}`);
    args = [npmCli, 'start', '--', ...electronFlags];
  } else {
    executable = resolve(root, 'release-build/win-unpacked/Bug Pocket.exe');
    assert.ok(existsSync(executable), 'Build the unpacked Windows app before running packaged acceptance.');
    args = electronFlags;
  }
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'BUG_POCKET_PACKAGED_SMOKE_TEST', 'BUG_POCKET_SMOKE_USER_DATA',
    'ELECTRON_RENDERER_URL', 'NO_SANDBOX', 'V8_INSPECTOR_PORT', 'V8_INSPECTOR_BRK_PORT', 'REMOTE_DEBUGGING_PORT', 'ELECTRON_CLI_ARGS']) delete env[key];
  const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const spawnFailure = new Promise((_, reject) => child.once('error', reject));
  let main;
  let renderer;
  let originalCss;
  let originalComponent;
  const cssPath = join(root, 'src/renderer/src/styles.css');
  const componentPath = join(root, 'src/renderer/src/components/shared/BrandMark.tsx');
  try {
    const inspected = await Promise.race([inspectBeforeStartup(mainPort, profile, child), spawnFailure]);
    main = inspected.cdp;
    assert.equal(inspected.isolation.isPackaged, mode === 'packaged');
    assert.equal(inspected.isolation.sessionData, profile);
    const target = await until(async () => (await listTargets(rendererPort))
      .find(item => item.type === 'page' && item.url.includes('#/dashboard')), 'real dashboard renderer');
    renderer = await Cdp.connect(target.webSocketDebuggerUrl);
    const preloadScripts = [];
    renderer.on('Debugger.scriptParsed', script => { if (/preload/i.test(script.url)) preloadScripts.push(script.url); });
    await renderer.send('Debugger.enable');
    await until(() => renderer.evaluate('Boolean(document.querySelector("#root")?.childElementCount && window.bugPocket?.getSettings)'), 'rendered dashboard and bridge');
    const preferences = await main.evaluate(`(() => {
      const e = globalThis.__exa70Electron;
      return { userData: e.app.getPath('userData'), sessionData: e.app.getPath('sessionData'),
        startupPreference: globalThis.__exa70StartupPreference,
        windows: e.BrowserWindow.getAllWindows().map(w => {
          const p = w.webContents.getLastWebPreferences();
          return { url: w.webContents.getURL(), preload: p.preload, preloadURL: p.preloadURL, contextIsolation: p.contextIsolation,
            sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity,
            navigationGuards: w.webContents.listenerCount('will-navigate'),
            redirectGuards: w.webContents.listenerCount('will-redirect') };
        }) };
    })()`);
    assert.equal(preferences.userData, expectedUserData);
    assert.equal(preferences.sessionData, expectedUserData);
    assert.ok(preferences.windows.length >= 2, 'normal startup must create main and Quick Capture windows');
    for (const window of preferences.windows) {
      assert.equal(window.contextIsolation, true);
      assert.equal(window.sandbox, true);
      assert.equal(window.nodeIntegration, false);
      assert.equal(window.webSecurity, true);
      assert.ok(window.navigationGuards && window.redirectGuards, 'navigation guards must be attached');
    }
    const acceptance = await renderer.evaluate(`(async () => {
      const settings = await window.bugPocket.getSettings();
      const count = await window.bugPocket.getTotalBugCount();
      let invalidIpcRejected = false;
      try { await window.bugPocket.getBug(-1); } catch { invalidIpcRejected = true; }
      return { settingsAccepted: Array.isArray(settings.applications) && Array.isArray(settings.shortcuts),
        freshCloudConfig: settings.supabaseProjectUrl === null && settings.supabaseAnonKey === null,
        bugCount: count, invalidIpcRejected, requireType: typeof require, processType: typeof process,
        renderedTextLength: document.querySelector('#root').textContent.length,
        preloadError: Boolean(document.querySelector('.preload-error')),
        popupDenied: window.open('about:blank') === null,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
        url: location.href };
    })()`);
    assert.equal(acceptance.settingsAccepted, true, 'real settings:get IPC must be accepted');
    assert.equal(acceptance.freshCloudConfig, true);
    assert.equal(acceptance.bugCount, 0, 'synthetic profile must start empty');
    assert.equal(acceptance.invalidIpcRejected, true);
    assert.equal(acceptance.requireType, 'undefined');
    assert.equal(acceptance.processType, 'undefined');
    assert.equal(acceptance.preloadError, false);
    assert.equal(acceptance.popupDenied, true, 'normal window-open handler must deny a benign popup');
    assert.ok(preloadScripts.some(url => /[/\\]out[/\\]preload[/\\]index\.(?:cjs|mjs|js)$/.test(url)), `actual preload scripts: ${JSON.stringify(preloadScripts)}`);
    assert.ok(acceptance.renderedTextLength > 100, 'real React app must render');
    assert.match(acceptance.csp, /default-src 'self'/);
    assert.ok(existsSync(join(expectedUserData, 'local.sqlite')), 'SQLite must be created inside the verified isolated profile');
    let hmr = null;
    if (mode === 'dev') {
      originalCss = readFileSync(cssPath);
      const nonce = randomUUID();
      const before = await renderer.evaluate(`(window.__exa70HmrSentinel = ${JSON.stringify(nonce)}, performance.timeOrigin)`);
      writeFileSync(cssPath, Buffer.concat([originalCss, Buffer.from(`\n:root { --exa70-hmr: "${nonce}"; }\n`)]));
      await until(() => renderer.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--exa70-hmr').includes(${JSON.stringify(nonce)})`), 'CSS HMR update');
      const after = await renderer.evaluate('({ timeOrigin: performance.timeOrigin, sentinel: window.__exa70HmrSentinel })');
      assert.equal(after.timeOrigin, before, 'HMR must update without a full page reload');
      assert.equal(after.sentinel, nonce);
      writeFileSync(cssPath, originalCss);
      assert.equal(hash(readFileSync(cssPath)), hash(originalCss), 'HMR fixture must be restored byte for byte');
      const cssHash = hash(originalCss);
      originalCss = null;
      // BrandMark exports a pure React component, giving plugin-react a valid
      // Fast Refresh boundary. Change its accessible rendered label temporarily.
      originalComponent = readFileSync(componentPath);
      const componentSource = originalComponent.toString('utf8');
      const labelSource = "label = 'Bug Pocket'";
      assert.equal(componentSource.split(labelSource).length, 2, 'BrandMark fixture anchor must be unique');
      const originalLabel = await renderer.evaluate('document.querySelector(".brand-logo").getAttribute("aria-label")');
      writeFileSync(componentPath, componentSource.replace(labelSource, `label = 'EXA70 ${nonce}'`));
      await until(() => renderer.evaluate(`document.querySelector('.brand-logo')?.getAttribute('aria-label') === ${JSON.stringify(`EXA70 ${nonce}`)}`), 'React component Fast Refresh');
      const refreshed = await renderer.evaluate('({ timeOrigin: performance.timeOrigin, sentinel: window.__exa70HmrSentinel })');
      assert.equal(refreshed.timeOrigin, before, 'React Fast Refresh must retain the document');
      assert.equal(refreshed.sentinel, nonce);
      writeFileSync(componentPath, originalComponent);
      await until(() => renderer.evaluate(`document.querySelector('.brand-logo')?.getAttribute('aria-label') === ${JSON.stringify(originalLabel)}`), 'restored React component Fast Refresh');
      assert.equal(hash(readFileSync(componentPath)), hash(originalComponent), 'React fixture must be restored byte for byte');
      hmr = { cssUpdated: true, reactComponentUpdated: true, reactLabelRestored: true,
        sameDocument: true, restoredSha256: cssHash, componentRestoredSha256: hash(originalComponent) };
      originalComponent = null;
    }
    return { mode, command: [executable, ...args], isolationBeforeUserCode: inspected.isolation,
      preferences, preloadScripts, acceptance, hmr, sqlite: join(expectedUserData, 'local.sqlite'),
      exclusions: ['Windows login Run registry update intercepted to avoid altering user startup preference'],
      stdout, stderr };
  } catch (error) {
    error.stack += `\n[${mode} stdout]\n${stdout}\n[${mode} stderr]\n${stderr}`;
    throw error;
  } finally {
    if (originalCss) writeFileSync(cssPath, originalCss);
    if (originalComponent) writeFileSync(componentPath, originalComponent);
    renderer?.close();
    // Ask normal main-process shutdown first. The test owns this process only.
    if (main) {
      try { await main.evaluate('globalThis.__exa70Electron.app.quit()'); } catch { /* Process can close before CDP returns. */ }
      main.close();
    }
    await delay(500);
    stopTree(child);
    await delay(300);
    if (devConfig) {
      rmSync(devConfig, { force: true });
      await until(() => portClosed(devPort), 'owned development server to close', 5000);
    }
    // The root was returned by mkdtempSync here; resolve-check it before cleanup.
    assert.ok(relative(tmpdir(), temporary).startsWith('bug-pocket-exa70-startup-'));
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

(async () => {
  const results = [];
  for (const mode of modes) {
    results.push(await runMode(mode));
    console.log(`${mode}: normal renderer, isolated preload, accepted IPC and SQLite passed${mode === 'dev' ? '; CSS HMR and React Fast Refresh passed' : ''}`);
    if (output) {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(output, `${JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version, platform: process.platform, results }, null, 2)}\n`);
    }
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
