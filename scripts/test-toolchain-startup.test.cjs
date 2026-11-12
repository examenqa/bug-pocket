'use strict';
// Synthetic host-only regression fixtures. No child application or network is used.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const test = require('node:test');
const {
  Cdp, inspectBeforeStartup, buildModeCommand, createApplicationSession,
  assertOwnedStartupProfile, parseStartupCli, runMode
} = require('./test-toolchain-startup.cjs');

function deferred() {
  let resolvePromise;
  const promise = new Promise(resolveValue => { resolvePromise = resolveValue; });
  return { promise, resolve: resolvePromise };
}

function inspectorFixture({ onRun = true, pid = 212 } = {}) {
  const events = [];
  const listeners = new Map();
  const cdp = {
    closed: false,
    on(method, listener) { listeners.set(method, listener); },
    async send(method, params) {
      events.push(method);
      if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'entry' };
      if (method === 'Debugger.evaluateOnCallFrame') {
        return { result: { value: params.expression.includes("require('electron')")
          ? { pid, parentPid: 111, executable: 'C:\\verified\\electron.exe', userData: 'C:\\synthetic\\profile' }
          : 'injected' } };
      }
      if (method === 'Runtime.runIfWaitingForDebugger' && onRun) {
        queueMicrotask(() => listeners.get('Debugger.paused')({
          callFrames: [{ callFrameId: 'entry-frame', url: '/app/out/main/index.js', location: { scriptId: 'entry' } }]
        }));
      }
      return {};
    },
    async evaluate(expression) { events.push(expression); return undefined; },
    close() { cdp.closed = true; events.push('close'); }
  };
  return { cdp, events, options: {
    connect: async () => cdp,
    targets: async () => [{ webSocketDebuggerUrl: 'ws://synthetic-not-opened' }],
    waitUntil: async check => check(),
    inspectionTimeoutMs: 1000
  } };
}

test('import is side-effect free and CLI retains the three existing mode entrypoints', () => {
  assert.deepEqual(parseStartupCli(['dev', 'start', 'packaged', '--output=C:\\review\\result.json']),
    { modes: ['dev', 'start', 'packaged'], output: 'C:\\review\\result.json' });
  assert.throws(() => parseStartupCli([]), /usage/);
  assert.throws(() => parseStartupCli(['start', '--unknown']), /usage/);
  assert.throws(() => parseStartupCli(['start', '--output=a', '--output=b']), /one nonempty/);
});

