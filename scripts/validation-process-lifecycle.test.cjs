'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createProcessLifecycle, cleanupAfterClose } = require('./validation-process-lifecycle.cjs');
const { runSmokeTest } = require('./smoke-test.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));

function childFixture(pid = 71) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding = () => stream;
    stream.destroy = () => { stream.destroyed = true; };
  }
  child.stdin = Object.assign(new EventEmitter(), { writes: [], write(value) { this.writes.push(value); }, end() { this.ended = true; } });
  child.killCalls = [];
  child.kill = signal => { child.killCalls.push(signal); return true; };
  child.unref = () => { child.unreferenced = true; };
  return child;
}
function clockFixture() {
  const timers = new Map();
  return {
    options: {
      schedule(callback, milliseconds) { const token = {}; timers.set(token, { callback, milliseconds }); return token; },
      cancel(token) { timers.delete(token); }
    },
    fire(milliseconds) {
      const entry = [...timers].find(([, value]) => value.milliseconds === milliseconds);
      assert.ok(entry, `No pending ${milliseconds}ms deadline`);
      timers.delete(entry[0]); entry[1].callback();
    },
    timers
  };
}
function ownedFixture() {
  const clock = clockFixture();
  const watcher = childFixture(72);
  let launch;
  const lifecycle = createProcessLifecycle({ ...clock.options, spawnProcess(...args) { launch = args; return watcher; } });
  lifecycle.expectOwnedPid('electron');
  const ready = lifecycle.observeOwnedPid(99, { executable: 'C:\\synthetic\\electron.exe' });
  const nonce = launch[2].env.EXA66_OWNED_NONCE;
  return { lifecycle, watcher, ready, clock, observerSource: Buffer.from(launch[1].at(-1), 'base64').toString('utf16le'),
    report(event, extra = {}) { watcher.stdout.emit('data', `${JSON.stringify({ event, nonce, pid: 99, started: '1234', ...extra })}\n`); },
    makeReady() { this.report('ready', { executable: 'C:\\synthetic\\electron.exe' }); return ready; }
  };
}
const profile = 'C:\\synthetic\\owned-profile';
const cleanup = (receipt, options = {}) => cleanupAfterClose(receipt, {
  profile, assertOwned() {}, remove: async () => {}, wait: async () => {}, ...options
});

test('markers, exit events and kill acceptance cannot authorize direct-child cleanup', async () => {
  const clock = clockFixture(); const child = childFixture();
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.trackChild(child);
  const waiting = lifecycle.waitForClosed(25);
  child.stdout.emit('data', 'passed'); child.emit('exit', 0, null); child.kill('SIGKILL');
  clock.fire(25); assert.equal(await waiting, false);
  child.emit('close', 0, null);
  const receipt = await lifecycle.finish();
  assert.equal(receipt.terminationConfirmed, true); assert.equal(receipt.error, null);
});

test('absent close is bounded, keeps first failure and retains profile even after late close', async () => {
  const clock = clockFixture(); const child = childFixture();
  child.kill = () => { throw new Error('synthetic kill failure'); };
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.trackChild(child);
  const original = new Error('original assertion failure');
  const ending = lifecycle.finish({ error: original }); await turn(); clock.fire(5_000);
  const receipt = await ending;
  let removed = 0; await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, false); assert.equal(removed, 0);
  assert.match(original.diagnostics.join('\n'), /synthetic kill failure/);
  assert.equal(original.retainedProfile, profile); assert.equal(child.unreferenced, true);
  child.emit('close', 0, null); await turn();
  assert.equal(receipt.terminationConfirmed, false); assert.equal(removed, 0);
});

test('a delayed real close after termination permits cleanup without replacing timeout', async () => {
  const clock = clockFixture(); const child = childFixture();
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.trackChild(child);
  const original = new Error('phase timeout');
  const ending = lifecycle.finish({ error: original }); await turn();
  child.emit('exit', null, 'SIGKILL'); assert.equal(lifecycle.snapshot()[0].confirmedClosed, false);
  child.emit('close', null, 'SIGKILL');
  const receipt = await ending; let removed = 0;
  await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, true); assert.equal(removed, 1);
});

