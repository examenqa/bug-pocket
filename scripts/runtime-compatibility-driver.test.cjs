const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { runHarnessChild, withProfileCleanup } = require('./runtime-compatibility-driver.cjs');

// Advance only the requested deadline: no wall-clock sleeps or races with kill.
function fixture() {
  const pending = new Map();
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.destroy = () => { child.stdout.destroyed = true; };
  child.stderr.destroy = () => { child.stderr.destroyed = true; };
  child.killCalls = [];
  child.kill = signal => { child.killCalls.push(signal); return true; };
  child.unref = () => { child.unreferenced = true; };
  const options = {
    phase: 'write',
    timeoutMs: 60_000,
    terminationTimeoutMs: 5_000,
    schedule: (callback, milliseconds) => { const token = {}; pending.set(token, { callback, milliseconds }); return token; },
    cancel: token => { pending.delete(token); },
    stdout: () => {},
    stderr: () => {}
  };
  return {
    child, options, pending,
    deadline(milliseconds) {
      const entry = Array.from(pending).find(([, task]) => task.milliseconds === milliseconds);
      assert.ok(entry, `No pending ${milliseconds}ms deadline`);
      pending.delete(entry[0]); entry[1].callback();
    },
    run() { return runHarnessChild(() => child, options); }
  };
}

const profile = 'synthetic-profile';
const turn = () => new Promise(resolveTurn => setImmediate(resolveTurn));

test('timeout keeps the profile until delayed child close, even after exit or a pass marker', async () => {
  const f = fixture();
  const events = [];
  let settled = false;
  const outcome = withProfileCleanup(profile, () => f.run(), {
    remove: async () => { events.push('cleanup'); }
  }).then(() => { settled = true; }, error => { settled = true; return error; });
  f.child.stdout.emit('data', '[runtime-compatibility] write passed');
  f.deadline(60_000);
  assert.deepEqual(f.child.killCalls, ['SIGKILL']);
  f.child.emit('error', new Error('asynchronous kill failure'));
  f.child.emit('exit', null, 'SIGKILL');
  await turn();
  assert.equal(settled, false);
  assert.deepEqual(events, [], 'No cleanup before close confirms termination and stdio closure');
  events.push('close'); f.child.emit('close', null, 'SIGKILL');
  const error = await outcome;
  assert.match(error.message, /write timed out/);
  assert.equal(error.terminationConfirmed, true);
  assert.match(error.output, /write passed/);
  assert.match(error.diagnostics.join('\n'), /asynchronous kill failure/);
  assert.deepEqual(events, ['close', 'cleanup']);
  assert.equal(f.pending.size, 0);
});

test('unconfirmed termination is bounded and retains the profile with path diagnostics', async () => {
  const f = fixture();
  let removes = 0;
  const outcome = withProfileCleanup(profile, () => f.run(), {
    remove: async () => { removes++; }
  }).catch(error => error);
  f.deadline(60_000);
  f.deadline(5_000);
  const error = await outcome;
  assert.match(error.message, /write timed out/);
  assert.equal(error.terminationConfirmed, false);
  assert.equal(error.retainedProfile, profile);
  assert.match(error.diagnostics.join('\n'), /close was not confirmed/);
  assert.match(error.diagnostics.join('\n'), /Profile retained.*synthetic-profile/);
  assert.equal(removes, 0);
  assert.equal(f.child.unreferenced, true);
  assert.equal(f.child.stdout.destroyed, true);
  assert.equal(f.child.stderr.destroyed, true);
  // Late error/close events neither throw nor authorize delayed deletion.
  assert.doesNotThrow(() => f.child.emit('error', new Error('late kill error')));
  f.child.emit('close', null, 'SIGKILL');
  assert.equal(removes, 0);
});

test('kill failure does not replace timeout and cannot authorize profile deletion', async () => {
  const f = fixture();
  f.child.kill = () => { throw new Error('access denied'); };
  const outcome = withProfileCleanup(profile, () => f.run(), {
    remove: async () => { assert.fail('Child termination was not confirmed'); }
  }).catch(error => error);
  f.deadline(60_000); f.deadline(5_000);
  const error = await outcome;
  assert.match(error.message, /write timed out/);
  assert.match(error.diagnostics.join('\n'), /access denied/);
  assert.equal(error.retainedProfile, profile);
});