test('mode command builder retains dev, start and packaged flags without spawning', () => {
  const common = { profile: 'C:\\synthetic\\profile', mainPort: 1001, rendererPort: 1002,
    applicationRoot: 'C:\\synthetic\\app', npmCliPath: 'C:\\portable\\npm-cli.js', nodeExecutable: 'C:\\portable\\node.exe' };
  const start = buildModeCommand({ ...common, mode: 'start' });
  assert.equal(start.executable, common.nodeExecutable);
  assert.deepEqual(start.args.slice(0, 3), [common.npmCliPath, 'start', '--']);
  assert.ok(start.args.includes('--inspect-brk=127.0.0.1:1001'));
  assert.ok(start.args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(start.args.includes('--user-data-dir=C:\\synthetic\\profile'));
  const dev = buildModeCommand({ ...common, mode: 'dev', devPort: 1003, devConfig: 'C:\\synthetic\\fixture.mjs' });
  assert.deepEqual(dev.args.slice(0, 4), [common.npmCliPath, 'run', 'dev', '--']);
  assert.ok(dev.args.includes('--inspectBrk'));
  assert.equal(buildModeCommand({ ...common, mode: 'packaged' }).executable,
    resolve(common.applicationRoot, 'release-build/win-unpacked/Bug Pocket.exe'));
  assert.throws(() => buildModeCommand({ ...common, mode: 'other' }), /Unknown/);
});

test('entry stays paused until actual Electron handle and pre-import injection both finish', async () => {
  const fixture = inspectorFixture();
  const observing = deferred();
  const handleReady = deferred();
  const injecting = deferred();
  const injectionReady = deferred();
  const order = [];
  const pending = inspectBeforeStartup(1001, 'C:\\synthetic\\profile', { pid: 111, exitCode: null }, {
    ...fixture.options,
    lifecycle: { async observeOwnedPid(pid, options) {
      assert.equal(pid, 212);
      assert.deepEqual(options, { label: 'electron', executable: 'C:\\verified\\electron.exe' });
      order.push('observe'); observing.resolve(); await handleReady.promise; order.push('handle-ready');
    } },
    async beforeImport(context) {
      assert.equal(context.callFrameId, 'entry-frame');
      assert.equal(context.isolation.pid, 212);
      assert.equal(await context.evaluate('synthetic injection'), 'injected');
      order.push('inject'); injecting.resolve(); await injectionReady.promise; order.push('injected');
    }
  });
  await observing.promise;
  assert.equal(fixture.events.includes('Debugger.resume'), false);
  handleReady.resolve();
  await injecting.promise;
  assert.equal(fixture.events.includes('Debugger.resume'), false);
  injectionReady.resolve();
  const result = await pending;
  assert.deepEqual(order, ['observe', 'handle-ready', 'inject', 'injected']);
  assert.equal(result.isolation.pid, 212);
  assert.equal(fixture.events.at(-1), 'Debugger.resume');
  result.cdp.close();
});

test('failed child-handle witness prevents injection/resume and keeps the original error', async () => {
  const fixture = inspectorFixture();
  const original = new Error('handle denied');
  let injected = false;
  await assert.rejects(inspectBeforeStartup(1001, 'C:\\synthetic\\profile', { pid: 111, exitCode: null }, {
    ...fixture.options,
    lifecycle: { async observeOwnedPid() { throw original; } },
    beforeImport: async () => { injected = true; }
  }), error => error === original);
  assert.equal(injected, false);
  assert.equal(fixture.events.includes('Debugger.resume'), false);
  assert.equal(fixture.cdp.closed, true);
});

test('direct packaged PID mismatch fails before any pre-import injection', async () => {
  const fixture = inspectorFixture();
  let injected = false;
  await assert.rejects(inspectBeforeStartup(1001, 'C:\\synthetic\\profile', { pid: 111, exitCode: null }, {
    ...fixture.options, expectedDirectPid: 111,
    beforeImport: async () => { injected = true; }
  }), /directly spawned/);
  assert.equal(injected, false);
  assert.equal(fixture.cdp.closed, true);
});

test('pre-import failure is preserved and never resumes application imports', async () => {
  const fixture = inspectorFixture();
  const original = new Error('injection failed');
  await assert.rejects(inspectBeforeStartup(1001, 'C:\\synthetic\\profile', { pid: 212, exitCode: null }, {
    ...fixture.options, beforeImport: async () => { throw original; }
  }), error => error === original);
  assert.equal(fixture.events.includes('Debugger.resume'), false);
  assert.equal(fixture.cdp.closed, true);
});

test('synthetic inspector timeout closes CDP without resuming application imports', async () => {
  const fixture = inspectorFixture({ onRun: false });
  await assert.rejects(inspectBeforeStartup(1001, 'C:\\synthetic\\profile', { pid: 111, exitCode: null }, {
    ...fixture.options,
    schedule(callback) { queueMicrotask(callback); return 1; }, cancel() {}
  }), /entry isolation breakpoint/);
  assert.equal(fixture.cdp.closed, true);
  assert.equal(fixture.events.includes('Debugger.resume'), false);
});

function sessionFixture({ inspectError, existingError, confirmed = true } = {}) {
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 111, exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter()
  });
  const main = {
    async evaluate(expression) { events.push(expression); },
    close() { events.push('cdp-close'); }
  };
  let failure = existingError;
  const lifecycle = {
    expectOwnedPid(label) { events.push('expect:' + label); },
    trackChild(actual, options) {
      assert.equal(actual, child);
      assert.deepEqual(options, { label: 'npm-wrapper', allowTermination: true, requiresClosed: 'electron' });
      events.push('track:' + options.label);
    },
    recordFailure(error) { failure ||= error; },
    async finish({ error, requestGraceful }) {
      failure ||= error;
      if (requestGraceful) await requestGraceful();
      events.push('finish');
      return { error: failure || null, terminationConfirmed: confirmed, diagnostics: [], processes: [] };
    }
  };
  const options = { mode: 'start', profile: 'C:\\synthetic\\profile', mainPort: 1001, rendererPort: 1002,
    exists: () => true, lifecycleFactory: () => lifecycle,
    spawnProcess() { events.push('spawn'); return child; },
    inspect: async (_port, _profile, actual, opts) => {
      assert.equal(actual, child);
      assert.equal(opts.lifecycle, lifecycle);
      events.push('inspect');
      if (inspectError) throw inspectError;
      return { cdp: main, isolation: { pid: 212 } };
    },
    remove() { throw new Error('Session must never remove a profile'); }
  };
  return { options, events, child, main, lifecycle };
}

