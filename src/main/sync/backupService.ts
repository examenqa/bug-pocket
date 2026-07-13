import Database from 'better-sqlite3';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve, sep } from 'node:path';
import type { BackupExportResult } from '../../shared/types';
import { operationBarrier } from '../OperationBarrier';

const manifestNames = ['manifest.json', 'backup-manifest.json'] as const;
const stagingDirectoryName = '.staging_restore';
const rollbackDirectoryName = '.restore_rollback';

type DatabaseRole = 'local' | 'workspace';

interface BackupManifest {
  databases: {
    local_db: string;
    workspace_db: string | null;
    current_workspace_id: string | null;
    files?: Array<{ role: DatabaseRole; path: string; workspace_id?: string | null }>;
  };
  attachment_directory?: string;
}

interface ValidatedBackup {
  manifestPath: string;
  localDatabasePath: string;
  workspaceDatabasePath: string | null;
  attachmentDirectoryPath: string;
}

export interface RestoreBackupHooks {
  beforeCommit: () => void | Promise<void>;
  afterCommit?: () => void | Promise<void>;
  beforeRollback?: () => void | Promise<void>;
}

interface SwapEntry {
  source: string;
  destination: string;
  rollback: string;
  hadLiveEntry: boolean;
}

export interface BackupArchiveSource {
  checkpoint(): void;
  getBackupDatabaseFiles(): Array<{
    archiveName: string;
    filePath: string;
    role: DatabaseRole;
    workspaceId?: string;
  }>;
  readonly screenshotsDir: string;
  listBackupAttachmentFiles(): Array<{
    id: number;
    bug_id: number | null;
    parent_id: number | null;
    content_hash: string;
    file_extension: string;
    file_name: string;
    file_path: string;
    created_at: string;
  }>;
}

export function cleanupSqliteSidecars(userDataPath: string): void {
  const entries = existsSync(userDataPath) ? readdirSync(userDataPath, { withFileTypes: true }) : [];
  entries
    .filter((entry) => entry.isFile() && (/\.sqlite-wal$/i.test(entry.name) || /\.sqlite-shm$/i.test(entry.name)))
    .forEach((entry) => {
      const filePath = join(userDataPath, entry.name);
      if (!existsSync(filePath)) return;
      try {
        unlinkSync(filePath);
      } catch {
        // Sidecar cleanup is best effort; the database reopen will surface failures.
      }
    });
}

async function createBackupArchiveInternal(
  filePath: string,
  source: BackupArchiveSource,
  tempDirectory: string
): Promise<BackupExportResult> {
  const tempDatabasePaths: string[] = [];
  try {
    source.checkpoint();
    const databaseFiles = source.getBackupDatabaseFiles();
    const archiveDatabaseFiles = databaseFiles
      .filter((file) => existsSync(file.filePath))
      .map((file) => {
        const tempPath = join(tempDirectory, `bug-pocket-temp-${file.role}-${Date.now()}-${randomUUID()}.sqlite`);
        copyFileSync(file.filePath, tempPath);
        tempDatabasePaths.push(tempPath);
        return { ...file, tempPath };
      });
    const attachmentsDir = source.screenshotsDir;
    const referencedAttachments = source.listBackupAttachmentFiles();
    const archivedAttachmentFiles = new Map<
      string,
      { fileName: string; filePath: string; contentHash: string; fileSize: number }
    >();
    referencedAttachments.forEach((attachment) => {
      if (!existsSync(attachment.file_path)) return;
      const fileStat = statSync(attachment.file_path);
      if (!fileStat.isFile()) return;
      archivedAttachmentFiles.set(attachment.file_name, {
        fileName: attachment.file_name,
        filePath: attachment.file_path,
        contentHash: attachment.content_hash,
        fileSize: fileStat.size
      });
    });

    const manifest = {
      exported_at: new Date().toISOString(),
      database: archiveDatabaseFiles.find((file) => file.role === 'workspace')?.archiveName
        ?? archiveDatabaseFiles[0]?.archiveName
        ?? 'local.sqlite',
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
        content_hash: attachment.contentHash,
        file_size: attachment.fileSize
      }))
    };
    const { ZipArchive } = (await import('archiver')) as unknown as {
      ZipArchive: new (options: { zlib: { level: number } }) => {
        append: (stream: NodeJS.ReadableStream | string | Buffer, data: { name: string }) => void;
        finalize: () => Promise<void>;
        on: (event: 'error' | 'warning', listener: (error: Error) => void) => void;
        pipe: (destination: NodeJS.WritableStream) => void;
        pointer: () => number;
      };
    };

    const result = await new Promise<BackupExportResult>((resolveResult) => {
      const output = createWriteStream(filePath);
      const archive = new ZipArchive({ zlib: { level: 9 } });
      let settled = false;
      const finish = (value: BackupExportResult): void => {
        if (settled) return;
        settled = true;
        resolveResult(value);
      };
      const fail = (error: Error): void => finish({
        success: false,
        filePath,
        error: error.message || 'Backup export failed.'
      });

      output.on('close', () => finish({ success: true, filePath, bytesWritten: archive.pointer() }));
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
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      void archive.finalize().catch(fail);
    });

    if (!result.success && existsSync(filePath)) rmSync(filePath, { force: true });
    return result;
  } catch (error) {
    if (existsSync(filePath)) rmSync(filePath, { force: true });
    return {
      success: false,
      filePath,
      error: error instanceof Error ? error.message : 'Backup export failed.'
    };
  } finally {
    tempDatabasePaths.forEach((tempPath) => rmSync(tempPath, { force: true }));
  }
}

