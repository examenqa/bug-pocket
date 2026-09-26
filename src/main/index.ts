import { AiRequestRegistry } from './ai/aiRequestRegistry';
import type { CaptureContext } from '../shared/types';
import { DetailsFlushGate } from './detailsFlush';
import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage, desktopCapturer, screen, Notification, shell, dialog, safeStorage } from 'electron';
import log from 'electron-log/main';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { BugPocketDatabase } from './database';
import { triageBugWithOllama } from './ai/ollamaTriage';
import { getByokAiConfig, processIssueWithByokAi, saveByokAiConfig, triageBugWithByokAi } from './ai/byokIssueProcessor';
import { registerGetByokAiConfigIpc } from './ipc/byokAiConfigIpc';
import { registerBugDeletionIpc } from './ipc/bugDeletionIpc';
import { createIpcArgumentValidators, createSecureIpcRegistrar } from './ipc/secureIpc';
import { assertWorkspaceAdminAccess, assertWorkspaceWriteAccess } from './ipc/workspaceWriteAccess';
import { resolveVerifiedTriageAttachmentPath } from './ai/triageAttachment';
import { SyncEngine } from './sync/syncService';
import { decodeInviteCode, generateInviteCode } from './sync/inviteToken';
import { normalizeSupabaseCredentials } from './sync/supabaseCredentials';
import { startSupabaseKeepAlive } from './sync/keepAlive';
import { createBackupArchive, restoreBackupArchive } from './sync/backupService';
import { getAssetPath } from './assetPaths';
import { runGracefulShutdown } from './lifecycle';
import { operationBarrier } from './OperationBarrier';
import { runDestructiveMaintenance } from './destructiveLifecycle';
import { sendFeedbackToExamenQa } from './support/feedbackService';
import type { AiConfigSaveInput, AiIssueProcessPayload, AiTriageBugPayload, AiTriageResult, AttachmentDownloadResult, BackupExportResult, BackupImportResult, CapturePresetInput, FeedbackPayload, ReferenceTable, SettingsData, ShortcutAction, ShortcutSetting, SyncAccountSetup, TaxonomyId } from '../shared/types';
import { DASHBOARD_ROUTE } from '../shared/navigation';

const packagedSmokeUserData = process.env.BUG_POCKET_SMOKE_USER_DATA?.trim();
const packagedSmokeTest = app.isPackaged && process.env.BUG_POCKET_PACKAGED_SMOKE_TEST === '1' && Boolean(packagedSmokeUserData);

if (packagedSmokeTest && packagedSmokeUserData) {
  app.setPath('userData', packagedSmokeUserData);
} else if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

app.name = 'Bug Pocket';
app.setAppUserModelId('com.bugpocket.app');

let mainWindow: BrowserWindow | null = null;
let quickWindow: BrowserWindow | null = null;
let snipWindow: BrowserWindow | null = null;
let quickWindowLoaded = false;
let quickWindowReady: Promise<void> | null = null;
let tray: Tray | null = null;
let db: BugPocketDatabase;
let syncEngine: SyncEngine;
let stopSupabaseKeepAlive: (() => void) | null = null;
let isQuitting = false;
let shutdownInProgress = false;
let gracefulShutdownComplete = false;
let gracefulShutdownPromise: Promise<void> | null = null;
let currentScreenshotSource: Buffer | null = null;
let pendingQuickScreenshotDataUrl = '';
let screenshotStarting = false;
const aiRequests = new AiRequestRegistry();
let screenshotBugId: number | null = null;
let mainWasVisibleBeforeSnip = false;
let shortcutRegistrationErrors: Partial<Record<ShortcutAction, string>> = {};
let rendererHasDirtyDetails = false;
const detailsFlushGate = new DetailsFlushGate();
let detailsTransitionInProgress = false;
let quickTopmostPulseTimer: NodeJS.Timeout | null = null;
const quickCaptureCompactSize = { width: 460, height: 505 };
const quickCaptureReviewSize = { width: 880, height: 760 };

const isDev = !!process.env['ELECTRON_RENDERER_URL'];
const backgroundStartArg = '--background-start';
const windowBackgroundColor = '#F8FAFC';

function startSupabaseKeepAliveIfConfigured(): void {
  stopSupabaseKeepAlive?.();
  stopSupabaseKeepAlive = null;
  if (!db?.isOpen() || !db.getSupabaseProjectUrl() || !db.getSupabaseAnonKey()) return;
  stopSupabaseKeepAlive = startSupabaseKeepAlive(db);
}

function createSyncEngine(): SyncEngine {
  return new SyncEngine(
    db,
    () => mainWindow?.webContents.send('bugs:changed'),
    undefined,
    (status) => mainWindow?.webContents.send('sync-status', status)
  );
}

function pauseRendererForShutdown(): void {
  aiRequests.cancelAll();
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('app:shutdown-started');
    window.setIgnoreMouseEvents(true);
    window.setFocusable(false);
  });
  globalShortcut.unregisterAll();
}

async function gracefulShutdown(): Promise<void> {
  if (gracefulShutdownComplete) return;
  if (gracefulShutdownPromise) return gracefulShutdownPromise;

  shutdownInProgress = true;
  isQuitting = true;

  gracefulShutdownPromise = runGracefulShutdown({
    pauseRenderer: pauseRendererForShutdown,
    collectDrafts: flushMainDetails,
    drainOperations: () => operationBarrier.drain(),
    stopAndDrain: async () => {
      stopSupabaseKeepAlive?.();
      stopSupabaseKeepAlive = null;
      await syncEngine?.stopAndDrain();
    },
    disconnectWorkspace: async () => {
      if (db?.isOpen()) {
        db.checkpoint();
        await Promise.resolve(db.disconnectWorkspace(true));
        db.close();
      }
    }
  }).then(() => {
    gracefulShutdownComplete = true;
  });

  try {
    await gracefulShutdownPromise;
  } catch (error) {
    console.error('[shutdown] Graceful shutdown failed. Attempting to restore background services.', error);
    gracefulShutdownPromise = null;
    shutdownInProgress = false;
    mainWindow?.webContents.send('details:resume');
    isQuitting = false;
    BrowserWindow.getAllWindows().forEach((window) => {
      window.setIgnoreMouseEvents(false);
      window.setFocusable(true);
    });
    if (db?.isOpen()) {
      try {
        await syncEngine?.resumeAfterFailedShutdown();
        startSupabaseKeepAliveIfConfigured();
      } catch (recoveryError) {
        console.error('[shutdown] Failed to restart background sync after shutdown recovery.', recoveryError);
      }
      try {
        registerAppShortcuts();
      } catch (recoveryError) {
        console.error('[shutdown] Failed to restore global shortcuts after shutdown recovery.', recoveryError);
      }
    } else {
      console.error('[shutdown] Database closure completed before the failure; background services cannot be restarted safely.');
    }
    throw error;
  }
}

