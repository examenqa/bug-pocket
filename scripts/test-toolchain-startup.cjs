// Windows normal-startup acceptance. This intentionally enables loopback-only
// debuggers for disposable test processes; it does not change app security flags.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createConnection, createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { basename, dirname, join, relative, resolve, sep } = require('node:path');
const { createProcessLifecycle, cleanupAfterClose, appendFailure } = require('./validation-process-lifecycle.cjs');

const root = resolve(__dirname, '..');
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
    this.closed = false;
    socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
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
  static async connect(url, { timeoutMs = 10_000, createSocket = target => new WebSocket(target),
    schedule = setTimeout, cancel = clearTimeout } = {}) {
    assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'CDP connection needs a bounded timeout');
    const socket = createSocket(url);
    await new Promise((resolveOpen, reject) => {
      let settled = false;
      let timer;
      const listeners = {};
      const settle = error => {
        if (settled) return;
        settled = true;
        cancel(timer);
        for (const [name, listener] of Object.entries(listeners)) socket.removeEventListener?.(name, listener);
        if (error) {
          try { socket.close(); }
          catch (closeError) { (error.diagnostics ??= []).push('Close opening CDP socket: ' + closeError.message); }
          reject(error);
        } else resolveOpen();
      };
      listeners.open = () => settle();
      listeners.close = () => settle(new Error('CDP socket closed before opening'));
      listeners.error = event => settle(event instanceof Error ? event : event.error instanceof Error
        ? event.error : new Error(event.message || 'CDP WebSocket opening failed'));
      for (const [name, listener] of Object.entries(listeners)) socket.addEventListener(name, listener, { once: true });
      timer = schedule(() => settle(new Error('Timed out opening CDP WebSocket after ' + timeoutMs + 'ms')), timeoutMs);
    });
    return new Cdp(socket);
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('CDP closed'));
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
  rejectPending(error) {
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  close() {
    this.rejectPending(new Error('CDP closed'));
    this.socket.close();
  }
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
  assert.equal(response.status, 200);
  return response.json();
}