export function createBackupArchive(
  filePath: string,
  source: BackupArchiveSource,
  tempDirectory: string
): Promise<BackupExportResult> {
  return operationBarrier.acquire(createBackupArchiveInternal(filePath, source, tempDirectory));
}

function validateArchivePath(rawPath: string, stagingPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/');
  const isDirectory = normalized.endsWith('/');
  const pathWithoutTrailingSlash = isDirectory ? normalized.slice(0, -1) : normalized;
  const parts = pathWithoutTrailingSlash.split('/');
  if (
    !pathWithoutTrailingSlash ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Backup archive contains an unsafe path: '${rawPath}'.`);
  }

  const resolvedTarget = resolve(stagingPath, ...parts);
  const stagingRoot = resolve(stagingPath);
  if (resolvedTarget !== stagingRoot && !resolvedTarget.startsWith(`${stagingRoot}${sep}`)) {
    throw new Error(`Backup archive path escapes the staging directory: '${rawPath}'.`);
  }
  return parts.join('/');
}

function validateManifestFileName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Backup manifest is missing ${label}.`);
  const cleaned = value.trim();
  if (basename(cleaned) !== cleaned || cleaned.includes('/') || cleaned.includes('\\') || cleaned === '.' || cleaned === '..') {
    throw new Error(`Backup manifest contains an unsafe ${label} path.`);
  }
  return cleaned;
}

