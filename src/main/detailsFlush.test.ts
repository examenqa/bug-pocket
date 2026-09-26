import assert from 'node:assert/strict';
import test from 'node:test';
import { DetailsFlushGate } from './detailsFlush';
import { runGracefulShutdown } from './lifecycle';
import { OperationBarrier } from './OperationBarrier';
import { createIpcArgumentValidators } from './ipc/secureIpc';

test('flush failure and timeout reject; stale acknowledgement cannot release a new transition', async () => {
  const gate = new DetailsFlushGate();
  let first = '';
  const failed = gate.request(id => { first = id; });
  gate.complete(first, false);
  await assert.rejects(failed, /could not be saved/);
  let second = '';
  const next = gate.request(id => { second = id; });
  gate.complete(first, true);
  assert.equal(gate.active, true);
  gate.complete(second, true);
  await next;
  await assert.rejects(gate.request(() => {}, 1), /could not be saved/);
  assert.equal(gate.active, false);
});

test('graceful shutdown collects renderer drafts before drain and never closes SQLite on failed save', async () => {
  const events: string[] = [];
  const tasks = {
    pauseRenderer: () => { events.push('pause'); },
    collectDrafts: async () => { events.push('flush'); throw new Error('disk full'); },
    drainOperations: async () => { events.push('drain'); },
    stopAndDrain: async () => { events.push('stop'); },
    disconnectWorkspace: () => { events.push('close'); }
  };
  await assert.rejects(runGracefulShutdown(tasks), /disk full/);
  assert.deepEqual(events, ['pause', 'flush']);
  events.length = 0;
  await runGracefulShutdown({ ...tasks, collectDrafts: async () => { events.push('flush'); } });
  assert.deepEqual(events, ['pause', 'flush', 'drain', 'stop', 'close']);
});

test('exclusive restore rejects new writes and remains visible to shutdown drain', async () => {
  const barrier = new OperationBarrier();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let started = false;
  const restore = barrier.exclusive(async () => { started = true; await pending; });
  await assert.rejects(barrier.acquire(async () => {}), /maintenance/);
  let drained = false;
  const drain = barrier.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(started, true);
  assert.equal(drained, false);
  finish(); await restore; await drain;
  assert.equal(barrier.isInMaintenance, false);
  await assert.rejects(barrier.exclusive(async () => { throw new Error('invalid archive'); }), /invalid archive/);
  assert.equal(await barrier.acquire(async () => 'recovered'), 'recovered');
});

test('new capture and flush IPC channels enforce exact argument shapes', () => {
  const validators = createIpcArgumentValidators();
  validators['capture:listPending']([]);
  validators['capture:discardPending']([]);
  validators['details:flushComplete'](['123', false]);
  assert.throws(() => validators['details:flushComplete']([]));
  assert.throws(() => validators['details:flushComplete'](['123', 'true']));
  assert.throws(() => validators['capture:discardPending']([1]));
});