test('nonzero direct close is a failure even after a success marker', async () => {
  const child = childFixture(); const lifecycle = createProcessLifecycle(); lifecycle.trackChild(child);
  child.stdout.emit('data', 'passed'); child.emit('close', 9, null);
  const receipt = await lifecycle.finish();
  assert.equal(receipt.terminationConfirmed, true); assert.match(receipt.error.message, /abnormally/);
});

test('npm wrapper close without discovered Electron handle retains profile', async () => {
  const clock = clockFixture(); const child = childFixture();
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.expectOwnedPid('electron'); lifecycle.trackChild(child);
  child.emit('close', 0, null);
  const ending = lifecycle.finish(); await turn(); clock.fire(5_000);
  const receipt = await ending; let removed = 0;
  await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(receipt.terminationConfirmed, false); assert.equal(removed, 0);
  assert.match(receipt.error.diagnostics.join('\n'), /No confirmed process handle/);
});

test('owned handle report and watcher exit still require watcher close plus wrapper close', async () => {
  const f = ownedFixture(); const wrapper = childFixture(70); f.lifecycle.trackChild(wrapper);
  // Inspect the actual factory payload without launching PowerShell or any app.
  assert.match(f.observerSource, /\$commandReader = \[IO\.StreamReader\]::new\(\[Console\]::OpenStandardInput\(\)/);
  assert.doesNotMatch(f.observerSource, /\[Console\]::In\.ReadLineAsync/);
  assert.equal((f.observerSource.match(/\$commandReader\.ReadLineAsync\(\)/g) || []).length, 2);
  assert.match(f.observerSource, /\$commandReader\.Dispose\(\)/);
  await f.makeReady(); f.report('confirmed', { processExited: true, exitCode: 0 });
  f.watcher.emit('exit', 0, null); wrapper.emit('close', 0, null);
  const waiting = f.lifecycle.waitForClosed(30); f.clock.fire(30); assert.equal(await waiting, false);
  f.watcher.emit('close', 0, null);
  const receipt = await f.lifecycle.finish();
  assert.equal(receipt.terminationConfirmed, true); assert.equal(receipt.error, null);
  assert.equal(receipt.processes.length, 2);
});

test('watcher code zero without held-handle proof leaves owned Electron uncertain', async () => {
  const f = ownedFixture(); await f.makeReady(); f.watcher.emit('close', 0, null);
  const ending = f.lifecycle.finish(); await turn(); f.clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.terminationConfirmed, false); assert.match(receipt.error.message, /not confirmed/);
});

test('observer PID identity mismatch fails readiness and cannot authorize cleanup', async () => {
  const f = ownedFixture();
  const rejected = assert.rejects(f.ready, /identity mismatch/);
  f.report('ready', { pid: 100, executable: 'C:\\synthetic\\electron.exe' }); await rejected;
  const ending = f.lifecycle.finish(); await turn(); f.clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.terminationConfirmed, false); assert.equal(f.watcher.stdin.writes.length, 0);
});

test('a later observer closure cannot change a retained teardown receipt', async () => {
  const f = ownedFixture(); await f.makeReady();
  const original = new Error('before-import failure');
  const ending = f.lifecycle.finish({ error: original }); await turn(); f.clock.fire(5_000);
  const receipt = await ending;
  assert.equal(f.watcher.stdin.writes.length, 1);
  f.report('confirmed', { processExited: true, exitCode: 0 }); f.watcher.emit('close', 0, null);
  let removed = 0; await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, false); assert.equal(removed, 0);
});