function readAndValidateManifest(stagingPath: string, archiveEntries: Set<string>): ValidatedBackup {
  const presentManifestNames = manifestNames.filter((candidate) => archiveEntries.has(candidate));
  if (!presentManifestNames.length) throw new Error('Backup archive is missing manifest.json.');
  if (presentManifestNames.length !== 1) throw new Error('Backup archive contains multiple manifests.');
  const manifestName = presentManifestNames[0];

  const manifestPath = join(stagingPath, manifestName);
  let parsed: BackupManifest;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
  } catch {
    throw new Error('Backup manifest is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.databases || typeof parsed.databases !== 'object') {
    throw new Error('Backup manifest is missing its database map.');
  }

  const localDatabaseName = validateManifestFileName(parsed.databases.local_db, 'local database');
  if (localDatabaseName !== 'local.sqlite') throw new Error("Backup local database must be named 'local.sqlite'.");

  const workspaceId = typeof parsed.databases.current_workspace_id === 'string'
    ? parsed.databases.current_workspace_id.trim()
    : '';
  if (workspaceId && (!/^[a-zA-Z0-9_.-]+$/.test(workspaceId) || workspaceId.includes('..'))) {
    throw new Error('Backup manifest contains an invalid workspace ID.');
  }

  let workspaceDatabaseName: string | null = null;
  if (parsed.databases.workspace_db != null) {
    workspaceDatabaseName = validateManifestFileName(parsed.databases.workspace_db, 'workspace database');
    if (!workspaceId) throw new Error('Backup manifest has a workspace database without a workspace ID.');
    const expectedName = `ws_${workspaceId}.sqlite`;
    if (workspaceDatabaseName !== expectedName) {
      throw new Error(`Backup workspace database must be named '${expectedName}'.`);
    }
  } else if (workspaceId) {
    throw new Error('Backup manifest has a workspace ID without a workspace database.');
  }

  const attachmentDirectory = parsed.attachment_directory ?? 'attachments';
  if (attachmentDirectory !== 'attachments') throw new Error("Backup attachment directory must be 'attachments'.");

  const expectedDatabaseNames = new Set([localDatabaseName]);
  if (workspaceDatabaseName) expectedDatabaseNames.add(workspaceDatabaseName);
  if (Array.isArray(parsed.databases.files)) {
    for (const file of parsed.databases.files) {
      if (!file || (file.role !== 'local' && file.role !== 'workspace')) {
        throw new Error('Backup manifest contains an invalid database role.');
      }
      const fileName = validateManifestFileName(file.path, `${file.role} database`);
      if (!expectedDatabaseNames.has(fileName)) throw new Error(`Backup manifest declares an unexpected database '${fileName}'.`);
    }
  }

  for (const entry of archiveEntries) {
    if (manifestNames.includes(entry as (typeof manifestNames)[number])) continue;
    if (expectedDatabaseNames.has(entry)) continue;
    if (entry === 'attachments') continue;
    if (entry.startsWith('attachments/')) {
      const fileName = entry.slice('attachments/'.length);
      if (!fileName || fileName.includes('/') || fileName === '.' || fileName === '..') {
        throw new Error(`Backup archive contains an invalid attachment path: '${entry}'.`);
      }
      continue;
    }
    throw new Error(`Backup archive contains an undeclared file: '${entry}'.`);
  }

  for (const databaseName of expectedDatabaseNames) {
    if (!archiveEntries.has(databaseName)) throw new Error(`Backup archive is missing '${databaseName}'.`);
  }

  const attachmentDirectoryPath = join(stagingPath, 'attachments');
  mkdirSync(attachmentDirectoryPath, { recursive: true });
  return {
    manifestPath,
    localDatabasePath: join(stagingPath, localDatabaseName),
    workspaceDatabasePath: workspaceDatabaseName ? join(stagingPath, workspaceDatabaseName) : null,
    attachmentDirectoryPath
  };
}

