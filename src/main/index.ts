import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, nativeImage, desktopCapturer, screen, Notification, shell, dialog } from 'electron';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';
import { copyFileSync, createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { BugPocketDatabase } from './database';
import { triageBugWithOllama } from './ai/ollamaTriage';
import { getByokAiConfig, processIssueWithByokAi, saveByokAiConfig, triageBugWithByokAi } from './ai/byokIssueProcessor';
import { SyncEngine } from './sync/syncService';
import type { AiIssueProcessPayload, AiProvider, AiTriageBugPayload, AiTriageResult, AttachmentDownloadResult, BackupExportResult, BackupImportResult, CapturePresetInput, FeedbackPayload, ReferenceTable, SettingsData, ShortcutAction, ShortcutSetting } from '../shared/types';

if (!app.isPackaged) {
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
let isQuitting = false;
let currentScreenshotSource = '';
let pendingQuickScreenshotDataUrl = '';
let screenshotBugId: number | null = null;
let mainWasVisibleBeforeSnip = false;
let shortcutRegistrationErrors: Partial<Record<ShortcutAction, string>> = {};
let rendererHasDirtyDetails = false;
let pendingMainCloseAfterFlush = false;
let pendingMainCloseTimer: NodeJS.Timeout | null = null;
let quickTopmostPulseTimer: NodeJS.Timeout | null = null;
const quickCaptureCompactSize = { width: 460, height: 505 };
const quickCaptureReviewSize = { width: 880, height: 760 };

const isDev = !!process.env['ELECTRON_RENDERER_URL'];
const backgroundStartArg = '--background-start';
const windowBackgroundColor = '#F8FAFC';

function rendererUrl(route: string): string {
  if (isDev) return `${process.env['ELECTRON_RENDERER_URL']}#${route}`;
  return `${pathToFileURL(join(__dirname, '../renderer/index.html')).toString()}#${route}`;
}

function preloadPath(): string {
  if (isDev) return join(__dirname, '../preload/index.js');
  const mjsPreload = join(__dirname, '../preload/index.mjs');
  return existsSync(mjsPreload) ? mjsPreload : join(__dirname, '../preload/index.js');
}

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../build/icon.ico');
}

function enforceStartupPreference(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: enabled ? [backgroundStartArg] : []
  });
}

function initializeAutoUpdater(): void {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-updater] Checking for update...');
    log.info('[auto-updater] Checking for update...');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[auto-updater] Update available:', info.version);
    log.info('[auto-updater] Update available:', info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[auto-updater] Update downloaded and staged for install on quit:', info.version);
    log.info('[auto-updater] Update downloaded and staged for install on quit:', info.version);
    mainWindow?.webContents.send('update-ready');
  });
  autoUpdater.on('error', (error) => {
    console.log('[auto-updater] Update error:', error);
    log.error('[auto-updater] Update error:', error);
  });
}

function createMainWindow(route = '/dashboard', showOnReady = true): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    title: 'Bug Pocket',
    show: false,
    icon: iconPath(),
    resizable: true,
    backgroundColor: windowBackgroundColor,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
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
    if (isQuitting) return;
    event.preventDefault();
    if (rendererHasDirtyDetails && !pendingMainCloseAfterFlush) {
      pendingMainCloseAfterFlush = true;
      mainWindow?.webContents.send('details:flush-save-request');
      pendingMainCloseTimer = setTimeout(() => {
        pendingMainCloseAfterFlush = false;
        pendingMainCloseTimer = null;
        mainWindow?.hide();
      }, 5000);
      return;
    }
    mainWindow?.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function finishPendingMainClose(): void {
  rendererHasDirtyDetails = false;
  if (!pendingMainCloseAfterFlush) return;
  pendingMainCloseAfterFlush = false;
  if (pendingMainCloseTimer) {
    clearTimeout(pendingMainCloseTimer);
    pendingMainCloseTimer = null;
  }
  const windowToClose = mainWindow;
  mainWindow = null;
  windowToClose?.destroy();
}

