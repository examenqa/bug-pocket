import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { configureAutoUpdater, installDownloadedUpdate, runGracefulShutdown } from './updater';

class MockAutoUpdater extends EventEmitter {
  logger: unknown;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  quitAndInstallCalls = 0;
  quitAndInstallArguments: Array<[boolean | undefined, boolean | undefined]> = [];

  constructor(private readonly onQuitAndInstall: () => void = () => undefined) {
    super();
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitAndInstallCalls += 1;
    this.quitAndInstallArguments.push([isSilent, isForceRunAfter]);
    this.onQuitAndInstall();
  }
}

test('update installation drains sync and disconnects SQLite before terminating', async () => {
  const lifecycle: string[] = [];
  const updater = new MockAutoUpdater(() => lifecycle.push('quit-and-install'));
  let resolveWrite!: () => void;
  let writeCompleted = false;
  const inFlightWrite = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  }).then(() => {
    writeCompleted = true;
    lifecycle.push('write-completed');
  });
  const syncService = {
    stopAndDrainCalls: 0,
    disconnectWorkspaceCalls: 0,
    async stopAndDrain(): Promise<void> {
      this.stopAndDrainCalls += 1;
      lifecycle.push('drain-started');
      await inFlightWrite;
      lifecycle.push('drain-completed');
    },
    disconnectWorkspace(): void {
      this.disconnectWorkspaceCalls += 1;
      lifecycle.push('workspace-disconnected');
    }
  };
  let updateReadyNotifications = 0;

  configureAutoUpdater(
    updater,
    { info: () => undefined, error: () => undefined },
    {
      console: { log: () => undefined },
      onUpdateReady: () => {
        updateReadyNotifications += 1;
      }
    }
  );

  updater.emit('update-downloaded', { version: '1.0.0-test' });
  await Promise.resolve();

  assert.equal(updateReadyNotifications, 1);
  assert.equal(updater.quitAndInstallCalls, 0, 'Downloading an update must remain passive.');

  const installation = installDownloadedUpdate(updater, () => runGracefulShutdown({
    pauseRenderer: () => lifecycle.push('renderer-paused'),
    stopAndDrain: () => syncService.stopAndDrain(),
    disconnectWorkspace: () => syncService.disconnectWorkspace()
  }));
  await Promise.resolve();

  assert.equal(syncService.stopAndDrainCalls, 1);
  assert.equal(writeCompleted, false);
  assert.equal(syncService.disconnectWorkspaceCalls, 0, 'SQLite must remain open until the in-flight write drains.');
  assert.equal(updater.quitAndInstallCalls, 0, 'The updater must not terminate while sync is in flight.');

  resolveWrite();
  await installation;

  assert.equal(syncService.disconnectWorkspaceCalls, 1);
  assert.equal(updater.quitAndInstallCalls, 1);
  assert.deepEqual(updater.quitAndInstallArguments, [[true, false]], 'The installer must not relaunch the app.');
  assert.deepEqual(lifecycle, [
    'renderer-paused',
    'drain-started',
    'write-completed',
    'drain-completed',
    'workspace-disconnected',
    'quit-and-install'
  ]);
});