async function waitForSafeStorageEncryption(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!safeStorage.isEncryptionAvailable()) {
    if (Date.now() >= deadline) {
      throw new Error('Windows secure storage did not become available. Cloud authentication was not initialized.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function rendererUrl(route: string): string {
  if (isDev) return `${process.env['ELECTRON_RENDERER_URL']}#${route}`;
  return `${pathToFileURL(join(__dirname, '../renderer/index.html')).toString()}#${route}`;
}

function isTrustedRendererUrl(candidateUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    if (isDev) {
      const expected = new URL(process.env['ELECTRON_RENDERER_URL']!);
      return candidate.protocol === expected.protocol && candidate.host === expected.host && candidate.pathname === expected.pathname;
    }
    const expected = pathToFileURL(join(__dirname, '../renderer/index.html'));
    return candidate.protocol === 'file:' && candidate.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function openSafeExternalUrl(candidateUrl: string): void {
  try {
    const parsed = new URL(candidateUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    void shell.openExternal(parsed.toString()).catch((error) => {
      console.error('Unable to open external URL.', error);
    });
  } catch {
    // Invalid and non-web URLs are intentionally ignored at the navigation boundary.
  }
}

function hardenRendererWindow(window: BrowserWindow): void {
  const guardNavigation = (event: Electron.Event, targetUrl: string): void => {
    if (isTrustedRendererUrl(targetUrl)) return;
    event.preventDefault();
    openSafeExternalUrl(targetUrl);
  };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalUrl(url);
    return { action: 'deny' };
  });
}

function preloadPath(): string {
  if (isDev) return join(__dirname, '../preload/index.js');
  const mjsPreload = join(__dirname, '../preload/index.mjs');
  return existsSync(mjsPreload) ? mjsPreload : join(__dirname, '../preload/index.js');
}

function enforceStartupPreference(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: enabled ? [backgroundStartArg] : []
  });
}

function createMainWindow(route = DASHBOARD_ROUTE, showOnReady = true): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    title: 'Bug Pocket',
    show: false,
    icon: getAssetPath('icon.ico'),
    resizable: true,
    backgroundColor: windowBackgroundColor,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  hardenRendererWindow(mainWindow);
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText.trim()) return;
    const menu = Menu.buildFromTemplate([
      { role: 'cut', enabled: params.isEditable },
      { role: 'copy', enabled: params.selectionText.trim().length > 0 },
      { role: 'paste', enabled: params.isEditable },
      { type: 'separator' },
      { role: 'selectAll' }
    ]);
    menu.popup({ window: mainWindow ?? undefined });
  });
  mainWindow.loadURL(rendererUrl(route));
  mainWindow.once('ready-to-show', () => {
    if (showOnReady) mainWindow?.show();
  });
  mainWindow.on('close', (event) => {
    if (gracefulShutdownComplete) return;
    event.preventDefault();
    if (isQuitting) return;
    if (detailsTransitionInProgress) return;
    void withFlushedDetails(() => mainWindow?.hide()).catch(error => {
      mainWindow?.webContents.send('app:toast', String(error.message ?? error), 'error');
    });
  });
  mainWindow.on('query-session-end', (event) => {
    if (gracefulShutdownComplete) return;
    event.preventDefault();
    app.quit(); // before-quit performs the same save/drain contract as an explicit quit.
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function flushMainDetails(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (rendererHasDirtyDetails) throw new Error('The edited report is unavailable. Quit was cancelled.');
    return;
  }
  if (mainWindow.webContents.isLoadingMainFrame()) {
    if (rendererHasDirtyDetails) throw new Error('The report is still loading; retry after it is ready.');
    return;
  }
  await detailsFlushGate.request(id => mainWindow!.webContents.send('details:flush-save-request', id));
}

async function withFlushedDetails<T>(action: () => T | Promise<T>): Promise<T> {
  if (shutdownInProgress) throw new Error('Bug Pocket is shutting down.');
  if (detailsTransitionInProgress) throw new Error('A report transition is already in progress.');
  detailsTransitionInProgress = true;
  try {
    await flushMainDetails();
    return await action();
  } finally {
    detailsTransitionInProgress = false;
    mainWindow?.webContents.send('details:resume');
  }
}

function discardQuickCaptures(finish = true): void {
  const context = db.beginCapture();
  db.assertCaptureContext(context);
  db.discardPendingCaptures();
  if (finish) db.finishCapture(context);
  pendingQuickScreenshotDataUrl = '';
  restoreQuickCaptureCompactSize();
}

function createQuickWindow(): void {
  quickWindow = new BrowserWindow({
    width: quickCaptureCompactSize.width,
    height: quickCaptureCompactSize.height,
    resizable: false,
    title: 'Quick Capture - Bug Pocket',
    show: false,
    icon: getAssetPath('icon.ico'),
    backgroundColor: '#022F63',
    autoHideMenuBar: true,
    skipTaskbar: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  hardenRendererWindow(quickWindow);
  quickWindowLoaded = false;
  quickWindowReady = new Promise((resolve) => {
    quickWindow?.webContents.once('did-finish-load', () => {
      quickWindowLoaded = true;
      resolve();
    });
  });
  quickWindow.loadURL(rendererUrl('/capture')).catch((error) => {
    quickWindowLoaded = true;
    quickWindowReady = null;
    console.error('Unable to load Quick Capture window.', error);
  });
  quickWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      try { discardQuickCaptures(); quickWindow?.hide(); }
      catch (error) { dialog.showErrorBox('Unable to discard capture', String(error)); }
    }
  });
}

async function ensureQuickWindowReady(): Promise<void> {
  if (!quickWindow) createQuickWindow();
  if (!quickWindowLoaded && quickWindowReady) await quickWindowReady;
}

async function openQuickCapture(): Promise<void> {
  assertAppAcceptingMutations();
  db.beginCapture();
  if (!quickWindow) createQuickWindow();
  if (!pendingQuickScreenshotDataUrl) restoreQuickCaptureCompactSize();
  quickWindow?.show();
  quickWindow?.moveTop();
  quickWindow?.setAlwaysOnTop(true);
  if (quickTopmostPulseTimer) clearTimeout(quickTopmostPulseTimer);
  quickTopmostPulseTimer = setTimeout(() => {
    quickWindow?.setAlwaysOnTop(false);
    quickTopmostPulseTimer = null;
  }, 500);
  quickWindow?.focus();
  await ensureQuickWindowReady();
  setTimeout(() => {
    quickWindow?.focus();
    quickWindow?.webContents.focus();
  }, 40);
  quickWindow?.webContents.send('app:quickCaptureOpened');
}