test('spawn error remains primary after close and assertion failure', async () => {
  const child = childFixture(); const lifecycle = createProcessLifecycle(); lifecycle.trackChild(child);
  const original = new Error('synthetic spawn error'); child.emit('error', original); child.emit('close', -1, null);
  const receipt = await lifecycle.finish({ error: new Error('later assertion') });
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, true);
  assert.match(original.diagnostics.join('\n'), /later assertion/);
});

test('graceful request error is diagnostic on the existing first failure', async () => {
  const clock = clockFixture(); const child = childFixture();
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.trackChild(child);
  const original = new Error('first check failed');
  const ending = lifecycle.finish({ error: original, requestGraceful: async () => { throw new Error('graceful rejection'); } });
  await turn(); child.emit('close', 0, null);
  const receipt = await ending;
  assert.equal(receipt.error, original); assert.match(original.diagnostics.join('\n'), /graceful rejection/);
});

test('Windows transient cleanup retries revalidate ownership before every attempt', async () => {
  const receipt = { error: null, terminationConfirmed: true }; let attempts = 0; let checks = 0; const waits = [];
  await cleanup(receipt, { assertOwned() { checks++; }, remove: async () => {
    if (++attempts <= 3) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
  }, wait: async ms => waits.push(ms) });
  assert.equal(receipt.error, null); assert.equal(attempts, 4); assert.equal(checks, 4);
  assert.deepEqual(waits, [100, 200, 300]);
});

test('cleanup exhaustion retains profile and preserves original error', async () => {
  const original = new Error('native check failed'); const receipt = { error: original, terminationConfirmed: true };
  let attempts = 0;
  await cleanup(receipt, { remove: async () => { attempts++; throw Object.assign(new Error('lock persists'), { code: 'EPERM' }); } });
  assert.equal(receipt.error, original); assert.equal(attempts, 4); assert.equal(receipt.retainedProfile, profile);
  assert.match(original.diagnostics.join('\n'), /lock persists/);
});

test('ownership rejection never reaches recursive removal', async () => {
  const receipt = { error: null, terminationConfirmed: true }; let removed = 0;
  await cleanup(receipt, { assertOwned() { throw new Error('path escaped or became a link'); }, remove: async () => { removed++; } });
  assert.equal(removed, 0); assert.equal(receipt.retainedProfile, profile); assert.match(receipt.error.message, /escaped/);
});

const markers = '[packaged-smoke] database-ready\n[packaged-smoke] native-integrations-ready\n[packaged-smoke] preload-ready\n';
function smokeFixture({ remove, spawnFailure } = {}) {
  const clock = clockFixture(); const child = childFixture(); let removals = 0;
  const promise = runSmokeTest({ executable: 'C:\\synthetic\\Bug Pocket.exe', assertUnpacked() {},
    allocateProfile: () => ({ profile, assertOwned() {} }),
    spawnChild() { if (spawnFailure) throw spawnFailure; return child; }, pathExists: () => true,
    lifecycleOptions: clock.options, timeoutMs: 40, log() {},
    cleanupOptions: { remove: remove ?? (async () => { removals++; }), wait: async () => {} }
  });
  // Attach rejection handling before intentionally delivering fake failures.
  const outcome = promise.then(value => ({ value }), error => ({ error }));
  return { child, clock, outcome, removed: () => removals };
}

test('actual exported smoke flow cleans only after all assertions and confirmed close', async () => {
  const f = smokeFixture(); f.child.stdout.emit('data', markers); f.child.emit('close', 0, null);
  const { value, error } = await f.outcome;
  assert.equal(error, undefined); assert.equal(value.terminationConfirmed, true); assert.equal(f.removed(), 1);
});

test('actual smoke flow retains on timeout despite misleading markers and exit', async () => {
  const f = smokeFixture(); f.child.stdout.emit('data', markers); f.child.emit('exit', 0, null);
  f.clock.fire(40); await turn(); f.clock.fire(5_000);
  const { error } = await f.outcome;
  assert.match(error.message, /within 40ms/); assert.equal(error.terminationConfirmed, false);
  assert.equal(error.retainedProfile, profile); assert.equal(f.removed(), 0);
});

