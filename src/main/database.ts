import Database from 'better-sqlite3';
import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  Application,
  Attachment,
  Bug,
  BugDetails,
  BugFilters,
  BugUpdateInput,
  CaptureStatus,
  CapturePreset,
  CapturePresetInput,
  ConfigOption,
  Module,
  QuickBugInput,
  ReferenceOption,
  ReferenceTable,
  ReportTemplate,
  RemoteSyncCursor,
  SettingsData,
  ShortcutAction,
  ShortcutSetting,
  SyncQueueEntityType,
  SyncDiagnosticsRow,
  SyncQueueEvent,
  SyncQueueOperation,
  SyncStatus,
  TaxonomyId,
  WorkspaceRole,
  AiProvider
} from '../shared/types';
import { operationBarrier } from './OperationBarrier';
import { resolveAttachmentFilePath, validateAttachmentMetadata } from './sync/attachmentPaths';

const now = (): string => new Date().toISOString();

const defaultStatuses: CaptureStatus[] = ['Draft', 'Reported', 'Discarded'];
const defaultScenarioStatuses: CaptureStatus[] = [];
const defaultSeverities = ['Low', 'Medium', 'High', 'Critical'];
const defaultIssuePlatforms = ['Linear', 'Jira', 'GitHub', 'Trello', 'Google Sheet', 'Other'];
const defaultEntryTypes = ['Bug', 'Scenario', 'Question', 'Observation', 'Improvement'];
const defaultEnvironments = ['Production', 'Staging', 'QA', 'UAT', 'Development', 'Local'];
const defaultDevices = ['Desktop', 'Laptop', 'Tablet', 'Mobile', 'Other'];
const defaultBrowsers = ['Chrome', 'Edge', 'Firefox', 'Safari', 'Other'];
const defaultUserRoles = ['Admin', 'Standard User', 'Guest', 'Read-Only'];
const defaultLocalWorkspaceId = 'default-local';
const referenceTables: Record<ReferenceTable, string> = {
  environment: 'environments',
  device: 'devices',
  browser: 'browsers',
  user_role: 'user_roles'
};
const referenceForeignKeys: Record<ReferenceTable, string> = {
  environment: 'environment_id',
  device: 'device_id',
  browser: 'browser_id',
  user_role: 'user_role_id'
};
const attachmentFileNameSql =
  "CASE WHEN attachments.content_hash IS NULL OR attachments.content_hash = '' THEN 'Pruned attachment' ELSE attachments.content_hash || attachments.file_extension END AS file_name";
const defaultShortcuts: Array<Pick<ShortcutSetting, 'action' | 'label' | 'accelerator' | 'is_enabled' | 'sort_order'>> = [
  { action: 'quick_capture', label: 'Quick Capture Panel', accelerator: 'CommandOrControl+Alt+P', is_enabled: 1, sort_order: 0 },
  { action: 'main_panel', label: 'Main App Panel', accelerator: 'CommandOrControl+Alt+M', is_enabled: 1, sort_order: 1 },
  { action: 'global_screenshot', label: 'Global Screenshot', accelerator: 'CommandOrControl+Alt+S', is_enabled: 1, sort_order: 2 }
];
const MAX_CAPTURE_PRESETS = 3;
const DATABASE_SCHEMA_VERSION = 2;

const quickReportTemplate = `🚨 *[{{severity}}] {{title}}*
*Context:* {{application}} > {{module}} | {{environment}} | {{user_role}}

*Note:* {{note}}`;

function normalizeCaptureStatus(value: string | null | undefined): CaptureStatus {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'reported' || normalized === 'fixed' || normalized === 'verified' || normalized === 'done' || normalized === 'converted to bug') return 'Reported';
  if (normalized === 'discarded' || normalized === 'duplicate' || normalized === 'ignored' || normalized === 'tested, no issue' || normalized === 'rejected / not a bug') return 'Discarded';
  return 'Draft';
}

const legacyFullReportTemplate = `Issue Title:
{{title}}

Summary:
{{note}}

Entry Type:
{{entry_type}}

Application:
{{application}}

Module:
{{module}}

Steps to Reproduce:
{{steps}}

Expected Result:
{{expected}}

Actual Result:
{{actual}}

Status:
{{status}}

Severity:
{{severity}}

Reported:
{{reported}}

Issue ID:
{{issue_id}}

Attachments:
{{attachments}}`;

const environmentOnlyFullReportTemplate = `Issue Title:
{{title}}

Summary:
{{note}}

Entry Type:
{{entry_type}}

Application:
{{application}}

Module:
{{module}}

Environment:
{{environment}}

Steps to Reproduce:
{{steps}}

Expected Result:
{{expected}}

Actual Result:
{{actual}}

Status:
{{status}}

Severity:
{{severity}}

Reported:
{{reported}}

Issue ID:
{{issue_id}}

Attachments:
{{attachments}}`;

const fullReportTemplate = `Issue Title:
{{title}}

Summary:
{{note}}

Entry Type:
{{entry_type}}

Application:
{{application}}

Module:
{{module}}

Environment:
{{environment}}

Device:
{{device}}

Browser:
{{browser}}

User Role:
{{user_role}}

Steps to Reproduce:
{{steps}}

Expected Result:
{{expected}}

Actual Result:
{{actual}}

Status:
{{status}}

Severity:
{{severity}}

Reported:
{{reported}}

Issue ID:
{{issue_id}}

Attachments:
{{attachments}}`;

export class BugPocketDatabase {
  private localDb: Database.Database;
  private workspaceDb: Database.Database | null = null;
  private db: Database.Database;
  private readonly dataDir: string;
  private readonly localDbPath: string;
  private cloudSyncSessionActive = false;

  constructor(dataDirOverride?: string) {
    this.dataDir = dataDirOverride ?? app.getPath('userData');
    mkdirSync(this.dataDir, { recursive: true });
    this.localDbPath = join(this.dataDir, 'local.sqlite');
    const legacyDbPath = join(this.dataDir, 'bug-pocket.sqlite');
    if (!existsSync(this.localDbPath) && existsSync(legacyDbPath)) {
      copyFileSync(legacyDbPath, this.localDbPath);
    }

    this.localDb = this.openDatabase(this.localDbPath);
    this.db = this.localDb;
    this.migrateConnection(this.localDb, false);
    this.seedDefaults();
    const workspaceId = this.getCurrentWorkspaceId();
    if (workspaceId) this.connectToWorkspace(workspaceId);
    try {
      this.pruneStaleAttachments();
    } catch {
      // Retention cleanup should never block app startup.
    }
  }

