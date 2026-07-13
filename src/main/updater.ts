export interface AutoUpdaterPort {
  logger: unknown;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface UpdaterLifecycleOptions {
  onUpdateReady(): void;
  console?: Pick<Console, 'log'>;
}

export interface GracefulShutdownTasks {
  pauseRenderer(): void;
  stopAndDrain(): Promise<void>;
  disconnectWorkspace(): void | Promise<void>;
}

export async function runGracefulShutdown(tasks: GracefulShutdownTasks): Promise<void> {
  tasks.pauseRenderer();
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

export function configureAutoUpdater(
  updater: AutoUpdaterPort,
  logger: UpdaterLogger,
  options: UpdaterLifecycleOptions
): void {
  const lifecycleConsole = options.console ?? console;
  updater.logger = logger;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  updater.on('checking-for-update', () => {
    lifecycleConsole.log('[auto-updater] Checking for update...');
    logger.info('[auto-updater] Checking for update...');
  });
  updater.on('update-available', (info: { version?: string }) => {
    lifecycleConsole.log('[auto-updater] Update available:', info.version);
    logger.info('[auto-updater] Update available:', info.version);
  });
  updater.on('update-downloaded', (info: { version?: string }) => {
    lifecycleConsole.log('[auto-updater] Update downloaded and staged for install on quit:', info.version);
    logger.info('[auto-updater] Update downloaded and staged for install on quit:', info.version);
    options.onUpdateReady();
  });
  updater.on('error', (error: unknown) => {
    lifecycleConsole.log('[auto-updater] Update error:', error);
    logger.error('[auto-updater] Update error:', error);
  });
}