function resizeQuickCaptureForReview(): void {
  if (!quickWindow) createQuickWindow();
  if (!quickWindow) return;
  quickWindow.setResizable(true);
  quickWindow.setSize(quickCaptureReviewSize.width, quickCaptureReviewSize.height, false);
  quickWindow.setBounds(
    {
      ...quickWindow.getBounds(),
      width: quickCaptureReviewSize.width,
      height: quickCaptureReviewSize.height
    },
    false
  );
  quickWindow.center();
  quickWindow.setResizable(false);
}

function restoreQuickCaptureCompactSize(): void {
  if (!quickWindow) return;
  quickWindow.setResizable(true);
  quickWindow.setSize(quickCaptureCompactSize.width, quickCaptureCompactSize.height, false);
  quickWindow.setBounds(
    {
      ...quickWindow.getBounds(),
      width: quickCaptureCompactSize.width,
      height: quickCaptureCompactSize.height
    },
    false
  );
  quickWindow.center();
  quickWindow.setResizable(false);
}

function openMainWindow(route = DASHBOARD_ROUTE): void {
  if (!mainWindow) {
    createMainWindow(route);
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.webContents.send('app:navigate', route);
  }
  mainWindow?.show();
  mainWindow?.focus();
}

function settingsRouteForSection(section?: string): string {
  const safeSection = typeof section === 'string' && /^[a-z0-9_-]+$/i.test(section) ? section : '';
  if (!safeSection) return '/settings/workspace';
  if (safeSection === 'presets') return '/settings/presets?card=presets';
  if (safeSection === 'ai-options') return '/settings/ai?card=ai-options';
  if (safeSection === 'templates') return '/settings/output?card=templates';
  if (['backup', 'data-management', 'storage'].includes(safeSection)) return `/settings/storage?card=${safeSection}`;
  if (['cloud-sync', 'sync'].includes(safeSection)) return `/settings/sync?card=${safeSection}`;
  if (['issue-platforms', 'jira-workspace'].includes(safeSection)) return `/settings/output?card=${safeSection}`;
  return `/settings/workspace?card=${safeSection}`;
}

function openSettings(section?: string): void {
  const route = settingsRouteForSection(section);
  openMainWindow(route);
  setTimeout(() => {
    mainWindow?.show();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
    mainWindow?.webContents.send('app:navigate', route);
  }, 40);
}

function restoreMainAfterSnip(): void {
  if (!mainWasVisibleBeforeSnip || !mainWindow) return;
  mainWindow.showInactive();
}

function resetSnipWindowState(): void {
  mainWasVisibleBeforeSnip = false;
  currentScreenshotSource = null;
}

function notifySaved(message = 'Capture saved locally.'): void {
  mainWindow?.webContents.send('app:toast', message);
  if (!mainWindow?.isVisible() && Notification.isSupported()) {
    new Notification({ title: 'Bug Pocket', body: message, icon: getAssetPath('icon.ico') }).show();
  }
}

function shortcutLabel(accelerator: string): string {
  return accelerator.replace(/CommandOrControl/g, 'Ctrl').replace(/\+/g, '+');
}

function shortcutHandlers(): Record<ShortcutAction, () => void> {
  return {
    quick_capture: () => { void openQuickCapture(); },
    main_panel: () => openMainWindow(DASHBOARD_ROUTE),
    global_screenshot: () => { void startScreenshotCapture(); }
  };
}

function settingsWithShortcutStatus(): SettingsData {
  const settings = db.getSettings();
  return {
    ...settings,
    shortcuts: settings.shortcuts.map((shortcut) => ({
      ...shortcut,
      registration_error: shortcutRegistrationErrors[shortcut.action]
    }))
  };
}

function notifySettingsChanged(): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('settings:changed');
  });
}

function assertAppAcceptingMutations(): void {
  if (shutdownInProgress) throw new Error('Bug Pocket is shutting down. New changes are temporarily paused.');
  operationBarrier.assertAcceptingOperations();
}

async function runDestructiveDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  assertCaptureTransition();
  return withFlushedDetails(() => runDestructiveMaintenance({
    barrier: operationBarrier,
    stopAndDrain: () => syncEngine.stopAndDrain(),
    operation,
    resumeAfterFailure: () => syncEngine.resumeAfterFailedShutdown()
  }));
}

function mutateSettings<T>(action: () => T): T {
  assertAppAcceptingMutations();
  const result = action();
  notifySettingsChanged();
  return result;
}

function assertCurrentWorkspaceWriteAccess(): void {
  const workspaceId = db.getCurrentWorkspaceId();
  if (!workspaceId) return;
  assertWorkspaceWriteAccess(db.getWorkspacePermissions(workspaceId).canWrite);
}

function mutateWorkspace<T>(action: () => T): T {
  assertAppAcceptingMutations();
  assertCurrentWorkspaceWriteAccess();
  return action();
}

function mutateWorkspaceSettings<T>(action: () => T): T {
  return mutateWorkspace(() => mutateSettings(action));
}

async function exportBackup(): Promise<BackupExportResult> {
  try {
    const dateLabel = new Date().toISOString().slice(0, 10);
    const defaultPath = join(app.getPath('documents'), `BugPocket_Backup_${dateLabel}.bugpocket`);
    const saveResult = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: 'Export Bug Pocket Backup',
          defaultPath,
          filters: [{ name: 'Bug Pocket Backup', extensions: ['bugpocket'] }]
        })
      : await dialog.showSaveDialog({
          title: 'Export Bug Pocket Backup',
          defaultPath,
          filters: [{ name: 'Bug Pocket Backup', extensions: ['bugpocket'] }]
        });

    if (saveResult.canceled || !saveResult.filePath) return { success: false, canceled: true };
    return await writeBackupArchive(saveResult.filePath);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Backup export failed.';
    return { success: false, error: message };
  }
}

async function chooseBackupDirectory(): Promise<string | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: 'Choose Automated Backup Location',
        properties: ['openDirectory']
      })
    : await dialog.showOpenDialog({
        title: 'Choose Automated Backup Location',
        properties: ['openDirectory']
      });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
}