async function inspectBeforeStartup(mainPort, userData, child, options = {}) {
  const { lifecycle, beforeImport, inspectionTimeoutMs = 30_000,
    connect = url => Cdp.connect(url, { timeoutMs: inspectionTimeoutMs }), targets = listTargets, waitUntil = until,
    schedule = setTimeout, cancel = clearTimeout, expectedDirectPid } = options;
  const target = await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`startup process exited with ${child.exitCode}`);
    return (await targets(mainPort)).find(item => item.webSocketDebuggerUrl);
  }, 'main inspector', inspectionTimeoutMs);
  const cdp = await connect(target.webSocketDebuggerUrl);
  const scripts = new Map();
  cdp.on('Debugger.scriptParsed', script => scripts.set(script.scriptId, script.url));
  let resolvePaused;
  let rejectPaused;
  let entryHandled = false;
  const paused = new Promise((resolvePause, rejectPause) => { resolvePaused = resolvePause; rejectPaused = rejectPause; });
  // A pause/injection may reject while debugger setup still awaits a response.
  // The final race below remains authoritative; this prevents a stray rejection.
  paused.catch(() => {});
  cdp.on('Debugger.paused', async event => {
    try {
      const frame = event.callFrames[0];
      const url = scripts.get(frame.location.scriptId) || frame.url;
      // Unpackaged Electron first pauses in default_app.asar's ESM bootstrap.
      // Run only as far as our CJS entry breakpoint, before its imports/DB setup.
      if (!/\/out\/main\/index\.js$/.test(url)) { await cdp.send('Debugger.resume'); return; }
      if (entryHandled) return;
      entryHandled = true;
      const evaluate = async expression => {
        const result = await cdp.send('Debugger.evaluateOnCallFrame', {
          callFrameId: frame.callFrameId, returnByValue: true, expression
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      const isolation = await evaluate(`(() => {
        const electron = require('electron');
        const actual = electron.app.getPath('userData');
        if (actual !== ${JSON.stringify(userData)}) throw new Error('Refusing startup outside isolated userData: ' + actual);
        globalThis.__exa70Electron = electron;
        globalThis.__exa70StartupPreference = null;
        // Do not change the user's real Windows Run registry while checking a
        // fresh synthetic profile. IPC, windows, SQLite and preload stay real.
        electron.app.setLoginItemSettings = value => { globalThis.__exa70StartupPreference = value; };
        return { pid: process.pid, parentPid: process.ppid, executable: process.execPath,
          platform: process.platform, arch: process.arch,
          userData: actual, sessionData: electron.app.getPath('sessionData'),
          isPackaged: electron.app.isPackaged, versions: process.versions };
      })()`);
      assert.ok(Number.isSafeInteger(isolation.pid) && isolation.pid > 0, 'Inspector did not identify an owned Electron PID');
      if (expectedDirectPid !== undefined) assert.equal(isolation.pid, expectedDirectPid, 'Packaged inspector must belong to the directly spawned executable');
      if (lifecycle && isolation.pid !== child.pid) {
        // Register the actual Electron process while it is paused. A wrapper's
        // close, successful kill request or missing PID is not child closure.
        await lifecycle.observeOwnedPid(isolation.pid, { label: 'electron', executable: isolation.executable });
      }
      if (beforeImport) await beforeImport({ cdp, callFrameId: frame.callFrameId, isolation, evaluate });
      resolvePaused(isolation);
    } catch (error) { rejectPaused(error); }
  });
  let pauseTimeout;
  try {
    await cdp.send('Debugger.enable');
    const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/out/main/index\\.js$', lineNumber: 0 });
    await cdp.send('Runtime.runIfWaitingForDebugger');
    const isolation = await Promise.race([paused, new Promise((_, reject) => {
      pauseTimeout = schedule(() => reject(new Error('Did not reach app entry isolation breakpoint')), inspectionTimeoutMs);
    })]).finally(() => cancel(pauseTimeout));
    await cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
    await cdp.send('Debugger.resume');
    return { cdp, isolation };
  } catch (error) {
    cdp.close();
    throw error;
  }
}

function buildModeCommand({ mode, profile, mainPort, rendererPort, devPort, devConfig,
  applicationRoot = root, npmCliPath = npmCli, nodeExecutable = process.execPath }) {
  assert.ok(['dev', 'start', 'packaged'].includes(mode), 'Unknown normal-startup mode');
  const electronFlags = [`--inspect-brk=127.0.0.1:${mainPort}`, `--remote-debugging-port=${rendererPort}`,
    '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`];
  if (mode === 'dev') {
    assert.ok(devConfig && Number.isSafeInteger(devPort), 'Development mode needs an owned config and port');
    return { executable: nodeExecutable, args: [npmCliPath, 'run', 'dev', '--', '--config', devConfig,
      '--inspectBrk', String(mainPort), '--remoteDebuggingPort', String(rendererPort),
      '--', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`] };
  }
  if (mode === 'start') return { executable: nodeExecutable, args: [npmCliPath, 'start', '--', ...electronFlags] };
  return { executable: resolve(applicationRoot, 'release-build/win-unpacked/Bug Pocket.exe'), args: electronFlags };
}

async function createApplicationSession(options) {
  const { mode, profile, beforeImport, applicationRoot = root, inspectionTimeoutMs = 30_000,
    spawnProcess = spawn, lifecycleFactory = createProcessLifecycle, inspect = inspectBeforeStartup,
    allocatePort = freePort, exists = existsSync, write = writeFileSync, remove = rmSync,
    isPortClosed = portClosed, waitUntil = until, gracefulResponseTimeoutMs = 1000,
    schedule = setTimeout, cancel = clearTimeout } = options;
  assert.ok(Number.isFinite(gracefulResponseTimeoutMs) && gracefulResponseTimeoutMs > 0, 'Quit response deadline must be positive and finite');
  const mainPort = options.mainPort ?? await allocatePort();
  const rendererPort = options.rendererPort ?? await allocatePort();
  const devPort = mode === 'dev' ? (options.devPort ?? await allocatePort()) : null;
  const devConfig = mode === 'dev' ? join(applicationRoot, `.exa70-startup-${randomUUID()}.mjs`) : null;
  const command = buildModeCommand({ ...options, mode, profile, applicationRoot, mainPort, rendererPort, devPort, devConfig });
  if (mode === 'packaged') assert.ok(exists(command.executable), 'Build the unpacked Windows app before running packaged acceptance.');
  else assert.ok(exists(options.npmCliPath || npmCli), `npm CLI not found: ${options.npmCliPath || npmCli}`);
  if (devConfig) {
    // Import actual configuration and override only this fixture's server port.
    write(devConfig, `import config from './electron.vite.config.ts';\nexport default { ...config, renderer: { ...config.renderer, server: { ...config.renderer.server, port: ${devPort}, strictPort: true } } };\n`);
  }
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'BUG_POCKET_PACKAGED_SMOKE_TEST', 'BUG_POCKET_SMOKE_USER_DATA',
    'ELECTRON_RENDERER_URL', 'NO_SANDBOX', 'V8_INSPECTOR_PORT', 'V8_INSPECTOR_BRK_PORT', 'REMOTE_DEBUGGING_PORT', 'ELECTRON_CLI_ARGS']) delete env[key];
  const lifecycle = lifecycleFactory({ label: `normal-startup:${mode}` });
  if (mode !== 'packaged') lifecycle.expectOwnedPid('electron');
  let child;
  let main;
  let stdout = '';
  let stderr = '';
  let finishPromise;
  const session = {
    child: null, lifecycle, main: null, isolation: null, command: [command.executable, ...command.args],
    mainPort, rendererPort, devPort, devConfig,
    stdout: () => stdout, stderr: () => stderr,
    finish(error) {
      // Every caller shares this one receipt. No profile is removed here.
      if (error) lifecycle.recordFailure(error);
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        let gracefulError;
        let gracefulRequest;
        const receipt = await lifecycle.finish({ error, requestGraceful: main ? () => {
          gracefulRequest = (async () => {
            try { await main.evaluate('globalThis.__exa70Electron.app.quit()'); }
            catch (quitError) { gracefulError = quitError; }
          })();
          return gracefulRequest;
        } : undefined });
        try { main?.close(); } catch (closeError) { appendFailure(receipt, closeError, 'Close main inspector'); }
        if (gracefulRequest) {
          // CDP close rejects its pending command, which can cross several async
          // continuations. Await that exact request within a separate bound;
          // neither acknowledgement nor this deadline proves process closure.
          let responseTimer;
          const settled = await Promise.race([gracefulRequest.then(() => true), new Promise(resolveResponse => {
            responseTimer = schedule(() => resolveResponse(false), gracefulResponseTimeoutMs);
          })]).finally(() => cancel(responseTimer));
          if (!settled) receipt.diagnostics.push('Graceful quit CDP response remained unsettled after ' + gracefulResponseTimeoutMs + 'ms');
        }
        if (gracefulError) receipt.diagnostics.push(`Graceful quit CDP response ended: ${gracefulError.message}`);
        if (devConfig && receipt.terminationConfirmed) {
          try {
            await waitUntil(() => isPortClosed(devPort), 'owned development server to close', 5000);
            remove(devConfig, { force: true });
          } catch (cleanupError) {
            appendFailure(receipt, cleanupError, 'Development server/config cleanup');
            receipt.terminationConfirmed = false;
          }
        }
        return receipt;
      })();
      return finishPromise;
    }
  };
  try {
    child = spawnProcess(command.executable, command.args, { cwd: applicationRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    session.child = child;
    lifecycle.trackChild(child, mode === 'packaged' ? { label: 'electron' }
      : { label: 'npm-wrapper', allowTermination: true, requiresClosed: 'electron' });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const spawnFailure = new Promise((_, reject) => child.once('error', reject));
    const inspected = await Promise.race([
      inspect(mainPort, profile, child, { lifecycle, beforeImport, inspectionTimeoutMs,
        expectedDirectPid: mode === 'packaged' ? child.pid : undefined }), spawnFailure
    ]);
    main = inspected.cdp;
    session.main = main;
    session.isolation = inspected.isolation;
    if (mode === 'packaged') assert.equal(session.isolation.pid, child.pid, 'Packaged inspector must belong to the directly spawned executable');
    return session;
  } catch (error) {
    const receipt = await session.finish(error);
    const primary = receipt.error || error;
    primary.sessionResult = receipt;
    primary.sessionOutput = { command: session.command, stdout, stderr, profile };
    throw primary;
  }
}

function assertOwnedStartupProfile(directory, owner, io = {}) {
  const stat = io.lstat || lstatSync;
  const realpath = io.realpath || realpathSync;
  const read = io.read || readFileSync;
  const candidate = resolve(directory);
  assert.equal(candidate, owner.directory, 'Refusing cleanup outside this startup profile');
  const rel = relative(owner.base, candidate);
  assert.ok(rel && !rel.startsWith('..') && !rel.includes(sep) && basename(rel).startsWith('bug-pocket-exa70-startup-'),
    'Refusing cleanup outside owned startup root');
  for (let current = candidate; ; current = dirname(current)) {
    assert.equal(stat(current).isSymbolicLink(), false, `Refusing linked startup cleanup path: ${current}`);
    const parent = dirname(current);
    if (parent === current) break;
  }
  const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  assert.equal(normalize(realpath(candidate)), normalize(candidate), 'Startup cleanup real path changed');
  const marker = join(candidate, '.startup-profile-owner');
  assert.equal(stat(marker).isSymbolicLink(), false, 'Startup ownership marker became a link');
  assert.equal(read(marker, 'utf8'), owner.token, 'Startup ownership marker changed');
}

async function runMode(mode) {
  const temporary = mkdtempSync(join(tmpdir(), 'bug-pocket-exa70-startup-'));
  const profile = join(temporary, 'profile');
  mkdirSync(profile);
  const expectedUserData = mode === 'packaged' ? profile : `${profile}-dev`;
  mkdirSync(expectedUserData, { recursive: true });
  const owner = { directory: resolve(temporary), base: resolve(tmpdir()), token: randomUUID() };
  writeFileSync(join(temporary, '.startup-profile-owner'), owner.token, { flag: 'wx' });
  let session;
  let result;
  let firstError;
  let receipt;
  let main;
  let renderer;
  let originalCss;
  let originalComponent;
  const cssPath = join(root, 'src/renderer/src/styles.css');
  const componentPath = join(root, 'src/renderer/src/components/shared/BrandMark.tsx');
  try {
    session = await createApplicationSession({ mode, profile });
    const inspected = { cdp: session.main, isolation: session.isolation };
    main = inspected.cdp;
    assert.equal(inspected.isolation.isPackaged, mode === 'packaged');
    assert.equal(inspected.isolation.sessionData, profile);
    const target = await until(async () => (await listTargets(session.rendererPort))
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
    result = { mode, command: session.command, isolationBeforeUserCode: inspected.isolation,
      preferences, preloadScripts, acceptance, hmr, sqlite: join(expectedUserData, 'local.sqlite'),
      exclusions: ['Windows login Run registry update intercepted to avoid altering user startup preference'] };
  } catch (error) {
    firstError = error;
  } finally {
    const fixtureFailures = [];
    for (const [path, bytes] of [[cssPath, originalCss], [componentPath, originalComponent]]) {
      if (!bytes) continue;
      try {
        writeFileSync(path, bytes);
        assert.equal(hash(readFileSync(path)), hash(bytes), 'HMR fixture must be restored byte for byte');
      } catch (error) { fixtureFailures.push(error); }
    }
    try { renderer?.close(); } catch (error) { fixtureFailures.push(error); }
    if (!firstError && fixtureFailures.length) firstError = fixtureFailures[0];
    receipt = session ? await session.finish(firstError)
      : firstError?.sessionResult || { error: firstError, terminationConfirmed: true, processes: [], diagnostics: [] };
    for (const error of fixtureFailures) appendFailure(receipt, error, 'Restore startup fixture/renderer');
    receipt = await cleanupAfterClose(receipt, {
      profile: temporary, assertOwned: path => assertOwnedStartupProfile(path, owner)
    });
  }
  const streams = { stdout: session?.stdout() || firstError?.sessionOutput?.stdout || '',
    stderr: session?.stderr() || firstError?.sessionOutput?.stderr || '' };
  if (receipt.error) {
    receipt.error.stack += `\n[${mode} stdout]\n${streams.stdout}\n[${mode} stderr]\n${streams.stderr}`;
    receipt.error.validationResult = { mode, profile: temporary, ...streams, lifecycle: receipt };
    throw receipt.error;
  }
  return { ...result, ...streams, lifecycle: receipt };
}

function parseStartupCli(argv) {
  const modes = argv.filter(arg => !arg.startsWith('--output='));
  assert.ok(modes.length && modes.every(mode => ['dev', 'start', 'packaged'].includes(mode)),
    'usage: node scripts/test-toolchain-startup.cjs dev|start|packaged [...] [--output=path.json]');
  const outputs = argv.filter(arg => arg.startsWith('--output='));
  assert.ok(outputs.length <= 1 && outputs.every(arg => arg.length > '--output='.length), 'Specify one nonempty output path');
  return { modes, output: outputs[0]?.slice('--output='.length) };
}

async function main(argv = process.argv.slice(2)) {
  const { modes, output } = parseStartupCli(argv);
  assert.equal(process.platform, 'win32', 'This acceptance runner exercises Windows behavior.');
  const results = [];
  const save = failure => {
    if (!output) return;
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(output, `${JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version,
      platform: process.platform, results, ...(failure ? { failure } : {}) }, null, 2)}\n`);
  };
  try {
    for (const mode of modes) {
      results.push(await runMode(mode));
      console.log(`${mode}: normal renderer, isolated preload, accepted IPC and SQLite passed${mode === 'dev' ? '; CSS HMR and React Fast Refresh passed' : ''}`);
      save();
    }
  } catch (error) {
    try { save({ message: error.message, diagnostics: error.diagnostics || [], ...error.validationResult,
      lifecycle: error.validationResult?.lifecycle ? { ...error.validationResult.lifecycle, error: undefined } : undefined }); }
    catch (saveError) { (error.diagnostics ??= []).push(`Save startup failure evidence: ${saveError.message}`); }
    throw error;
  }
}

module.exports = { Cdp, freePort, listTargets, until, inspectBeforeStartup, buildModeCommand,
  createApplicationSession, assertOwnedStartupProfile, parseStartupCli, runMode, main };

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error); if (error.diagnostics?.length) console.error(error.diagnostics.join('\n')); process.exitCode = 1; });
}
