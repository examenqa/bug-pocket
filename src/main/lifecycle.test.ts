import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationBarrier } from './OperationBarrier';
import { registerUpdateInstallIpc, runGracefulShutdown } from './updater';

class MockAutoUpdater {
  updateDownloaded = false;
  quitAndInstallCalls = 0;

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }
}

test('unstaged update request is rejected before graceful shutdown', async () => {
  const updater = new MockAutoUpdater();
  let rendererFrozen = false;
  let databaseOpen = true;
  let syncDrainCalls = 0;

  const handlers = new Map<string, () => Promise<void>>();
  registerUpdateInstallIpc(
    {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    updater,
    () => runGracefulShutdown({
      pauseRenderer: () => {
        rendererFrozen = true;
      },
      drainOperations: async () => undefined,
      stopAndDrain: async () => {
        syncDrainCalls += 1;
      },
      disconnectWorkspace: () => {
        databaseOpen = false;
      }
    })
  );

  const installUpdateHandler = handlers.get('app:installUpdate');
  assert.ok(installUpdateHandler, 'The app:installUpdate IPC handler was not registered.');
  await assert.rejects(installUpdateHandler(), /No update downloaded/);

  assert.equal(updater.updateDownloaded, false, 'The fixture must not stage an update before invoking the IPC path.');
  assert.equal(syncDrainCalls, 0, 'The unstaged request must not enter graceful shutdown.');
  assert.equal(rendererFrozen, false, 'The renderer remains interactive after an unstaged request.');
  assert.equal(databaseOpen, true, 'Database handles remain open after an unstaged request.');
  assert.equal(updater.quitAndInstallCalls, 0, 'The installer is not invoked without a staged update.');
});

test('graceful shutdown waits for registered background operations before closing SQLite', async () => {
  const barrier = new OperationBarrier();
  let databaseOpen = true;
  let rendererFrozen = false;
  let backupCompleted = false;
  let markOperationStarted!: () => void;
  const operationStarted = new Promise<void>((resolve) => {
    markOperationStarted = resolve;
  });

  const backgroundBackup = barrier.acquire((async () => {
    markOperationStarted();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (!databaseOpen) throw new Error('Database connection is not open');
    backupCompleted = true;
  })());

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