async function importBackup(): Promise<BackupImportResult> {
  assertCaptureTransition();
  const openResult = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: 'Import Bug Pocket Backup',
        properties: ['openFile'],
        filters: [{ name: 'Bug Pocket Backup', extensions: ['bugpocket'] }]
      })
    : await dialog.showOpenDialog({
        title: 'Import Bug Pocket Backup',
        properties: ['openFile'],
        filters: [{ name: 'Bug Pocket Backup', extensions: ['bugpocket'] }]
      });

  if (openResult.canceled || !openResult.filePaths[0]) return { success: false, canceled: true };
  const backupPath = openResult.filePaths[0];
  const userDataPath = app.getPath('userData');
  let restoreLifecycleStarted = false;

  try {
    await restoreBackupArchive(backupPath, userDataPath, {
      beforeCommit: async () => {
        restoreLifecycleStarted = true;
        stopSupabaseKeepAlive?.();
        stopSupabaseKeepAlive = null;
        await syncEngine?.stopAndWait();
        db.checkpoint();
        db.close();
      },
      afterCommit: () => {
        try {
          db = new BugPocketDatabase(undefined, { restoring: true });
          db.applyAfterRestorePatch();
        } catch (error) {
          try {
            db?.close();
          } catch {
            // The restore service will roll back the staged filesystem swap.
          }
          throw error;
        }
      },
      beforeRollback: () => {
        try {
          db?.close();
        } catch {
          // The rollback still needs to restore the original files.
        }
      }
    });
    syncEngine = createSyncEngine();
    syncEngine.initialize();
    await syncEngine.restorePersistedSession();
    startSupabaseKeepAliveIfConfigured();
    registerAppShortcuts();

    setTimeout(() => {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.reload();
      });
    }, 250);

    return { success: true, filePath: backupPath };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Backup import failed.';
    if (restoreLifecycleStarted) {
      try {
        if (db.isOpen()) db.close();
        db = new BugPocketDatabase();
        syncEngine = createSyncEngine();
        syncEngine.initialize();
        await syncEngine.restorePersistedSession();
        startSupabaseKeepAliveIfConfigured();
        registerAppShortcuts();
      } catch {
        // If reopening fails, surface the original restore error.
      }
    }
    return { success: false, filePath: backupPath, error: message };
  }
}

async function writeBackupArchive(filePath: string): Promise<BackupExportResult> {
  return createBackupArchive(filePath, db, app.getPath('userData'));
}

async function runAutomatedStartupBackup(): Promise<void> {
  const directoryPath = db.getAutoBackupDirectoryPath();
  if (!directoryPath || !existsSync(directoryPath)) return;
  try {
    const directoryStat = await stat(directoryPath);
    if (!directoryStat.isDirectory()) return;
    const filePath = join(directoryPath, `auto_backup_${Math.floor(Date.now() / 1000)}.bugpocket`);
    const result = await writeBackupArchive(filePath);
    if (result.success) await pruneAutomatedBackups(directoryPath);
  } catch {
    // Automated backups should never interrupt startup.
  }
}

async function pruneAutomatedBackups(directoryPath: string): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^auto_backup_\d+\.bugpocket$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = join(directoryPath, entry.name);
        const match = entry.name.match(/^auto_backup_(\d+)\.bugpocket$/i);
        const timestamp = match ? Number(match[1]) : 0;
        const fileStat = await stat(filePath);
        return { filePath, timestamp, mtimeMs: fileStat.mtimeMs };
      })
  );

  if (backups.length <= 3) return;
  const staleBackups = backups
    .sort((a, b) => (a.timestamp || a.mtimeMs) - (b.timestamp || b.mtimeMs))
    .slice(0, backups.length - 3);
  await Promise.all(staleBackups.map((backup) => unlink(backup.filePath).catch(() => undefined)));
}

function registerAppShortcuts(): void {
  globalShortcut.unregisterAll();
  shortcutRegistrationErrors = {};
  const handlers = shortcutHandlers();
  const usedAccelerators = new Set<string>();
  db.getShortcutSettings().forEach((shortcut) => {
    if (!shortcut.is_enabled || !shortcut.accelerator.trim()) return;
    const accelerator = shortcut.accelerator.trim();
    const normalized = accelerator.toLowerCase();
    if (usedAccelerators.has(normalized)) {
      shortcutRegistrationErrors[shortcut.action] = `${shortcutLabel(accelerator)} is already assigned to another Bug Pocket action.`;
      return;
    }
    usedAccelerators.add(normalized);
    const registered = globalShortcut.register(accelerator, handlers[shortcut.action]);
    if (!registered) {
      shortcutRegistrationErrors[shortcut.action] = `${shortcutLabel(accelerator)} could not be registered. Another app or Windows may already be using it.`;
    }
  });
  mainWindow?.webContents.send('shortcuts:changed');
}

function suspendAppShortcuts(): void {
  globalShortcut.unregisterAll();
}

async function cancelScreenshotCapture(): Promise<void> {
  snipWindow?.close();
  snipWindow = null;
  if (screenshotBugId) {
    openMainWindow(`/bugs/${screenshotBugId}`);
    screenshotBugId = null;
    resetSnipWindowState();
    return;
  }
  restoreMainAfterSnip();
  await openQuickCapture();
  resetSnipWindowState();
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getAssetPath('icon.ico')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Bug Pocket');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Quick Capture', click: () => { void openQuickCapture(); } },
      { label: 'Take Screenshot', click: () => { void startScreenshotCapture(); } },
      { label: 'Open Dashboard', click: () => openMainWindow('/dashboard') },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('double-click', () => { void openQuickCapture(); });
}

async function startScreenshotCapture(bugId?: number): Promise<void> {
  assertAppAcceptingMutations();
  if (!bugId) db.beginCapture();
  if (screenshotStarting) return;
  if (snipWindow) {
    snipWindow.focus();
    return;
  }
  if (!bugId && pendingQuickScreenshotDataUrl) {
    await openQuickCapture();
    quickWindow?.webContents.send('quickScreenshot:reviewReady');
    return;
  }
  screenshotStarting = true;
  try {
    screenshotBugId = typeof bugId === 'number' ? bugId : null;
    mainWasVisibleBeforeSnip = !!mainWindow?.isVisible();
    quickWindow?.hide();
    mainWindow?.hide();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });
    const source = sources.find((candidate) => candidate.display_id === String(primaryDisplay.id)) ?? sources[0];
    if (!source) throw new Error('No screen source available.');
    currentScreenshotSource = source.thumbnail.toPNG();
    snipWindow = new BrowserWindow({
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      width: primaryDisplay.bounds.width,
      height: primaryDisplay.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      fullscreen: true,
      skipTaskbar: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });
    hardenRendererWindow(snipWindow);
    snipWindow.webContents.once('did-finish-load', () => {
      snipWindow?.webContents.send('screenshot:source', currentScreenshotSource);
      snipWindow?.focus();
    });
    snipWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') {
        event.preventDefault();
        void cancelScreenshotCapture();
      }
    });
    await snipWindow.loadURL(rendererUrl('/snip'));
  } finally {
    screenshotStarting = false;
  }
}

function persistScreenshotDataUrl(dataUrl: string): { id: number; fileName: string; contentHash: string } {
  const bytes = pngBytesFromDataUrl(dataUrl);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const fileExtension = '.png';
  const fileName = `${contentHash}${fileExtension}`;
  const filePath = db.resolveAttachmentPath(contentHash, fileExtension);
  if (!existsSync(filePath)) writeFileSync(filePath, bytes);
  const id = db.createAttachment(contentHash, fileExtension, 'image/png', 'snip', true);
  return { id, fileName, contentHash };
}