test('actual smoke flow waits for delayed close after timeout and keeps timeout first', async () => {
  const f = smokeFixture(); f.clock.fire(40); await turn();
  assert.equal(f.removed(), 0); f.child.emit('close', null, 'SIGKILL');
  const { error } = await f.outcome;
  assert.match(error.message, /within 40ms/); assert.equal(error.terminationConfirmed, true); assert.equal(f.removed(), 1);
});

test('actual smoke assertions still reject missing preload marker', async () => {
  const f = smokeFixture(); f.child.stdout.emit('data', markers.replace('[packaged-smoke] preload-ready', ''));
  f.child.emit('close', 0, null);
  const { error } = await f.outcome;
  assert.match(error.message, /isolated preload bridge/); assert.equal(f.removed(), 1);
});

test('actual smoke flow preserves synchronous spawn failure and can clean unlaunched profile', async () => {
  const original = new Error('spawn threw synchronously'); const f = smokeFixture({ spawnFailure: original });
  const { error } = await f.outcome;
  assert.equal(error, original); assert.equal(error.terminationConfirmed, true); assert.equal(f.removed(), 1);
});

test('actual smoke cleanup failure after successful checks is still a retained failure', async () => {
  let attempts = 0;
  const f = smokeFixture({ remove: async () => { attempts++; throw Object.assign(new Error('locked profile'), { code: 'EACCES' }); } });
  f.child.stdout.emit('data', markers); f.child.emit('close', 0, null);
  const { error } = await f.outcome;
  assert.equal(attempts, 4); assert.match(error.message, /locked profile/); assert.equal(error.retainedProfile, profile);
});

test('exported smoke ownership rejects a replaced directory junction', () => {
  const fs = require('node:fs');
  const { allocateSmokeProfile } = require('./smoke-test.cjs');
  const owned = allocateSmokeProfile();
  const target = `${owned.profile}-link-target`;
  // Both freshly allocated paths are inside this test session's configured
  // external TEMP root. Use only nonrecursive removals for the empty fixtures.
  owned.assertOwned(owned.profile);
  fs.rmdirSync(owned.profile);
  fs.mkdirSync(target);
  try {
    fs.symlinkSync(target, owned.profile, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => owned.assertOwned(owned.profile), /link/);
  } finally {
    if (fs.existsSync(owned.profile)) fs.unlinkSync(owned.profile);
    fs.rmdirSync(target);
  }
});

test('exported smoke ownership rejects an escaped removal target', () => {
  const fs = require('node:fs');
  const { allocateSmokeProfile } = require('./smoke-test.cjs');
  const owned = allocateSmokeProfile();
  try { assert.throws(() => owned.assertOwned(`${owned.profile}-outside`), /own freshly allocated/); }
  finally { owned.assertOwned(owned.profile); fs.rmdirSync(owned.profile); }
});

test('invalid observer proof cannot be repaired by later markers and close', async () => {
  const f = ownedFixture(); await f.makeReady();
  f.report('confirmed', { started: 'different-handle', processExited: true, exitCode: 0 });
  f.report('confirmed', { processExited: true, exitCode: 0 }); f.watcher.emit('close', 0, null);
  const ending = f.lifecycle.finish(); await turn(); f.clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.terminationConfirmed, false); assert.match(receipt.error.message, /Invalid owned process closure proof/);
  let removed = 0; await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(removed, 0); assert.equal(receipt.retainedProfile, profile);
});

test('observer synchronous spawn failure retains unresolved Electron ownership', async () => {
  const clock = clockFixture(); const original = new Error('observer spawn rejected');
  const lifecycle = createProcessLifecycle({ ...clock.options, spawnProcess() { throw original; } });
  lifecycle.expectOwnedPid('electron');
  await assert.rejects(lifecycle.observeOwnedPid(99, { executable: 'C:\\synthetic\\electron.exe' }), error => error === original);
  const ending = lifecycle.finish(); await turn(); clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, false);
});

