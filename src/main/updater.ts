import { PUBLIC_UPDATE_FEED_URL } from './updateFeed';

export interface AutoUpdaterPort {
  logger: unknown;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { provider: 'generic'; url: string; channel: 'latest' }): void;
  checkForUpdatesAndNotify(): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface UpdaterLifecycleOptions {
  onUpdateReady(): void;
  checkForUpdates?: () => Promise<unknown>;
  scheduleRetry?: (callback: () => void, delayMs: number) => unknown;
  retryDelayMs?: number;
  maxRetryAttempts?: number;
  console?: Pick<Console, 'log'>;
}

export interface GracefulShutdownTasks {
  pauseRenderer(): void;
  drainOperations(): Promise<void>;
  stopAndDrain(): Promise<void>;
  disconnectWorkspace(): void | Promise<void>;
}

export interface UpdateInstallIpcRegistrar {
  handle(channel: 'app:installUpdate', listener: () => Promise<void>): void;
}

export let isUpdateStaged = false;

export async function runGracefulShutdown(tasks: GracefulShutdownTasks): Promise<void> {
  tasks.pauseRenderer();
  await tasks.drainOperations();
  await tasks.stopAndDrain();
  await tasks.disconnectWorkspace();
}

export async function installDownloadedUpdate(
  updater: Pick<AutoUpdaterPort, 'quitAndInstall'>,
  gracefulShutdown: () => Promise<void>
): Promise<void> {
  await gracefulShutdown();
  // The installer remains silent and does not relaunch Bug Pocket after applying the update.
  updater.quitAndInstall(true, false);
}

export function registerUpdateInstallIpc(
  registrar: UpdateInstallIpcRegistrar,
  updater: Pick<AutoUpdaterPort, 'quitAndInstall'>,
  gracefulShutdown: () => Promise<void>
): void {
  registrar.handle('app:installUpdate', async () => {
    if (!isUpdateStaged) throw new Error('No update downloaded');
    await installDownloadedUpdate(updater, gracefulShutdown);
  });
}

function isRecoverableDownloadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|aborted|download/i.test(message);
}

export function configureAutoUpdater(
  updater: AutoUpdaterPort,
  logger: UpdaterLogger,
  options: UpdaterLifecycleOptions
): void {
  const lifecycleConsole = options.console ?? console;
  const checkForUpdates = options.checkForUpdates ?? (() => updater.checkForUpdatesAndNotify());
  const scheduleRetry = options.scheduleRetry ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const retryDelayMs = options.retryDelayMs ?? 30_000;
  const maxRetryAttempts = options.maxRetryAttempts ?? 3;
  let retryAttempts = 0;
  let retryPending = false;

  const scheduleDownloadRetry = (error: unknown): void => {
    if (!isRecoverableDownloadError(error) || retryPending || retryAttempts >= maxRetryAttempts) return;
    const delayMs = retryDelayMs * 2 ** retryAttempts;
    retryAttempts += 1;
    retryPending = true;
    logger.info('[auto-updater] Scheduling update recovery attempt.', { attempt: retryAttempts, delayMs });
    scheduleRetry(() => {
      retryPending = false;
      void checkForUpdates().catch((retryError) => {
        lifecycleConsole.log('[auto-updater] Recovery check failed:', retryError);
        logger.error('[auto-updater] Recovery check failed:', retryError);
        scheduleDownloadRetry(retryError);
      });
    }, delayMs);
  };

  updater.logger = logger;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.setFeedURL({
    provider: 'generic',
    url: PUBLIC_UPDATE_FEED_URL,
    channel: 'latest'
  });

  updater.on('checking-for-update', () => {
    lifecycleConsole.log('[auto-updater] Checking for update...');
    logger.info('[auto-updater] Checking for update...');
  });
  updater.on('update-available', (info: { version?: string }) => {
    lifecycleConsole.log('[auto-updater] Update available:', info.version);
    logger.info('[auto-updater] Update available:', info.version);
  });
  updater.on('update-not-available', () => {
    retryAttempts = 0;
    retryPending = false;
  });
  updater.on('update-downloaded', (info: { version?: string }) => {
    retryAttempts = 0;
    retryPending = false;
    isUpdateStaged = true;
    lifecycleConsole.log('[auto-updater] Update downloaded and staged for install on quit:', info.version);
    logger.info('[auto-updater] Update downloaded and staged for install on quit:', info.version);
    options.onUpdateReady();
  });
  updater.on('error', (error: unknown) => {
    lifecycleConsole.log('[auto-updater] Update error:', error);
    logger.error('[auto-updater] Update error:', error);
    scheduleDownloadRetry(error);
  });
}