async function saveScreenshot(dataUrl: string): Promise<{ id: number; fileName: string; contentHash: string } | null> {
  snipWindow?.close();
  snipWindow = null;
  if (screenshotBugId) {
    const result = persistScreenshotDataUrl(dataUrl);
    db.attachScreenshotToBug(screenshotBugId, result.id);
    openMainWindow(`/bugs/${screenshotBugId}`);
    mainWindow?.webContents.send('screenshot:captured', result);
    mainWindow?.webContents.send('bugs:changed');
    screenshotBugId = null;
    resetSnipWindowState();
    return result;
  }
  if (db.getQuickCaptureAnnotationReview()) {
    pendingQuickScreenshotDataUrl = dataUrl;
    resetSnipWindowState();
    await openQuickCapture();
    quickWindow?.webContents.send('quickScreenshot:reviewReady');
    return null;
  }
  const result = persistScreenshotDataUrl(dataUrl);
  restoreMainAfterSnip();
  await openQuickCapture();
  quickWindow?.webContents.send('screenshot:captured', result);
  resetSnipWindowState();
  return result;
}

function pngBytesFromDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('Annotated attachment must be a PNG data URL.');
  return Buffer.from(match[1], 'base64');
}

function saveAnnotatedAttachment(parentId: number, dataUrl: string) {
  const bytes = pngBytesFromDataUrl(dataUrl);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const fileExtension = '.png';
  const filePath = db.resolveAttachmentPath(contentHash, fileExtension);
  if (!existsSync(filePath)) writeFileSync(filePath, bytes);
  const attachment = db.createAnnotatedAttachment(parentId, contentHash, fileExtension, 'image/png');
  mainWindow?.webContents.send('bugs:changed');
  mainWindow?.webContents.send('app:toast', 'Annotated screenshot saved.');
  return attachment;
}