test('session expects a child before wrapper spawn and exports one first-error-preserving teardown', async () => {
  const fixture = sessionFixture();
  const session = await createApplicationSession(fixture.options);
  assert.deepEqual(fixture.events.slice(0, 4), ['expect:electron', 'spawn', 'track:npm-wrapper', 'inspect']);
  fixture.child.stdout.emit('data', Buffer.from('synthetic success marker'));
  fixture.child.stderr.emit('data', Buffer.from('synthetic stderr'));
  assert.equal(session.stdout(), 'synthetic success marker');
  assert.equal(session.stderr(), 'synthetic stderr');
  const original = new Error('original assertion');
  const pending = session.finish(original);
  assert.equal(session.finish(), pending);
  const receipt = await pending;
  assert.equal(receipt.error, original);
  assert.equal(receipt.terminationConfirmed, true);
  assert.deepEqual(fixture.events.slice(-3), ['globalThis.__exa70Electron.app.quit()', 'finish', 'cdp-close']);
});

test('inspector failure still tears down wrapper and returns uncertain closure without deleting profile', async () => {
  const original = new Error('inspector failed before PID discovery');
  const fixture = sessionFixture({ inspectError: original, confirmed: false });
  await assert.rejects(createApplicationSession(fixture.options), error => {
    assert.equal(error, original);
    assert.equal(error.sessionResult.error, original);
    assert.equal(error.sessionResult.terminationConfirmed, false);
    assert.equal(error.sessionOutput.profile, fixture.options.profile);
    return true;
  });
  assert.equal(fixture.events.at(-1), 'finish');
});

test('an earlier lifecycle failure remains primary when inspector setup later fails', async () => {
  const original = new Error('earlier owned child failure');
  const later = new Error('later inspector timeout');
  const fixture = sessionFixture({ inspectError: later, existingError: original, confirmed: false });
  await assert.rejects(createApplicationSession(fixture.options), error => {
    assert.equal(error, original);
    assert.equal(error.sessionResult.error, original);
    return true;
  });
});

function ownershipFixture() {
  const base = resolve('C:\\synthetic\\scratch');
  const directory = join(base, 'bug-pocket-exa70-startup-fixture');
  const owner = { base, directory, token: 'synthetic-token' };
  const io = {
    lstat: () => ({ isSymbolicLink: () => false }),
    realpath: path => path,
    read: () => owner.token
  };
  return { directory, owner, io };
}

