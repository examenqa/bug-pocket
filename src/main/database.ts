import Database from 'better-sqlite3';
import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
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
  SettingsData,
  ShortcutAction,
  ShortcutSetting,
  SyncQueueEntityType,
  SyncQueueOperation
} from '../shared/types';

const now = (): string => new Date().toISOString();

const defaultStatuses: CaptureStatus[] = ['Draft', 'Reported', 'Discarded'];
const defaultScenarioStatuses: CaptureStatus[] = [];
const defaultSeverities = ['Low', 'Medium', 'High', 'Critical'];
const defaultIssuePlatforms = ['Linear', 'Jira', 'GitHub', 'Trello', 'Google Sheet', 'Other'];
const defaultEntryTypes = ['Bug', 'Scenario', 'Question', 'Observation', 'Improvement'];
const defaultEnvironments = ['Production', 'Staging', 'QA', 'UAT', 'Development', 'Local'];
const defaultDevices = ['Desktop', 'Laptop', 'Tablet', 'Mobile', 'Other'];
const defaultBrowsers = ['Chrome', 'Edge', 'Firefox', 'Safari', 'Other'];
const referenceTables: Record<ReferenceTable, string> = {
  environment: 'environments',
  device: 'devices',
  browser: 'browsers'
};
const referenceForeignKeys: Record<ReferenceTable, string> = {
  environment: 'environment_id',
  device: 'device_id',
  browser: 'browser_id'
};
const attachmentFileNameSql =
  "CASE WHEN attachments.content_hash IS NULL OR attachments.content_hash = '' THEN 'Pruned attachment' ELSE attachments.content_hash || attachments.file_extension END AS file_name";
const defaultShortcuts: Array<Pick<ShortcutSetting, 'action' | 'label' | 'accelerator' | 'is_enabled' | 'sort_order'>> = [
  { action: 'quick_capture', label: 'Quick Capture Panel', accelerator: 'CommandOrControl+Alt+P', is_enabled: 1, sort_order: 0 },
  { action: 'main_panel', label: 'Main App Panel', accelerator: 'CommandOrControl+Alt+M', is_enabled: 1, sort_order: 1 }
];
const MAX_CAPTURE_PRESETS = 3;