async function downloadAttachment(id: number): Promise<AttachmentDownloadResult> {
  const attachment = db.getAttachment(id);
  if (!attachment?.content_hash) {
    return { success: false, error: 'This attachment file is no longer available locally.' };
  }
  const sourcePath = db.resolveAttachmentPath(attachment.content_hash, attachment.file_extension);
  if (!sourcePath || !existsSync(sourcePath)) {
    return { success: false, error: 'This attachment file is missing from local storage.' };
  }
  const saveDialogOptions = {
    title: 'Download Screenshot',
    defaultPath: join(app.getPath('downloads'), attachment.file_name || `${attachment.content_hash}${attachment.file_extension}`),
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveDialogOptions)
    : await dialog.showSaveDialog(saveDialogOptions);
  if (result.canceled || !result.filePath) return { success: false, canceled: true };
  try {
    copyFileSync(sourcePath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unable to download screenshot.' };
  }
}

async function attachPendingQuickScreenshot(dataUrl: string): Promise<{ id: number; fileName: string; contentHash: string }> {
  if (!pendingQuickScreenshotDataUrl) throw new Error('No pending Quick Panel screenshot.');
  const result = persistScreenshotDataUrl(dataUrl);
  pendingQuickScreenshotDataUrl = '';
  restoreQuickCaptureCompactSize();
  await openQuickCapture();
  quickWindow?.webContents.send('screenshot:captured', result);
  return result;
}

async function discardPendingQuickScreenshot(): Promise<void> {
  pendingQuickScreenshotDataUrl = '';
  restoreQuickCaptureCompactSize();
  await openQuickCapture();
}


async function triageBugWithConfiguredAi(bugData: unknown, signal: AbortSignal): Promise<string> {
  const verifiedPayload = bugData as AiTriageBugPayload;
  const byokConfig = getByokAiConfig(db);
  if (byokConfig.hasApiKey) return triageBugWithByokAi(db, verifiedPayload, signal);

  if (db.getAiTriageEnabled()) {
    const verifiedImagePath = resolveVerifiedTriageAttachmentPath(db, verifiedPayload);
    const localResult = await triageBugWithOllama(verifiedPayload, db.getOllamaModelName(), verifiedImagePath, signal);
    if (!localResult.success) throw new Error(localResult.error || 'Local AI triage failed.');
    return JSON.stringify(normalizeOllamaTriageResult(localResult.result));
  }

  throw new Error('AI triage is not configured. Add a BYOK API key or enable local Ollama triage in Settings.');
}

function normalizeOllamaTriageResult(result: AiTriageResult): Record<string, string> {
  return {
    title: result.bug_title || '',
    bugNote: result.refined_summary || '',
    stepsToReproduce: result.steps_to_reproduce || '',
    expectedResult: result.expected_result || '',
    actualResult: result.actual_result || ''
  };
}

function requireCapture(context: CaptureContext | null): void {
  if (!context) throw new Error('Reopen Quick Capture to continue this draft.');
  db.assertCaptureContext(context);
}

function assertCaptureTransition(): void {
  db.assertCaptureTransition();
  if (screenshotStarting || snipWindow || pendingQuickScreenshotDataUrl) throw new Error('Finish or cancel the screenshot before changing workspace.');
}

function registerIpc(): void {
  const secureIpc = createSecureIpcRegistrar(
    ipcMain,
    createIpcArgumentValidators(),
    (event) => Boolean(event.senderFrame && !event.senderFrame.parent && isTrustedRendererUrl(event.senderFrame.url))
  );
  secureIpc.handle('window:openQuickCapture', () => openQuickCapture());
  secureIpc.handle('capture:context', () => db.getCaptureContext());
  secureIpc.handle('capture:listPending', (_event, context: CaptureContext | null) => {
    requireCapture(context);
    if (!shutdownInProgress && !operationBarrier.isInMaintenance) db.cleanupExpiredCaptures();
    return db.listPendingCaptures();
  });
  secureIpc.handle('capture:discardPending', (_event, context: CaptureContext | null) => { requireCapture(context); assertAppAcceptingMutations(); discardQuickCaptures(false); });
  secureIpc.handle('window:hideQuickCapture', (_event, context: CaptureContext | null) => {
    requireCapture(context);
    assertAppAcceptingMutations();
    discardQuickCaptures();
    quickWindow?.hide();
  });
  secureIpc.handle('window:expandQuickCaptureForReview', () => resizeQuickCaptureForReview());
  secureIpc.handle('window:restoreQuickCaptureCompact', () => restoreQuickCaptureCompactSize());
  secureIpc.handle('window:openMain', (_event, route = DASHBOARD_ROUTE) => openMainWindow(route));
  secureIpc.handle('window:openSettings', (_event, section?: string) => openSettings(section));
  secureIpc.handle('settings:get', () => settingsWithShortcutStatus());
  secureIpc.handle('settings:addApplication', (_event, name: string, contextDescription?: string | null, issuePrefix = '') => mutateWorkspaceSettings(() => db.addApplication(name, contextDescription ?? '', issuePrefix)));
  secureIpc.handle('settings:updateApplication', (_event, id: TaxonomyId, name: string, contextDescription = '', issuePrefix = '') => mutateWorkspaceSettings(() => db.updateApplication(id, name, contextDescription, issuePrefix)));
  secureIpc.handle('settings:updateApplicationContext', (_event, id: TaxonomyId, contextDescription: string) => mutateWorkspaceSettings(() => db.updateApplicationContext(id, contextDescription)));
  secureIpc.handle('settings:updateApplicationSync', (_event, id: TaxonomyId, isSynced: boolean) => mutateWorkspaceSettings(() => db.updateApplicationSync(id, isSynced)));
  secureIpc.handle('settings:deleteApplication', (_event, id: TaxonomyId) => mutateWorkspaceSettings(() => db.deleteApplication(id)));
  secureIpc.handle('settings:addModule', (_event, name: string, applicationId: TaxonomyId | null, contextDescription = '') => mutateWorkspaceSettings(() => db.addModule(name, applicationId, contextDescription)));
  secureIpc.handle('settings:updateModule', (_event, id: TaxonomyId, name: string, applicationId: TaxonomyId | null, contextDescription = '') => mutateWorkspaceSettings(() => db.updateModule(id, name, applicationId, contextDescription)));
  secureIpc.handle('settings:updateModuleContext', (_event, id: TaxonomyId, contextDescription: string) => mutateWorkspaceSettings(() => db.updateModuleContext(id, contextDescription)));
  secureIpc.handle('settings:deleteModule', (_event, id: TaxonomyId) => mutateWorkspaceSettings(() => db.deleteModule(id)));
  secureIpc.handle('settings:addEnvironment', (_event, name: string) => mutateWorkspaceSettings(() => db.addEnvironment(name)));
  secureIpc.handle('settings:updateEnvironment', (_event, id: TaxonomyId, name: string) => mutateWorkspaceSettings(() => db.updateEnvironment(id, name)));
  secureIpc.handle('settings:deleteEnvironment', (_event, id: TaxonomyId) => mutateWorkspaceSettings(() => db.deleteEnvironment(id)));
  secureIpc.handle('settings:addDevice', (_event, name: string) => mutateWorkspaceSettings(() => db.addDevice(name)));
  secureIpc.handle('settings:updateDevice', (_event, id: TaxonomyId, name: string) => mutateWorkspaceSettings(() => db.updateDevice(id, name)));
  secureIpc.handle('settings:deleteDevice', (_event, id: TaxonomyId) => mutateWorkspaceSettings(() => db.deleteDevice(id)));
  secureIpc.handle('settings:addBrowser', (_event, name: string) => mutateWorkspaceSettings(() => db.addBrowser(name)));
  secureIpc.handle('settings:updateBrowser', (_event, id: TaxonomyId, name: string) => mutateWorkspaceSettings(() => db.updateBrowser(id, name)));
  secureIpc.handle('settings:deleteBrowser', (_event, id: TaxonomyId) => mutateWorkspaceSettings(() => db.deleteBrowser(id)));
  secureIpc.handle('settings:addUserRole', (_event, name: string) => mutateWorkspaceSettings(() => db.addUserRole(name)));
  secureIpc.handle('settings:updateUserRole', (_event, id: TaxonomyId, name: string) => mutateWorkspaceSettings(() => db.updateUserRole(id, name)));
  secureIpc.handle('settings:deleteUserRole', (_event, id: TaxonomyId) => mutateWorkspaceSettings(() => db.deleteUserRole(id)));
  secureIpc.handle('settings:addConfigOption', (_event, type: string, value: string) => mutateWorkspaceSettings(() => db.addConfigOption(type, value)));
  secureIpc.handle('settings:updateConfigOption', (_event, id: number, value: string) => mutateWorkspaceSettings(() => db.updateConfigOption(id, value)));
  secureIpc.handle('settings:deleteConfigOption', (_event, id: number) => mutateWorkspaceSettings(() => db.deleteConfigOption(id)));
  secureIpc.handle('settings:saveTemplate', (_event, id: number | null, name: string, templateText: string) => mutateWorkspaceSettings(() => db.saveTemplate(id, name, templateText)));
  secureIpc.handle('settings:updateJiraWorkspaceUrl', (_event, value: string) => mutateSettings(() => db.updateJiraWorkspaceUrl(value)));
  secureIpc.handle('settings:updateAutoBackupDirectoryPath', (_event, value: string) => mutateSettings(() => db.updateAutoBackupDirectoryPath(value)));
  secureIpc.handle('settings:updateQuickCaptureAnnotationReview', (_event, enabled: boolean) => mutateSettings(() => db.updateQuickCaptureAnnotationReview(enabled)));
  secureIpc.handle('settings:updateAiTriageOptions', (_event, enabled: boolean, modelName: string) => mutateSettings(() => db.updateAiTriageOptions(enabled, modelName)));
  registerGetByokAiConfigIpc(secureIpc, () => getByokAiConfig(db));
  secureIpc.handle('save-ai-config', (_event, input: AiConfigSaveInput) =>
    mutateSettings(() => saveByokAiConfig(db, input))
  );
  secureIpc.handle('settings:updateSupabaseSettings', async (_event, projectUrl: string, anonKey: string, inviteEmail?: string) =>
    withFlushedDetails(() => operationBarrier.acquire(async () => {
      assertAppAcceptingMutations();
      assertCaptureTransition();
      // Validate first so an accidental typo cannot disconnect a working project.
      if (projectUrl.trim() || anonKey.trim()) normalizeSupabaseCredentials(projectUrl, anonKey);

      stopSupabaseKeepAlive?.();
      stopSupabaseKeepAlive = null;
      await syncEngine.disconnectWorkspace();

      const result = db.updateSupabaseSettings(projectUrl, anonKey);
      db.updateSupabaseInviteEmail(inviteEmail ?? null);
      syncEngine.initialize();
      startSupabaseKeepAliveIfConfigured();
      notifySettingsChanged();
      mainWindow?.webContents.send('bugs:changed');
      return result;
    }))
  );
  secureIpc.handle('settings:toggleStartup', (_event, enabled: boolean) =>
    mutateSettings(() => {
      const value = db.updateRunOnSystemStartup(enabled);
      enforceStartupPreference(value);
      return value;
    })
  );
  secureIpc.handle('settings:mergeReference', (_event, tableName: ReferenceTable, sourceId: TaxonomyId, targetId: TaxonomyId) => mutateWorkspaceSettings(() => db.mergeReferenceOption(tableName, sourceId, targetId)));
  secureIpc.handle('settings:createPreset', (_event, input: CapturePresetInput) => mutateSettings(() => db.createPreset(input)));
  secureIpc.handle('settings:updatePreset', (_event, id: number, input: CapturePresetInput) => mutateSettings(() => db.updatePreset(id, input)));
  secureIpc.handle('settings:deletePreset', (_event, id: number) => mutateSettings(() => db.deletePreset(id)));
  secureIpc.handle('settings:updateShortcut', (_event, action: ShortcutAction, accelerator: string, enabled: boolean) => {
    assertAppAcceptingMutations();
    db.updateShortcut(action, accelerator, enabled);
    registerAppShortcuts();
    return settingsWithShortcutStatus().shortcuts.find((shortcut: ShortcutSetting) => shortcut.action === action);
  });
  secureIpc.handle('shortcuts:suspend', () => suspendAppShortcuts());
  secureIpc.handle('shortcuts:resume', () => registerAppShortcuts());
  secureIpc.handle('bugs:list', (_event, filters) => db.listBugs(filters));
  secureIpc.handle('bugs:count', () => db.getTotalBugCount());
  secureIpc.handle('bugs:statusCounts', () => db.getBugStatusCounts());
  secureIpc.handle('bugs:get', (_event, id: number) => db.getBug(id));
  secureIpc.handle('bugs:createQuick', (_event, input) => {
    if (screenshotStarting || snipWindow || pendingQuickScreenshotDataUrl) throw new Error('Finish or cancel the screenshot before saving.');
    if (!input.capture_context) throw new Error('Capture context is required. Reopen Quick Capture.');
    db.assertCaptureContext(input.capture_context);
    const bug = mutateWorkspace(() => db.createQuickBug(input));
    db.finishCapture(input.capture_context);
    quickWindow?.hide();
    mainWindow?.webContents.send('bugs:changed');
    notifySaved('Capture saved locally.');
    return bug;
  });
  secureIpc.handle('bugs:update', (event, id: number, input) => {
    operationBarrier.assertAcceptingOperations();
    if (!detailsFlushGate.active || event.sender !== mainWindow?.webContents) assertAppAcceptingMutations();
    assertCurrentWorkspaceWriteAccess();
    const updated = db.updateBug(id, input);
    mainWindow?.webContents.send('bugs:changed');
    return updated;
  });
  registerBugDeletionIpc(secureIpc, {
    authorizeMutation: () => {
      assertAppAcceptingMutations();
      assertCurrentWorkspaceWriteAccess();
    },
    deleteBug: (id) => db.deleteBug(id),
    emitBugsChanged: () => mainWindow?.webContents.send('bugs:changed'),
    emitDeletedToast: () => mainWindow?.webContents.send('app:toast', 'Report deleted.')
  });
  secureIpc.handle('attachments:delete', (_event, id: number) => {
    mutateWorkspace(() => db.deleteAttachment(id));
    mainWindow?.webContents.send('bugs:changed');
  });
  secureIpc.handle('attachments:download', async (_event, id: number) => operationBarrier.acquire(async () => {
    const result = await downloadAttachment(id);
    if (result.success) mainWindow?.webContents.send('app:toast', 'Screenshot downloaded.');
    else if (!result.canceled) mainWindow?.webContents.send('app:toast', result.error || 'Unable to download screenshot.', 'error');
    return result;
  }));
  secureIpc.handle('attachments:saveAnnotated', (_event, parentId: number, dataUrl: string) => mutateWorkspace(() => saveAnnotatedAttachment(parentId, dataUrl)));
  secureIpc.handle('attachments:previewDataUrl', (_event, id: number) => {
    const attachment = db.getAttachment(id);
    if (!attachment) return '';
    const filePath = db.resolveAttachmentPath(attachment.content_hash, attachment.file_extension);
    if (!existsSync(filePath)) return '';
    try {
      const bytes = readFileSync(filePath);
      return `data:${attachment.mime_type};base64,${bytes.toString('base64')}`;
    } catch {
      return '';
    }
  });
  secureIpc.handle('attachments:lineage', (_event, id: number) => db.getAttachmentLineage(id));
  secureIpc.handle('clipboard:copy', (_event, text: string) => clipboard.writeText(text));
  secureIpc.handle('shell:openExternal', (_event, url: string) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only web URLs can be opened.');
    return shell.openExternal(parsed.toString());
  });
  secureIpc.handle('support:sendFeedback', (_event, payload: FeedbackPayload) => operationBarrier.acquire(() => sendFeedbackToExamenQa(payload)));

  secureIpc.handle('details:setDirty', (event, dirty: boolean) => {
    if (event.sender === mainWindow?.webContents) rendererHasDirtyDetails = dirty;
  });
  secureIpc.handle('details:flushComplete', (event, requestId: string, success: boolean) => {
    if (event.sender === mainWindow?.webContents) detailsFlushGate.complete(requestId, success);
  });
  secureIpc.handle('screenshot:start', (event, bugId: number | undefined, context: CaptureContext | null) => {
    if (event.sender === quickWindow?.webContents) requireCapture(context);
    return mutateWorkspace(() => startScreenshotCapture(bugId));
  });
  secureIpc.handle('screenshot:getSource', () => currentScreenshotSource);
  secureIpc.handle('screenshot:complete', (_event, dataUrl: string) => mutateWorkspace(() => saveScreenshot(dataUrl)));
  secureIpc.handle('screenshot:cancel', () => cancelScreenshotCapture());
  secureIpc.handle('quickScreenshot:getPending', (_event, context: CaptureContext | null) => { if (pendingQuickScreenshotDataUrl) requireCapture(context); return pendingQuickScreenshotDataUrl; });
  secureIpc.handle('quickScreenshot:attachPending', (_event, dataUrl: string, context: CaptureContext | null) => { requireCapture(context); return mutateWorkspace(() => attachPendingQuickScreenshot(dataUrl)); });
  secureIpc.handle('quickScreenshot:discardPending', (_event, context: CaptureContext | null) => { requireCapture(context); return discardPendingQuickScreenshot(); });
  secureIpc.handle('backup:export', () => exportBackup());
  secureIpc.handle('backup:import', () => withFlushedDetails(() => importBackup()));
  secureIpc.handle('backup:chooseDirectory', () => chooseBackupDirectory());
  secureIpc.handle('app:clearCurrentWorkspace', async () => {
    const result = await runDestructiveDatabaseOperation(() => db.clearCurrentWorkspace());
    mainWindow?.webContents.send('bugs:changed');
    mainWindow?.webContents.send('settings:changed');
    return { success: true, ...result };
  });
  secureIpc.handle('app:factoryReset', async () => {
    await runDestructiveDatabaseOperation(() => db.factoryReset());
    app.relaunch();
    app.exit(0);
    return { success: true };
  });
  secureIpc.handle('sync:testConnection', () => syncEngine.testConnection());
  secureIpc.handle('sync:authSignIn', (_event, email: string, password: string) => withFlushedDetails(() => operationBarrier.acquire(() => { assertCaptureTransition(); return syncEngine.authSignIn(email, password); })));
  secureIpc.handle('sync:authSignUp', (_event, email: string, password: string, setup: SyncAccountSetup) => withFlushedDetails(() => operationBarrier.acquire(() => { assertCaptureTransition(); return syncEngine.authSignUp(email, password, setup); })));
  secureIpc.handle('sync:generateInvite', async (_event, passphrase: string, targetEmail: string, targetRole: string) => {
    const workspaceId = db.getCurrentWorkspaceId();
    const projectUrl = db.getSupabaseProjectUrl();
    const anonKey = db.getSupabaseAnonKey();
    if (!workspaceId || !projectUrl || !anonKey) throw new Error('Connect a Supabase workspace before creating an invite.');
    assertWorkspaceAdminAccess(db.getWorkspaceRole(workspaceId));
    await syncEngine.inviteUserToWorkspace(targetEmail, targetRole);
    return generateInviteCode(projectUrl, anonKey, workspaceId, passphrase, targetEmail);
  });
  secureIpc.handle('sync:decodeInvite', (_event, token: string, passphrase: string) => decodeInviteCode(token, passphrase));
  secureIpc.handle('sync:authSignOut', () => withFlushedDetails(() => operationBarrier.acquire(async () => {
    assertCaptureTransition();
    const result = await syncEngine.authSignOut();
    mainWindow?.webContents.send('bugs:changed');
    return result;
  })));
  secureIpc.handle('sync:getSessionStatus', () => operationBarrier.acquire(() => syncEngine.getSyncSessionStatus()));
  secureIpc.handle('sync:listWorkspaces', () => operationBarrier.acquire(() => syncEngine.listWorkspaceMemberships()));
  secureIpc.handle('sync:updateWorkspaceName', (_event, workspaceId: string, name: string) => mutateWorkspace(() => syncEngine.updateWorkspaceName(workspaceId, name)));
  secureIpc.handle('sync:getWorkspaceRole', (_event, workspaceId: string | null) => db.getWorkspaceRole(workspaceId));
  secureIpc.handle('sync:claimIssueUserCode', async (_event, userCode: string) => {
    const claimedCode = await operationBarrier.acquire(() => syncEngine.claimIssueUserCode(userCode));
    notifySettingsChanged();
    return claimedCode;
  });
  secureIpc.handle('sync:getDiagnostics', () => db.getSyncDiagnostics());
  secureIpc.handle('sync:getRuntimeStatus', () => syncEngine.getRuntimeStatus());
  secureIpc.handle('sync:retryNow', async () => {
    operationBarrier.assertAcceptingOperations();
    await syncEngine.retrySyncQueueNow();
    return syncEngine.getRuntimeStatus();
  });
  secureIpc.handle('sync:forceRetry', async () => {
    assertAppAcceptingMutations();
    assertCurrentWorkspaceWriteAccess();
    db.resetSyncQueueRetries();
    await syncEngine.retrySyncQueueNow();
    return db.getSyncDiagnostics();
  });
  secureIpc.handle('sync:switchWorkspace', async (_event, workspaceId: string) => withFlushedDetails(async () => {
    assertCaptureTransition();
    const result = await syncEngine.switchWorkspace(workspaceId);
    if (result.success) mainWindow?.webContents.send('bugs:changed');
    return result;
  }));
  secureIpc.handle('ai:triageBug', (event, bugData: unknown, requestId: string) => {
    assertAppAcceptingMutations();
    return operationBarrier.acquire(() => aiRequests.run(event.sender.id, requestId, signal => triageBugWithConfiguredAi(bugData, signal)));
  });
  secureIpc.handle('ai:processIssueWithByok', (event, payload: AiIssueProcessPayload, requestId: string) => {
    assertAppAcceptingMutations();
    return operationBarrier.acquire(() => aiRequests.run(event.sender.id, requestId, signal => processIssueWithByokAi(db, payload, signal)));
  });
  secureIpc.handle('ai:cancel', (event, requestId: string) => aiRequests.cancel(event.sender.id, requestId));
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openMainWindow(DASHBOARD_ROUTE);
  });

  app.whenReady().then(async () => {
    await waitForSafeStorageEncryption();
    db = new BugPocketDatabase();
    if (packagedSmokeTest) {
      const bugCount = db.getTotalBugCount();
      const packagedIconPath = getAssetPath('icon.ico');
      const packagedIcon = nativeImage.createFromPath(packagedIconPath);
      if (packagedIcon.isEmpty()) {
        throw new Error(`Packaged Tray icon failed to load: ${packagedIconPath}`);
      }
      createTray();
      console.log(`[packaged-smoke] database-ready bug-count=${bugCount}`);
      console.log(`[packaged-smoke] native-integrations-ready tray-icon=${packagedIconPath}`);
      tray?.destroy();
      tray = null;
      db.close();
      app.exit(0);
      return;
    }
    syncEngine = createSyncEngine();
    syncEngine.initialize();
    await syncEngine.restorePersistedSession();
    startSupabaseKeepAliveIfConfigured();
    enforceStartupPreference(db.getRunOnSystemStartup());
    registerIpc();
    const captureCleanup = setInterval(() => {
      if (db?.isOpen() && !shutdownInProgress && !operationBarrier.isInMaintenance) {
        try { db.cleanupExpiredCaptures(); } catch (error) { log.warn('Capture cleanup will retry later.', error); }
      }
    }, 60 * 60 * 1000);
    captureCleanup.unref();
    createMainWindow('/dashboard', !process.argv.includes(backgroundStartArg));
    createQuickWindow();
    createTray();
    registerAppShortcuts();
    setTimeout(() => {
      void runAutomatedStartupBackup();
    }, 1500);
  }).catch((caught) => {
    const message = caught instanceof Error ? caught.message : String(caught);
    log.error('[startup] Bug Pocket initialization failed:', caught);
    if (packagedSmokeTest) {
      console.error(`[packaged-smoke] startup-failed ${message}`);
      app.exit(1);
      return;
    }
    dialog.showErrorBox('Bug Pocket could not start', message);
    app.quit();
  });
}

app.on('window-all-closed', () => {});

app.on('before-quit', (event) => {
  if (gracefulShutdownComplete) return;
  event.preventDefault();
  void gracefulShutdown()
    .then(() => app.quit())
    .catch((error) => {
      log.error('[shutdown] Graceful shutdown failed; quit was cancelled.', error);
      dialog.showErrorBox(
        'Bug Pocket could not close safely',
        'An active operation could not be completed. Bug Pocket will remain open so your data is not interrupted.'
      );
    });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});




app.on('web-contents-created', (_event, contents) => {
  const owner = contents.id;
  contents.once('destroyed', () => aiRequests.cancel(owner));
  contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) aiRequests.cancel(owner); });
});