  get screenshotsDir(): string {
    const dir = join(this.dataDir, 'attachments');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  get databasePath(): string {
    return this.workspaceDb ? this.workspaceDatabasePath(this.getCurrentWorkspaceId() ?? '') : this.localDbPath;
  }

  getBackupDatabaseFiles(): Array<{ archiveName: string; filePath: string; role: 'local' | 'workspace'; workspaceId?: string }> {
    const files: Array<{ archiveName: string; filePath: string; role: 'local' | 'workspace'; workspaceId?: string }> = [
      { archiveName: 'local.sqlite', filePath: this.localDbPath, role: 'local' }
    ];
    const workspaceId = this.getCurrentWorkspaceId();
    if (workspaceId && this.workspaceDb) {
      files.push({
        archiveName: `ws_${workspaceId.trim().replace(/[^a-zA-Z0-9_.-]/g, '_')}.sqlite`,
        filePath: this.workspaceDatabasePath(workspaceId),
        role: 'workspace',
        workspaceId
      });
    }
    return files;
  }

  listBackupAttachmentFiles(): Array<{
    id: number;
    bug_id: number | null;
    parent_id: number | null;
    content_hash: string;
    file_extension: string;
    file_name: string;
    file_path: string;
    created_at: string;
  }> {
    type AttachmentReference = {
      id: number;
      bug_id: number | null;
      parent_id: number | null;
      content_hash: string;
      file_extension: string;
      created_at: string;
    };
    const sourceDatabases = this.workspaceDb ? [this.localDb, this.workspaceDb] : [this.localDb];
    const referencedFiles = new Map<string, AttachmentReference & { file_name: string; file_path: string }>();

    for (const sourceDb of sourceDatabases) {
      const rows = sourceDb
        .prepare(
          `SELECT id, bug_id, parent_id, content_hash, file_extension, created_at
           FROM attachments
           WHERE content_hash IS NOT NULL AND content_hash != ''
           ORDER BY id`
        )
        .all() as AttachmentReference[];
      for (const row of rows) {
        const extension = row.file_extension.startsWith('.') ? row.file_extension : `.${row.file_extension}`;
        const fileName = `${row.content_hash}${extension}`;
        referencedFiles.set(fileName, {
          ...row,
          file_extension: extension,
          file_name: fileName,
          file_path: this.resolveAttachmentPath(row.content_hash, extension)
        });
      }
    }

    return Array.from(referencedFiles.values());
  }

  checkpoint(): void {
    this.localDb.pragma('wal_checkpoint(FULL)');
    this.workspaceDb?.pragma('wal_checkpoint(FULL)');
  }

  close(): void {
    this.disconnectWorkspace();
    this.localDb.close();
  }

  disconnectWorkspace(): void {
    if (this.workspaceDb) {
      this.workspaceDb.close();
      this.workspaceDb = null;
    }
    this.db = this.localDb;
  }

  isOpen(): boolean {
    return (this.localDb as unknown as { open?: boolean }).open !== false;
  }

  async clearCurrentWorkspace(): Promise<{ workspaceId: string; deletedAttachmentFiles: number }> {
    const workspaceId = this.getCurrentWorkspaceId();
    if (!workspaceId || !this.workspaceDb) throw new Error('No workspace is currently connected.');

    const workspacePath = this.workspaceDatabasePath(workspaceId);
    const attachmentRows = this.workspaceDb
      .prepare(
        `SELECT DISTINCT content_hash, file_extension
         FROM attachments
         WHERE content_hash IS NOT NULL AND content_hash != ''`
      )
      .all() as Array<{ content_hash: string; file_extension: string }>;

    this.disconnectWorkspace();
    try {
      await this.removeSqliteDatabaseFiles(workspacePath);
    } catch (caught) {
      this.connectToWorkspace(workspaceId);
      throw caught;
    }

    this.updateCurrentWorkspaceId(null);
    this.setCloudSyncSessionActive(false);

    let deletedAttachmentFiles = 0;
    const checkedHashes = new Set<string>();
    for (const attachment of attachmentRows) {
      const normalizedHash = attachment.content_hash.toLowerCase();
      if (checkedHashes.has(normalizedHash)) continue;
      checkedHashes.add(normalizedHash);
      if (this.isAttachmentHashReferencedByAnyDatabase(attachment.content_hash, workspacePath)) continue;

      const sameHashRows = attachmentRows.filter((row) => row.content_hash.toLowerCase() === normalizedHash);
      for (const row of sameHashRows) {
        try {
          const attachmentPath = this.resolveAttachmentPath(row.content_hash, row.file_extension);
          if (attachmentPath && existsSync(attachmentPath)) {
            await rm(attachmentPath, { force: true });
            deletedAttachmentFiles += 1;
          }
        } catch {
          // Malformed legacy metadata is never converted into a filesystem path.
        }
      }
    }

    return { workspaceId, deletedAttachmentFiles };
  }

  async factoryReset(): Promise<void> {
    const attachmentsDir = this.screenshotsDir;
    this.disconnectWorkspace();

    const workspaceFiles = readdirSync(this.dataDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^ws_.+\.sqlite(?:-wal|-shm)?$/i.test(entry.name))
      .map((entry) => join(this.dataDir, entry.name));
    await Promise.all(workspaceFiles.map((filePath) => rm(filePath, { force: true })));

    this.localDb.pragma('foreign_keys = OFF');
    try {
      const wipeLocalData = this.localDb.transaction(() => {
        // Preset records are retained, but their taxonomy links cannot point at rows being reset.
        this.localDb
          .prepare(
            `UPDATE presets
             SET application_id = NULL, module_id = NULL, environment_id = NULL,
                 user_role_id = NULL, entry_type_id = NULL, updated_at = ?`
          )
          .run(now());
        for (const table of [
          'sync_queue',
          'attachments',
          'bugs',
          'modules',
          'applications',
          'environments',
          'devices',
          'browsers',
          'user_roles',
          'config_options'
        ]) {
          if (this.tableExists(this.localDb, table)) {
            this.localDb.prepare(`DELETE FROM ${this.quoteIdentifier(table)}`).run();
          }
        }
      });
      wipeLocalData();
    } finally {
      this.localDb.pragma('foreign_keys = ON');
    }

    this.updateCurrentWorkspaceId(null);
    this.setCloudSyncSessionActive(false);
    await rm(attachmentsDir, { recursive: true, force: true });
    mkdirSync(attachmentsDir, { recursive: true });
  }

  private async removeSqliteDatabaseFiles(databasePath: string): Promise<void> {
    await Promise.all([
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`
    ].map((filePath) => rm(filePath, { force: true })));
  }

  private isAttachmentHashReferencedByAnyDatabase(contentHash: string, excludedDatabasePath: string): boolean {
    const excludedPath = resolve(excludedDatabasePath).toLowerCase();
    const databasePaths = readdirSync(this.dataDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sqlite'))
      .map((entry) => join(this.dataDir, entry.name))
      .filter((filePath) => resolve(filePath).toLowerCase() !== excludedPath);

    for (const databasePath of databasePaths) {
      const isLocalDatabase = resolve(databasePath).toLowerCase() === resolve(this.localDbPath).toLowerCase();
      let connection: Database.Database | null = null;
      try {
        connection = isLocalDatabase
          ? this.localDb
          : new Database(databasePath, { readonly: true, fileMustExist: true });
        if (!this.tableExists(connection, 'attachments')) continue;
        const reference = connection
          .prepare('SELECT 1 AS referenced FROM attachments WHERE LOWER(content_hash) = LOWER(?) LIMIT 1')
          .get(contentHash) as { referenced: number } | undefined;
        if (reference) return true;
      } catch {
        // An unreadable database may still own the blob, so preserve it conservatively.
        return true;
      } finally {
        if (!isLocalDatabase) connection?.close();
      }
    }
    return false;
  }

  applyAfterRestorePatch(): void {
    const manifestPath = existsSync(join(this.dataDir, 'manifest.json'))
      ? join(this.dataDir, 'manifest.json')
      : join(this.dataDir, 'backup-manifest.json');
    const restoredSingleDatabasePath = join(this.dataDir, 'bug-pocket.sqlite');
    const defaultWorkspacePath = this.workspaceDatabasePath(defaultLocalWorkspaceId);
    const restoredManifest = this.readRestoreManifest(manifestPath);

    if (restoredManifest?.databases) {
      const currentWorkspaceId = typeof restoredManifest.databases.current_workspace_id === 'string'
        ? restoredManifest.databases.current_workspace_id.trim()
        : '';
      const workspaceDbName = typeof restoredManifest.databases.workspace_db === 'string'
        ? restoredManifest.databases.workspace_db.trim()
        : '';

      if (currentWorkspaceId && workspaceDbName) {
        const extractedWorkspacePath = join(this.dataDir, workspaceDbName);
        const targetWorkspacePath = this.workspaceDatabasePath(currentWorkspaceId);
        if (!existsSync(extractedWorkspacePath)) {
          throw new Error(`Backup restore failed: workspace database '${workspaceDbName}' is missing from the archive.`);
        }
        if (existsSync(extractedWorkspacePath) && extractedWorkspacePath !== targetWorkspacePath) {
          this.workspaceDb?.close();
          this.workspaceDb = null;
          copyFileSync(extractedWorkspacePath, targetWorkspacePath);
        }
        this.connectToWorkspace(currentWorkspaceId);
      } else {
        this.connectToWorkspace(defaultLocalWorkspaceId);
        this.copyLegacyLocalRowsToWorkspace();
      }

      this.clearLegacyLocalWorkspaceRows();
      return;
    }

    const restoredSingleDatabaseExists = existsSync(restoredSingleDatabasePath);

    if (restoredSingleDatabaseExists) {
      this.workspaceDb?.close();
      this.workspaceDb = null;
      copyFileSync(restoredSingleDatabasePath, defaultWorkspacePath);
    }

    this.connectToWorkspace(defaultLocalWorkspaceId);
    if (!restoredSingleDatabaseExists) {
      this.copyLegacyLocalRowsToWorkspace();
    }
    this.clearLegacyLocalWorkspaceRows();
    this.updateCurrentWorkspaceId(defaultLocalWorkspaceId);
  }

  private readRestoreManifest(manifestPath: string): { databases?: { local_db?: unknown; workspace_db?: unknown; current_workspace_id?: unknown } } | null {
    if (!existsSync(manifestPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { databases?: { local_db?: unknown; workspace_db?: unknown; current_workspace_id?: unknown } };
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  resolveAttachmentPath(contentHash: string | null, fileExtension: string): string {
    if (!contentHash) return '';
    return resolveAttachmentFilePath(this.screenshotsDir, contentHash, fileExtension);
  }

  attachmentFileExists(contentHash: string | null, fileExtension: string): boolean {
    const filePath = this.resolveAttachmentPath(contentHash, fileExtension);
    return Boolean(filePath && existsSync(filePath));
  }

  connectToWorkspace(workspaceId: string): string | null {
    const cleaned = workspaceId.trim();
    if (!cleaned) {
      this.disconnectWorkspace();
      this.updateCurrentWorkspaceId(null);
      return null;
    }

    const nextPath = this.workspaceDatabasePath(cleaned);
    this.disconnectWorkspace();
    // Workspace databases are a loose offline cache. Taxonomy/config tables are exposed from
    // local.sqlite via attached temp views, and SQLite cannot enforce REFERENCES across attached
    // database files. Keep workspace FK checks disabled here; Supabase remains the authoritative
    // relational integrity layer for cloud sync. Re-enabling this breaks Quick Panel inserts.
    this.workspaceDb = this.openDatabase(nextPath, false);
    this.migrateConnection(this.workspaceDb, true);
    this.attachLocalTaxonomyViews(this.workspaceDb);
    this.workspaceDb.pragma('foreign_keys = OFF');
    this.updateCurrentWorkspaceId(cleaned);
    return cleaned;
  }

  connectToWorkspaceTracked(workspaceId: string): Promise<string | null> {
    const operation = Promise.resolve().then(() => this.connectToWorkspace(workspaceId));
    return operationBarrier.acquire(operation);
  }

  private openDatabase(path: string, enforceForeignKeys = true): Database.Database {
    const connection = new Database(path);
    connection.pragma('journal_mode = WAL');
    connection.pragma(`foreign_keys = ${enforceForeignKeys ? 'ON' : 'OFF'}`);
    return connection;
  }

  private migrateConnection(connection: Database.Database, workspace: boolean): void {
    const previous = this.db;
    this.db = connection;
    try {
      const version = Number(connection.pragma('user_version', { simple: true }) ?? 0);
      this.migrate();
      if (workspace) this.ensureWorkspaceUuidTaxonomySchema();
      else this.ensureLocalTextTaxonomyReferences();
      if (version < DATABASE_SCHEMA_VERSION) {
        connection.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
      }
      if (workspace) connection.pragma('foreign_keys = OFF');
    } finally {
      this.db = previous;
    }
  }

  private workspaceDatabasePath(workspaceId: string): string {
    const safeId = workspaceId.trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
    return join(this.dataDir, `ws_${safeId}.sqlite`);
  }

  private copyLegacyLocalRowsToWorkspace(): void {
    if (!this.workspaceDb) return;
    const legacyTables = ['applications', 'modules', 'environments', 'bugs', 'attachments', 'sync_queue'];
    this.workspaceDb.exec('PRAGMA foreign_keys = OFF');
    try {
      for (const table of legacyTables) {
        if (!this.tableExists(this.localDb, table) || !this.tableExists(this.workspaceDb, table)) continue;
        const localCount = this.localDb.prepare(`SELECT COUNT(*) AS count FROM ${this.quoteIdentifier(table)}`).get() as { count: number };
        if (!localCount.count) continue;

        const commonColumns = this.commonColumns(this.localDb, this.workspaceDb, table);
        if (!commonColumns.length) continue;

        const columnSql = commonColumns.map((column) => this.quoteIdentifier(column)).join(', ');
        const placeholders = commonColumns.map((column) => `@${column}`).join(', ');
        const rows = this.localDb.prepare(`SELECT ${columnSql} FROM ${this.quoteIdentifier(table)}`).all() as Array<Record<string, unknown>>;
        const insert = this.workspaceDb.prepare(`INSERT OR IGNORE INTO ${this.quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`);
        const copyRows = this.workspaceDb.transaction((values: Array<Record<string, unknown>>) => {
          values.forEach((row) => insert.run(row));
        });
        copyRows(rows);
      }
    } finally {
      this.workspaceDb.exec('PRAGMA foreign_keys = OFF');
    }
  }

  private clearLegacyLocalWorkspaceRows(): void {
    const clearRows = this.localDb.transaction(() => {
      ['sync_queue', 'attachments', 'bugs'].forEach((table) => {
        if (!this.tableExists(this.localDb, table)) return;
        this.localDb.prepare(`DELETE FROM ${this.quoteIdentifier(table)}`).run();
      });
    });
    clearRows();
  }

  private tableExists(connection: Database.Database, table: string): boolean {
    const row = connection
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
      .get(table) as { name: string } | undefined;
    return Boolean(row);
  }

  private commonColumns(left: Database.Database, right: Database.Database, table: string): string[] {
    const leftColumns = new Set(
      (left.prepare(`PRAGMA table_info(${this.quoteIdentifier(table)})`).all() as Array<{ name: string }>).map((column) => column.name)
    );
    return (right.prepare(`PRAGMA table_info(${this.quoteIdentifier(table)})`).all() as Array<{ name: string }>)
      .map((column) => column.name)
      .filter((column) => leftColumns.has(column));
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private attachLocalTaxonomyViews(connection: Database.Database): void {
    const escapedPath = this.localDbPath.replace(/'/g, "''");
    connection.exec(`ATTACH DATABASE '${escapedPath}' AS local_config`);
    const viewTables = [
      'devices',
      'browsers',
      'user_roles',
      'config_options',
      'report_templates',
      'presets',
      'shortcut_settings',
      'app_settings'
    ];
    for (const table of viewTables) {
      connection.exec(`DROP VIEW IF EXISTS temp.${table}`);
      connection.exec(`CREATE TEMP VIEW ${table} AS SELECT * FROM local_config.${table}`);
    }
  }

  private ensureWorkspaceUuidTaxonomySchema(): void {
    const applicationIdColumn = this.db.prepare('PRAGMA table_info(applications)').all() as Array<{ name: string; type: string }>;
    const alreadyUuid = applicationIdColumn.some((column) => column.name === 'id' && column.type.toUpperCase().includes('TEXT'));
    if (alreadyUuid) return;

    this.db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS applications_uuid (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        context_description TEXT NULL DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_synced INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO applications_uuid (id, name, context_description, is_active, is_synced, created_at, updated_at)
      SELECT CAST(id AS TEXT), name, context_description, is_active, is_synced, created_at, updated_at FROM applications;

      CREATE TABLE IF NOT EXISTS modules_uuid (
        id TEXT PRIMARY KEY,
        application_id TEXT NULL REFERENCES applications(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        context_description TEXT NULL DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO modules_uuid (id, application_id, name, context_description, is_active, created_at, updated_at)
      SELECT CAST(id AS TEXT), CASE WHEN application_id IS NULL THEN NULL ELSE CAST(application_id AS TEXT) END, name, context_description, is_active, created_at, updated_at FROM modules;

      CREATE TABLE IF NOT EXISTS environments_uuid (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO environments_uuid (id, name, value, sort_order, is_active, created_at, updated_at)
      SELECT CAST(id AS TEXT), name, value, sort_order, is_active, created_at, updated_at FROM environments;

      CREATE TABLE IF NOT EXISTS bugs_uuid (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id TEXT NULL REFERENCES applications(id) ON DELETE SET NULL,
        module_id TEXT NULL REFERENCES modules(id) ON DELETE SET NULL,
        environment_id TEXT NULL REFERENCES environments(id) ON DELETE SET NULL,
        device_id INTEGER NULL REFERENCES devices(id) ON DELETE SET NULL,
        browser_id INTEGER NULL REFERENCES browsers(id) ON DELETE SET NULL,
        user_role_id INTEGER NULL REFERENCES user_roles(id) ON DELETE SET NULL,
        entry_type TEXT NOT NULL DEFAULT 'Bug',
        title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        other_details TEXT NOT NULL DEFAULT '',
        steps_to_reproduce TEXT NOT NULL DEFAULT '',
        expected_result TEXT NOT NULL DEFAULT '',
        actual_result TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Reported', 'Discarded')),
        severity TEXT NOT NULL DEFAULT 'Medium',
        reported INTEGER NOT NULL DEFAULT 0,
        issue_platform TEXT NOT NULL DEFAULT '',
        issue_id TEXT NOT NULL DEFAULT '',
        issue_url TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'Local Only',
        last_sync_at TEXT NOT NULL DEFAULT '',
        remote_id TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NULL DEFAULT NULL,
        created_by TEXT NULL DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO bugs_uuid (
        id, application_id, module_id, environment_id, device_id, browser_id, user_role_id,
        entry_type, title, note, other_details, steps_to_reproduce, expected_result, actual_result,
        status, severity, reported, issue_platform, issue_id, issue_url, tags, sync_status, last_sync_at, remote_id, workspace_id, created_by, created_at, updated_at
      )
      SELECT
        id,
        CASE WHEN application_id IS NULL THEN NULL ELSE CAST(application_id AS TEXT) END,
        CASE WHEN module_id IS NULL THEN NULL ELSE CAST(module_id AS TEXT) END,
        CASE WHEN environment_id IS NULL THEN NULL ELSE CAST(environment_id AS TEXT) END,
        device_id, browser_id, user_role_id,
        entry_type, title, note, other_details, steps_to_reproduce, expected_result, actual_result,
        status, severity, reported, issue_platform, issue_id, issue_url, tags, sync_status, last_sync_at, remote_id, workspace_id, created_by, created_at, updated_at
      FROM bugs;

      DROP TABLE bugs;
      DROP TABLE modules;
      DROP TABLE applications;
      DROP TABLE environments;
      ALTER TABLE applications_uuid RENAME TO applications;
      ALTER TABLE modules_uuid RENAME TO modules;
      ALTER TABLE environments_uuid RENAME TO environments;
      ALTER TABLE bugs_uuid RENAME TO bugs;

      CREATE INDEX IF NOT EXISTS idx_modules_application_id ON modules(application_id);
      CREATE INDEX IF NOT EXISTS idx_bugs_application_id ON bugs(application_id);
      CREATE INDEX IF NOT EXISTS idx_bugs_module_id ON bugs(module_id);
      CREATE INDEX IF NOT EXISTS idx_bugs_environment_id ON bugs(environment_id);
      CREATE INDEX IF NOT EXISTS idx_bugs_sync_status ON bugs(sync_status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bugs_remote_id ON bugs(remote_id) WHERE remote_id != '';

      PRAGMA foreign_keys = ON;
    `);
  }

  private ensureLocalTextTaxonomyReferences(): void {
    this.rebuildTableWithTextColumns('bugs', ['application_id', 'module_id', 'environment_id']);
    this.rebuildTableWithTextColumns('presets', ['application_id', 'module_id', 'environment_id']);
  }

  private rebuildTableWithTextColumns(table: 'bugs' | 'presets', targetColumns: string[]): void {
    const columns = this.localDb.prepare(`PRAGMA table_info(${this.quoteIdentifier(table)})`).all() as Array<{ name: string; type: string }>;
    const schema = this.localDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    if (!schema?.sql) throw new Error(`Cannot migrate missing ${table} schema.`);
    const textColumnsReady = targetColumns.every((target) => columns.find((column) => column.name === target)?.type.toUpperCase().includes('TEXT'));
    const hasPresetTaxonomyForeignKeys = table === 'presets' && targetColumns.some((column) =>
      new RegExp(`${column}\\s+TEXT[^,]*REFERENCES`, 'i').test(schema.sql)
    );
    if (textColumnsReady && !hasPresetTaxonomyForeignKeys) return;

    const temporaryTable = `${table}_taxonomy_text`;
    let createSql = schema.sql.replace(
      new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+[\"\\[]?${table}[\"\\]]?`, 'i'),
      `CREATE TABLE ${temporaryTable}`
    );
    for (const column of targetColumns) {
      createSql = createSql.replace(
        new RegExp(`([\"\\[]?${column}[\"\\]]?\\s+)INTEGER\\b`, 'i'),
        '$1TEXT'
      );
      if (table === 'presets') {
        createSql = createSql.replace(
          new RegExp(`([\"\\[]?${column}[\"\\]]?\\s+TEXT\\s+NULL)\\s+REFERENCES\\s+[^,]+`, 'i'),
          '$1'
        );
      }
    }

    const indexSql = this.localDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
      .all(table) as Array<{ sql: string }>;
    const columnNames = columns.map((column) => column.name);
    const insertColumns = columnNames.map((column) => this.quoteIdentifier(column)).join(', ');
    const selectColumns = columnNames
      .map((column) => targetColumns.includes(column) ? `CAST(${this.quoteIdentifier(column)} AS TEXT)` : this.quoteIdentifier(column))
      .join(', ');

    this.localDb.pragma('foreign_keys = OFF');
    try {
      const migrateTable = this.localDb.transaction(() => {
        this.localDb.exec(`DROP TABLE IF EXISTS ${this.quoteIdentifier(temporaryTable)}`);
        this.localDb.exec(createSql);
        this.localDb.exec(`INSERT INTO ${this.quoteIdentifier(temporaryTable)} (${insertColumns}) SELECT ${selectColumns} FROM ${this.quoteIdentifier(table)}`);
        this.localDb.exec(`DROP TABLE ${this.quoteIdentifier(table)}`);
        this.localDb.exec(`ALTER TABLE ${this.quoteIdentifier(temporaryTable)} RENAME TO ${this.quoteIdentifier(table)}`);
        indexSql.forEach((index) => this.localDb.exec(index.sql));
      });
      migrateTable();
    } finally {
      this.localDb.pragma('foreign_keys = ON');
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        context_description TEXT NULL DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_synced INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS modules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NULL REFERENCES applications(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        context_description TEXT NULL DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS environments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browsers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bugs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id TEXT NULL REFERENCES applications(id) ON DELETE SET NULL,
        module_id TEXT NULL REFERENCES modules(id) ON DELETE SET NULL,
        environment_id TEXT NULL REFERENCES environments(id) ON DELETE SET NULL,
        device_id INTEGER NULL REFERENCES devices(id) ON DELETE SET NULL,
        browser_id INTEGER NULL REFERENCES browsers(id) ON DELETE SET NULL,
        user_role_id INTEGER NULL REFERENCES user_roles(id) ON DELETE SET NULL,
        entry_type TEXT NOT NULL DEFAULT 'Bug',
        title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        other_details TEXT NOT NULL DEFAULT '',
        steps_to_reproduce TEXT NOT NULL DEFAULT '',
        expected_result TEXT NOT NULL DEFAULT '',
        actual_result TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Reported', 'Discarded')),
        severity TEXT NOT NULL DEFAULT 'Medium',
        reported INTEGER NOT NULL DEFAULT 0,
        issue_platform TEXT NOT NULL DEFAULT '',
        issue_id TEXT NOT NULL DEFAULT '',
        issue_url TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'Local Only',
        last_sync_at TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NULL DEFAULT NULL,
        created_by TEXT NULL DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bug_id INTEGER NULL REFERENCES bugs(id) ON DELETE CASCADE,
        parent_id INTEGER NULL REFERENCES attachments(id) ON DELETE SET NULL,
        content_hash TEXT NULL DEFAULT NULL,
        file_extension TEXT NOT NULL DEFAULT '.png',
        mime_type TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'snip',
        sync_status TEXT NOT NULL DEFAULT 'Local Only',
        last_sync_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(type, value)
      );

      CREATE TABLE IF NOT EXISTS report_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        template_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shortcut_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        accelerator TEXT NOT NULL DEFAULT '',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        -- Presets remain in local.sqlite and may point at UUID taxonomies in workspaceDb.
        -- Cross-database foreign keys are impossible in SQLite; validate these IDs in application code.
        application_id TEXT NULL,
        module_id TEXT NULL,
        environment_id TEXT NULL,
        user_role_id INTEGER NULL REFERENCES user_roles(id) ON DELETE RESTRICT,
        entry_type_id INTEGER NULL REFERENCES config_options(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_seq INTEGER NOT NULL DEFAULT 0,
        op_id TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NULL DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY NOT NULL,
        value      TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_bugs_updated_at ON bugs(updated_at);
      CREATE INDEX IF NOT EXISTS idx_attachments_bug_id ON attachments(bug_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_content_hash ON attachments(content_hash);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue(created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_modules_application_id ON modules(application_id);
      CREATE INDEX IF NOT EXISTS idx_presets_application_id ON presets(application_id);
      CREATE INDEX IF NOT EXISTS idx_presets_module_id ON presets(module_id);
      CREATE INDEX IF NOT EXISTS idx_presets_environment_id ON presets(environment_id);
      CREATE INDEX IF NOT EXISTS idx_presets_entry_type_id ON presets(entry_type_id);
    `);
    this.ensureColumn('applications', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('applications', 'is_synced', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('applications', 'context_description', 'TEXT NULL DEFAULT NULL');
    this.ensureColumn('modules', 'context_description', 'TEXT NULL DEFAULT NULL');
    this.ensureColumn('modules', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureReferenceColumns();
    this.ensureColumn('bugs', 'entry_type', "TEXT NOT NULL DEFAULT 'Bug'");
    this.ensureColumn('bugs', 'environment_id', 'TEXT NULL REFERENCES environments(id) ON DELETE SET NULL');
    this.ensureColumn('bugs', 'device_id', 'INTEGER NULL REFERENCES devices(id) ON DELETE SET NULL');
    this.ensureColumn('bugs', 'browser_id', 'INTEGER NULL REFERENCES browsers(id) ON DELETE SET NULL');
    this.ensureColumn('bugs', 'user_role_id', 'INTEGER NULL REFERENCES user_roles(id) ON DELETE SET NULL');
    this.ensureColumn('presets', 'user_role_id', 'INTEGER NULL REFERENCES user_roles(id) ON DELETE RESTRICT');
    this.ensureColumn('bugs', 'steps_to_reproduce', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'expected_result', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'actual_result', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'sync_status', "TEXT NOT NULL DEFAULT 'Local Only'");
    this.ensureColumn('bugs', 'last_sync_at', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'remote_id', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'workspace_id', 'TEXT NULL DEFAULT NULL');
    this.ensureColumn('bugs', 'created_by', 'TEXT NULL DEFAULT NULL');
    this.ensureColumn('attachments', 'source_type', "TEXT NOT NULL DEFAULT 'snip'");
    this.ensureColumn('attachments', 'sync_status', "TEXT NOT NULL DEFAULT 'Local Only'");
    this.ensureColumn('attachments', 'last_sync_at', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('attachments', 'remote_id', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('attachments', 'updated_at', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('attachments', 'content_hash', 'TEXT NULL DEFAULT NULL');
    this.ensureColumn('attachments', 'file_extension', "TEXT NOT NULL DEFAULT '.png'");
    this.ensureColumn('attachments', 'parent_id', 'INTEGER NULL REFERENCES attachments(id) ON DELETE SET NULL');
    this.ensureColumn('sync_queue', 'local_seq', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('sync_queue', 'op_id', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('sync_queue', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('sync_queue', 'last_error', 'TEXT NULL DEFAULT NULL');
    this.ensureClientId();
    this.migrateToAppSettings();
    this.backfillSyncQueueDeterminism();
    this.backfillAttachmentContentAddress();
    this.rebuildAttachmentsTableWithoutAbsolutePaths();
    this.ensureNullableAttachmentContentHash();
    this.ensureColumn('attachments', 'parent_id', 'INTEGER NULL REFERENCES attachments(id) ON DELETE SET NULL');
    this.migrateReferenceOptions();
    this.migrateCaptureStatuses();
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_entry_type ON bugs(entry_type)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_environment_id ON bugs(environment_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_device_id ON bugs(device_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_browser_id ON bugs(browser_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_user_role_id ON bugs(user_role_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_sync_status ON bugs(sync_status)');
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_bugs_remote_id ON bugs(remote_id) WHERE remote_id != ''");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_bug_id ON attachments(bug_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_content_hash ON attachments(content_hash)');
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_remote_id ON attachments(remote_id) WHERE remote_id != ''");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue(created_at)');
    this.db.exec('DROP INDEX IF EXISTS idx_sync_queue_local_seq');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_local_seq ON sync_queue(local_seq) WHERE local_seq > 0');
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_op_id ON sync_queue(op_id) WHERE op_id != ''");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_application_id ON presets(application_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_module_id ON presets(module_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_environment_id ON presets(environment_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_user_role_id ON presets(user_role_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_entry_type_id ON presets(entry_type_id)');
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private ensureReferenceColumns(): void {
    Object.values(referenceTables).forEach((table) => {
      this.ensureColumn(table, 'value', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn(table, 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
      this.ensureColumn(table, 'is_active', 'INTEGER NOT NULL DEFAULT 1');
      this.ensureColumn(table, 'created_at', `TEXT NOT NULL DEFAULT '${now()}'`);
      this.ensureColumn(table, 'updated_at', `TEXT NOT NULL DEFAULT '${now()}'`);
      this.db.prepare(`UPDATE ${table} SET value = name WHERE value = ''`).run();
    });
  }

  private ensureClientId(): void {
    const existing = this.db.prepare("SELECT value FROM config_options WHERE type = 'client_id' LIMIT 1").get() as { value: string } | undefined;
    if (existing?.value) return;
    this.db
      .prepare('INSERT INTO config_options (type, value, sort_order, is_active) VALUES (?, ?, ?, 1)')
      .run('client_id', randomUUID(), 0);
  }

  /**
   * One-time migration: moves all scalar singleton settings out of the
   * legacy config_options rows and into the dedicated app_settings table.
   * Safe to run on every startup — uses INSERT OR IGNORE so it only
   * writes each key once and never overwrites existing values.
   * After copying, deletes the old config_options rows so the table
   * only holds editable lookup lists going forward.
   */
  private migrateToAppSettings(): void {
    const stamp = now();
    const singletonTypes = [
      'jira_workspace_url',
      'auto_backup_directory_path',
      'quick_capture_annotate_screenshots',
      'run_on_system_startup',
      'ai_triage_enabled',
      'ollama_model_name',
      'supabase_project_url',
      'supabase_anon_key',
      'current_workspace_id',
      'byok_ai_provider',
      'byok_ai_base_url',
      'byok_ai_model_id',
      'byok_ai_api_key_encrypted',
      'byok_ai_api_keys_encrypted',
      'byok_ai_custom_system_prompt'
    ];

    const defaults: Record<string, string> = {
      jira_workspace_url: '',
      auto_backup_directory_path: '',
      quick_capture_annotate_screenshots: 'true',
      run_on_system_startup: 'false',
      ai_triage_enabled: 'false',
      ollama_model_name: 'qwen3-vl:8b',
      supabase_project_url: '',
      supabase_anon_key: '',
      current_workspace_id: '',
      byok_ai_provider: 'OpenRouter',
      byok_ai_base_url: 'https://openrouter.ai/api/v1',
      byok_ai_model_id: 'google/gemma-4-31b-it:free',
      byok_ai_api_key_encrypted: '',
      byok_ai_api_keys_encrypted: '{}',
      byok_ai_custom_system_prompt: ''
    };

    const tx = this.db.transaction(() => {
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
      );

      for (const type of singletonTypes) {
        // Read any existing value from the old config_options table
        const existing = this.db
          .prepare("SELECT value FROM config_options WHERE type = ? AND is_active = 1 ORDER BY id LIMIT 1")
          .get(type) as { value: string } | undefined;

        const value = existing?.value ?? defaults[type] ?? '';
        insert.run(type, value, stamp);
      }

      // Remove the now-migrated rows from config_options
      // Use a parameterised IN query built from the known constant list
      const placeholders = singletonTypes.map(() => '?').join(', ');
      this.db
        .prepare(`DELETE FROM config_options WHERE type IN (${placeholders})`)
        .run(...singletonTypes);
    });

    tx();
  }

  private backfillSyncQueueDeterminism(): void {
    const rows = this.db
      .prepare("SELECT id FROM sync_queue WHERE local_seq = 0 OR op_id = '' ORDER BY id")
      .all() as Array<{ id: number }>;
    if (!rows.length) return;
    const tx = this.db.transaction(() => {
      const update = this.db.prepare('UPDATE sync_queue SET local_seq = ?, op_id = ? WHERE id = ?');
      rows.forEach((row) => {
        update.run(this.nextLocalSeq(), randomUUID(), row.id);
      });
    });
    tx();
  }

  private migrateReferenceOptions(): void {
    const stamp = now();
    this.migrateReferenceTable('environment', 'environment', stamp);
    this.migrateReferenceTable('device', 'device', stamp);
    this.migrateReferenceTable('browser', 'browser', stamp);
  }

  private migrateReferenceTable(type: ReferenceTable, legacyBugColumn: string, stamp: string): void {
    const table = referenceTables[type];
    const legacyOptions = this.db
      .prepare('SELECT value, sort_order, is_active FROM config_options WHERE type = ?')
      .all(type) as Array<{ value: string; sort_order: number; is_active: number }>;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO ${table} (name, value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    legacyOptions.forEach((option) => {
      const value = option.value.trim();
      if (value) insert.run(value, value, option.sort_order, option.is_active, stamp, stamp);
    });

    const bugColumns = this.db.prepare('PRAGMA table_info(bugs)').all() as Array<{ name: string }>;
    if (bugColumns.some((column) => column.name === legacyBugColumn)) {
      const values = this.db
        .prepare(`SELECT DISTINCT ${legacyBugColumn} AS value FROM bugs WHERE ${legacyBugColumn} IS NOT NULL AND TRIM(${legacyBugColumn}) != ''`)
        .all() as Array<{ value: string }>;
      values.forEach((row) => {
        const value = row.value.trim();
        if (value) insert.run(value, value, 999, 1, stamp, stamp);
      });
      this.db
        .prepare(
          `UPDATE bugs
           SET ${type}_id = (SELECT id FROM ${table} WHERE ${table}.name = bugs.${legacyBugColumn})
           WHERE ${type}_id IS NULL AND TRIM(${legacyBugColumn}) != ''`
        )
        .run();
    }
  }

  private backfillAttachmentContentAddress(): void {
    const attachmentColumns = this.db.prepare('PRAGMA table_info(attachments)').all() as Array<{ name: string }>;
    if (!attachmentColumns.some((column) => column.name === 'file_path')) return;
    const legacyAttachments = this.db
      .prepare("SELECT id, file_path, file_name FROM attachments WHERE content_hash = '' AND file_path IS NOT NULL AND file_path != ''")
      .all() as Array<{ id: number; file_path: string; file_name: string }>;
    const update = this.db.prepare('UPDATE attachments SET content_hash = ?, file_extension = ? WHERE id = ?');
    legacyAttachments.forEach((attachment) => {
      if (!existsSync(attachment.file_path)) return;
      const bytes = readFileSync(attachment.file_path);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const extension = extname(attachment.file_name || attachment.file_path) || '.png';
      const targetPath = this.resolveAttachmentPath(contentHash, extension);
      if (!existsSync(targetPath)) copyFileSync(attachment.file_path, targetPath);
      update.run(contentHash, extension, attachment.id);
    });
  }

  private rebuildAttachmentsTableWithoutAbsolutePaths(): void {
    const attachmentColumns = this.db.prepare('PRAGMA table_info(attachments)').all() as Array<{ name: string }>;
    if (!attachmentColumns.some((column) => column.name === 'file_path' || column.name === 'file_name')) return;
    this.db.exec(`
      DROP TABLE IF EXISTS attachments_content_addressed;

      CREATE TABLE attachments_content_addressed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bug_id INTEGER NULL REFERENCES bugs(id) ON DELETE CASCADE,
        parent_id INTEGER NULL REFERENCES attachments(id) ON DELETE SET NULL,
        content_hash TEXT NULL DEFAULT NULL,
        file_extension TEXT NOT NULL DEFAULT '.png',
        mime_type TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'snip',
        sync_status TEXT NOT NULL DEFAULT 'Local Only',
        last_sync_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      INSERT INTO attachments_content_addressed (
        id, bug_id, parent_id, content_hash, file_extension, mime_type, source_type, sync_status, last_sync_at, created_at
      )
      SELECT id, bug_id, parent_id, content_hash, file_extension, mime_type, source_type, sync_status, last_sync_at, created_at
      FROM attachments
      WHERE content_hash != '';

      DROP TABLE attachments;
      ALTER TABLE attachments_content_addressed RENAME TO attachments;
    `);
  }

  private ensureNullableAttachmentContentHash(): void {
    const attachmentColumns = this.db.prepare('PRAGMA table_info(attachments)').all() as Array<{ name: string; notnull: number }>;
    const contentHashColumn = attachmentColumns.find((column) => column.name === 'content_hash');
    if (!contentHashColumn?.notnull) return;
    this.db.exec(`
      DROP TABLE IF EXISTS attachments_nullable_hash;

      CREATE TABLE attachments_nullable_hash (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bug_id INTEGER NULL REFERENCES bugs(id) ON DELETE CASCADE,
        parent_id INTEGER NULL REFERENCES attachments(id) ON DELETE SET NULL,
        content_hash TEXT NULL DEFAULT NULL,
        file_extension TEXT NOT NULL DEFAULT '.png',
        mime_type TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'snip',
        sync_status TEXT NOT NULL DEFAULT 'Local Only',
        last_sync_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      INSERT INTO attachments_nullable_hash (
        id, bug_id, parent_id, content_hash, file_extension, mime_type, source_type, sync_status, last_sync_at, created_at
      )
      SELECT id, bug_id, parent_id, NULLIF(content_hash, ''), file_extension, mime_type, source_type, sync_status, last_sync_at, created_at
      FROM attachments;

      DROP TABLE attachments;
      ALTER TABLE attachments_nullable_hash RENAME TO attachments;
    `);
  }

  private migrateCaptureStatuses(): void {
    const stamp = now();
    this.db
      .prepare(
        `UPDATE bugs
         SET status = CASE
           WHEN LOWER(TRIM(status)) IN ('reported', 'fixed', 'verified', 'done', 'converted to bug') THEN 'Reported'
           WHEN LOWER(TRIM(status)) IN ('discarded', 'duplicate', 'ignored', 'tested, no issue', 'rejected / not a bug') THEN 'Discarded'
           ELSE 'Draft'
         END,
         reported = CASE
           WHEN LOWER(TRIM(status)) IN ('reported', 'fixed', 'verified', 'done', 'converted to bug') THEN 1
           ELSE 0
         END,
         updated_at = ?
         WHERE status NOT IN ('Draft', 'Reported', 'Discarded')`
      )
      .run(stamp);

    const table = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bugs'").get() as { sql: string } | undefined;
    if (table?.sql.includes("CHECK (status IN ('Draft', 'Reported', 'Discarded'))")) return;

    this.db.exec(`
      DROP TABLE IF EXISTS bugs_status_limited;

      CREATE TABLE bugs_status_limited (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id TEXT NULL REFERENCES applications(id) ON DELETE SET NULL,
        module_id TEXT NULL REFERENCES modules(id) ON DELETE SET NULL,
        environment_id TEXT NULL REFERENCES environments(id) ON DELETE SET NULL,
        device_id INTEGER NULL REFERENCES devices(id) ON DELETE SET NULL,
        browser_id INTEGER NULL REFERENCES browsers(id) ON DELETE SET NULL,
        user_role_id INTEGER NULL REFERENCES user_roles(id) ON DELETE SET NULL,
        entry_type TEXT NOT NULL DEFAULT 'Bug',
        title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        other_details TEXT NOT NULL DEFAULT '',
        steps_to_reproduce TEXT NOT NULL DEFAULT '',
        expected_result TEXT NOT NULL DEFAULT '',
        actual_result TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Reported', 'Discarded')),
        severity TEXT NOT NULL DEFAULT 'Medium',
        reported INTEGER NOT NULL DEFAULT 0,
        issue_platform TEXT NOT NULL DEFAULT '',
        issue_id TEXT NOT NULL DEFAULT '',
        issue_url TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'Local Only',
        last_sync_at TEXT NOT NULL DEFAULT '',
        remote_id TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NULL DEFAULT NULL,
        created_by TEXT NULL DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO bugs_status_limited (
        id, application_id, module_id, environment_id, device_id, browser_id, user_role_id, entry_type, title, note, other_details,
        steps_to_reproduce, expected_result, actual_result, status, severity, reported, issue_platform, issue_id,
        issue_url, tags, sync_status, last_sync_at, remote_id, workspace_id, created_by, created_at, updated_at
      )
      SELECT
        id, application_id, module_id, environment_id, device_id, browser_id, user_role_id, entry_type, title, note, other_details,
        steps_to_reproduce, expected_result, actual_result,
        CASE
          WHEN LOWER(TRIM(status)) IN ('reported', 'fixed', 'verified', 'done', 'converted to bug') THEN 'Reported'
          WHEN LOWER(TRIM(status)) IN ('discarded', 'duplicate', 'ignored', 'tested, no issue', 'rejected / not a bug') THEN 'Discarded'
          ELSE 'Draft'
        END,
        severity,
        CASE
          WHEN LOWER(TRIM(status)) IN ('reported', 'fixed', 'verified', 'done', 'converted to bug') THEN 1
          ELSE 0
        END,
        issue_platform, issue_id, issue_url, tags, sync_status, last_sync_at, remote_id, workspace_id, created_by, created_at, updated_at
      FROM bugs;

      DROP TABLE bugs;
      ALTER TABLE bugs_status_limited RENAME TO bugs;
    `);
  }

  private deleteAttachmentBlobIfUnused(contentHash: string | null, fileExtension: string): void {
    if (!contentHash) return;
    const remaining = this.workspaceDataDb().prepare('SELECT COUNT(*) AS count FROM attachments WHERE content_hash = ?').get(contentHash) as { count: number };
    if (remaining.count > 0) return;
    const filePath = this.resolveAttachmentPath(contentHash, fileExtension);
    if (existsSync(filePath)) unlinkSync(filePath);
  }

  private nextLocalSeq(): number {
    const row = this.workspaceDataDb().prepare('SELECT COALESCE(MAX(local_seq), 0) + 1 AS next_seq FROM sync_queue').get() as { next_seq: number };
    return row.next_seq;
  }

  private enqueueSyncEvent(entityType: SyncQueueEntityType, entityId: number | string, operation: SyncQueueOperation, payload: unknown): void {
    this.workspaceDataDb()
      .prepare('INSERT INTO sync_queue (local_seq, op_id, entity_type, entity_id, operation, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(this.nextLocalSeq(), randomUUID(), entityType, entityId, operation, JSON.stringify(payload ?? {}), now());
  }

  private enqueueBugSyncEvent(bugId: number, operation: SyncQueueOperation, payload = this.bugPayload(bugId)): void {
    if (!this.shouldSyncBugPayload(payload)) return;
    this.enqueueSyncEvent('bug', bugId, operation, payload);
  }

  private enqueueAttachmentSyncEvent(attachmentId: number, operation: SyncQueueOperation, payload = this.attachmentPayload(attachmentId)): void {
    if (!this.shouldSyncAttachmentPayload(payload)) return;
    this.enqueueSyncEvent('attachment', attachmentId, operation, payload);
  }

  private enqueueApplicationSyncEvent(applicationId: number | string, operation: SyncQueueOperation, payload = this.applicationPayload(applicationId)): void {
    if (!this.isCloudSyncReady()) return;
    if (payload && Number(payload.is_synced ?? 1) === 0) return;
    this.enqueueSyncEvent('application', applicationId, operation, payload);
  }

  private enqueueModuleSyncEvent(moduleId: number | string, operation: SyncQueueOperation, payload = this.modulePayload(moduleId)): void {
    if (!this.isCloudSyncReady()) return;
    const applicationId = payload?.application_id ?? null;
    if (!this.shouldSyncApplication(this.sanitizeOptionalForeignKey(applicationId))) return;
    this.enqueueSyncEvent('module', moduleId, operation, payload);
  }

  private enqueueEnvironmentSyncEvent(environmentId: number | string, operation: SyncQueueOperation, payload = this.environmentPayload(environmentId)): void {
    if (!this.isCloudSyncReady()) return;
    this.enqueueSyncEvent('environment', environmentId, operation, payload);
  }

  setCloudSyncSessionActive(active: boolean): void {
    this.cloudSyncSessionActive = active;
  }

  isCloudSyncActive(): boolean {
    return Boolean(this.cloudSyncSessionActive && this.getSupabaseProjectUrl() && this.getSupabaseAnonKey() && this.getCurrentWorkspaceId());
  }

  private isCloudSyncReady(): boolean {
    return this.isCloudSyncActive();
  }

  private pendingSyncStatusForBug(applicationId: number | string | null): SyncStatus {
    return this.isCloudSyncReady() && this.shouldSyncApplication(applicationId) ? 'Sync Pending' : 'Local Only';
  }

  private pendingSyncStatusForBugId(bugId: number): SyncStatus {
    return this.isCloudSyncReady() && this.shouldSyncBug(bugId) ? 'Sync Pending' : 'Local Only';
  }

  private shouldSyncBugPayload(payload: unknown): boolean {
    if (!this.isCloudSyncReady()) return false;
    const applicationId = typeof payload === 'object' && payload !== null ? (payload as { application_id?: unknown }).application_id : null;
    return this.shouldSyncApplication(this.sanitizeOptionalForeignKey(applicationId));
  }

  private shouldSyncAttachmentPayload(payload: unknown): boolean {
    if (!this.isCloudSyncReady()) return false;
    const bugId = typeof payload === 'object' && payload !== null ? (payload as { bug_id?: unknown }).bug_id : null;
    if (typeof bugId !== 'number') return false;
    return this.shouldSyncBug(bugId);
  }

  private shouldSyncBug(bugId: number): boolean {
    const row = this.workspaceDataDb().prepare('SELECT application_id FROM bugs WHERE id = ?').get(bugId) as { application_id: number | string | null } | undefined;
    if (!row) return false;
    return this.shouldSyncApplication(row.application_id);
  }

  private shouldSyncApplication(applicationId: number | string | null): boolean {
    if (applicationId == null) return true;
    const row = this.taxonomyDb().prepare('SELECT is_synced FROM applications WHERE id = ?').get(applicationId) as { is_synced: number } | undefined;
    return row ? row.is_synced !== 0 : false;
  }

  private sanitizeOptionalForeignKey(value: unknown): number | string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
      const cleaned = value.trim();
      return cleaned ? cleaned : null;
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private bugPayload(id: number): Record<string, unknown> | null {
    return (
      (this.workspaceDataDb()
        .prepare(
          `
          SELECT bugs.*, COALESCE(applications.name, 'General') AS application_name, COALESCE(modules.name, 'Uncategorized') AS module_name,
            environments.name AS environment, devices.name AS device, browsers.name AS browser, user_roles.name AS user_role
          FROM bugs
          LEFT JOIN applications ON applications.id = bugs.application_id
          LEFT JOIN modules ON modules.id = bugs.module_id
          LEFT JOIN environments ON environments.id = bugs.environment_id
          LEFT JOIN devices ON devices.id = bugs.device_id
          LEFT JOIN browsers ON browsers.id = bugs.browser_id
        LEFT JOIN user_roles ON user_roles.id = bugs.user_role_id
          WHERE bugs.id = ?
        `
        )
        .get(id) as Record<string, unknown> | undefined) ?? null
    );
  }

  private attachmentPayload(id: number): Record<string, unknown> | null {
    return (
      (this.workspaceDataDb()
        .prepare(`SELECT attachments.*, ${attachmentFileNameSql} FROM attachments WHERE id = ?`)
        .get(id) as Record<string, unknown> | undefined) ?? null
    );
  }

  private applicationPayload(id: number | string): Record<string, unknown> | null {
    return (this.taxonomyDb().prepare('SELECT * FROM applications WHERE id = ?').get(id) as Record<string, unknown> | undefined) ?? null;
  }

  private modulePayload(id: number | string): Record<string, unknown> | null {
    return (this.taxonomyDb().prepare('SELECT * FROM modules WHERE id = ?').get(id) as Record<string, unknown> | undefined) ?? null;
  }

  private environmentPayload(id: number | string): Record<string, unknown> | null {
    return (
      (this.taxonomyDb()
        .prepare('SELECT id, name, COALESCE(NULLIF(value, \'\'), name) AS value, sort_order, is_active, created_at, updated_at FROM environments WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined) ?? null
    );
  }

  private seedDefaults(): void {
    const stamp = now();
    const appInsert = this.db.prepare('INSERT OR IGNORE INTO applications (name, is_active, is_synced, created_at, updated_at) VALUES (?, 1, 1, ?, ?)');
    appInsert.run('General', stamp, stamp);
    this.db.prepare('UPDATE applications SET is_active = 1, updated_at = ? WHERE name = ?').run(stamp, 'General');
    this.ensureDefaultGeneralModule(stamp);

    this.db.prepare("UPDATE config_options SET is_active = 0 WHERE type IN ('status', 'scenario_status')").run();
    const optionInsert = this.db.prepare('INSERT OR IGNORE INTO config_options (type, value, sort_order, is_active) VALUES (?, ?, ?, 1)');
    defaultStatuses.forEach((value, index) => optionInsert.run('status', value, index));
    defaultScenarioStatuses.forEach((value, index) => optionInsert.run('scenario_status', value, index));
    defaultStatuses.forEach((value, index) => {
      this.db.prepare('UPDATE config_options SET sort_order = ?, is_active = 1 WHERE type = ? AND value = ?').run(index, 'status', value);
    });
    defaultSeverities.forEach((value, index) => optionInsert.run('severity', value, index));
    defaultIssuePlatforms.forEach((value, index) => optionInsert.run('issue_platform', value, index));
    defaultEntryTypes.forEach((value, index) => optionInsert.run('entry_type', value, index));
    defaultEnvironments.forEach((value, index) => this.addReferenceOption('environment', value, index, stamp));
    defaultDevices.forEach((value, index) => this.addReferenceOption('device', value, index, stamp));
    defaultBrowsers.forEach((value, index) => this.addReferenceOption('browser', value, index, stamp));
    defaultUserRoles.forEach((value, index) => this.addReferenceOption('user_role', value, index, stamp));

    this.normalizeShortcutActions(stamp);

    const shortcutInsert = this.db.prepare(
      'INSERT OR IGNORE INTO shortcut_settings (action, label, accelerator, is_enabled, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    defaultShortcuts.forEach((shortcut) => {
      shortcutInsert.run(shortcut.action, shortcut.label, shortcut.accelerator, shortcut.is_enabled, shortcut.sort_order, stamp);
    });
    this.removeLegacyShortcut();

    const templateInsert = this.db.prepare(
      'INSERT OR IGNORE INTO report_templates (name, template_text, created_at, updated_at) VALUES (?, ?, ?, ?)'
    );
    templateInsert.run('Full Bug Report', fullReportTemplate, stamp, stamp);
    templateInsert.run('Quick Report', quickReportTemplate, stamp, stamp);
    templateInsert.run('Linear Format', '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nUser Role: {{user_role}}\nDevice: {{device}}\nBrowser: {{browser}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}', stamp, stamp);
    templateInsert.run('Jira Format', '{{title}}\n\nSummary:\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nUser Role: {{user_role}}\nDevice: {{device}}\nBrowser: {{browser}}\n\nSteps to Reproduce:\n{{steps}}\n\nExpected Result:\n{{expected}}\n\nActual Result:\n{{actual}}\n\nSeverity: {{severity}}\nAttachments:\n{{attachments}}', stamp, stamp);
    this.upgradeDefaultTemplatesForEnvironment(stamp);
    this.upgradeDefaultTemplatesForUserRole(stamp);
  }

  private ensureDefaultGeneralModule(stamp: string): void {
    const generalApplication = this.db.prepare('SELECT id FROM applications WHERE name = ? LIMIT 1').get('General') as { id: number } | undefined;
    if (!generalApplication) return;

    const assignedGeneralModule = this.db
      .prepare('SELECT id FROM modules WHERE application_id = ? AND name = ? LIMIT 1')
      .get(generalApplication.id, 'General') as { id: number } | undefined;
    const unassignedGeneralModule = this.db
      .prepare('SELECT id FROM modules WHERE application_id IS NULL AND name = ? LIMIT 1')
      .get('General') as { id: number } | undefined;

    if (unassignedGeneralModule && assignedGeneralModule && unassignedGeneralModule.id !== assignedGeneralModule.id) {
      this.db.prepare('UPDATE bugs SET module_id = ? WHERE module_id = ?').run(assignedGeneralModule.id, unassignedGeneralModule.id);
      this.db.prepare('UPDATE presets SET module_id = ? WHERE module_id = ?').run(assignedGeneralModule.id, unassignedGeneralModule.id);
      this.db.prepare('DELETE FROM modules WHERE id = ?').run(unassignedGeneralModule.id);
      return;
    }

    if (unassignedGeneralModule) {
      this.db
        .prepare('UPDATE modules SET application_id = ?, is_active = 1, updated_at = ? WHERE id = ?')
        .run(generalApplication.id, stamp, unassignedGeneralModule.id);
      return;
    }

    if (assignedGeneralModule) {
      this.db.prepare('UPDATE modules SET is_active = 1, updated_at = ? WHERE id = ?').run(stamp, assignedGeneralModule.id);
      return;
    }

    this.db
      .prepare('INSERT INTO modules (application_id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
      .run(generalApplication.id, 'General', stamp, stamp);
  }

  private normalizeShortcutActions(stamp: string): void {
    this.db
      .prepare(
        "UPDATE shortcut_settings SET action = 'global_screenshot', label = 'Global Screenshot', sort_order = 2, updated_at = ? WHERE action = 'screenshot_capture' AND NOT EXISTS (SELECT 1 FROM shortcut_settings WHERE action = 'global_screenshot')"
      )
      .run(stamp);
    this.db.prepare("UPDATE shortcut_settings SET label = 'Global Screenshot' WHERE action = 'global_screenshot'").run();
  }

  private removeLegacyShortcut(): void {
    this.db.prepare('DELETE FROM shortcut_settings WHERE action IN (?, ?)').run('quick_capture_legacy', 'screenshot_capture');
  }

  private upgradeDefaultTemplatesForUserRole(stamp: string): void {
    const replacements: Array<[string, string, string]> = [
      [
        'Quick Report',
        `🚨 *[{{severity}}] {{title}}*
*Context:* {{application}} > {{module}} | {{environment}}

*Note:* {{note}}`,
        quickReportTemplate
      ],
      [
        'Linear Format',
        `{{title}}

{{note}}

Application: {{application}}
Module: {{module}}
Environment: {{environment}}
Device: {{device}}
Browser: {{browser}}
Severity: {{severity}}
Attachments:
{{attachments}}`,
        `{{title}}

{{note}}

Application: {{application}}
Module: {{module}}
Environment: {{environment}}
User Role: {{user_role}}
Device: {{device}}
Browser: {{browser}}
Severity: {{severity}}
Attachments:
{{attachments}}`
      ],
      [
        'Jira Format',
        `{{title}}

Summary:
{{note}}

Application: {{application}}
Module: {{module}}
Environment: {{environment}}
Device: {{device}}
Browser: {{browser}}

Steps to Reproduce:
{{steps}}

Expected Result:
{{expected}}

Actual Result:
{{actual}}

Severity: {{severity}}
Attachments:
{{attachments}}`,
        `{{title}}

Summary:
{{note}}

Application: {{application}}
Module: {{module}}
Environment: {{environment}}
User Role: {{user_role}}
Device: {{device}}
Browser: {{browser}}

Steps to Reproduce:
{{steps}}

Expected Result:
{{expected}}

Actual Result:
{{actual}}

Severity: {{severity}}
Attachments:
{{attachments}}`
      ]
    ];
    const update = this.db.prepare('UPDATE report_templates SET template_text = ?, updated_at = ? WHERE name = ? AND template_text = ?');
    replacements.forEach(([name, before, after]) => update.run(after, stamp, name, before));
  }

  private upgradeDefaultTemplatesForEnvironment(stamp: string): void {
    this.db.prepare('DELETE FROM report_templates WHERE name = ?').run('Slack Summary');

    const templateUpdate = this.db.prepare('UPDATE report_templates SET template_text = ?, updated_at = ? WHERE name = ? AND template_text = ?');
    templateUpdate.run(fullReportTemplate, stamp, 'Full Bug Report', legacyFullReportTemplate);
    templateUpdate.run(fullReportTemplate, stamp, 'Full Bug Report', environmentOnlyFullReportTemplate);
    templateUpdate.run(
      quickReportTemplate,
      stamp,
      'Quick Report',
      '{{title}}\n\n{{note}}\n\n{{application}} / {{module}}\nSeverity: {{severity}}'
    );
    templateUpdate.run(
      quickReportTemplate,
      stamp,
      'Quick Report',
      '{{title}}\n\n{{note}}\n\n{{application}} / {{module}}\nEnvironment: {{environment}}\nSeverity: {{severity}}'
    );
    templateUpdate.run(
      quickReportTemplate,
      stamp,
      'Quick Report',
      '{{title}}\n\n{{note}}\n\n{{application}} / {{module}}\nEnvironment: {{environment}}\nUser Role: {{user_role}}\nDevice: {{device}}\nBrowser: {{browser}}\nSeverity: {{severity}}'
    );
    templateUpdate.run(
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}',
      stamp,
      'Linear Format',
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}'
    );
    templateUpdate.run(
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nUser Role: {{user_role}}\nDevice: {{device}}\nBrowser: {{browser}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}',
      stamp,
      'Linear Format',
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}'
    );
  }

  getSettings(): SettingsData {
    const taxonomyDb = this.taxonomyDb();
    return {
      applications: taxonomyDb.prepare('SELECT * FROM applications WHERE is_active = 1 ORDER BY name').all() as Application[],
      modules: taxonomyDb
        .prepare(
          `
          SELECT modules.*
          FROM modules
          LEFT JOIN applications ON applications.id = modules.application_id
          WHERE modules.is_active = 1
          ORDER BY COALESCE(applications.name, 'Unassigned'), modules.name
        `
        )
        .all() as Module[],
      statuses: this.getOptions('status'),
      scenarioStatuses: this.getOptions('scenario_status'),
      severities: this.getOptions('severity'),
      issuePlatforms: this.getOptions('issue_platform'),
      entryTypes: this.getOptions('entry_type'),
      environments: this.getReferenceOptions('environment'),
      devices: this.getReferenceOptions('device'),
      browsers: this.getReferenceOptions('browser'),
      userRoles: this.getReferenceOptions('user_role'),
      reportTemplates: this.db.prepare('SELECT * FROM report_templates ORDER BY name').all() as ReportTemplate[],
      shortcuts: this.getShortcutSettings(),
      jiraWorkspaceUrl: this.getJiraWorkspaceUrl(),
      autoBackupDirectoryPath: this.getAutoBackupDirectoryPath(),
      quickCaptureAnnotateScreenshots: this.getQuickCaptureAnnotationReview(),
      runOnSystemStartup: this.getRunOnSystemStartup(),
      aiTriageEnabled: this.getAiTriageEnabled(),
      ollamaModelName: this.getOllamaModelName(),
      supabaseProjectUrl: this.getSupabaseProjectUrl(),
      supabaseAnonKey: this.getSupabaseAnonKey(),
      currentWorkspaceId: this.getCurrentWorkspaceId(),
      currentWorkspaceRole: this.getWorkspaceRole(this.getCurrentWorkspaceId()),
      cloudSyncActive: this.isCloudSyncActive(),
      presets: this.getPresets()
    };
  }

  getShortcutSettings(): ShortcutSetting[] {
    return this.db.prepare('SELECT * FROM shortcut_settings ORDER BY sort_order, label').all() as ShortcutSetting[];
  }

  getTotalBugCount(): number {
    const row = this.workspaceDataDb().prepare("SELECT COUNT(*) AS count FROM bugs WHERE status != 'Discarded'").get() as { count: number };
    return row.count;
  }

  updateShortcut(action: ShortcutAction, accelerator: string, enabled: boolean): ShortcutSetting {
    const cleaned = accelerator.trim();
    this.db
      .prepare('UPDATE shortcut_settings SET accelerator = ?, is_enabled = ?, updated_at = ? WHERE action = ?')
      .run(cleaned, enabled ? 1 : 0, now(), action);
    return this.db.prepare('SELECT * FROM shortcut_settings WHERE action = ?').get(action) as ShortcutSetting;
  }

  // ---------------------------------------------------------------------------
  // Generic app_settings accessors
  // ---------------------------------------------------------------------------

  private getSetting(key: string): string {
    return (
      this.localDb
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get(key) as { value: string } | undefined
    )?.value ?? '';
  }

  private setSetting(key: string, value: string): void {
    this.localDb
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now());
  }

  getEncryptedSupabaseAuthItem(storageKey: string): Buffer | null {
    const value = this.getSetting(this.supabaseAuthStorageKey(storageKey));
    return value ? Buffer.from(value, 'base64') : null;
  }

  setEncryptedSupabaseAuthItem(storageKey: string, encrypted: Buffer): void {
    this.setSetting(this.supabaseAuthStorageKey(storageKey), encrypted.toString('base64'));
  }

  removeEncryptedSupabaseAuthItem(storageKey: string): void {
    this.localDb
      .prepare('DELETE FROM app_settings WHERE key = ?')
      .run(this.supabaseAuthStorageKey(storageKey));
  }

  private supabaseAuthStorageKey(storageKey: string): string {
    const cleaned = storageKey.trim();
    if (!cleaned || cleaned.length > 512) throw new Error('Invalid Supabase auth storage key.');
    return `supabase_auth_${createHash('sha256').update(cleaned).digest('hex')}`;
  }

  getJiraWorkspaceUrl(): string | null {
    const value = this.getSetting('jira_workspace_url').trim();
    return value || null;
  }

  updateJiraWorkspaceUrl(value: string): string | null {
    const cleaned = value.trim();
    this.setSetting('jira_workspace_url', cleaned);
    return cleaned || null;
  }

  getAutoBackupDirectoryPath(): string | null {
    const value = this.getSetting('auto_backup_directory_path').trim();
    return value || null;
  }

  updateAutoBackupDirectoryPath(value: string): string | null {
    const cleaned = value.trim();
    this.setSetting('auto_backup_directory_path', cleaned);
    return cleaned || null;
  }

  getQuickCaptureAnnotationReview(): boolean {
    return this.getSetting('quick_capture_annotate_screenshots') !== 'false';
  }

  updateQuickCaptureAnnotationReview(enabled: boolean): boolean {
    this.setSetting('quick_capture_annotate_screenshots', enabled ? 'true' : 'false');
    return enabled;
  }

  getRunOnSystemStartup(): boolean {
    return this.getSetting('run_on_system_startup') === 'true';
  }

  updateRunOnSystemStartup(enabled: boolean): boolean {
    this.setSetting('run_on_system_startup', enabled ? 'true' : 'false');
    return enabled;
  }

  getAiTriageEnabled(): boolean {
    const value = this.getSetting('ai_triage_enabled');
    return value === 'true' || value === '1';
  }

  getOllamaModelName(): string {
    const value = this.getSetting('ollama_model_name').trim();
    return value || 'qwen3-vl:8b';
  }

  updateAiTriageOptions(enabled: boolean, modelName: string): { enabled: boolean; modelName: string } {
    const cleanedModel = modelName.trim() || 'qwen3-vl:8b';
    this.setSetting('ai_triage_enabled', enabled ? 'true' : 'false');
    this.setSetting('ollama_model_name', cleanedModel);
    return { enabled, modelName: cleanedModel };
  }

  getSupabaseProjectUrl(): string | null {
    const value = this.getSetting('supabase_project_url').trim();
    return value || null;
  }

  getSupabaseAnonKey(): string | null {
    const value = this.getSetting('supabase_anon_key').trim();
    return value || null;
  }

  updateSupabaseSettings(projectUrl: string, anonKey: string): { projectUrl: string | null; anonKey: string | null } {
    const cleanedUrl = projectUrl.trim();
    const cleanedKey = anonKey.trim();
    this.setSetting('supabase_project_url', cleanedUrl);
    this.setSetting('supabase_anon_key', cleanedKey);
    return { projectUrl: cleanedUrl || null, anonKey: cleanedKey || null };
  }

  getCurrentWorkspaceId(): string | null {
    const value = this.getSetting('current_workspace_id').trim();
    return value || null;
  }

  updateCurrentWorkspaceId(workspaceId: string | null): string | null {
    const cleaned = (workspaceId ?? '').trim();
    this.setSetting('current_workspace_id', cleaned);
    return cleaned || null;
  }

  getWorkspaceRole(workspaceId: string | null): WorkspaceRole {
    const cleaned = (workspaceId ?? '').trim();
    if (!cleaned) return 'admin';
    const value = this.getSetting(this.workspaceRoleKey(cleaned)).trim();
    return value === 'owner' || value === 'admin' || value === 'member' ? value : 'admin';
  }

  updateWorkspaceRole(workspaceId: string, role: string | null | undefined): WorkspaceRole {
    const cleanedWorkspaceId = workspaceId.trim();
    const normalizedRole: WorkspaceRole =
      role === 'owner' || role === 'admin' || role === 'member' || role === 'developer'
        ? role
        : 'member';
    if (cleanedWorkspaceId) this.setSetting(this.workspaceRoleKey(cleanedWorkspaceId), normalizedRole);
    return normalizedRole;
  }

  getRemoteSyncCursor(workspaceId: string, entityType: 'bug' | 'attachment'): RemoteSyncCursor {
    const stored = this.getSetting(this.remoteSyncCursorKey(workspaceId, entityType)).trim();
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<RemoteSyncCursor>;
        if (typeof parsed.updated_at === 'string' && !Number.isNaN(Date.parse(parsed.updated_at)) && typeof parsed.id === 'string') {
          return { updated_at: parsed.updated_at, id: parsed.id };
        }
      } catch {
        // Fall through to the legacy shared watermark migration.
      }
    }

    const legacyTimestamp = this.getSetting(this.legacyRemoteSyncWatermarkKey(workspaceId)).trim();
    // A shared legacy watermark cannot be safely split because either table may
    // already have rows stranded behind it. Reset both new cursors for one
    // idempotent full replay instead of carrying forward potential data loss.
    if (legacyTimestamp) {
      return { updated_at: '1970-01-01T00:00:00.000Z', id: '' };
    }
    return {
      updated_at: '1970-01-01T00:00:00.000Z',
      id: ''
    };
  }

  updateRemoteSyncCursor(
    workspaceId: string,
    entityType: 'bug' | 'attachment',
    cursor: RemoteSyncCursor
  ): RemoteSyncCursor {
    if (Number.isNaN(Date.parse(cursor.updated_at))) throw new Error('Remote sync cursor timestamp is invalid.');
    const normalized = { updated_at: cursor.updated_at.trim(), id: cursor.id.trim() };
    if (!normalized.id) throw new Error('Remote sync cursor ID is required after a completed batch.');
    this.setSetting(this.remoteSyncCursorKey(workspaceId, entityType), JSON.stringify(normalized));
    return normalized;
  }

  applyRemoteBugBatch(rows: Array<Record<string, unknown>>): boolean {
    const transaction = this.requireWorkspaceDb().transaction(() => {
      let changed = false;
      for (const row of rows) {
        if (this.upsertRemoteBug(row)) changed = true;
      }
      return changed;
    });
    return transaction();
  }

  applyRemoteAttachmentBatch(rows: Array<Record<string, unknown>>): boolean {
    const transaction = this.requireWorkspaceDb().transaction(() => {
      let changed = false;
      for (const row of rows) {
        if (this.upsertRemoteAttachment(row)) changed = true;
      }
      return changed;
    });
    return transaction();
  }

  markRemoteId(entityType: 'bug' | 'attachment', localId: number, remoteId: string): void {
    const table = entityType === 'bug' ? 'bugs' : 'attachments';
    this.requireWorkspaceDb().prepare(`UPDATE ${table} SET remote_id = ? WHERE id = ?`).run(remoteId, localId);
  }

  upsertRemoteBug(remoteBug: Record<string, unknown>): boolean {
    const db = this.requireWorkspaceDb();
    const remoteId = this.remoteString(remoteBug.id);
    if (!remoteId) return false;

    const remoteUpdatedAt = this.remoteString(remoteBug.updated_at) || now();
    const existing = db.prepare('SELECT id, updated_at FROM bugs WHERE remote_id = ?').get(remoteId) as { id: number; updated_at: string } | undefined;

    if (this.remoteString(remoteBug.deleted_at)) {
      if (!existing) return false;
      db.prepare('DELETE FROM attachments WHERE bug_id = ?').run(existing.id);
      db.prepare('DELETE FROM bugs WHERE id = ?').run(existing.id);
      return true;
    }

    if (existing && this.isLocalNewer(existing.updated_at, remoteUpdatedAt)) return false;

    const values = {
      remote_id: remoteId,
      application_id: this.remoteString(remoteBug.application_id) || null,
      module_id: this.remoteString(remoteBug.module_id) || null,
      environment_id: this.remoteString(remoteBug.environment_id) || null,
      device_id: null,
      browser_id: null,
      user_role_id: null,
      entry_type: this.remoteString(remoteBug.entry_type) || 'Bug',
      title: this.remoteString(remoteBug.title) || '',
      note: this.remoteString(remoteBug.note) || '',
      other_details: this.remoteString(remoteBug.other_details) || '',
      steps_to_reproduce: this.remoteString(remoteBug.steps_to_reproduce) || '',
      expected_result: this.remoteString(remoteBug.expected_result) || '',
      actual_result: this.remoteString(remoteBug.actual_result) || '',
      status: normalizeCaptureStatus(this.remoteString(remoteBug.status)),
      severity: this.remoteString(remoteBug.severity) || 'Medium',
      reported: this.remoteBoolean(remoteBug.reported) ? 1 : 0,
      issue_platform: this.remoteString(remoteBug.issue_platform) || '',
      issue_id: this.remoteString(remoteBug.issue_id) || '',
      issue_url: this.remoteString(remoteBug.issue_url) || '',
      tags: this.remoteString(remoteBug.tags) || '',
      sync_status: 'Synced' as SyncStatus,
      last_sync_at: now(),
      created_at: this.remoteString(remoteBug.created_at) || remoteUpdatedAt,
      updated_at: remoteUpdatedAt
    };

    if (existing) {
      db.prepare(`
        UPDATE bugs SET
          application_id = @application_id,
          module_id = @module_id,
          environment_id = @environment_id,
          device_id = @device_id,
          browser_id = @browser_id,
          user_role_id = @user_role_id,
          entry_type = @entry_type,
          title = @title,
          note = @note,
          other_details = @other_details,
          steps_to_reproduce = @steps_to_reproduce,
          expected_result = @expected_result,
          actual_result = @actual_result,
          status = @status,
          severity = @severity,
          reported = @reported,
          issue_platform = @issue_platform,
          issue_id = @issue_id,
          issue_url = @issue_url,
          tags = @tags,
          sync_status = @sync_status,
          last_sync_at = @last_sync_at,
          updated_at = @updated_at
        WHERE id = @id
      `).run({ ...values, id: existing.id });
      return true;
    }

    db.prepare(`
      INSERT INTO bugs (
        remote_id, application_id, module_id, environment_id, device_id, browser_id, user_role_id,
        entry_type, title, note, other_details, steps_to_reproduce, expected_result, actual_result,
        status, severity, reported, issue_platform, issue_id, issue_url, tags, sync_status, last_sync_at, created_at, updated_at
      ) VALUES (
        @remote_id, @application_id, @module_id, @environment_id, @device_id, @browser_id, @user_role_id,
        @entry_type, @title, @note, @other_details, @steps_to_reproduce, @expected_result, @actual_result,
        @status, @severity, @reported, @issue_platform, @issue_id, @issue_url, @tags, @sync_status, @last_sync_at, @created_at, @updated_at
      )
    `).run(values);
    return true;
  }

  upsertRemoteApplication(remoteApplication: Record<string, unknown>): boolean {
    const db = this.requireWorkspaceDb();
    const id = this.remoteString(remoteApplication.id);
    const name = this.remoteString(remoteApplication.name);
    if (!id || !name) return false;

    db.prepare(`
      INSERT INTO applications (id, name, context_description, is_active, is_synced, created_at, updated_at)
      VALUES (@id, @name, @context_description, @is_active, 1, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        context_description = excluded.context_description,
        is_active = excluded.is_active,
        is_synced = 1,
        updated_at = excluded.updated_at
    `).run({
      id,
      name,
      context_description: this.remoteString(remoteApplication.context_description) || null,
      is_active: remoteApplication.is_active === false ? 0 : 1,
      created_at: this.remoteString(remoteApplication.created_at) || now(),
      updated_at: this.remoteString(remoteApplication.updated_at) || now()
    });
    return true;
  }

  upsertRemoteModule(remoteModule: Record<string, unknown>): boolean {
    const db = this.requireWorkspaceDb();
    const id = this.remoteString(remoteModule.id);
    const name = this.remoteString(remoteModule.name);
    if (!id || !name) return false;

    db.prepare(`
      INSERT INTO modules (id, application_id, name, context_description, is_active, created_at, updated_at)
      VALUES (@id, @application_id, @name, @context_description, @is_active, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        application_id = excluded.application_id,
        name = excluded.name,
        context_description = excluded.context_description,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `).run({
      id,
      application_id: this.remoteString(remoteModule.application_id) || null,
      name,
      context_description: this.remoteString(remoteModule.context_description) || null,
      is_active: remoteModule.is_active === false ? 0 : 1,
      created_at: this.remoteString(remoteModule.created_at) || now(),
      updated_at: this.remoteString(remoteModule.updated_at) || now()
    });
    return true;
  }

  upsertRemoteEnvironment(remoteEnvironment: Record<string, unknown>): boolean {
    const db = this.requireWorkspaceDb();
    const id = this.remoteString(remoteEnvironment.id);
    const name = this.remoteString(remoteEnvironment.name);
    if (!id || !name) return false;

    db.prepare(`
      INSERT INTO environments (id, name, value, sort_order, is_active, created_at, updated_at)
      VALUES (@id, @name, @value, @sort_order, @is_active, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        value = excluded.value,
        sort_order = excluded.sort_order,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `).run({
      id,
      name,
      value: this.remoteString(remoteEnvironment.value) || name,
      sort_order: Number(remoteEnvironment.sort_order ?? 0),
      is_active: remoteEnvironment.is_active === false ? 0 : 1,
      created_at: this.remoteString(remoteEnvironment.created_at) || now(),
      updated_at: this.remoteString(remoteEnvironment.updated_at) || now()
    });
    return true;
  }

  upsertRemoteAttachment(remoteAttachment: Record<string, unknown>): boolean {
    const attachmentMetadata = validateAttachmentMetadata(
      remoteAttachment.content_hash,
      remoteAttachment.file_extension
    );
    const db = this.requireWorkspaceDb();
    const remoteId = this.remoteString(remoteAttachment.id);
    if (!remoteId) return false;

    const remoteUpdatedAt = this.remoteString(remoteAttachment.updated_at) || this.remoteString(remoteAttachment.created_at) || now();
    const existing = db.prepare('SELECT id, updated_at FROM attachments WHERE remote_id = ?').get(remoteId) as { id: number; updated_at: string } | undefined;

    if (this.remoteString(remoteAttachment.deleted_at)) {
      if (!existing) return false;
      db.prepare('DELETE FROM attachments WHERE id = ?').run(existing.id);
      return true;
    }

    if (existing && this.isLocalNewer(existing.updated_at, remoteUpdatedAt)) return false;

    const remoteBugId = this.remoteString(remoteAttachment.bug_id);
    const remoteParentId = this.remoteString(remoteAttachment.parent_id);
    const bug = remoteBugId ? db.prepare('SELECT id FROM bugs WHERE remote_id = ?').get(remoteBugId) as { id: number } | undefined : undefined;
    const parent = remoteParentId ? db.prepare('SELECT id FROM attachments WHERE remote_id = ?').get(remoteParentId) as { id: number } | undefined : undefined;
    const values = {
      remote_id: remoteId,
      bug_id: bug?.id ?? null,
      parent_id: parent?.id ?? null,
      content_hash: attachmentMetadata.contentHash,
      file_extension: attachmentMetadata.extension,
      mime_type: this.remoteString(remoteAttachment.mime_type) || 'image/png',
      source_type: this.remoteString(remoteAttachment.source_type) || 'other',
      sync_status: 'Synced' as SyncStatus,
      last_sync_at: now(),
      created_at: this.remoteString(remoteAttachment.created_at) || remoteUpdatedAt,
      updated_at: remoteUpdatedAt
    };

    if (existing) {
      db.prepare(`
        UPDATE attachments SET
          bug_id = @bug_id,
          parent_id = @parent_id,
          content_hash = @content_hash,
          file_extension = @file_extension,
          mime_type = @mime_type,
          source_type = @source_type,
          sync_status = @sync_status,
          last_sync_at = @last_sync_at,
          updated_at = @updated_at
        WHERE id = @id
      `).run({ ...values, id: existing.id });
      return true;
    }

    db.prepare(`
      INSERT INTO attachments (
        remote_id, bug_id, parent_id, content_hash, file_extension, mime_type, source_type,
        sync_status, last_sync_at, created_at, updated_at
      ) VALUES (
        @remote_id, @bug_id, @parent_id, @content_hash, @file_extension, @mime_type, @source_type,
        @sync_status, @last_sync_at, @created_at, @updated_at
      )
    `).run(values);
    return true;
  }

  private legacyRemoteSyncWatermarkKey(workspaceId: string): string {
    return `last_remote_sync_${workspaceId.trim().replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  }

  private remoteSyncCursorKey(workspaceId: string, entityType: 'bug' | 'attachment'): string {
    const safeWorkspaceId = workspaceId.trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
    return `${entityType}_cursor_${safeWorkspaceId}`;
  }

  private workspaceRoleKey(workspaceId: string): string {
    return `workspace_role_${workspaceId.trim().replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  }

  private requireWorkspaceDb(): Database.Database {
    if (!this.workspaceDb) throw new Error('No active workspace database is connected.');
    return this.workspaceDb;
  }

  private workspaceDataDb(): Database.Database {
    return this.workspaceDb ?? this.localDb;
  }

  private taxonomyDb(): Database.Database {
    return this.workspaceDb ?? this.localDb;
  }

  private referenceDb(type: ReferenceTable): Database.Database {
    return type === 'environment' ? this.taxonomyDb() : this.localDb;
  }

  private remoteString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private remoteBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  private isLocalNewer(localUpdatedAt: string, remoteUpdatedAt: string): boolean {
    if (!localUpdatedAt) return false;
    return new Date(localUpdatedAt).getTime() > new Date(remoteUpdatedAt).getTime();
  }

  getByokAiProvider(): AiProvider {
    const value = this.getSetting('byok_ai_provider').trim();
    if (value === 'Grok' || value === 'OpenRouter' || value === 'Gemini' || value === 'Custom/Local') return value;
    return 'OpenRouter';
  }

  getByokAiBaseUrl(): string {
    return this.getSetting('byok_ai_base_url').trim() || 'https://openrouter.ai/api/v1';
  }

  getByokAiModelId(): string {
    const modelId = this.getSetting('byok_ai_model_id').trim();
    return !modelId || modelId === 'openrouter/free' ? 'google/gemma-4-31b-it:free' : modelId;
  }

  private getEncryptedByokAiApiKeyMap(): Partial<Record<AiProvider, string>> {
    const value = this.getSetting('byok_ai_api_keys_encrypted').trim();
    if (value) {
      try {
        const parsed = JSON.parse(value) as Partial<Record<AiProvider, string>>;
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
      } catch {
        // Fall through to the legacy single-key setting below.
      }
    }

    const legacyKey = this.getSetting('byok_ai_api_key_encrypted').trim();
    return legacyKey ? { [this.getByokAiProvider()]: legacyKey } : {};
  }

  getEncryptedByokAiApiKey(provider = this.getByokAiProvider()): string {
    return this.getEncryptedByokAiApiKeyMap()[provider]?.trim() ?? '';
  }

  getEncryptedByokAiApiKeys(): Partial<Record<AiProvider, string>> {
    return this.getEncryptedByokAiApiKeyMap();
  }

  getByokAiCustomSystemPrompt(): string {
    return this.getSetting('byok_ai_custom_system_prompt');
  }

  updateByokAiConfig(
    provider: AiProvider,
    baseUrl: string,
    modelId: string,
    encryptedApiKey: string | null | undefined,
    customSystemPrompt: string
  ): void {
    this.setSetting('byok_ai_provider', provider);
    this.setSetting('byok_ai_base_url', baseUrl.trim());
    this.setSetting('byok_ai_model_id', modelId.trim());
    if (encryptedApiKey !== undefined) {
      const keyMap = this.getEncryptedByokAiApiKeyMap();
      if (encryptedApiKey) keyMap[provider] = encryptedApiKey;
      else delete keyMap[provider];
      this.setSetting('byok_ai_api_keys_encrypted', JSON.stringify(keyMap));
    }
    this.setSetting('byok_ai_custom_system_prompt', customSystemPrompt);
  }

  getPendingSyncQueue(limit = 25, maxRetries = 5): SyncQueueEvent[] {
    const dataDb = this.workspaceDataDb();
    return dataDb
      .prepare(`
        SELECT id, local_seq, op_id, entity_type, entity_id, operation, payload, created_at, retry_count, last_error
        FROM sync_queue
        WHERE retry_count < ?
        ORDER BY
          CASE entity_type
            WHEN 'application' THEN 0
            WHEN 'module' THEN 1
            WHEN 'environment' THEN 2
            WHEN 'reference' THEN 3
            WHEN 'bug' THEN 4
            WHEN 'attachment' THEN 5
            ELSE 6
          END,
          local_seq,
          id
        LIMIT ?
      `)
      .all(maxRetries, limit) as SyncQueueEvent[];
  }

  markSyncEventSucceeded(event: Pick<SyncQueueEvent, 'id' | 'entity_type' | 'entity_id' | 'operation'>): void {
    const stamp = now();
    const dataDb = this.workspaceDataDb();
    const tx = dataDb.transaction(() => {
      if (event.operation !== 'DELETE') {
        if (event.entity_type === 'bug') {
          dataDb.prepare("UPDATE bugs SET sync_status = 'Synced', last_sync_at = ? WHERE id = ?").run(stamp, event.entity_id);
        } else if (event.entity_type === 'attachment') {
          dataDb.prepare("UPDATE attachments SET sync_status = 'Synced', last_sync_at = ? WHERE id = ?").run(stamp, event.entity_id);
        }
      }
      dataDb.prepare('DELETE FROM sync_queue WHERE id = ?').run(event.id);
    });
    tx();
  }

  markSyncEventFailed(event: Pick<SyncQueueEvent, 'entity_type' | 'entity_id'>): void {
    const stamp = now();
    const dataDb = this.workspaceDataDb();
    const tx = dataDb.transaction(() => {
      if (event.entity_type === 'bug') {
        dataDb.prepare("UPDATE bugs SET sync_status = 'Sync Failed', last_sync_at = ? WHERE id = ?").run(stamp, event.entity_id);
      } else if (event.entity_type === 'attachment') {
        dataDb.prepare("UPDATE attachments SET sync_status = 'Sync Failed', last_sync_at = ? WHERE id = ?").run(stamp, event.entity_id);
      }
    });
    tx();
  }

  recordSyncEventFailure(event: Pick<SyncQueueEvent, 'id' | 'entity_type' | 'entity_id'>, errorMessage: string, maxRetries = 5): number {
    const cleanedError = errorMessage.slice(0, 2000);
    const dataDb = this.workspaceDataDb();
    const tx = dataDb.transaction(() => {
      dataDb
        .prepare('UPDATE sync_queue SET retry_count = COALESCE(retry_count, 0) + 1, last_error = ? WHERE id = ?')
        .run(cleanedError, event.id);
      const row = dataDb.prepare('SELECT retry_count FROM sync_queue WHERE id = ?').get(event.id) as { retry_count: number } | undefined;
      const retryCount = row?.retry_count ?? maxRetries;
      if (retryCount >= maxRetries) {
        this.markSyncEventFailed(event);
      }
      return retryCount;
    });
    return tx() as number;
  }

  resetSyncQueueRetries(): void {
    this.workspaceDataDb().prepare('UPDATE sync_queue SET retry_count = 0, last_error = NULL').run();
  }

  getSyncDiagnostics(): SyncDiagnosticsRow[] {
    return this.workspaceDataDb().prepare(`
      SELECT
        q.id,
        q.local_seq,
        q.op_id,
        q.entity_type,
        q.entity_id,
        q.operation,
        q.created_at,
        q.retry_count,
        q.last_error,
        COALESCE(
          NULLIF(b.title, ''),
          CASE
            WHEN q.entity_type = 'attachment' THEN COALESCE(NULLIF(a.content_hash || a.file_extension, ''), 'Attachment #' || q.entity_id)
            ELSE q.entity_type || ' #' || q.entity_id
          END
        ) AS label
      FROM sync_queue q
      LEFT JOIN bugs b ON q.entity_type = 'bug' AND b.id = q.entity_id
      LEFT JOIN attachments a ON q.entity_type = 'attachment' AND a.id = q.entity_id
      ORDER BY q.local_seq, q.id
    `).all() as SyncDiagnosticsRow[];
  }

  getPresets(): CapturePreset[] {
    return this.db.prepare('SELECT * FROM presets ORDER BY id LIMIT ?').all(MAX_CAPTURE_PRESETS) as CapturePreset[];
  }

  createPreset(input: CapturePresetInput): CapturePreset {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM presets').get() as { count: number };
    if (count.count >= MAX_CAPTURE_PRESETS) throw new Error(`Only ${MAX_CAPTURE_PRESETS} Quick Capture presets are allowed.`);
    return this.savePreset(null, input);
  }

  updatePreset(id: number, input: CapturePresetInput): CapturePreset {
    return this.savePreset(id, input);
  }

  deletePreset(id: number): void {
    this.db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  }

  private savePreset(id: number | null, input: CapturePresetInput): CapturePreset {
    const name = input.name.trim();
    if (!name) throw new Error('Preset name is required.');
    this.validatePresetReferences(input);
    const stamp = now();
    const duplicate = this.db.prepare('SELECT id FROM presets WHERE name = ? AND (? IS NULL OR id != ?)').get(name, id, id) as { id: number } | undefined;
    if (duplicate) throw new Error('A preset with this name already exists.');
    if (id) {
      this.db
        .prepare(
          `UPDATE presets
           SET name = ?, application_id = ?, module_id = ?, environment_id = ?, user_role_id = ?, entry_type_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(name, input.application_id, input.module_id, input.environment_id, input.user_role_id, input.entry_type_id, stamp, id);
      return this.db.prepare('SELECT * FROM presets WHERE id = ?').get(id) as CapturePreset;
    }
    this.db
      .prepare(
        `INSERT INTO presets (name, application_id, module_id, environment_id, user_role_id, entry_type_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, input.application_id, input.module_id, input.environment_id, input.user_role_id, input.entry_type_id, stamp, stamp);
    return this.db.prepare('SELECT * FROM presets WHERE id = last_insert_rowid()').get() as CapturePreset;
  }

  private validatePresetReferences(input: CapturePresetInput): void {
    if (input.application_id != null) this.requireExists('applications', input.application_id, 'Application');
    if (input.module_id != null) this.requireExists('modules', input.module_id, 'Module');
    if (input.environment_id != null) this.requireExists('environments', input.environment_id, 'Environment');
    if (input.user_role_id != null) this.requireExists('user_roles', input.user_role_id, 'User role');
    if (input.entry_type_id != null) {
      const entryType = this.db.prepare("SELECT id FROM config_options WHERE id = ? AND type = 'entry_type' AND is_active = 1").get(input.entry_type_id);
      if (!entryType) throw new Error('Entry type was not found.');
    }
  }

  private requireExists(table: string, id: TaxonomyId, label: string): void {
    const db = table === 'applications' || table === 'modules' || table === 'environments'
      ? this.taxonomyDb()
      : this.localDb;
    const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND is_active = 1`).get(id);
    if (!row) throw new Error(`${label} was not found.`);
  }

  private assertNotUsedByPreset(column: 'application_id' | 'module_id' | 'environment_id' | 'user_role_id' | 'entry_type_id', id: TaxonomyId): void {
    const row = this.localDb.prepare(`SELECT COUNT(*) AS count FROM presets WHERE ${column} = ?`).get(id) as { count: number };
    if (row.count > 0) throw new Error('Cannot delete because it is currently used by an active preset. Please update or delete the preset first.');
  }

  private getOptions(type: string): ConfigOption[] {
    return this.db
      .prepare('SELECT * FROM config_options WHERE type = ? AND is_active = 1 ORDER BY sort_order, value')
      .all(type) as ConfigOption[];
  }

  private getReferenceOptions(type: ReferenceTable): ReferenceOption[] {
    const table = referenceTables[type];
    return this.referenceDb(type)
      .prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE is_active = 1 ORDER BY sort_order, name`)
      .all() as ReferenceOption[];
  }

  private addReferenceOption(type: ReferenceTable, name: string, sortOrder?: number, stamp = now()): ReferenceOption {
    const table = referenceTables[type];
    const db = this.referenceDb(type);
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Option value is required.');
    const existing = db.prepare(`SELECT * FROM ${table} WHERE name = ?`).get(cleaned) as ReferenceOption | undefined;
    if (existing) {
      db.prepare(`UPDATE ${table} SET is_active = 1, value = name, updated_at = ? WHERE id = ?`).run(stamp, existing.id);
      return db.prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE id = ?`).get(existing.id) as ReferenceOption;
    }
    const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) as sort_order FROM ${table}`).get() as { sort_order: number };
    const order = sortOrder ?? maxOrder.sort_order + 1;
    if (type === 'environment' && this.workspaceDb) {
      const id = randomUUID();
      db.prepare(`INSERT INTO ${table} (id, name, value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
        .run(id, cleaned, cleaned, order, stamp, stamp);
      return db.prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE id = ?`).get(id) as ReferenceOption;
    }
    db.prepare(`INSERT INTO ${table} (name, value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
      .run(cleaned, cleaned, order, stamp, stamp);
    return db.prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE id = last_insert_rowid()`).get() as ReferenceOption;
  }

  addEnvironment(name: string): ReferenceOption {
    const environment = this.addReferenceOption('environment', name);
    this.enqueueEnvironmentSyncEvent(environment.id, 'INSERT', this.environmentPayload(environment.id));
    return environment;
  }

  updateEnvironment(id: TaxonomyId, name: string): ReferenceOption {
    const environment = this.updateReferenceOption('environment', id, name);
    this.enqueueEnvironmentSyncEvent(environment.id, 'UPDATE', this.environmentPayload(environment.id));
    return environment;
  }

  deleteEnvironment(id: TaxonomyId): void {
    this.assertNotUsedByPreset('environment_id', id);
    this.deleteReferenceOption('environment', id);
    this.enqueueEnvironmentSyncEvent(id, 'DELETE', this.environmentPayload(id));
  }

  addDevice(name: string): ReferenceOption {
    return this.addReferenceOption('device', name);
  }

  updateDevice(id: TaxonomyId, name: string): ReferenceOption {
    return this.updateReferenceOption('device', id, name);
  }

  deleteDevice(id: TaxonomyId): void {
    this.deleteReferenceOption('device', id);
  }

  addBrowser(name: string): ReferenceOption {
    return this.addReferenceOption('browser', name);
  }

  updateBrowser(id: TaxonomyId, name: string): ReferenceOption {
    return this.updateReferenceOption('browser', id, name);
  }

  deleteBrowser(id: TaxonomyId): void {
    this.deleteReferenceOption('browser', id);
  }

  addUserRole(name: string): ReferenceOption {
    return this.addReferenceOption('user_role', name);
  }

  updateUserRole(id: TaxonomyId, name: string): ReferenceOption {
    return this.updateReferenceOption('user_role', id, name);
  }

  deleteUserRole(id: TaxonomyId): void {
    this.assertNotUsedByPreset('user_role_id', id);
    this.deleteReferenceOption('user_role', id);
  }

  private updateReferenceOption(type: ReferenceTable, id: TaxonomyId, name: string): ReferenceOption {
    const table = referenceTables[type];
    const db = this.referenceDb(type);
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Option value is required.');
    const duplicate = db.prepare(`SELECT id FROM ${table} WHERE name = ? AND id != ?`).get(cleaned, id) as { id: TaxonomyId } | undefined;
    if (duplicate) throw new Error('Option already exists.');
    db.prepare(`UPDATE ${table} SET name = ?, value = ?, updated_at = ? WHERE id = ?`).run(cleaned, cleaned, now(), id);
    return db.prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE id = ?`).get(id) as ReferenceOption;
  }

  private deleteReferenceOption(type: ReferenceTable, id: TaxonomyId): void {
    const table = referenceTables[type];
    this.referenceDb(type).prepare(`UPDATE ${table} SET is_active = 0, updated_at = ? WHERE id = ?`).run(now(), id);
  }

  mergeReferenceOption(tableName: ReferenceTable | string, sourceId: TaxonomyId, targetId: TaxonomyId): void {
    const type = this.normalizeReferenceTable(tableName);
    if (sourceId === targetId) throw new Error('Choose a different target to merge into.');
    const table = referenceTables[type];
    const foreignKey = referenceForeignKeys[type];
    const referenceDb = this.referenceDb(type);
    const source = referenceDb.prepare(`SELECT id, name, value FROM ${table} WHERE id = ?`).get(sourceId) as ReferenceOption | undefined;
    const target = referenceDb.prepare(`SELECT id, name, value FROM ${table} WHERE id = ?`).get(targetId) as ReferenceOption | undefined;
    if (!source) throw new Error('Duplicate reference item was not found.');
    if (!target) throw new Error('Canonical reference item was not found.');

    const dataDb = this.workspaceDataDb();
    const updateBugs = dataDb.transaction(() =>
      dataDb.prepare(`UPDATE bugs SET ${foreignKey} = ?, sync_status = ?, updated_at = ? WHERE ${foreignKey} = ?`)
        .run(targetId, this.isCloudSyncReady() ? 'Sync Pending' : 'Local Only', now(), sourceId)
    );
    const result = updateBugs();

    const updateLocalReferences = this.localDb.transaction(() => {
      const presetResult = this.localDb.prepare(`UPDATE presets SET ${foreignKey} = ?, updated_at = ? WHERE ${foreignKey} = ?`).run(targetId, now(), sourceId);
      return presetResult;
    });
    const presetResult = updateLocalReferences();
    referenceDb.prepare(`DELETE FROM ${table} WHERE id = ?`).run(sourceId);

    if (this.isCloudSyncReady()) {
      this.enqueueSyncEvent('reference', targetId, 'MERGE', {
        table_name: type,
        source_id: sourceId,
        target_id: targetId,
        source_name: source.name,
        target_name: target.name,
        foreign_key: foreignKey,
        affected_bugs: result.changes,
        affected_presets: presetResult.changes
      });
    }
  }

  private normalizeReferenceTable(tableName: ReferenceTable | string): ReferenceTable {
    const normalized = tableName.trim().toLowerCase();
    if (normalized === 'environment' || normalized === 'environments') return 'environment';
    if (normalized === 'device' || normalized === 'devices') return 'device';
    if (normalized === 'browser' || normalized === 'browsers') return 'browser';
    if (normalized === 'user_role' || normalized === 'user_roles' || normalized === 'user role' || normalized === 'user roles') return 'user_role';
    throw new Error('Unsupported reference table.');
  }

  addApplication(name: string, contextDescription = ''): Application {
    const db = this.taxonomyDb();
    const cleaned = name.trim();
    const context = contextDescription.trim() || null;
    if (!cleaned) throw new Error('Application name is required.');
    const stamp = now();
    const existing = db.prepare('SELECT * FROM applications WHERE name = ?').get(cleaned) as Application | undefined;
    if (existing) {
      db.prepare('UPDATE applications SET context_description = COALESCE(?, context_description), is_active = 1, updated_at = ? WHERE id = ?').run(context, stamp, existing.id);
      const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(existing.id) as Application;
      this.enqueueApplicationSyncEvent(application.id, 'UPDATE', this.applicationPayload(application.id));
      return application;
    }
    const tx = db.transaction(() => {
      let application: Application;
      let module: Module;
      if (this.workspaceDb) {
        const applicationId = randomUUID();
        const moduleId = randomUUID();
        db.prepare('INSERT INTO applications (id, name, context_description, is_active, is_synced, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)')
          .run(applicationId, cleaned, context, stamp, stamp);
        application = db.prepare('SELECT * FROM applications WHERE id = ?').get(applicationId) as Application;
        db.prepare('INSERT INTO modules (id, application_id, name, context_description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
          .run(moduleId, application.id, 'General', null, stamp, stamp);
        module = db.prepare('SELECT * FROM modules WHERE id = ?').get(moduleId) as Module;
      } else {
        db.prepare('INSERT INTO applications (name, context_description, is_active, is_synced, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)').run(cleaned, context, stamp, stamp);
        application = db.prepare('SELECT * FROM applications WHERE id = last_insert_rowid()').get() as Application;
        db.prepare('INSERT INTO modules (application_id, name, context_description, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(application.id, 'General', null, stamp, stamp);
        module = db.prepare('SELECT * FROM modules WHERE id = last_insert_rowid()').get() as Module;
      }
      return { application, module };
    });
    const { application, module } = tx();
    this.enqueueApplicationSyncEvent(application.id, 'INSERT', this.applicationPayload(application.id));
    this.enqueueModuleSyncEvent(module.id, 'INSERT', this.modulePayload(module.id));
    return application;
  }

  updateApplication(id: TaxonomyId, name: string, contextDescription = ''): Application {
    const db = this.taxonomyDb();
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Application name is required.');
    const duplicate = db.prepare('SELECT id FROM applications WHERE name = ? AND id != ?').get(cleaned, id) as { id: TaxonomyId } | undefined;
    if (duplicate) throw new Error('Application already exists.');
    db.prepare('UPDATE applications SET name = ?, context_description = ?, updated_at = ? WHERE id = ?').run(cleaned, contextDescription.trim() || null, now(), id);
    const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Application;
    this.enqueueApplicationSyncEvent(application.id, 'UPDATE', this.applicationPayload(application.id));
    return application;
  }

  updateApplicationSync(id: TaxonomyId, isSynced: boolean): Application {
    const db = this.taxonomyDb();
    db.prepare('UPDATE applications SET is_synced = ?, updated_at = ? WHERE id = ?').run(isSynced ? 1 : 0, now(), id);
    const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Application;
    this.enqueueApplicationSyncEvent(application.id, 'UPDATE', this.applicationPayload(application.id));
    return application;
  }

  updateApplicationContext(id: TaxonomyId, contextDescription: string): Application {
    const db = this.taxonomyDb();
    db.prepare('UPDATE applications SET context_description = ?, updated_at = ? WHERE id = ?').run(contextDescription.trim() || null, now(), id);
    const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Application;
    this.enqueueApplicationSyncEvent(application.id, 'UPDATE', this.applicationPayload(application.id));
    return application;
  }

  deleteApplication(id: TaxonomyId): void {
    this.assertNotUsedByPreset('application_id', id);
    this.taxonomyDb().prepare('UPDATE applications SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), id);
    this.enqueueApplicationSyncEvent(id, 'DELETE', this.applicationPayload(id));
  }

  addModule(name: string, applicationId: TaxonomyId | null, contextDescription = ''): Module {
    const db = this.taxonomyDb();
    const cleaned = name.trim();
    const context = contextDescription.trim() || null;
    if (!cleaned) throw new Error('Module name is required.');
    const stamp = now();
    const existing = db
      .prepare('SELECT * FROM modules WHERE name = ? AND ((? IS NULL AND application_id IS NULL) OR application_id = ?) LIMIT 1')
      .get(cleaned, applicationId, applicationId) as Module | undefined;
    if (existing) {
      db.prepare('UPDATE modules SET context_description = COALESCE(?, context_description), is_active = 1, updated_at = ? WHERE id = ?').run(context, stamp, existing.id);
      const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(existing.id) as Module;
      this.enqueueModuleSyncEvent(module.id, 'UPDATE', this.modulePayload(module.id));
      return module;
    }
    let module: Module;
    if (this.workspaceDb) {
      const id = randomUUID();
      db.prepare('INSERT INTO modules (id, application_id, name, context_description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
        .run(id, applicationId, cleaned, context, stamp, stamp);
      module = db.prepare('SELECT * FROM modules WHERE id = ?').get(id) as Module;
    } else {
      db.prepare('INSERT INTO modules (application_id, name, context_description, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(applicationId, cleaned, context, stamp, stamp);
      module = db.prepare('SELECT * FROM modules WHERE id = last_insert_rowid()').get() as Module;
    }
    this.enqueueModuleSyncEvent(module.id, 'INSERT', this.modulePayload(module.id));
    return module;
  }

  updateModule(id: TaxonomyId, name: string, applicationId: TaxonomyId | null, contextDescription = ''): Module {
    const db = this.taxonomyDb();
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Module name is required.');
    const duplicate = db
      .prepare('SELECT id FROM modules WHERE name = ? AND ((? IS NULL AND application_id IS NULL) OR application_id = ?) AND id != ? AND is_active = 1 LIMIT 1')
      .get(cleaned, applicationId, applicationId, id) as { id: TaxonomyId } | undefined;
    if (duplicate) throw new Error('Module already exists for this application.');
    db.prepare('UPDATE modules SET application_id = ?, name = ?, context_description = ?, updated_at = ? WHERE id = ?').run(applicationId, cleaned, contextDescription.trim() || null, now(), id);
    const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(id) as Module;
    this.enqueueModuleSyncEvent(module.id, 'UPDATE', this.modulePayload(module.id));
    return module;
  }

  updateModuleContext(id: TaxonomyId, contextDescription: string): Module {
    const db = this.taxonomyDb();
    db.prepare('UPDATE modules SET context_description = ?, updated_at = ? WHERE id = ?').run(contextDescription.trim() || null, now(), id);
    const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(id) as Module;
    this.enqueueModuleSyncEvent(module.id, 'UPDATE', this.modulePayload(module.id));
    return module;
  }

  deleteModule(id: TaxonomyId): void {
    this.assertNotUsedByPreset('module_id', id);
    this.taxonomyDb().prepare('UPDATE modules SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), id);
    this.enqueueModuleSyncEvent(id, 'DELETE', this.modulePayload(id));
  }

  addConfigOption(type: string, value: string): ConfigOption {
    if (type === 'status' || type === 'scenario_status') throw new Error('Capture statuses are fixed: Draft, Reported, and Discarded.');
    const cleaned = value.trim();
    if (!cleaned) throw new Error('Option value is required.');
    const existing = this.db.prepare('SELECT * FROM config_options WHERE type = ? AND value = ?').get(type, cleaned) as ConfigOption | undefined;
    if (existing) {
      this.db.prepare('UPDATE config_options SET is_active = 1 WHERE id = ?').run(existing.id);
      return this.db.prepare('SELECT * FROM config_options WHERE id = ?').get(existing.id) as ConfigOption;
    }
    const maxOrder = this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) as sort_order FROM config_options WHERE type = ?').get(type) as {
      sort_order: number;
    };
    this.db
      .prepare('INSERT OR IGNORE INTO config_options (type, value, sort_order, is_active) VALUES (?, ?, ?, 1)')
      .run(type, cleaned, maxOrder.sort_order + 1);
    return this.db.prepare('SELECT * FROM config_options WHERE type = ? AND value = ?').get(type, cleaned) as ConfigOption;
  }

  updateConfigOption(id: number, value: string): ConfigOption {
    const cleaned = value.trim();
    if (!cleaned) throw new Error('Option value is required.');
    const current = this.db.prepare('SELECT * FROM config_options WHERE id = ?').get(id) as ConfigOption | undefined;
    if (!current) throw new Error('Option not found.');
    if (current.type === 'status' || current.type === 'scenario_status') throw new Error('Capture statuses are fixed: Draft, Reported, and Discarded.');
    const duplicate = this.db.prepare('SELECT id FROM config_options WHERE type = ? AND value = ? AND id != ?').get(current.type, cleaned, id) as
      | { id: number }
      | undefined;
    if (duplicate) throw new Error('Option already exists.');
    this.db.prepare('UPDATE config_options SET value = ? WHERE id = ?').run(cleaned, id);
    return this.db.prepare('SELECT * FROM config_options WHERE id = ?').get(id) as ConfigOption;
  }

  deleteConfigOption(id: number): void {
    const current = this.db.prepare('SELECT type FROM config_options WHERE id = ?').get(id) as { type: string } | undefined;
    if (current?.type === 'status' || current?.type === 'scenario_status') throw new Error('Capture statuses are fixed: Draft, Reported, and Discarded.');
    if (current?.type === 'entry_type') this.assertNotUsedByPreset('entry_type_id', id);
    this.db.prepare('UPDATE config_options SET is_active = 0 WHERE id = ?').run(id);
  }

  saveTemplate(id: number | null, name: string, templateText: string): ReportTemplate {
    const cleanedName = name.trim();
    if (!cleanedName || !templateText.trim()) throw new Error('Template name and text are required.');
    const stamp = now();
    if (id) {
      this.db.prepare('UPDATE report_templates SET name = ?, template_text = ?, updated_at = ? WHERE id = ?').run(cleanedName, templateText, stamp, id);
      return this.db.prepare('SELECT * FROM report_templates WHERE id = ?').get(id) as ReportTemplate;
    }
    this.db.prepare('INSERT INTO report_templates (name, template_text, created_at, updated_at) VALUES (?, ?, ?, ?)').run(cleanedName, templateText, stamp, stamp);
    return this.db.prepare('SELECT * FROM report_templates WHERE id = last_insert_rowid()').get() as ReportTemplate;
  }

  listBugs(filters: BugFilters): Bug[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.search) {
      clauses.push('(bugs.title LIKE ? OR bugs.note LIKE ? OR bugs.steps_to_reproduce LIKE ? OR bugs.expected_result LIKE ? OR bugs.actual_result LIKE ? OR bugs.tags LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term, term);
    }
    if (filters.entryType && filters.entryType !== 'all') {
      clauses.push('bugs.entry_type = ?');
      params.push(filters.entryType);
    }
    if (filters.applicationId && filters.applicationId !== 'all') {
      clauses.push('bugs.application_id = ?');
      params.push(filters.applicationId);
    }
    if (filters.moduleId && filters.moduleId !== 'all') {
      clauses.push('bugs.module_id = ?');
      params.push(filters.moduleId);
    }
    if (filters.environmentId && filters.environmentId !== 'all') {
      clauses.push('bugs.environment_id = ?');
      params.push(filters.environmentId);
    }
    if (filters.status === 'Discarded') {
      clauses.push('bugs.status = ?');
      params.push(filters.status);
    } else {
      clauses.push("bugs.status != 'Discarded'");
    }
    if (filters.status && filters.status !== 'all' && filters.status !== 'Discarded') {
      clauses.push('bugs.status = ?');
      params.push(filters.status);
    }
    if (filters.severity && filters.severity !== 'all') {
      clauses.push('bugs.severity = ?');
      params.push(filters.severity);
    }
    if (filters.syncStatus && filters.syncStatus !== 'all') {
      clauses.push('bugs.sync_status = ?');
      params.push(filters.syncStatus);
    }
    if (filters.reported === 'reported') clauses.push('bugs.reported = 1');
    if (filters.reported === 'unreported') clauses.push('bugs.reported = 0');

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const dataDb = this.workspaceDataDb();
    return dataDb
      .prepare(
        `
        SELECT bugs.*, COALESCE(applications.name, 'General') AS application_name, COALESCE(modules.name, 'Uncategorized') AS module_name,
          environments.name AS environment, devices.name AS device, browsers.name AS browser, user_roles.name AS user_role,
          COUNT(
            CASE
              WHEN attachments.id IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM attachments child
                  WHERE child.parent_id = attachments.id
                    AND child.bug_id = attachments.bug_id
                )
              THEN 1
            END
          ) AS attachment_count
        FROM bugs
        LEFT JOIN applications ON applications.id = bugs.application_id
        LEFT JOIN modules ON modules.id = bugs.module_id
        LEFT JOIN environments ON environments.id = bugs.environment_id
        LEFT JOIN devices ON devices.id = bugs.device_id
        LEFT JOIN browsers ON browsers.id = bugs.browser_id
        LEFT JOIN user_roles ON user_roles.id = bugs.user_role_id
        LEFT JOIN attachments ON attachments.bug_id = bugs.id
        ${where}
        GROUP BY bugs.id
        ORDER BY bugs.created_at DESC
      `
      )
      .all(...params) as Bug[];
  }

  getBug(id: number): BugDetails | null {
    const dataDb = this.workspaceDataDb();
    const bug = dataDb
      .prepare(
        `
        SELECT bugs.*, COALESCE(applications.name, 'General') AS application_name, COALESCE(modules.name, 'Uncategorized') AS module_name,
          environments.name AS environment, devices.name AS device, browsers.name AS browser, user_roles.name AS user_role
        FROM bugs
        LEFT JOIN applications ON applications.id = bugs.application_id
        LEFT JOIN modules ON modules.id = bugs.module_id
        LEFT JOIN environments ON environments.id = bugs.environment_id
        LEFT JOIN devices ON devices.id = bugs.device_id
        LEFT JOIN browsers ON browsers.id = bugs.browser_id
        LEFT JOIN user_roles ON user_roles.id = bugs.user_role_id
        WHERE bugs.id = ?
      `
      )
      .get(id) as Bug | undefined;
    if (!bug) return null;
    const attachments = dataDb
      .prepare(
        `SELECT attachments.*, ${attachmentFileNameSql}
         FROM attachments
         WHERE bug_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM attachments child
             WHERE child.parent_id = attachments.id
               AND child.bug_id = attachments.bug_id
           )
         ORDER BY created_at DESC`
      )
      .all(id);
    return { ...bug, attachments } as BugDetails;
  }

  getAttachment(id: number): Attachment | null {
    return (
      (this.workspaceDataDb().prepare(`SELECT attachments.*, ${attachmentFileNameSql} FROM attachments WHERE id = ?`).get(id) as Attachment | undefined) ??
      null
    );
  }

  getAttachmentLineage(id: number): Attachment[] {
    const seen = new Set<number>();
    let current = this.getAttachment(id);
    let root = current;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      root = current;
      current = current.parent_id ? this.getAttachment(current.parent_id) : null;
    }
    if (!root) return [];
    const dataDb = this.workspaceDataDb();
    return dataDb
      .prepare(
        `WITH RECURSIVE attachment_tree(id) AS (
           SELECT ?
           UNION ALL
           SELECT child.id
           FROM attachments child
           INNER JOIN attachment_tree tree ON child.parent_id = tree.id
         )
         SELECT attachments.*, ${attachmentFileNameSql}
         FROM attachments
         INNER JOIN attachment_tree tree ON tree.id = attachments.id
         ORDER BY attachments.created_at, attachments.id`
      )
      .all(root.id) as Attachment[];
  }

  createQuickBug(input: QuickBugInput): Bug {
    const stamp = now();
    const title = this.makeTitle(input.note);
    const dataDb = this.workspaceDataDb();
    const sanitized = {
      applicationId: this.sanitizeOptionalForeignKey(input.application_id),
      moduleId: this.sanitizeOptionalForeignKey(input.module_id),
      environmentId: this.sanitizeOptionalForeignKey(input.environment_id),
      deviceId: this.sanitizeOptionalForeignKey(input.device_id),
      browserId: this.sanitizeOptionalForeignKey(input.browser_id),
      userRoleId: this.sanitizeOptionalForeignKey(input.user_role_id),
      workspaceId: this.sanitizeOptionalForeignKey(input.workspace_id),
      createdBy: this.sanitizeOptionalForeignKey(input.created_by)
    };
    const tx = dataDb.transaction(() => {
      const result = dataDb
        .prepare(
          `INSERT INTO bugs (entry_type, application_id, module_id, environment_id, device_id, browser_id, user_role_id, workspace_id, created_by, title, note, status, severity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', 'Medium', ?, ?)`
        )
        .run(
          input.entry_type || 'Bug',
          sanitized.applicationId,
          sanitized.moduleId,
          sanitized.environmentId,
          sanitized.deviceId,
          sanitized.browserId,
          sanitized.userRoleId,
          sanitized.workspaceId,
          sanitized.createdBy,
          title,
          input.note.trim(),
          stamp,
          stamp
        );
      const bugId = Number(result.lastInsertRowid);
      const attach = dataDb.prepare('UPDATE attachments SET bug_id = ?, updated_at = ? WHERE id = ? AND bug_id IS NULL');
      this.enqueueBugSyncEvent(bugId, 'INSERT');
      input.attachment_ids.forEach((attachmentId) => {
        attach.run(bugId, stamp, attachmentId);
        this.enqueueAttachmentSyncEvent(attachmentId, 'UPDATE');
      });
      return bugId;
    });
    return this.getBug(tx()) as Bug;
  }

  updateBug(id: number, input: BugUpdateInput): BugDetails {
    const stamp = now();
    const status = normalizeCaptureStatus(input.status);
    const dataDb = this.workspaceDataDb();
    const applicationId = this.sanitizeOptionalForeignKey(input.application_id);
    const moduleId = this.sanitizeOptionalForeignKey(input.module_id);
    const environmentId = this.sanitizeOptionalForeignKey(input.environment_id);
    const deviceId = this.sanitizeOptionalForeignKey(input.device_id);
    const browserId = this.sanitizeOptionalForeignKey(input.browser_id);
    const userRoleId = this.sanitizeOptionalForeignKey(input.user_role_id);
    const tx = dataDb.transaction(() => {
      dataDb
        .prepare(
          `
          UPDATE bugs SET entry_type = ?, application_id = ?, module_id = ?, title = ?, note = ?, other_details = ?,
            steps_to_reproduce = ?, expected_result = ?, actual_result = ?, environment_id = ?, device_id = ?, browser_id = ?, user_role_id = ?,
            status = ?, severity = ?, reported = ?, issue_platform = ?, issue_id = ?, issue_url = ?,
            tags = ?, sync_status = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(
          input.entry_type,
          applicationId,
          moduleId,
          input.title.trim() || this.makeTitle(input.note),
          input.note,
          input.other_details,
          input.steps_to_reproduce,
          input.expected_result,
          input.actual_result,
          environmentId,
          deviceId,
          browserId,
          userRoleId,
          status,
          input.severity,
          status === 'Reported' ? 1 : 0,
          input.issue_platform,
          input.issue_id,
          input.issue_url,
          input.tags,
          this.pendingSyncStatusForBug(applicationId),
          stamp,
          id
        );
      this.enqueueBugSyncEvent(id, 'UPDATE');
    });
    tx();
    return this.getBug(id) as BugDetails;
  }

  deleteBug(id: number): void {
    const dataDb = this.workspaceDataDb();
    const attachments = dataDb.prepare('SELECT content_hash, file_extension FROM attachments WHERE bug_id = ?').all(id) as Array<{
      content_hash: string | null;
      file_extension: string;
    }>;
    const bugPayload = this.bugPayload(id);
    const attachmentPayloads = dataDb
      .prepare(`SELECT attachments.*, ${attachmentFileNameSql} FROM attachments WHERE bug_id = ?`)
      .all(id) as Array<Record<string, unknown> & { id: number }>;
    const tx = dataDb.transaction(() => {
      attachmentPayloads.forEach((attachment) => this.enqueueAttachmentSyncEvent(attachment.id, 'DELETE', attachment));
      this.enqueueBugSyncEvent(id, 'DELETE', bugPayload);
      dataDb.prepare('DELETE FROM attachments WHERE bug_id = ?').run(id);
      dataDb.prepare('DELETE FROM bugs WHERE id = ?').run(id);
    });
    tx();
    attachments.forEach((attachment) => {
      this.deleteAttachmentBlobIfUnused(attachment.content_hash, attachment.file_extension);
    });
  }

  createAttachment(contentHash: string, fileExtension: string, mimeType = 'image/png', sourceType = 'snip'): number {
    const dataDb = this.workspaceDataDb();
    const tx = dataDb.transaction(() => {
      const result = dataDb
        .prepare('INSERT INTO attachments (bug_id, content_hash, file_extension, mime_type, source_type, sync_status, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?)')
        .run(contentHash, fileExtension, mimeType, sourceType, 'Local Only', now());
      return Number(result.lastInsertRowid);
    });
    return tx();
  }

  createAnnotatedAttachment(parentId: number, contentHash: string, fileExtension: string, mimeType = 'image/png'): Attachment {
    const dataDb = this.workspaceDataDb();
    const parent = dataDb.prepare('SELECT * FROM attachments WHERE id = ?').get(parentId) as { bug_id: number | null } | undefined;
    if (!parent) throw new Error('Original attachment not found.');
    if (!parent.bug_id) throw new Error('Annotated attachments must belong to a saved entry.');
    const bugId = parent.bug_id;
    const stamp = now();
    const tx = dataDb.transaction(() => {
      const result = dataDb
        .prepare(
          `INSERT INTO attachments (bug_id, parent_id, content_hash, file_extension, mime_type, source_type, sync_status, created_at)
           VALUES (?, ?, ?, ?, ?, 'annotation', 'Local Only', ?)`
        )
        .run(bugId, parentId, contentHash, fileExtension, mimeType, stamp);
      const attachmentId = Number(result.lastInsertRowid);
      dataDb.prepare('UPDATE bugs SET sync_status = ?, updated_at = ? WHERE id = ?').run(this.pendingSyncStatusForBugId(bugId), stamp, bugId);
      this.enqueueAttachmentSyncEvent(attachmentId, 'INSERT');
      this.enqueueBugSyncEvent(bugId, 'UPDATE');
      return attachmentId;
    });
    return this.getAttachment(tx()) as Attachment;
  }

  attachScreenshotToBug(bugId: number, attachmentId: number): BugDetails {
    const dataDb = this.workspaceDataDb();
    const stamp = now();
    const tx = dataDb.transaction(() => {
      dataDb.prepare('UPDATE attachments SET bug_id = ?, updated_at = ? WHERE id = ?').run(bugId, stamp, attachmentId);
      dataDb.prepare('UPDATE bugs SET sync_status = ?, updated_at = ? WHERE id = ?').run(this.pendingSyncStatusForBugId(bugId), stamp, bugId);
      this.enqueueAttachmentSyncEvent(attachmentId, 'UPDATE');
      this.enqueueBugSyncEvent(bugId, 'UPDATE');
    });
    tx();
    return this.getBug(bugId) as BugDetails;
  }

  deleteAttachment(attachmentId: number): void {
    const dataDb = this.workspaceDataDb();
    const attachment = dataDb.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as
      | { bug_id: number | null; content_hash: string | null; file_extension: string }
      | undefined;
    if (!attachment) return;
    const deletedPayload = this.attachmentPayload(attachmentId);
    const tx = dataDb.transaction(() => {
      this.enqueueAttachmentSyncEvent(attachmentId, 'DELETE', deletedPayload);
      dataDb.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);
      if (attachment.bug_id) {
        dataDb.prepare('UPDATE bugs SET sync_status = ?, updated_at = ? WHERE id = ?').run(this.pendingSyncStatusForBugId(attachment.bug_id), now(), attachment.bug_id);
        this.enqueueBugSyncEvent(attachment.bug_id, 'UPDATE');
      }
    });
    tx();
    this.deleteAttachmentBlobIfUnused(attachment.content_hash, attachment.file_extension);
  }

  pruneStaleAttachments(): number {
    const dataDb = this.workspaceDataDb();
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const staleAttachments = dataDb
      .prepare(
        `SELECT attachments.id, attachments.content_hash, attachments.file_extension
         FROM attachments
         INNER JOIN bugs ON bugs.id = attachments.bug_id
         WHERE bugs.status = 'Discarded'
           AND bugs.updated_at < ?
           AND attachments.content_hash IS NOT NULL
           AND attachments.content_hash != ''`
      )
      .all(cutoff) as Array<{ id: number; content_hash: string; file_extension: string }>;

    if (!staleAttachments.length) return 0;

    const groups = new Map<string, { contentHash: string; fileExtension: string; ids: number[] }>();
    staleAttachments.forEach((attachment) => {
      const key = `${attachment.content_hash}\n${attachment.file_extension}`;
      const group = groups.get(key) ?? { contentHash: attachment.content_hash, fileExtension: attachment.file_extension, ids: [] };
      group.ids.push(attachment.id);
      groups.set(key, group);
    });

    const idsToPrune: number[] = [];
    groups.forEach((group) => {
      const placeholders = group.ids.map(() => '?').join(', ');
      const remaining = dataDb
        .prepare(`SELECT COUNT(*) AS count FROM attachments WHERE content_hash = ? AND id NOT IN (${placeholders})`)
        .get(group.contentHash, ...group.ids) as { count: number };

      if (remaining.count === 0) {
        const filePath = this.resolveAttachmentPath(group.contentHash, group.fileExtension);
        try {
          if (filePath && existsSync(filePath)) unlinkSync(filePath);
        } catch {
          return;
        }
      }
      idsToPrune.push(...group.ids);
    });

    if (!idsToPrune.length) return 0;
    const stamp = now();
    const tx = dataDb.transaction((attachmentIds: number[]) => {
      const update = dataDb.prepare('UPDATE attachments SET content_hash = NULL, updated_at = ? WHERE id = ?');
      attachmentIds.forEach((attachmentId) => {
        update.run(stamp, attachmentId);
        this.enqueueAttachmentSyncEvent(attachmentId, 'UPDATE');
      });
    });
    tx(idsToPrune);
    return idsToPrune.length;
  }

  private makeTitle(note: string): string {
    const firstLine = note
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return 'Untitled bug';
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  }
}