test('startup profile ownership accepts only the generated directory and marker', () => {
  const { directory, owner, io } = ownershipFixture();
  assert.doesNotThrow(() => assertOwnedStartupProfile(directory, owner, io));
  assert.throws(() => assertOwnedStartupProfile(join(owner.base, 'other'), owner, io), /outside this startup profile/);
  assert.throws(() => assertOwnedStartupProfile(directory, { ...owner, base: join(owner.base, 'escape') }, io), /owned startup root/);
  assert.throws(() => assertOwnedStartupProfile(directory, owner, { ...io, read: () => 'changed' }), /marker changed/);
});

test('startup cleanup rejects changed real paths and linked ancestor/ownership markers', () => {
  const { directory, owner, io } = ownershipFixture();
  assert.throws(() => assertOwnedStartupProfile(directory, owner, { ...io,
    realpath: () => join(owner.base, 'outside') }), /real path changed/);
  assert.throws(() => assertOwnedStartupProfile(directory, owner, { ...io,
    lstat: path => ({ isSymbolicLink: () => path === owner.base }) }), /linked startup cleanup/);
  assert.throws(() => assertOwnedStartupProfile(directory, owner, { ...io,
    lstat: path => ({ isSymbolicLink: () => path.endsWith('.startup-profile-owner') }) }), /marker became a link/);
});

function startupSetupFixture(t) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'bug-pocket-exa71-tests-'));
  const sentinel = join(base, 'unrelated.txt');
  writeFileSync(sentinel, 'keep');
  t.after(() => {
    assert.equal(dirname(resolve(base)), realpathSync(tmpdir()));
    assert.ok(basename(base).startsWith('bug-pocket-exa71-tests-'));
    rmSync(base, { recursive: true, force: true });
  });
  let directory;
  let sessionCalls = 0;
  const options = {
    temporaryBase: base,
    makeTemporary(prefix) { directory = mkdtempSync(prefix); return directory; },
    startSession() { sessionCalls++; throw new Error('Application session is mocked'); },
    cleanupOptions: { wait: async () => {} }
  };
  return { base, options, directory: () => directory,
    rejectSession(error) {
      options.startSession = async () => { sessionCalls++; throw error; };
    },
    async fails(original, overrides, { retained = false, expectedSessions = 0 } = {}) {
      await assert.rejects(runMode('start', { ...options, ...overrides }), error => {
        assert.equal(error, original, 'The setup failure must remain the primary error');
        assert.equal(error.validationResult.lifecycle.error, original);
        assert.equal(error.validationResult.lifecycle.retainedProfile, retained ? directory : undefined);
        return true;
      });
      assert.equal(sessionCalls, expectedSessions);
      assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
      if (directory) assert.equal(existsSync(directory), retained);
    }
  };
}

test('runMode skips removal when temporary allocation fails', async t => {
  const fixture = startupSetupFixture(t);
  const original = new Error('temporary allocation failed');
  let removals = 0;
  await fixture.fails(original, {
    makeTemporary() { throw original; },
    cleanupOptions: { remove() { removals++; } }
  });
  assert.equal(removals, 0);
});

for (const phase of ['before', 'partial', 'complete']) {
  test(`runMode cleans its directory when marker writing fails (${phase})`, async t => {
    const fixture = startupSetupFixture(t);
    const original = new Error(`marker write failed: ${phase}`);
    await fixture.fails(original, {
      write(marker, token, options) {
        if (phase !== 'before') writeFileSync(marker, phase === 'partial' ? token.slice(0, 4) : token, options);
        throw original;
      }
    });
  });
}

for (const failingCall of [1, 2]) {
  test(`runMode cleans initialized ownership when profile mkdir ${failingCall} fails`, async t => {
    const fixture = startupSetupFixture(t);
    const original = new Error('profile directory setup failed');
    let calls = 0;
    await fixture.fails(original, {
      mkdir(directory, options) {
        assert.ok(existsSync(join(fixture.directory(), '.startup-profile-owner')));
        if (++calls === failingCall) throw original;
        mkdirSync(directory, options);
      }
    });
    assert.equal(calls, failingCall);
  });
}