function assertSqliteIntegrity(databasePath: string): void {
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    throw new Error(`Backup database '${basename(databasePath)}' is missing.`);
  }

  let connection: Database.Database | null = null;
  try {
    connection = new Database(databasePath, { readonly: true, fileMustExist: true });
    const rows = connection.pragma('integrity_check') as Array<Record<string, unknown>>;
    const results = rows.flatMap((row) => Object.values(row)).map((value) => String(value).toLowerCase());
    if (results.length !== 1 || results[0] !== 'ok') {
      throw new Error(`SQLite integrity check failed for '${basename(databasePath)}': ${results.join('; ') || 'no result'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/integrity check failed/i.test(message)) throw error;
    throw new Error(`SQLite integrity check failed for '${basename(databasePath)}': ${message}`);
  } finally {
    connection?.close();
  }
}

function rollbackSwap(entries: SwapEntry[]): void {
  for (const entry of [...entries].reverse()) {
    if (existsSync(entry.destination)) rmSync(entry.destination, { recursive: true, force: true });
    if (entry.hadLiveEntry && existsSync(entry.rollback)) renameSync(entry.rollback, entry.destination);
  }
}

async function commitValidatedBackup(
  validated: ValidatedBackup,
  stagingPath: string,
  userDataPath: string,
  hooks: RestoreBackupHooks
): Promise<void> {
  const rollbackPath = join(userDataPath, rollbackDirectoryName);
  rmSync(rollbackPath, { recursive: true, force: true });
  mkdirSync(rollbackPath, { recursive: true });

  const entries: SwapEntry[] = [
    {
      source: validated.localDatabasePath,
      destination: join(userDataPath, 'local.sqlite'),
      rollback: join(rollbackPath, 'local.sqlite'),
      hadLiveEntry: false
    },
    {
      source: validated.attachmentDirectoryPath,
      destination: join(userDataPath, 'attachments'),
      rollback: join(rollbackPath, 'attachments'),
      hadLiveEntry: false
    },
    {
      source: validated.manifestPath,
      destination: join(userDataPath, 'manifest.json'),
      rollback: join(rollbackPath, 'manifest.json'),
      hadLiveEntry: false
    }
  ];
  if (validated.workspaceDatabasePath) {
    const workspaceName = basename(validated.workspaceDatabasePath);
    entries.splice(1, 0, {
      source: validated.workspaceDatabasePath,
      destination: join(userDataPath, workspaceName),
      rollback: join(rollbackPath, workspaceName),
      hadLiveEntry: false
    });
  }

  await hooks.beforeCommit();
  cleanupSqliteSidecars(userDataPath);
  const movedEntries: SwapEntry[] = [];
  try {
    for (const entry of entries) {
      entry.hadLiveEntry = existsSync(entry.destination);
      if (entry.hadLiveEntry) renameSync(entry.destination, entry.rollback);
      movedEntries.push(entry);
      renameSync(entry.source, entry.destination);
    }
    await hooks.afterCommit?.();
    rmSync(rollbackPath, { recursive: true, force: true });
  } catch (error) {
    await hooks.beforeRollback?.();
    rollbackSwap(movedEntries);
    rmSync(rollbackPath, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(stagingPath, { recursive: true, force: true });
  }
}

async function restoreBackupArchiveInternal(
  backupPath: string,
  userDataPath: string,
  hooks: RestoreBackupHooks
): Promise<void> {
  const stagingPath = join(userDataPath, stagingDirectoryName);
  rmSync(stagingPath, { recursive: true, force: true });
  mkdirSync(stagingPath, { recursive: true });

  try {
    const extractZipModule = (await import('extract-zip')) as unknown as {
      default?: (
        zipPath: string,
        options: { dir: string; onEntry?: (entry: { fileName: string; externalFileAttributes: number }) => void }
      ) => Promise<void>;
    } & ((
      zipPath: string,
      options: { dir: string; onEntry?: (entry: { fileName: string; externalFileAttributes: number }) => void }
    ) => Promise<void>);
    const extractZip = extractZipModule.default ?? extractZipModule;
    if (typeof extractZip !== 'function') throw new Error('Backup extractor could not be loaded.');

    const archiveEntries = new Set<string>();
    await extractZip(backupPath, {
      dir: stagingPath,
      onEntry: (entry) => {
        const normalizedPath = validateArchivePath(entry.fileName, stagingPath);
        const mode = (entry.externalFileAttributes >> 16) & 0xffff;
        if ((mode & 0xf000) === 0xa000) throw new Error(`Backup archive contains a symbolic link: '${entry.fileName}'.`);
        archiveEntries.add(normalizedPath);
      }
    });

    const validated = readAndValidateManifest(stagingPath, archiveEntries);
    assertSqliteIntegrity(validated.localDatabasePath);
    if (validated.workspaceDatabasePath) assertSqliteIntegrity(validated.workspaceDatabasePath);
    await commitValidatedBackup(validated, stagingPath, userDataPath, hooks);
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

export function restoreBackupArchive(
  backupPath: string,
  userDataPath: string,
  hooks: RestoreBackupHooks
): Promise<void> {
  return operationBarrier.acquire(restoreBackupArchiveInternal(backupPath, userDataPath, hooks));
}