test('unsettled graceful request has one bounded window before bounded forced teardown', async () => {
  const clock = clockFixture(); const child = childFixture();
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.trackChild(child);
  const original = new Error('initial check failure');
  const ending = lifecycle.finish({ error: original, requestGraceful: () => new Promise(() => {}) });
  await turn(); clock.fire(5_000); await turn();
  assert.equal(child.killCalls.length, 1); clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, false);
  assert.match(original.diagnostics.join('\n'), /graceful closure/);
  assert.equal(clock.timers.size, 0);
});

test('rejected kill request is diagnostic and never substitutes for close', async () => {
  const clock = clockFixture(); const child = childFixture(); child.kill = () => false;
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.trackChild(child);
  const original = new Error('phase already failed');
  const ending = lifecycle.finish({ error: original }); await turn(); clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, false);
  assert.match(original.diagnostics.join('\n'), /Kill request was not accepted/);
});

test('normal Electron closure permits bounded launcher termination but still waits for launcher close', async () => {
  const f = ownedFixture(); const wrapper = childFixture(70);
  f.lifecycle.trackChild(wrapper, { label: 'npm launcher', allowTermination: true, requiresClosed: 'electron' });
  await f.makeReady(); f.report('confirmed', { processExited: true, exitCode: 0 }); f.watcher.emit('close', 0, null);
  const ending = f.lifecycle.finish(); await turn();
  assert.equal(wrapper.killCalls.length, 1); wrapper.emit('exit', null, 'SIGKILL');
  assert.equal(f.lifecycle.snapshot().find(item => item.label === 'npm launcher').confirmedClosed, false);
  wrapper.emit('close', null, 'SIGKILL');
  const receipt = await ending;
  assert.equal(receipt.error, null); assert.equal(receipt.terminationConfirmed, true);
  assert.match(receipt.diagnostics.join('\n'), /after confirmed normal Electron closure/);
});

test('launcher allowTermination cannot waive abnormal Electron closure', async () => {
  const f = ownedFixture(); const wrapper = childFixture(70);
  f.lifecycle.trackChild(wrapper, { label: 'npm launcher', allowTermination: true, requiresClosed: 'electron' });
  await f.makeReady(); f.report('confirmed', { processExited: true, exitCode: 7 }); f.watcher.emit('close', 0, null);
  const ending = f.lifecycle.finish(); await turn(); wrapper.emit('close', null, 'SIGKILL');
  const receipt = await ending;
  assert.equal(receipt.terminationConfirmed, true); assert.ok(receipt.error);
  assert.match(receipt.error.diagnostics.join('\n'), /electron closed abnormally/);
});

test('expected launcher kill acknowledgement without close still retains profile', async () => {
  const f = ownedFixture(); const wrapper = childFixture(70);
  f.lifecycle.trackChild(wrapper, { label: 'npm launcher', allowTermination: true, requiresClosed: 'electron' });
  await f.makeReady(); f.report('confirmed', { processExited: true, exitCode: 0 }); f.watcher.emit('close', 0, null);
  const ending = f.lifecycle.finish(); await turn(); f.clock.fire(5_000);
  const receipt = await ending; let removed = 0;
  await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(receipt.terminationConfirmed, false); assert.equal(removed, 0);
  assert.match(receipt.error.diagnostics.join('\n'), /Stopping owned launcher/);
});

test('allowTermination launcher cannot waive an undiscovered Electron process', async () => {
  const clock = clockFixture(); const wrapper = childFixture();
  const lifecycle = createProcessLifecycle(clock.options); lifecycle.expectOwnedPid('electron');
  lifecycle.trackChild(wrapper, { allowTermination: true, requiresClosed: 'electron' });
  wrapper.emit('close', 0, null);
  const ending = lifecycle.finish(); await turn(); clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.terminationConfirmed, false); assert.ok(receipt.error);
});