const quickReportTemplate = `🚨 *[{{severity}}] {{title}}*
*Context:* {{application}} > {{module}} | {{environment}}

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
  private db: Database.Database;

  constructor() {
    const dataDir = app.getPath('userData');
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'bug-pocket.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.seedDefaults();
    try {
      this.pruneStaleAttachments();
    } catch {
      // Retention cleanup should never block app startup.
    }
  }

  get screenshotsDir(): string {
    const dir = join(app.getPath('userData'), 'attachments');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  get databasePath(): string {
    return join(app.getPath('userData'), 'bug-pocket.sqlite');
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
    const rows = this.db
      .prepare(
        `SELECT id, bug_id, parent_id, content_hash, file_extension, created_at
         FROM attachments
         WHERE content_hash IS NOT NULL AND content_hash != ''
         ORDER BY id`
      )
      .all() as Array<{
      id: number;
      bug_id: number | null;
      parent_id: number | null;
      content_hash: string;
      file_extension: string;
      created_at: string;
    }>;

    return rows.map((row) => {
      const extension = row.file_extension.startsWith('.') ? row.file_extension : `.${row.file_extension}`;
      const fileName = `${row.content_hash}${extension}`;
      return {
        ...row,
        file_extension: extension,
        file_name: fileName,
        file_path: this.resolveAttachmentPath(row.content_hash, extension)
      };
    });
  }

  checkpoint(): void {
    this.db.pragma('wal_checkpoint(FULL)');
  }

  close(): void {
    this.db.close();
  }

  resolveAttachmentPath(contentHash: string | null, fileExtension: string): string {
    if (!contentHash) return '';
    const extension = fileExtension.startsWith('.') ? fileExtension : `.${fileExtension}`;
    return join(this.screenshotsDir, `${contentHash}${extension}`);
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

      CREATE TABLE IF NOT EXISTS bugs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NULL REFERENCES applications(id) ON DELETE SET NULL,
        module_id INTEGER NULL REFERENCES modules(id) ON DELETE SET NULL,
        environment_id INTEGER NULL REFERENCES environments(id) ON DELETE SET NULL,
        device_id INTEGER NULL REFERENCES devices(id) ON DELETE SET NULL,
        browser_id INTEGER NULL REFERENCES browsers(id) ON DELETE SET NULL,
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
        application_id INTEGER NULL REFERENCES applications(id) ON DELETE RESTRICT,
        module_id INTEGER NULL REFERENCES modules(id) ON DELETE RESTRICT,
        environment_id INTEGER NULL REFERENCES environments(id) ON DELETE RESTRICT,
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
        created_at TEXT NOT NULL
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
    this.ensureColumn('bugs', 'environment_id', 'INTEGER NULL REFERENCES environments(id) ON DELETE SET NULL');
    this.ensureColumn('bugs', 'device_id', 'INTEGER NULL REFERENCES devices(id) ON DELETE SET NULL');
    this.ensureColumn('bugs', 'browser_id', 'INTEGER NULL REFERENCES browsers(id) ON DELETE SET NULL');
    this.ensureColumn('bugs', 'steps_to_reproduce', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'expected_result', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'actual_result', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('bugs', 'sync_status', "TEXT NOT NULL DEFAULT 'Local Only'");
    this.ensureColumn('bugs', 'last_sync_at', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('attachments', 'source_type', "TEXT NOT NULL DEFAULT 'snip'");
    this.ensureColumn('attachments', 'sync_status', "TEXT NOT NULL DEFAULT 'Local Only'");
    this.ensureColumn('attachments', 'last_sync_at', "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn('attachments', 'content_hash', 'TEXT NULL DEFAULT NULL');
    this.ensureColumn('attachments', 'file_extension', "TEXT NOT NULL DEFAULT '.png'");
    this.ensureColumn('attachments', 'parent_id', 'INTEGER NULL REFERENCES attachments(id) ON DELETE SET NULL');
    this.ensureColumn('sync_queue', 'local_seq', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('sync_queue', 'op_id', "TEXT NOT NULL DEFAULT ''");
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
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_sync_status ON bugs(sync_status)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_bug_id ON attachments(bug_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_content_hash ON attachments(content_hash)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue(created_at)');
    this.db.exec('DROP INDEX IF EXISTS idx_sync_queue_local_seq');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_local_seq ON sync_queue(local_seq) WHERE local_seq > 0');
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_op_id ON sync_queue(op_id) WHERE op_id != ''");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_application_id ON presets(application_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_module_id ON presets(module_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presets_environment_id ON presets(environment_id)');
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
      'ollama_model_name'
    ];

    const defaults: Record<string, string> = {
      jira_workspace_url: '',
      auto_backup_directory_path: '',
      quick_capture_annotate_screenshots: 'true',
      run_on_system_startup: 'false',
      ai_triage_enabled: 'false',
      ollama_model_name: 'qwen3-vl:8b'
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
        application_id INTEGER NULL REFERENCES applications(id) ON DELETE SET NULL,
        module_id INTEGER NULL REFERENCES modules(id) ON DELETE SET NULL,
        environment_id INTEGER NULL REFERENCES environments(id) ON DELETE SET NULL,
        device_id INTEGER NULL REFERENCES devices(id) ON DELETE SET NULL,
        browser_id INTEGER NULL REFERENCES browsers(id) ON DELETE SET NULL,
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO bugs_status_limited (
        id, application_id, module_id, environment_id, device_id, browser_id, entry_type, title, note, other_details,
        steps_to_reproduce, expected_result, actual_result, status, severity, reported, issue_platform, issue_id,
        issue_url, tags, sync_status, last_sync_at, created_at, updated_at
      )
      SELECT
        id, application_id, module_id, environment_id, device_id, browser_id, entry_type, title, note, other_details,
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
        issue_platform, issue_id, issue_url, tags, sync_status, last_sync_at, created_at, updated_at
      FROM bugs;

      DROP TABLE bugs;
      ALTER TABLE bugs_status_limited RENAME TO bugs;
    `);
  }

  private deleteAttachmentBlobIfUnused(contentHash: string | null, fileExtension: string): void {
    if (!contentHash) return;
    const remaining = this.db.prepare('SELECT COUNT(*) AS count FROM attachments WHERE content_hash = ?').get(contentHash) as { count: number };
    if (remaining.count > 0) return;
    const filePath = this.resolveAttachmentPath(contentHash, fileExtension);
    if (existsSync(filePath)) unlinkSync(filePath);
  }

  private nextLocalSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(local_seq), 0) + 1 AS next_seq FROM sync_queue').get() as { next_seq: number };
    return row.next_seq;
  }

  private enqueueSyncEvent(entityType: SyncQueueEntityType, entityId: number, operation: SyncQueueOperation, payload: unknown): void {
    this.db
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

  private shouldSyncBugPayload(payload: unknown): boolean {
    const applicationId = typeof payload === 'object' && payload !== null ? (payload as { application_id?: unknown }).application_id : null;
    return this.shouldSyncApplication(typeof applicationId === 'number' ? applicationId : null);
  }

  private shouldSyncAttachmentPayload(payload: unknown): boolean {
    const bugId = typeof payload === 'object' && payload !== null ? (payload as { bug_id?: unknown }).bug_id : null;
    if (typeof bugId !== 'number') return false;
    return this.shouldSyncBug(bugId);
  }

  private shouldSyncBug(bugId: number): boolean {
    const row = this.db.prepare('SELECT application_id FROM bugs WHERE id = ?').get(bugId) as { application_id: number | null } | undefined;
    if (!row) return false;
    return this.shouldSyncApplication(row.application_id);
  }

  private shouldSyncApplication(applicationId: number | null): boolean {
    if (applicationId == null) return true;
    const row = this.db.prepare('SELECT is_synced FROM applications WHERE id = ?').get(applicationId) as { is_synced: number } | undefined;
    return row ? row.is_synced !== 0 : false;
  }

  private bugPayload(id: number): Record<string, unknown> | null {
    return (
      (this.db
        .prepare(
          `
          SELECT bugs.*, applications.name AS application_name, modules.name AS module_name,
            environments.name AS environment, devices.name AS device, browsers.name AS browser
          FROM bugs
          LEFT JOIN applications ON applications.id = bugs.application_id
          LEFT JOIN modules ON modules.id = bugs.module_id
          LEFT JOIN environments ON environments.id = bugs.environment_id
          LEFT JOIN devices ON devices.id = bugs.device_id
          LEFT JOIN browsers ON browsers.id = bugs.browser_id
          WHERE bugs.id = ?
        `
        )
        .get(id) as Record<string, unknown> | undefined) ?? null
    );
  }

  private attachmentPayload(id: number): Record<string, unknown> | null {
    return (
      (this.db
        .prepare(`SELECT attachments.*, ${attachmentFileNameSql} FROM attachments WHERE id = ?`)
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
    templateInsert.run('Linear Format', '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nDevice: {{device}}\nBrowser: {{browser}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}', stamp, stamp);
    templateInsert.run('Jira Format', '{{title}}\n\nSummary:\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nDevice: {{device}}\nBrowser: {{browser}}\n\nSteps to Reproduce:\n{{steps}}\n\nExpected Result:\n{{expected}}\n\nActual Result:\n{{actual}}\n\nSeverity: {{severity}}\nAttachments:\n{{attachments}}', stamp, stamp);
    this.upgradeDefaultTemplatesForEnvironment(stamp);
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

  private removeLegacyShortcut(): void {
    this.db.prepare('DELETE FROM shortcut_settings WHERE action = ?').run('quick_capture_legacy');
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
      '{{title}}\n\n{{note}}\n\n{{application}} / {{module}}\nEnvironment: {{environment}}\nDevice: {{device}}\nBrowser: {{browser}}\nSeverity: {{severity}}'
    );
    templateUpdate.run(
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}',
      stamp,
      'Linear Format',
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}'
    );
    templateUpdate.run(
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nDevice: {{device}}\nBrowser: {{browser}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}',
      stamp,
      'Linear Format',
      '{{title}}\n\n{{note}}\n\nApplication: {{application}}\nModule: {{module}}\nEnvironment: {{environment}}\nSeverity: {{severity}}\nAttachments:\n{{attachments}}'
    );
  }

  getSettings(): SettingsData {
    return {
      applications: this.db.prepare('SELECT * FROM applications WHERE is_active = 1 ORDER BY name').all() as Application[],
      modules: this.db
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
      reportTemplates: this.db.prepare('SELECT * FROM report_templates ORDER BY name').all() as ReportTemplate[],
      shortcuts: this.getShortcutSettings(),
      jiraWorkspaceUrl: this.getJiraWorkspaceUrl(),
      autoBackupDirectoryPath: this.getAutoBackupDirectoryPath(),
      quickCaptureAnnotateScreenshots: this.getQuickCaptureAnnotationReview(),
      runOnSystemStartup: this.getRunOnSystemStartup(),
      aiTriageEnabled: this.getAiTriageEnabled(),
      ollamaModelName: this.getOllamaModelName(),
      presets: this.getPresets()
    };
  }

  getShortcutSettings(): ShortcutSetting[] {
    return this.db.prepare('SELECT * FROM shortcut_settings ORDER BY sort_order, label').all() as ShortcutSetting[];
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
      this.db
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get(key) as { value: string } | undefined
    )?.value ?? '';
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now());
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
           SET name = ?, application_id = ?, module_id = ?, environment_id = ?, entry_type_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(name, input.application_id, input.module_id, input.environment_id, input.entry_type_id, stamp, id);
      return this.db.prepare('SELECT * FROM presets WHERE id = ?').get(id) as CapturePreset;
    }
    this.db
      .prepare(
        `INSERT INTO presets (name, application_id, module_id, environment_id, entry_type_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, input.application_id, input.module_id, input.environment_id, input.entry_type_id, stamp, stamp);
    return this.db.prepare('SELECT * FROM presets WHERE id = last_insert_rowid()').get() as CapturePreset;
  }

  private validatePresetReferences(input: CapturePresetInput): void {
    if (input.application_id != null) this.requireExists('applications', input.application_id, 'Application');
    if (input.module_id != null) this.requireExists('modules', input.module_id, 'Module');
    if (input.environment_id != null) this.requireExists('environments', input.environment_id, 'Environment');
    if (input.entry_type_id != null) {
      const entryType = this.db.prepare("SELECT id FROM config_options WHERE id = ? AND type = 'entry_type' AND is_active = 1").get(input.entry_type_id);
      if (!entryType) throw new Error('Entry type was not found.');
    }
  }

  private requireExists(table: string, id: number, label: string): void {
    const row = this.db.prepare(`SELECT id FROM ${table} WHERE id = ? AND is_active = 1`).get(id);
    if (!row) throw new Error(`${label} was not found.`);
  }

  private assertNotUsedByPreset(column: 'application_id' | 'module_id' | 'environment_id' | 'entry_type_id', id: number): void {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM presets WHERE ${column} = ?`).get(id) as { count: number };
    if (row.count > 0) throw new Error('Cannot delete because it is currently used by an active preset. Please update or delete the preset first.');
  }

  private getOptions(type: string): ConfigOption[] {
    return this.db
      .prepare('SELECT * FROM config_options WHERE type = ? AND is_active = 1 ORDER BY sort_order, value')
      .all(type) as ConfigOption[];
  }

  private getReferenceOptions(type: ReferenceTable): ReferenceOption[] {
    const table = referenceTables[type];
    return this.db
      .prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE is_active = 1 ORDER BY sort_order, name`)
      .all() as ReferenceOption[];
  }

  private addReferenceOption(type: ReferenceTable, name: string, sortOrder?: number, stamp = now()): ReferenceOption {
    const table = referenceTables[type];
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Option value is required.');
    const existing = this.db.prepare(`SELECT * FROM ${table} WHERE name = ?`).get(cleaned) as ReferenceOption | undefined;
    if (existing) {
      this.db.prepare(`UPDATE ${table} SET is_active = 1, value = name, updated_at = ? WHERE id = ?`).run(stamp, existing.id);
      return this.db.prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE id = ?`).get(existing.id) as ReferenceOption;
    }
    const maxOrder = this.db.prepare(`SELECT COALESCE(MAX(sort_order), 0) as sort_order FROM ${table}`).get() as { sort_order: number };
    const order = sortOrder ?? maxOrder.sort_order + 1;
    this.db
      .prepare(`INSERT INTO ${table} (name, value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
      .run(cleaned, cleaned, order, stamp, stamp);
    return this.db.prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE id = last_insert_rowid()`).get() as ReferenceOption;
  }

  addEnvironment(name: string): ReferenceOption {
    return this.addReferenceOption('environment', name);
  }

  updateEnvironment(id: number, name: string): ReferenceOption {
    return this.updateReferenceOption('environment', id, name);
  }

  deleteEnvironment(id: number): void {
    this.assertNotUsedByPreset('environment_id', id);
    this.deleteReferenceOption('environment', id);
  }

  addDevice(name: string): ReferenceOption {
    return this.addReferenceOption('device', name);
  }

  updateDevice(id: number, name: string): ReferenceOption {
    return this.updateReferenceOption('device', id, name);
  }

  deleteDevice(id: number): void {
    this.deleteReferenceOption('device', id);
  }

  addBrowser(name: string): ReferenceOption {
    return this.addReferenceOption('browser', name);
  }

  updateBrowser(id: number, name: string): ReferenceOption {
    return this.updateReferenceOption('browser', id, name);
  }

  deleteBrowser(id: number): void {
    this.deleteReferenceOption('browser', id);
  }

  private updateReferenceOption(type: ReferenceTable, id: number, name: string): ReferenceOption {
    const table = referenceTables[type];
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Option value is required.');
    const duplicate = this.db.prepare(`SELECT id FROM ${table} WHERE name = ? AND id != ?`).get(cleaned, id) as { id: number } | undefined;
    if (duplicate) throw new Error('Option already exists.');
    this.db.prepare(`UPDATE ${table} SET name = ?, value = ?, updated_at = ? WHERE id = ?`).run(cleaned, cleaned, now(), id);
    return this.db.prepare(`SELECT id, name, COALESCE(NULLIF(value, ''), name) AS value, sort_order, is_active, created_at, updated_at FROM ${table} WHERE id = ?`).get(id) as ReferenceOption;
  }

  private deleteReferenceOption(type: ReferenceTable, id: number): void {
    const table = referenceTables[type];
    this.db.prepare(`UPDATE ${table} SET is_active = 0, updated_at = ? WHERE id = ?`).run(now(), id);
  }

  mergeReferenceOption(tableName: ReferenceTable | string, sourceId: number, targetId: number): void {
    const type = this.normalizeReferenceTable(tableName);
    if (sourceId === targetId) throw new Error('Choose a different target to merge into.');
    const table = referenceTables[type];
    const foreignKey = referenceForeignKeys[type];
    const source = this.db.prepare(`SELECT id, name, value FROM ${table} WHERE id = ?`).get(sourceId) as ReferenceOption | undefined;
    const target = this.db.prepare(`SELECT id, name, value FROM ${table} WHERE id = ?`).get(targetId) as ReferenceOption | undefined;
    if (!source) throw new Error('Duplicate reference item was not found.');
    if (!target) throw new Error('Canonical reference item was not found.');

    const tx = this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE bugs SET ${foreignKey} = ?, sync_status = 'Sync Pending', updated_at = ? WHERE ${foreignKey} = ?`).run(targetId, now(), sourceId);
      const presetResult = this.db.prepare(`UPDATE presets SET ${foreignKey} = ?, updated_at = ? WHERE ${foreignKey} = ?`).run(targetId, now(), sourceId);
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(sourceId);
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
    });
    tx();
  }

  private normalizeReferenceTable(tableName: ReferenceTable | string): ReferenceTable {
    const normalized = tableName.trim().toLowerCase();
    if (normalized === 'environment' || normalized === 'environments') return 'environment';
    if (normalized === 'device' || normalized === 'devices') return 'device';
    if (normalized === 'browser' || normalized === 'browsers') return 'browser';
    throw new Error('Unsupported reference table.');
  }

  addApplication(name: string, contextDescription = ''): Application {
    const cleaned = name.trim();
    const context = contextDescription.trim() || null;
    if (!cleaned) throw new Error('Application name is required.');
    const stamp = now();
    const existing = this.db.prepare('SELECT * FROM applications WHERE name = ?').get(cleaned) as Application | undefined;
    if (existing) {
      this.db.prepare('UPDATE applications SET context_description = COALESCE(?, context_description), is_active = 1, updated_at = ? WHERE id = ?').run(context, stamp, existing.id);
      return this.db.prepare('SELECT * FROM applications WHERE id = ?').get(existing.id) as Application;
    }
    this.db.prepare('INSERT INTO applications (name, context_description, is_active, is_synced, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)').run(cleaned, context, stamp, stamp);
    return this.db.prepare('SELECT * FROM applications WHERE name = ?').get(cleaned) as Application;
  }

  updateApplication(id: number, name: string, contextDescription = ''): Application {
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Application name is required.');
    const duplicate = this.db.prepare('SELECT id FROM applications WHERE name = ? AND id != ?').get(cleaned, id) as { id: number } | undefined;
    if (duplicate) throw new Error('Application already exists.');
    this.db.prepare('UPDATE applications SET name = ?, context_description = ?, updated_at = ? WHERE id = ?').run(cleaned, contextDescription.trim() || null, now(), id);
    return this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Application;
  }

  updateApplicationSync(id: number, isSynced: boolean): Application {
    this.db.prepare('UPDATE applications SET is_synced = ?, updated_at = ? WHERE id = ?').run(isSynced ? 1 : 0, now(), id);
    return this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Application;
  }

  updateApplicationContext(id: number, contextDescription: string): Application {
    this.db.prepare('UPDATE applications SET context_description = ?, updated_at = ? WHERE id = ?').run(contextDescription.trim() || null, now(), id);
    return this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Application;
  }

  deleteApplication(id: number): void {
    this.assertNotUsedByPreset('application_id', id);
    this.db.prepare('UPDATE applications SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), id);
  }

  addModule(name: string, applicationId: number | null, contextDescription = ''): Module {
    const cleaned = name.trim();
    const context = contextDescription.trim() || null;
    if (!cleaned) throw new Error('Module name is required.');
    const stamp = now();
    const existing = this.db
      .prepare('SELECT * FROM modules WHERE name = ? AND ((? IS NULL AND application_id IS NULL) OR application_id = ?) LIMIT 1')
      .get(cleaned, applicationId, applicationId) as Module | undefined;
    if (existing) {
      this.db.prepare('UPDATE modules SET context_description = COALESCE(?, context_description), is_active = 1, updated_at = ? WHERE id = ?').run(context, stamp, existing.id);
      return this.db.prepare('SELECT * FROM modules WHERE id = ?').get(existing.id) as Module;
    }
    this.db.prepare('INSERT INTO modules (application_id, name, context_description, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(applicationId, cleaned, context, stamp, stamp);
    return this.db.prepare('SELECT * FROM modules WHERE id = last_insert_rowid()').get() as Module;
  }

  updateModule(id: number, name: string, applicationId: number | null, contextDescription = ''): Module {
    const cleaned = name.trim();
    if (!cleaned) throw new Error('Module name is required.');
    const duplicate = this.db
      .prepare('SELECT id FROM modules WHERE name = ? AND ((? IS NULL AND application_id IS NULL) OR application_id = ?) AND id != ? AND is_active = 1 LIMIT 1')
      .get(cleaned, applicationId, applicationId, id) as { id: number } | undefined;
    if (duplicate) throw new Error('Module already exists for this application.');
    this.db.prepare('UPDATE modules SET application_id = ?, name = ?, context_description = ?, updated_at = ? WHERE id = ?').run(applicationId, cleaned, contextDescription.trim() || null, now(), id);
    return this.db.prepare('SELECT * FROM modules WHERE id = ?').get(id) as Module;
  }

  updateModuleContext(id: number, contextDescription: string): Module {
    this.db.prepare('UPDATE modules SET context_description = ?, updated_at = ? WHERE id = ?').run(contextDescription.trim() || null, now(), id);
    return this.db.prepare('SELECT * FROM modules WHERE id = ?').get(id) as Module;
  }

  deleteModule(id: number): void {
    this.assertNotUsedByPreset('module_id', id);
    this.db.prepare('UPDATE modules SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), id);
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
    if (filters.status && filters.status !== 'all') {
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
    return this.db
      .prepare(
        `
        SELECT bugs.*, applications.name AS application_name, modules.name AS module_name,
          environments.name AS environment, devices.name AS device, browsers.name AS browser,
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
        LEFT JOIN attachments ON attachments.bug_id = bugs.id
        ${where}
        GROUP BY bugs.id
        ORDER BY bugs.created_at DESC
      `
      )
      .all(...params) as Bug[];
  }

  getBug(id: number): BugDetails | null {
    const bug = this.db
      .prepare(
        `
        SELECT bugs.*, applications.name AS application_name, modules.name AS module_name,
          environments.name AS environment, devices.name AS device, browsers.name AS browser
        FROM bugs
        LEFT JOIN applications ON applications.id = bugs.application_id
        LEFT JOIN modules ON modules.id = bugs.module_id
        LEFT JOIN environments ON environments.id = bugs.environment_id
        LEFT JOIN devices ON devices.id = bugs.device_id
        LEFT JOIN browsers ON browsers.id = bugs.browser_id
        WHERE bugs.id = ?
      `
      )
      .get(id) as Bug | undefined;
    if (!bug) return null;
    const attachments = this.db
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
      (this.db.prepare(`SELECT attachments.*, ${attachmentFileNameSql} FROM attachments WHERE id = ?`).get(id) as Attachment | undefined) ??
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
    return this.db
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
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO bugs (entry_type, application_id, module_id, environment_id, title, note, status, severity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'Draft', 'Medium', ?, ?)`
        )
        .run(input.entry_type || 'Bug', input.application_id, input.module_id, input.environment_id, title, input.note.trim(), stamp, stamp);
      const bugId = Number(result.lastInsertRowid);
      const attach = this.db.prepare('UPDATE attachments SET bug_id = ? WHERE id = ? AND bug_id IS NULL');
      this.enqueueBugSyncEvent(bugId, 'INSERT');
      input.attachment_ids.forEach((attachmentId) => {
        attach.run(bugId, attachmentId);
        this.enqueueAttachmentSyncEvent(attachmentId, 'UPDATE');
      });
      return bugId;
    });
    return this.getBug(tx()) as Bug;
  }

  updateBug(id: number, input: BugUpdateInput): BugDetails {
    const stamp = now();
    const status = normalizeCaptureStatus(input.status);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
          UPDATE bugs SET entry_type = ?, application_id = ?, module_id = ?, title = ?, note = ?, other_details = ?,
            steps_to_reproduce = ?, expected_result = ?, actual_result = ?, environment_id = ?, device_id = ?, browser_id = ?,
            status = ?, severity = ?, reported = ?, issue_platform = ?, issue_id = ?, issue_url = ?,
            tags = ?, sync_status = 'Sync Pending', updated_at = ?
          WHERE id = ?
        `
        )
        .run(
          input.entry_type,
          input.application_id,
          input.module_id,
          input.title.trim() || this.makeTitle(input.note),
          input.note,
          input.other_details,
          input.steps_to_reproduce,
          input.expected_result,
          input.actual_result,
          input.environment_id,
          input.device_id,
          input.browser_id,
          status,
          input.severity,
          status === 'Reported' ? 1 : 0,
          input.issue_platform,
          input.issue_id,
          input.issue_url,
          input.tags,
          stamp,
          id
        );
      this.enqueueBugSyncEvent(id, 'UPDATE');
    });
    tx();
    return this.getBug(id) as BugDetails;
  }

  deleteBug(id: number): void {
    const attachments = this.db.prepare('SELECT content_hash, file_extension FROM attachments WHERE bug_id = ?').all(id) as Array<{
      content_hash: string | null;
      file_extension: string;
    }>;
    const bugPayload = this.bugPayload(id);
    const attachmentPayloads = this.db
      .prepare(`SELECT attachments.*, ${attachmentFileNameSql} FROM attachments WHERE bug_id = ?`)
      .all(id) as Array<Record<string, unknown> & { id: number }>;
    const tx = this.db.transaction(() => {
      attachmentPayloads.forEach((attachment) => this.enqueueAttachmentSyncEvent(attachment.id, 'DELETE', attachment));
      this.enqueueBugSyncEvent(id, 'DELETE', bugPayload);
      this.db.prepare('DELETE FROM attachments WHERE bug_id = ?').run(id);
      this.db.prepare('DELETE FROM bugs WHERE id = ?').run(id);
    });
    tx();
    attachments.forEach((attachment) => {
      this.deleteAttachmentBlobIfUnused(attachment.content_hash, attachment.file_extension);
    });
  }

  createAttachment(contentHash: string, fileExtension: string, mimeType = 'image/png', sourceType = 'snip'): number {
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare('INSERT INTO attachments (bug_id, content_hash, file_extension, mime_type, source_type, sync_status, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?)')
        .run(contentHash, fileExtension, mimeType, sourceType, 'Local Only', now());
      return Number(result.lastInsertRowid);
    });
    return tx();
  }

  createAnnotatedAttachment(parentId: number, contentHash: string, fileExtension: string, mimeType = 'image/png'): Attachment {
    const parent = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(parentId) as { bug_id: number | null } | undefined;
    if (!parent) throw new Error('Original attachment not found.');
    if (!parent.bug_id) throw new Error('Annotated attachments must belong to a saved entry.');
    const bugId = parent.bug_id;
    const stamp = now();
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO attachments (bug_id, parent_id, content_hash, file_extension, mime_type, source_type, sync_status, created_at)
           VALUES (?, ?, ?, ?, ?, 'annotation', 'Local Only', ?)`
        )
        .run(bugId, parentId, contentHash, fileExtension, mimeType, stamp);
      const attachmentId = Number(result.lastInsertRowid);
      this.db.prepare("UPDATE bugs SET sync_status = 'Sync Pending', updated_at = ? WHERE id = ?").run(stamp, bugId);
      this.enqueueAttachmentSyncEvent(attachmentId, 'INSERT');
      this.enqueueBugSyncEvent(bugId, 'UPDATE');
      return attachmentId;
    });
    return this.getAttachment(tx()) as Attachment;
  }

  attachScreenshotToBug(bugId: number, attachmentId: number): BugDetails {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE attachments SET bug_id = ? WHERE id = ?').run(bugId, attachmentId);
      this.db.prepare("UPDATE bugs SET sync_status = 'Sync Pending', updated_at = ? WHERE id = ?").run(now(), bugId);
      this.enqueueAttachmentSyncEvent(attachmentId, 'UPDATE');
      this.enqueueBugSyncEvent(bugId, 'UPDATE');
    });
    tx();
    return this.getBug(bugId) as BugDetails;
  }

  deleteAttachment(attachmentId: number): void {
    const attachment = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as
      | { bug_id: number | null; content_hash: string | null; file_extension: string }
      | undefined;
    if (!attachment) return;
    const deletedPayload = this.attachmentPayload(attachmentId);
    const tx = this.db.transaction(() => {
      this.enqueueAttachmentSyncEvent(attachmentId, 'DELETE', deletedPayload);
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);
      if (attachment.bug_id) {
        this.db.prepare("UPDATE bugs SET sync_status = 'Sync Pending', updated_at = ? WHERE id = ?").run(now(), attachment.bug_id);
        this.enqueueBugSyncEvent(attachment.bug_id, 'UPDATE');
      }
    });
    tx();
    this.deleteAttachmentBlobIfUnused(attachment.content_hash, attachment.file_extension);
  }

  pruneStaleAttachments(): number {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const staleAttachments = this.db
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
      const remaining = this.db
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
    const tx = this.db.transaction((attachmentIds: number[]) => {
      const update = this.db.prepare('UPDATE attachments SET content_hash = NULL WHERE id = ?');
      attachmentIds.forEach((attachmentId) => update.run(attachmentId));
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