for (const initialized of [false, true]) {
  test(`runMode preserves setup failure and cleanup diagnostics (marker initialized: ${initialized})`, async t => {
    const fixture = startupSetupFixture(t);
    const original = new Error('original setup failure');
    let removals = 0;
    await fixture.fails(original, {
      ...(initialized ? { mkdir() { throw original; } } : { write() { throw original; } }),
      cleanupOptions: { cleanupRetries: 0, remove(directory) {
        assert.equal(directory, fixture.directory());
        removals++;
        throw new Error('synthetic cleanup failure');
      } }
    }, { retained: true });
    assert.equal(removals, 1);
    assert.equal(original.retainedProfile, fixture.directory());
    assert.ok(original.diagnostics.includes('Profile cleanup: synthetic cleanup failure'));
    assert.ok(original.diagnostics.includes(`Profile retained: ${fixture.directory()}`));
  });
}

test('runMode refuses pre-marker cleanup of a replacement directory', async t => {
  const fixture = startupSetupFixture(t);
  const original = new Error('marker setup interrupted');
  const held = join(fixture.base, 'held-original');
  let replacementSentinel;
  await fixture.fails(original, {
    write() {
      renameSync(fixture.directory(), held);
      mkdirSync(fixture.directory());
      replacementSentinel = join(fixture.directory(), 'replacement.txt');
      writeFileSync(replacementSentinel, 'preserve replacement');
      throw original;
    }
  }, { retained: true });
  assert.ok(existsSync(held));
  assert.equal(readFileSync(replacementSentinel, 'utf8'), 'preserve replacement');
  assert.match(original.diagnostics.join('\n'), /identity changed during setup/);
});

test('runMode still requires the completed ownership marker after setup initialization', async t => {
  const fixture = startupSetupFixture(t);
  const original = new Error('directory setup interrupted');
  await fixture.fails(original, {
    mkdir() {
      writeFileSync(join(fixture.directory(), '.startup-profile-owner'), 'changed');
      throw original;
    }
  }, { retained: true });
  assert.match(original.diagnostics.join('\n'), /marker changed/);
});

test('runMode cleans initialized setup after a mocked session rejection', async t => {
  const fixture = startupSetupFixture(t);
  const original = new Error('mock session setup failed before launch');
  fixture.rejectSession(original);
  await fixture.fails(original, undefined, { expectedSessions: 1 });
});

test('runMode retains initialized setup when mocked session closure is unconfirmed', async t => {
  const fixture = startupSetupFixture(t);
  const original = new Error('mock session closure unconfirmed');
  original.sessionResult = { error: original, terminationConfirmed: false, processes: [], diagnostics: [] };
  fixture.rejectSession(original);
  await fixture.fails(original, undefined, { retained: true, expectedSessions: 1 });
  assert.equal(original.terminationConfirmed, false);
  assert.match(original.diagnostics.join('\n'), /process closure is unconfirmed/);
});

test('CDP socket closure rejects pending commands immediately and rejects later sends', async () => {
  const listeners = new Map();
  const socket = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    send() {},
    close() {}
  };
  const cdp = new Cdp(socket);
  const pending = cdp.send('Runtime.evaluate');
  const rejected = assert.rejects(pending, /socket closed/);
  listeners.get('close')();
  await rejected;
  assert.equal(cdp.pending.size, 0);
  await assert.rejects(cdp.send('Debugger.resume'), /CDP closed/);
  cdp.close();
});

function openingSocketFixture({ closeError } = {}) {
  const listeners = new Map();
  let closeCount = 0;
  const socket = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    send() {},
    close() {
      closeCount++;
      if (closeError) throw closeError;
      listeners.get('close')?.();
    }
  };
  return { socket, emit: (name, event) => listeners.get(name)?.(event), closes: () => closeCount };
}