function createQuickWindow(): void {
  quickWindow = new BrowserWindow({
    width: quickCaptureCompactSize.width,
    height: quickCaptureCompactSize.height,
    resizable: false,
    title: 'Quick Capture - Bug Pocket',
    show: false,
    icon: iconPath(),
    backgroundColor: '#022F63',
    autoHideMenuBar: true,
    skipTaskbar: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
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
      pendingQuickScreenshotDataUrl = '';
      restoreQuickCaptureCompactSize();
      quickWindow?.hide();
    }
  });
}

async function ensureQuickWindowReady(): Promise<void> {
  if (!quickWindow) createQuickWindow();
  if (!quickWindowLoaded && quickWindowReady) await quickWindowReady;
}

async function openQuickCapture(): Promise<void> {
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

function openMainWindow(route = '/dashboard'): void {
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
}

function notifySaved(message = 'Capture saved locally.'): void {
  mainWindow?.webContents.send('app:toast', message);
  if (!mainWindow?.isVisible() && Notification.isSupported()) {
    new Notification({ title: 'Bug Pocket', body: message, icon: iconPath() }).show();
  }
}

function shortcutLabel(accelerator: string): string {
  return accelerator.replace(/CommandOrControl/g, 'Ctrl').replace(/\+/g, '+');
}

function shortcutHandlers(): Record<ShortcutAction, () => void> {
  return {
    quick_capture: () => { void openQuickCapture(); },
    main_panel: () => openMainWindow('/dashboard'),
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

function mutateSettings<T>(action: () => T): T {
  const result = action();
  notifySettingsChanged();
  return result;
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

  try {
    const extractZipModule = (await import('extract-zip')) as unknown as { default?: (zipPath: string, options: { dir: string }) => Promise<void> } & ((zipPath: string, options: { dir: string }) => Promise<void>);
    const extractZip = extractZipModule.default ?? extractZipModule;
    if (typeof extractZip !== 'function') throw new Error('Backup extractor could not be loaded.');

    try {
      syncEngine?.stop();
      db.checkpoint();
      db.close();
    } catch {
      // Continue so a restore can recover even if the current database is unhealthy.
    }

    cleanupSqliteSidecars(userDataPath);
    await extractZip(backupPath, { dir: userDataPath });
    cleanupSqliteSidecars(userDataPath);

    db = new BugPocketDatabase();
    db.applyAfterRestorePatch();
    syncEngine = new SyncEngine(db, () => mainWindow?.webContents.send('bugs:changed'));
    syncEngine.initialize();
    registerAppShortcuts();

    setTimeout(() => {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.reload();
      });
    }, 250);

    return { success: true, filePath: backupPath };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Backup import failed.';
    try {
      db = new BugPocketDatabase();
      syncEngine = new SyncEngine(db, () => mainWindow?.webContents.send('bugs:changed'));
      syncEngine.initialize();
      registerAppShortcuts();
    } catch {
      // If reopening fails, surface the original restore error.
    }
    return { success: false, filePath: backupPath, error: message };
  }
}

function cleanupSqliteSidecars(userDataPath: string): void {
  readdirSync(userDataPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (/\.sqlite-wal$/i.test(entry.name) || /\.sqlite-shm$/i.test(entry.name)))
    .forEach((entry) => {
    const filePath = join(userDataPath, entry.name);
    if (!existsSync(filePath)) return;
    try {
      unlinkSync(filePath);
    } catch {
      // Sidecar cleanup is best effort; extraction/reopen will report if this matters.
    }
  });
}

async function writeBackupArchive(filePath: string): Promise<BackupExportResult> {
  const tempDatabasePaths: string[] = [];
  try {
    db.checkpoint();
    const databaseFiles = db.getBackupDatabaseFiles();
    const archiveDatabaseFiles = databaseFiles
      .filter((file) => existsSync(file.filePath))
      .map((file) => {
        const tempPath = join(app.getPath('userData'), `bug-pocket-temp-${file.role}-${Date.now()}-${randomUUID()}.sqlite`);
        copyFileSync(file.filePath, tempPath);
        tempDatabasePaths.push(tempPath);
        return { ...file, tempPath };
      });
    const attachmentsDir = db.screenshotsDir;
    const referencedAttachments = db.listBackupAttachmentFiles();
    const uniqueReferencedAttachments = new Map<string, { fileName: string; filePath: string }>();
    referencedAttachments.forEach((attachment) => {
      uniqueReferencedAttachments.set(attachment.file_name, { fileName: attachment.file_name, filePath: attachment.file_path });
    });
    const archivedAttachmentFiles = new Map<string, { fileName: string; filePath: string; source: 'database' | 'orphaned-file' }>();
    uniqueReferencedAttachments.forEach((attachment) => {
      if (existsSync(attachment.filePath)) archivedAttachmentFiles.set(attachment.fileName, { ...attachment, source: 'database' });
    });
    if (existsSync(attachmentsDir)) {
      readdirSync(attachmentsDir, { withFileTypes: true }).forEach((entry) => {
        if (!entry.isFile() || archivedAttachmentFiles.has(entry.name)) return;
        const filePath = join(attachmentsDir, entry.name);
        archivedAttachmentFiles.set(entry.name, { fileName: entry.name, filePath, source: 'orphaned-file' });
      });
    }
    const attachmentManifest = {
      exported_at: new Date().toISOString(),
      database: archiveDatabaseFiles.find((file) => file.role === 'workspace')?.archiveName ?? archiveDatabaseFiles[0]?.archiveName ?? 'local.sqlite',
      databases: {
        local_db: archiveDatabaseFiles.find((file) => file.role === 'local')?.archiveName ?? null,
        workspace_db: archiveDatabaseFiles.find((file) => file.role === 'workspace')?.archiveName ?? null,
        current_workspace_id: archiveDatabaseFiles.find((file) => file.role === 'workspace')?.workspaceId ?? null,
        files: archiveDatabaseFiles.map((file) => ({
          role: file.role,
          path: file.archiveName,
          workspace_id: file.workspaceId ?? null
        }))
      },
      attachment_directory: 'attachments',
      referenced_attachment_count: referencedAttachments.length,
      archived_attachment_count: archivedAttachmentFiles.size,
      missing_referenced_attachments: referencedAttachments
        .filter((attachment) => !existsSync(attachment.file_path))
        .map((attachment) => ({
          id: attachment.id,
          bug_id: attachment.bug_id,
          parent_id: attachment.parent_id,
          file_name: attachment.file_name,
          content_hash: attachment.content_hash,
          file_extension: attachment.file_extension,
          created_at: attachment.created_at
        })),
      archived_attachments: Array.from(archivedAttachmentFiles.values()).map((attachment) => ({
        file_name: attachment.fileName,
        source: attachment.source
      }))
    };
    const { ZipArchive } = (await import('archiver')) as unknown as {
      ZipArchive: new (options: { zlib: { level: number } }) => {
        append: (source: NodeJS.ReadableStream | string | Buffer, data: { name: string }) => void;
        finalize: () => Promise<void>;
        on: (event: 'error' | 'warning', listener: (error: Error) => void) => void;
        pipe: (destination: NodeJS.WritableStream) => void;
        pointer: () => number;
      };
    };

    const result = await new Promise<BackupExportResult>((resolve) => {
      const output = createWriteStream(filePath);
      const archive = new ZipArchive({ zlib: { level: 9 } });
      let settled = false;

      const finish = (result: BackupExportResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (error: Error): void => {
        finish({ success: false, filePath, error: error.message || 'Backup export failed.' });
      };

      output.on('close', () => {
        finish({ success: true, filePath, bytesWritten: archive.pointer() });
      });
      output.on('error', fail);
      archive.on('error', fail);
      archive.on('warning', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        fail(error);
      });

      archive.pipe(output);
      archiveDatabaseFiles.forEach((databaseFile) => {
        archive.append(createReadStream(databaseFile.tempPath), { name: databaseFile.archiveName });
      });
      archivedAttachmentFiles.forEach((attachment) => {
        if (!existsSync(attachment.filePath) || !statSync(attachment.filePath).isFile()) return;
        archive.append(createReadStream(attachment.filePath), { name: `attachments/${attachment.fileName}` });
      });
      archive.append(JSON.stringify(attachmentManifest, null, 2), { name: 'backup-manifest.json' });
      archive.finalize().catch(fail);
    });
    if (!result.success && existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Failed backup artifacts are best-effort cleanup.
      }
    }
    return result;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Backup export failed.';
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Failed backup artifacts are best-effort cleanup.
      }
    }
    return { success: false, filePath, error: message };
  } finally {
    tempDatabasePaths.forEach((tempDatabasePath) => {
      if (!existsSync(tempDatabasePath)) return;
      try {
        unlinkSync(tempDatabasePath);
      } catch {
        // Temporary backup copies are best-effort cleanup.
      }
    });
  }
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
  const icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
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
  if (snipWindow) {
    snipWindow.focus();
    return;
  }
  if (!bugId && pendingQuickScreenshotDataUrl) {
    await openQuickCapture();
    quickWindow?.webContents.send('quickScreenshot:reviewReady');
    return;
  }
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
  const source = sources[0];
  if (!source) throw new Error('No screen source available.');
  currentScreenshotSource = source.thumbnail.toDataURL();
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
      nodeIntegration: false
    }
  });
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
}

