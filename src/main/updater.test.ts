import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PUBLIC_UPDATE_FEED_URL } from './updateFeed';
import { configureAutoUpdater, installDownloadedUpdate, runGracefulShutdown } from './updater';

class MockAutoUpdater extends EventEmitter {
  logger: unknown;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  quitAndInstallCalls = 0;
  checkForUpdatesCalls = 0;
  feedOptions: { provider: 'generic'; url: string; channel: 'latest' } | null = null;
  quitAndInstallArguments: Array<[boolean | undefined, boolean | undefined]> = [];

  constructor(private readonly onQuitAndInstall: () => void = () => undefined) {
    super();
  }

  setFeedURL(options: { provider: 'generic'; url: string; channel: 'latest' }): void {
    this.feedOptions = options;
  }

  async checkForUpdatesAndNotify(): Promise<void> {
    this.checkForUpdatesCalls += 1;
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitAndInstallCalls += 1;
    this.quitAndInstallArguments.push([isSilent, isForceRunAfter]);
    this.onQuitAndInstall();
  }
}

test('interrupted update downloads schedule a credential-free recovery check', async () => {
  const updater = new MockAutoUpdater();
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  let recoveryChecks = 0;

  configureAutoUpdater(
    updater,
    { info: () => undefined, error: () => undefined },
    {
      console: { log: () => undefined },
      onUpdateReady: () => undefined,
      checkForUpdates: async () => {
        recoveryChecks += 1;
      },
      retryDelayMs: 10,
      scheduleRetry: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
      }
    }
  );

  assert.deepEqual(updater.feedOptions, {
    provider: 'generic',
    url: PUBLIC_UPDATE_FEED_URL,
    channel: 'latest'
  });
  updater.emit('error', new Error('ECONNRESET while downloading update'));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.delayMs, 10);

  scheduled[0]?.callback();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(recoveryChecks, 1);
  assert.equal(updater.quitAndInstallCalls, 0, 'Recovery must remain passive.');
});

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
    drainOperations: async () => {
      lifecycle.push('operations-drained');
    },
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
    'operations-drained',
    'drain-started',
    'write-completed',
    'drain-completed',
    'workspace-disconnected',
    'quit-and-install'
  ]);
});