test('CDP opening has a deterministic timeout and closes the incomplete socket', async () => {
  const fixture = openingSocketFixture();
  let canceled = 0;
  await assert.rejects(Cdp.connect('ws://synthetic-not-opened', {
    createSocket: () => fixture.socket, timeoutMs: 25,
    schedule(callback, delay) { assert.equal(delay, 25); queueMicrotask(callback); return 9; },
    cancel(timer) { assert.equal(timer, 9); canceled++; }
  }), /Timed out opening CDP WebSocket after 25ms/);
  assert.equal(fixture.closes(), 1);
  assert.equal(canceled, 1);
});

test('CDP pre-open closure fails promptly and keeps socket cleanup errors diagnostic', async () => {
  const fixture = openingSocketFixture({ closeError: new Error('synthetic close failure') });
  let timerCallback;
  const pending = Cdp.connect('ws://synthetic-not-opened', {
    createSocket: () => fixture.socket, schedule(callback) { timerCallback = callback; return 8; }, cancel() {}
  });
  fixture.emit('close');
  await assert.rejects(pending, error => {
    assert.equal(error.message, 'CDP socket closed before opening');
    assert.deepEqual(error.diagnostics, ['Close opening CDP socket: synthetic close failure']);
    return true;
  });
  timerCallback(); // A late timeout cannot replace the first error.
  assert.equal(fixture.closes(), 1);
});

test('CDP opening keeps the original error and clears the deadline on success', async () => {
  const original = new Error('synthetic handshake failure');
  const failed = openingSocketFixture();
  const rejection = Cdp.connect('ws://synthetic-not-opened', {
    createSocket: () => failed.socket, schedule: () => 1, cancel() {}
  });
  failed.emit('error', { error: original });
  await assert.rejects(rejection, error => error === original);
  assert.equal(failed.closes(), 1);

  const opened = openingSocketFixture();
  let canceled = false;
  const connection = Cdp.connect('ws://synthetic-not-opened', {
    createSocket: () => opened.socket, schedule: () => 2, cancel(timer) { canceled = timer === 2; }
  });
  opened.emit('open');
  const cdp = await connection;
  assert.equal(canceled, true);
  assert.equal(cdp.socket, opened.socket);
  assert.equal(opened.closes(), 0);
  cdp.close();
});

test('quit CDP rejection after helper finish and several microtasks remains diagnostic', async () => {
  for (const original of [undefined, new Error('original assertion')]) {
    const fixture = sessionFixture();
    let rejectQuit;
    const quit = new Promise((_, reject) => { rejectQuit = reject; });
    fixture.main.evaluate = () => quit;
    fixture.main.close = () => queueMicrotask(() => queueMicrotask(() => rejectQuit(new Error('socket response ended after close'))));
    fixture.lifecycle.finish = async ({ requestGraceful }) => {
      requestGraceful();
      return { error: original || null, terminationConfirmed: true, diagnostics: [], processes: [] };
    };
    const session = await createApplicationSession(fixture.options);
    const receipt = await session.finish(original);
    assert.equal(receipt.error, original || null);
    assert.equal(receipt.terminationConfirmed, true);
    assert.deepEqual(receipt.diagnostics, ['Graceful quit CDP response ended: socket response ended after close']);
  }
});

test('an unsettled quit response is bounded independently of confirmed process closure', async () => {
  const fixture = sessionFixture();
  fixture.main.evaluate = () => new Promise(() => {});
  fixture.lifecycle.finish = async ({ requestGraceful }) => {
    requestGraceful();
    return { error: null, terminationConfirmed: true, diagnostics: [], processes: [] };
  };
  const session = await createApplicationSession({ ...fixture.options, gracefulResponseTimeoutMs: 17,
    schedule(callback, delay) { assert.equal(delay, 17); queueMicrotask(callback); return 17; }, cancel() {} });
  const receipt = await session.finish();
  assert.equal(receipt.error, null);
  assert.equal(receipt.terminationConfirmed, true);
  assert.deepEqual(receipt.diagnostics, ['Graceful quit CDP response remained unsettled after 17ms']);
});