function persistScreenshotDataUrl(dataUrl: string): { id: number; fileName: string; contentHash: string } {
  const bytes = pngBytesFromDataUrl(dataUrl);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const fileExtension = '.png';
  const fileName = `${contentHash}${fileExtension}`;
  const filePath = db.resolveAttachmentPath(contentHash, fileExtension);
  if (!existsSync(filePath)) writeFileSync(filePath, bytes);
  const id = db.createAttachment(contentHash, fileExtension, 'image/png', 'snip');
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


async function triageBugWithConfiguredAi(bugData: unknown): Promise<string> {
  const byokConfig = getByokAiConfig(db);
  if (byokConfig.hasApiKey) return triageBugWithByokAi(db, bugData);

  if (db.getAiTriageEnabled()) {
    const localResult = await triageBugWithOllama(bugData as AiTriageBugPayload, db.getOllamaModelName());
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

function registerIpc(): void {
  ipcMain.handle('window:openQuickCapture', () => openQuickCapture());
  ipcMain.handle('window:hideQuickCapture', () => {
    pendingQuickScreenshotDataUrl = '';
    restoreQuickCaptureCompactSize();
    quickWindow?.hide();
  });
  ipcMain.handle('window:expandQuickCaptureForReview', () => resizeQuickCaptureForReview());
  ipcMain.handle('window:restoreQuickCaptureCompact', () => restoreQuickCaptureCompactSize());
  ipcMain.handle('window:openMain', (_event, route = '/dashboard') => openMainWindow(route));
  ipcMain.handle('window:openSettings', (_event, section?: string) => openSettings(section));
  ipcMain.handle('settings:get', () => settingsWithShortcutStatus());
  ipcMain.handle('settings:addApplication', (_event, name: string, contextDescription?: string | null) => mutateSettings(() => db.addApplication(name, contextDescription ?? '')));
  ipcMain.handle('settings:updateApplication', (_event, id: number, name: string, contextDescription = '') => mutateSettings(() => db.updateApplication(id, name, contextDescription)));
  ipcMain.handle('settings:updateApplicationContext', (_event, id: number, contextDescription: string) => mutateSettings(() => db.updateApplicationContext(id, contextDescription)));
  ipcMain.handle('settings:updateApplicationSync', (_event, id: number, isSynced: boolean) => mutateSettings(() => db.updateApplicationSync(id, isSynced)));
  ipcMain.handle('settings:deleteApplication', (_event, id: number) => mutateSettings(() => db.deleteApplication(id)));
  ipcMain.handle('settings:addModule', (_event, name: string, applicationId: number | null, contextDescription = '') => mutateSettings(() => db.addModule(name, applicationId, contextDescription)));
  ipcMain.handle('settings:updateModule', (_event, id: number, name: string, applicationId: number | null, contextDescription = '') => mutateSettings(() => db.updateModule(id, name, applicationId, contextDescription)));
  ipcMain.handle('settings:updateModuleContext', (_event, id: number, contextDescription: string) => mutateSettings(() => db.updateModuleContext(id, contextDescription)));
  ipcMain.handle('settings:deleteModule', (_event, id: number) => mutateSettings(() => db.deleteModule(id)));
  ipcMain.handle('settings:addEnvironment', (_event, name: string) => mutateSettings(() => db.addEnvironment(name)));
  ipcMain.handle('settings:updateEnvironment', (_event, id: number, name: string) => mutateSettings(() => db.updateEnvironment(id, name)));
  ipcMain.handle('settings:deleteEnvironment', (_event, id: number) => mutateSettings(() => db.deleteEnvironment(id)));
  ipcMain.handle('settings:addDevice', (_event, name: string) => mutateSettings(() => db.addDevice(name)));
  ipcMain.handle('settings:updateDevice', (_event, id: number, name: string) => mutateSettings(() => db.updateDevice(id, name)));
  ipcMain.handle('settings:deleteDevice', (_event, id: number) => mutateSettings(() => db.deleteDevice(id)));
  ipcMain.handle('settings:addBrowser', (_event, name: string) => mutateSettings(() => db.addBrowser(name)));
  ipcMain.handle('settings:updateBrowser', (_event, id: number, name: string) => mutateSettings(() => db.updateBrowser(id, name)));
  ipcMain.handle('settings:deleteBrowser', (_event, id: number) => mutateSettings(() => db.deleteBrowser(id)));
  ipcMain.handle('settings:addUserRole', (_event, name: string) => mutateSettings(() => db.addUserRole(name)));
  ipcMain.handle('settings:updateUserRole', (_event, id: number, name: string) => mutateSettings(() => db.updateUserRole(id, name)));
  ipcMain.handle('settings:deleteUserRole', (_event, id: number) => mutateSettings(() => db.deleteUserRole(id)));
  ipcMain.handle('settings:addConfigOption', (_event, type: string, value: string) => mutateSettings(() => db.addConfigOption(type, value)));
  ipcMain.handle('settings:updateConfigOption', (_event, id: number, value: string) => mutateSettings(() => db.updateConfigOption(id, value)));
  ipcMain.handle('settings:deleteConfigOption', (_event, id: number) => mutateSettings(() => db.deleteConfigOption(id)));
  ipcMain.handle('settings:saveTemplate', (_event, id: number | null, name: string, templateText: string) => mutateSettings(() => db.saveTemplate(id, name, templateText)));
  ipcMain.handle('settings:updateJiraWorkspaceUrl', (_event, value: string) => mutateSettings(() => db.updateJiraWorkspaceUrl(value)));
  ipcMain.handle('settings:updateAutoBackupDirectoryPath', (_event, value: string) => mutateSettings(() => db.updateAutoBackupDirectoryPath(value)));
  ipcMain.handle('settings:updateQuickCaptureAnnotationReview', (_event, enabled: boolean) => mutateSettings(() => db.updateQuickCaptureAnnotationReview(enabled)));
  ipcMain.handle('settings:updateAiTriageOptions', (_event, enabled: boolean, modelName: string) => mutateSettings(() => db.updateAiTriageOptions(enabled, modelName)));
  ipcMain.handle('get-ai-config', () => getByokAiConfig(db));
  ipcMain.handle('save-ai-config', (_event, input: { provider: AiProvider; baseUrl: string; modelId: string; apiKey?: string; clearApiKey?: boolean; customSystemPrompt: string }) =>
    mutateSettings(() => saveByokAiConfig(db, input))
  );
  ipcMain.handle('settings:updateSupabaseSettings', (_event, projectUrl: string, anonKey: string) =>
    mutateSettings(() => {
      const result = db.updateSupabaseSettings(projectUrl, anonKey);
      syncEngine?.initialize();
      return result;
    })
  );
  ipcMain.handle('settings:toggleStartup', (_event, enabled: boolean) =>
    mutateSettings(() => {
      const value = db.updateRunOnSystemStartup(enabled);
      enforceStartupPreference(value);
      return value;
    })
  );
  ipcMain.handle('settings:mergeReference', (_event, tableName: ReferenceTable, sourceId: number, targetId: number) => mutateSettings(() => db.mergeReferenceOption(tableName, sourceId, targetId)));
  ipcMain.handle('settings:createPreset', (_event, input: CapturePresetInput) => mutateSettings(() => db.createPreset(input)));
  ipcMain.handle('settings:updatePreset', (_event, id: number, input: CapturePresetInput) => mutateSettings(() => db.updatePreset(id, input)));
  ipcMain.handle('settings:deletePreset', (_event, id: number) => mutateSettings(() => db.deletePreset(id)));
  ipcMain.handle('settings:updateShortcut', (_event, action: ShortcutAction, accelerator: string, enabled: boolean) => {
    db.updateShortcut(action, accelerator, enabled);
    registerAppShortcuts();
    return settingsWithShortcutStatus().shortcuts.find((shortcut: ShortcutSetting) => shortcut.action === action);
  });
  ipcMain.handle('shortcuts:suspend', () => suspendAppShortcuts());
  ipcMain.handle('shortcuts:resume', () => registerAppShortcuts());
  ipcMain.handle('bugs:list', (_event, filters) => db.listBugs(filters));
  ipcMain.handle('bugs:count', () => db.getTotalBugCount());
  ipcMain.handle('bugs:get', (_event, id: number) => db.getBug(id));
  ipcMain.handle('bugs:createQuick', (_event, input) => {
    const bug = db.createQuickBug(input);
    quickWindow?.hide();
    mainWindow?.webContents.send('bugs:changed');
    notifySaved('Capture saved locally.');
    return bug;
  });
  ipcMain.handle('bugs:update', (_event, id: number, input) => {
    const updated = db.updateBug(id, input);
    mainWindow?.webContents.send('bugs:changed');
    return updated;
  });
  ipcMain.handle('bugs:delete', (_event, id: number) => {
    db.deleteBug(id);
    mainWindow?.webContents.send('bugs:changed');
    mainWindow?.webContents.send('app:toast', 'Report deleted.');
  });
  ipcMain.handle('attachments:delete', (_event, id: number) => {
    db.deleteAttachment(id);
    mainWindow?.webContents.send('bugs:changed');
  });
  ipcMain.handle('attachments:download', async (_event, id: number) => {
    const result = await downloadAttachment(id);
    if (result.success) mainWindow?.webContents.send('app:toast', 'Screenshot downloaded.');
    else if (!result.canceled) mainWindow?.webContents.send('app:toast', result.error || 'Unable to download screenshot.', 'error');
    return result;
  });
  ipcMain.handle('attachments:saveAnnotated', (_event, parentId: number, dataUrl: string) => saveAnnotatedAttachment(parentId, dataUrl));
  ipcMain.handle('attachments:previewDataUrl', (_event, id: number) => {
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
  ipcMain.handle('attachments:lineage', (_event, id: number) => db.getAttachmentLineage(id));
  ipcMain.handle('attachments:resolvePath', (_event, id: number) => {
    const attachment = db.getAttachment(id);
    return attachment ? db.resolveAttachmentPath(attachment.content_hash, attachment.file_extension) : '';
  });
  ipcMain.handle('clipboard:copy', (_event, text: string) => clipboard.writeText(text));
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only web URLs can be opened.');
    return shell.openExternal(parsed.toString());
  });
  ipcMain.handle('support:sendFeedback', (_event, payload: FeedbackPayload) => syncEngine.sendFeedback(payload));

  ipcMain.handle('details:setDirty', (_event, dirty: boolean) => {
    rendererHasDirtyDetails = !!dirty;
  });
  ipcMain.handle('details:flushComplete', () => {
    finishPendingMainClose();
  });
  ipcMain.handle('screenshot:start', (_event, bugId?: number) => startScreenshotCapture(bugId));
  ipcMain.handle('screenshot:getSource', () => currentScreenshotSource);
  ipcMain.handle('screenshot:complete', (_event, dataUrl: string) => saveScreenshot(dataUrl));
  ipcMain.handle('screenshot:cancel', () => cancelScreenshotCapture());
  ipcMain.handle('quickScreenshot:getPending', () => pendingQuickScreenshotDataUrl);
  ipcMain.handle('quickScreenshot:attachPending', (_event, dataUrl: string) => attachPendingQuickScreenshot(dataUrl));
  ipcMain.handle('quickScreenshot:discardPending', () => discardPendingQuickScreenshot());
  ipcMain.handle('backup:export', () => exportBackup());
  ipcMain.handle('backup:import', () => importBackup());
  ipcMain.handle('backup:chooseDirectory', () => chooseBackupDirectory());
  ipcMain.handle('app:factoryReset', async () => {
    await db.factoryReset();
    app.relaunch();
    app.exit(0);
    return { success: true };
  });
  ipcMain.handle('sync:testConnection', () => syncEngine.testConnection());
  ipcMain.handle('sync:authSignIn', (_event, email: string, password: string) => syncEngine.authSignIn(email, password));
  ipcMain.handle('sync:authSignUp', (_event, email: string, password: string) => syncEngine.authSignUp(email, password));
  ipcMain.handle('sync:authSignOut', () => syncEngine.authSignOut());
  ipcMain.handle('sync:getSessionStatus', () => syncEngine.getSyncSessionStatus());
  ipcMain.handle('sync:listWorkspaces', () => syncEngine.listWorkspaceMemberships());
  ipcMain.handle('sync:updateWorkspaceName', (_event, workspaceId: string, name: string) => syncEngine.updateWorkspaceName(workspaceId, name));
  ipcMain.handle('sync:getWorkspaceRole', (_event, workspaceId: string | null) => db.getWorkspaceRole(workspaceId));
  ipcMain.handle('sync:getDiagnostics', () => db.getSyncDiagnostics());
  ipcMain.handle('sync:forceRetry', async () => {
    db.resetSyncQueueRetries();
    await syncEngine.retrySyncQueueNow();
    return db.getSyncDiagnostics();
  });
  ipcMain.handle('sync:switchWorkspace', async (_event, workspaceId: string) => {
    const result = await syncEngine.switchWorkspace(workspaceId);
    if (result.success) mainWindow?.webContents.send('bugs:changed');
    return result;
  });
  ipcMain.handle('ai:triageBug', (_event, bugData: unknown) => triageBugWithConfiguredAi(bugData));
  ipcMain.handle('ai:processIssueWithByok', (_event, payload: AiIssueProcessPayload) => processIssueWithByokAi(db, payload));
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openMainWindow('/dashboard');
  });

  app.whenReady().then(() => {
    db = new BugPocketDatabase();
    syncEngine = new SyncEngine(db, () => mainWindow?.webContents.send('bugs:changed'));
    syncEngine.initialize();
    enforceStartupPreference(db.getRunOnSystemStartup());
    registerIpc();
    initializeAutoUpdater();
    createMainWindow('/dashboard', !process.argv.includes(backgroundStartArg));
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        console.log('[auto-updater] Update check failed:', error);
        log.error('[auto-updater] Update check failed:', error);
      });
    }
    createQuickWindow();
    createTray();
    registerAppShortcuts();
    setTimeout(() => {
      void runAutomatedStartupBackup();
    }, 1500);
  });
}

app.on('window-all-closed', () => {});

app.on('will-quit', () => {
  syncEngine?.stop();
  globalShortcut.unregisterAll();
});