test('Windows cleanup retries after close preserve the original timeout error', async () => {
  const f = fixture();
  const delays = [];
  let removes = 0;
  let originalError;
  const outcome = withProfileCleanup(profile, () => f.run().catch(error => { originalError = error; throw error; }), {
    remove: async () => {
      removes++;
      if (removes <= 2) throw Object.assign(new Error('Windows handle not released yet'), { code: removes === 1 ? 'EBUSY' : 'EPERM' });
    },
    wait: async milliseconds => { delays.push(milliseconds); }
  }).catch(error => error);
  f.deadline(60_000); f.child.emit('close', null, 'SIGKILL');
  const error = await outcome;
  assert.equal(error, originalError);
  assert.match(error.message, /write timed out/);
  assert.equal(removes, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(error.retainedProfile, undefined);
});

test('exhausted cleanup retries retain the profile without replacing the original failure', async () => {
  const originalError = new Error('original timeout');
  originalError.terminationConfirmed = true;
  const delays = [];
  let removes = 0;
  const error = await withProfileCleanup(profile, async () => { throw originalError; }, {
    remove: async () => { removes++; throw Object.assign(new Error('locked file'), { code: 'EBUSY' }); },
    wait: async milliseconds => { delays.push(milliseconds); }
  }).catch(error => error);
  assert.equal(error, originalError);
  assert.equal(error.message, 'original timeout');
  assert.equal(removes, 4);
  assert.deepEqual(delays, [100, 200, 300]);
  assert.equal(error.retainedProfile, profile);
  assert.match(error.diagnostics.join('\n'), /cleanup failed: locked file/);
  assert.match(error.diagnostics.join('\n'), /synthetic-profile/);
});

test('permanent cleanup errors are not retried or silently accepted after child success', async () => {
  const cleanupError = Object.assign(new Error('disk I/O failure'), { code: 'EIO' });
  let removes = 0;
  const error = await withProfileCleanup(profile, async () => 'success', {
    remove: async () => { removes++; throw cleanupError; },
    wait: async () => assert.fail('Permanent I/O errors should not be retried')
  }).catch(error => error);
  assert.equal(error, cleanupError);
  assert.equal(removes, 1);
  assert.equal(error.retainedProfile, profile);
});

test('asynchronous spawn failure waits for close and preserves the spawn error', async () => {
  const f = fixture();
  const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  let removes = 0;
  const outcome = withProfileCleanup(profile, () => f.run(), {
    remove: async () => { removes++; }
  }).catch(error => error);
  f.child.emit('error', spawnError);
  await turn();
  assert.equal(removes, 0);
  f.child.emit('close', -2, null);
  const error = await outcome;
  assert.equal(error, spawnError);
  assert.equal(error.terminationConfirmed, true);
  assert.equal(removes, 1);
  assert.equal(f.pending.size, 0);
});

test('spawn error without close is bounded and retains the profile', async () => {
  const f = fixture();
  const spawnError = new Error('spawn failure without close');
  const outcome = withProfileCleanup(profile, () => f.run(), {
    remove: async () => assert.fail('Termination not confirmed')
  }).catch(error => error);
  f.child.emit('error', spawnError); f.deadline(5_000);
  const error = await outcome;
  assert.equal(error, spawnError);
  assert.equal(error.terminationConfirmed, false);
  assert.equal(error.retainedProfile, profile);
});

test('synchronous spawn throw has no child to wait for and preserves failure through cleanup', async () => {
  const spawnError = new Error('spawn threw synchronously');
  let removes = 0;
  const error = await withProfileCleanup(profile, () => runHarnessChild(() => { throw spawnError; }, { phase: 'write' }), {
    remove: async () => { removes++; }
  }).catch(error => error);
  assert.equal(error, spawnError);
  assert.equal(removes, 1);
});

for (const [name, code, output, expectedError] of [
  ['ordinary marker and zero exit', 0, '[runtime-compatibility] write passed', null],
  ['nonzero exit despite marker', 1, '[runtime-compatibility] write passed', /write failed/],
  ['zero exit without marker', 0, 'startup only', /did not confirm all checks/]
]) {
  test(name, async () => {
    const f = fixture();
    const outcome = f.run().catch(error => error);
    f.child.stdout.emit('data', output); f.child.emit('close', code, null);
    const error = await outcome;
    if (expectedError) {
      assert.match(error.message, expectedError);
      assert.equal(error.output, output);
      assert.equal(error.terminationConfirmed, true);
    } else assert.equal(error, undefined);
    assert.equal(f.pending.size, 0);
    assert.deepEqual(f.child.killCalls, []);
  });
}
