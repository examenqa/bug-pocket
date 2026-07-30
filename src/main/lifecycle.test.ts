import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationBarrier } from './OperationBarrier';
import { runGracefulShutdown } from './lifecycle';
import { runDestructiveMaintenance } from './destructiveLifecycle';

test('graceful shutdown waits for registered background operations before closing SQLite', async () => {
  const barrier = new OperationBarrier();
  let databaseOpen = true;
  let rendererFrozen = false;
  let backupCompleted = false;
  let markOperationStarted!: () => void;
  const operationStarted = new Promise<void>((resolve) => {
    markOperationStarted = resolve;
  });

  const backgroundBackup = barrier.acquire(async () => {
    markOperationStarted();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (!databaseOpen) throw new Error('Database connection is not open');
    backupCompleted = true;
  });

  await operationStarted;
  let shutdownCompleted = false;
  const shutdown = runGracefulShutdown({
    pauseRenderer: () => {
      rendererFrozen = true;
    },
    drainOperations: () => barrier.drain(),
    stopAndDrain: async () => undefined,
    disconnectWorkspace: () => {
      databaseOpen = false;
    }
  }).then(() => {
    shutdownCompleted = true;
  });

  await Promise.resolve();
  assert.equal(rendererFrozen, true);
  assert.equal(databaseOpen, true, 'SQLite remains open while the registered backup is running.');
  assert.equal(shutdownCompleted, false, 'Shutdown must wait for the registered backup operation.');

  await shutdown;
  await backgroundBackup;

  assert.equal(backupCompleted, true, 'The backup completes before SQLite is closed.');
  assert.equal(databaseOpen, false, 'SQLite closes after the operation barrier drains.');
  assert.equal(shutdownCompleted, true);
  assert.equal(barrier.activeCount, 0);
});
test('maintenance drains active operations, rejects late arrivals, and stops sync before deletion', async () => {
  const barrier = new OperationBarrier();
  const sequence: string[] = [];
  let finishActive!: () => void;
  const activeFinished = new Promise<void>((resolve) => {
    finishActive = resolve;
  });

  const activeOperation = barrier.acquire(async () => {
    sequence.push('active-started');
    await activeFinished;
    sequence.push('active-finished');
  });

  const destructive = runDestructiveMaintenance({
    barrier,
    stopAndDrain: async () => {
      sequence.push('sync-stopped');
    },
    operation: async () => {
      sequence.push('database-deleted');
      return 'done';
    }
  });

  let lateOperationStarted = false;
  await assert.rejects(
    barrier.acquire(async () => {
      lateOperationStarted = true;
    }),
    /maintenance is in progress/i
  );
  assert.equal(lateOperationStarted, false, 'Rejected operations must not start before maintenance completes.');
  assert.deepEqual(sequence, ['active-started']);

  finishActive();
  assert.equal(await destructive, 'done');
  await activeOperation;
  assert.deepEqual(sequence, ['active-started', 'active-finished', 'sync-stopped', 'database-deleted']);
  assert.equal(barrier.isInMaintenance, false);
});

test('failed destructive maintenance reopens the barrier and restores background services', async () => {
  const barrier = new OperationBarrier();
  let resumeCalls = 0;

  await assert.rejects(
    runDestructiveMaintenance({
      barrier,
      stopAndDrain: async () => undefined,
      operation: async () => {
        throw new Error('workspace deletion failed');
      },
      resumeAfterFailure: async () => {
        assert.equal(barrier.isInMaintenance, false, 'maintenance reopens before services restart');
        resumeCalls += 1;
      }
    }),
    /workspace deletion failed/
  );

  assert.equal(resumeCalls, 1);
  assert.equal(barrier.isInMaintenance, false);
  assert.equal(await barrier.acquire(async () => 'accepted'), 'accepted');
});