test('normal child plus launcher kill failure preserves the original startup failure', async () => {
  const f = ownedFixture(); const wrapper = childFixture(70);
  wrapper.kill = () => { throw new Error('launcher termination rejected'); };
  f.lifecycle.trackChild(wrapper, { allowTermination: true, requiresClosed: 'electron' });
  await f.makeReady(); f.report('confirmed', { processExited: true, exitCode: 0 }); f.watcher.emit('close', 0, null);
  const original = new Error('first startup invariant failed');
  const ending = f.lifecycle.finish({ error: original }); await turn(); f.clock.fire(5_000);
  const receipt = await ending;
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, false);
  assert.match(original.diagnostics.join('\n'), /launcher termination rejected/);
});

test('asynchronous and late observer stdin EPIPE preserves first failure and uncertain profile', async () => {
  const f = ownedFixture(); await f.makeReady();
  const original = new Error('initial startup failure');
  const ending = f.lifecycle.finish({ error: original }); await turn();
  const pipeFailure = Object.assign(new Error('synthetic EPIPE after terminate write'), { code: 'EPIPE' });
  assert.doesNotThrow(() => f.watcher.stdin.emit('error', pipeFailure));
  f.clock.fire(5_000);
  const receipt = await ending; let removed = 0;
  await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, false); assert.equal(removed, 0);
  assert.match(original.diagnostics.join('\n'), /observer command pipe: synthetic EPIPE/);
  assert.doesNotThrow(() => f.watcher.stdin.emit('error', new Error('late EPIPE after receipt')));
  assert.equal(receipt.error, original); assert.equal(receipt.retainedProfile, profile);
  assert.match(original.diagnostics.join('\n'), /late EPIPE after receipt/);
});

test('late graceful rejection updates the returned stable receipt and preserves first failure', async () => {
  const child = childFixture(); const lifecycle = createProcessLifecycle(); lifecycle.trackChild(child);
  let rejectGraceful;
  const graceful = new Promise((_, reject) => { rejectGraceful = reject; });
  const original = new Error('first validation failure');
  const ending = lifecycle.finish({ error: original, requestGraceful: () => graceful });
  await turn(); child.emit('close', 0, null);
  const receipt = await ending;
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, true);
  rejectGraceful(new Error('late graceful request failure'));
  await turn();
  assert.equal(receipt.error, original);
  assert.match(receipt.diagnostics.join('\n'), /Graceful shutdown request: late graceful request failure/);
  assert.equal(await lifecycle.finish(), receipt, 'All finish callers must share the same mutable receipt');
});

test('late graceful rejection with no earlier failure remains visible on the returned receipt', async () => {
  const child = childFixture(); const lifecycle = createProcessLifecycle(); lifecycle.trackChild(child);
  let rejectGraceful;
  const graceful = new Promise((_, reject) => { rejectGraceful = reject; });
  const ending = lifecycle.finish({ requestGraceful: () => graceful });
  await turn(); child.emit('close', 0, null);
  const receipt = await ending; assert.equal(receipt.error, null);
  const failure = new Error('late first graceful failure'); rejectGraceful(failure);
  await turn();
  assert.equal(receipt.error, failure); assert.equal(failure.terminationConfirmed, true);
  assert.equal(receipt.diagnostics, failure.diagnostics);
});

test('termination-request diagnostic does not taint a later valid held-handle closure', async () => {
  const f = ownedFixture(); await f.makeReady();
  const original = new Error('original validation failure');
  const ending = f.lifecycle.finish({ error: original }); await turn();
  f.report('diagnostic', { message: 'held-handle termination request failed' });
  f.report('confirmed', { processExited: true, exitCode: 0 }); f.watcher.emit('close', 0, null);
  const receipt = await ending; let removed = 0;
  await cleanup(receipt, { remove: async () => { removed++; } });
  assert.equal(receipt.error, original); assert.equal(receipt.terminationConfirmed, true); assert.equal(removed, 1);
  assert.match(receipt.diagnostics.join('\n'), /held-handle termination request failed/);
});
