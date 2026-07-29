import assert from 'node:assert/strict';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createBackupArchive, restoreBackupArchive, type BackupArchiveSource } from './backupService';

interface ArchiveEntry {
  name: string;
  bytes: Buffer;
}

async function writeBackupArchive(archivePath: string, entries: ArchiveEntry[]): Promise<void> {
  const { ZipArchive } = (await import('archiver')) as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => {
      append: (source: Buffer, data: { name: string }) => void;
      finalize: () => Promise<void>;
      on: (event: 'error', listener: (error: Error) => void) => void;
      pipe: (destination: NodeJS.WritableStream) => void;
    };
  };

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    entries.forEach((entry) => archive.append(entry.bytes, { name: entry.name }));
    void archive.finalize().catch(reject);
  });
}

function readSentinel(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return (database.prepare('SELECT value FROM sentinel').get() as { value: string }).value;
  } finally {
    database.close();
  }
}

function createSqliteFixture(databasePath: string, value: string): Buffer {
  const database = new Database(databasePath);
  database.exec('CREATE TABLE sentinel (value TEXT NOT NULL)');
  database.prepare('INSERT INTO sentinel (value) VALUES (?)').run(value);
  database.close();
  return readFileSync(databasePath);
}

function dualDatabaseManifest(): Record<string, unknown> {
  return {
    databases: {
      local_db: 'local.sqlite',
      workspace_db: 'ws_test.sqlite',
      current_workspace_id: 'test',
      files: [
        { role: 'local', path: 'local.sqlite', workspace_id: null },
        { role: 'workspace', path: 'ws_test.sqlite', workspace_id: 'test' }
      ]
    },
    attachment_directory: 'attachments'
  };
}

test('corrupted staged backup is rejected without replacing either live database', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-transactional-restore-'));
  const localPath = join(dataDir, 'local.sqlite');
  const workspacePath = join(dataDir, 'ws_test.sqlite');
  const backupPath = join(dataDir, 'corrupted.bugpocket');
  const corruptWorkspaceBytes = Buffer.from('this is a truncated and invalid SQLite database', 'utf8');

  try {
    const localDb = new Database(localPath);
    localDb.exec("CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES ('live-local-data');");
    localDb.close();

    const workspaceDb = new Database(workspacePath);
    workspaceDb.exec("CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES ('live-workspace-data');");
    workspaceDb.close();
    const originalLocalBytes = readFileSync(localPath);
    const originalWorkspaceBytes = readFileSync(workspacePath);

    await writeBackupArchive(backupPath, [
      { name: 'local.sqlite', bytes: originalLocalBytes },
      { name: 'ws_test.sqlite', bytes: corruptWorkspaceBytes },
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(dualDatabaseManifest()), 'utf8') }
    ]);

    let beforeCommitCalled = false;
    await assert.rejects(
      restoreBackupArchive(backupPath, dataDir, {
        beforeCommit: () => {
          beforeCommitCalled = true;
        }
      }),
      /integrity check failed.*ws_test\.sqlite/i
    );

    assert.equal(beforeCommitCalled, false, 'live database handles must remain open when staging validation fails');
    assert.deepEqual(readFileSync(localPath), originalLocalBytes);
    assert.deepEqual(readFileSync(workspacePath), originalWorkspaceBytes);
    assert.equal(readSentinel(localPath), 'live-local-data');
    assert.equal(readSentinel(workspacePath), 'live-workspace-data');
    assert.equal(existsSync(join(dataDir, '.staging_restore')), false, 'failed staging directories must be removed');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('validated databases replace live files only after beforeCommit and survive post-commit validation', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-valid-restore-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'bug-pocket-valid-restore-source-'));
  const localPath = join(dataDir, 'local.sqlite');
  const workspacePath = join(dataDir, 'ws_test.sqlite');
  const backupPath = join(dataDir, 'valid.bugpocket');

  try {
    createSqliteFixture(localPath, 'old-local');
    createSqliteFixture(workspacePath, 'old-workspace');
    const replacementLocal = createSqliteFixture(join(sourceDir, 'local.sqlite'), 'new-local');
    const replacementWorkspace = createSqliteFixture(join(sourceDir, 'ws_test.sqlite'), 'new-workspace');
    await writeBackupArchive(backupPath, [
      { name: 'local.sqlite', bytes: replacementLocal },
      { name: 'ws_test.sqlite', bytes: replacementWorkspace },
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(dualDatabaseManifest()), 'utf8') }
    ]);

    let beforeCommitCalled = false;
    let afterCommitCalled = false;
    await restoreBackupArchive(backupPath, dataDir, {
      beforeCommit: () => {
        beforeCommitCalled = true;
        assert.equal(readSentinel(localPath), 'old-local');
        assert.equal(readSentinel(workspacePath), 'old-workspace');
      },
      afterCommit: () => {
        afterCommitCalled = true;
        assert.equal(readSentinel(localPath), 'new-local');
        assert.equal(readSentinel(workspacePath), 'new-workspace');
      }
    });

    assert.equal(beforeCommitCalled, true);
    assert.equal(afterCommitCalled, true);
    assert.equal(readSentinel(localPath), 'new-local');
    assert.equal(readSentinel(workspacePath), 'new-workspace');
    assert.equal(existsSync(join(dataDir, '.staging_restore')), false);
    assert.equal(existsSync(join(dataDir, '.restore_rollback')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('post-commit failure rolls both databases back to their original bytes', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-rollback-restore-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'bug-pocket-rollback-source-'));
  const localPath = join(dataDir, 'local.sqlite');
  const workspacePath = join(dataDir, 'ws_test.sqlite');
  const backupPath = join(dataDir, 'rollback.bugpocket');

  try {
    const originalLocal = createSqliteFixture(localPath, 'old-local');
    const originalWorkspace = createSqliteFixture(workspacePath, 'old-workspace');
    const replacementLocal = createSqliteFixture(join(sourceDir, 'local.sqlite'), 'new-local');
    const replacementWorkspace = createSqliteFixture(join(sourceDir, 'ws_test.sqlite'), 'new-workspace');
    await writeBackupArchive(backupPath, [
      { name: 'local.sqlite', bytes: replacementLocal },
      { name: 'ws_test.sqlite', bytes: replacementWorkspace },
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(dualDatabaseManifest()), 'utf8') }
    ]);

    let rollbackHookCalled = false;
    await assert.rejects(
      restoreBackupArchive(backupPath, dataDir, {
        beforeCommit: () => {},
        afterCommit: () => {
          throw new Error('simulated database reopen failure');
        },
        beforeRollback: () => {
          rollbackHookCalled = true;
        }
      }),
      /simulated database reopen failure/
    );

    assert.equal(rollbackHookCalled, true);
    assert.deepEqual(readFileSync(localPath), originalLocal);
    assert.deepEqual(readFileSync(workspacePath), originalWorkspace);
    assert.equal(readSentinel(localPath), 'old-local');
    assert.equal(readSentinel(workspacePath), 'old-workspace');
    assert.equal(existsSync(join(dataDir, '.staging_restore')), false);
    assert.equal(existsSync(join(dataDir, '.restore_rollback')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('manifest path traversal is rejected before the live lifecycle begins', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-manifest-traversal-'));
  const localPath = join(dataDir, 'local.sqlite');
  const backupPath = join(dataDir, 'traversal.bugpocket');

  try {
    const localDb = new Database(localPath);
    localDb.exec("CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES ('untouched');");
    localDb.close();
    const originalLocalBytes = readFileSync(localPath);

    const manifest = {
      databases: {
        local_db: '../local.sqlite',
        workspace_db: null,
        current_workspace_id: null
      },
      attachment_directory: 'attachments'
    };
    await writeBackupArchive(backupPath, [
      { name: 'local.sqlite', bytes: originalLocalBytes },
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest), 'utf8') }
    ]);

    let beforeCommitCalled = false;
    await assert.rejects(
      restoreBackupArchive(backupPath, dataDir, {
        beforeCommit: () => {
          beforeCommitCalled = true;
        }
      }),
      /unsafe local database path/i
    );
    assert.equal(beforeCommitCalled, false);
    assert.deepEqual(readFileSync(localPath), originalLocalBytes);
    assert.equal(readSentinel(localPath), 'untouched');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('active workspace backup excludes attachments referenced only by an inactive workspace', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-cross-workspace-backup-'));
  const inspectDir = mkdtempSync(join(tmpdir(), 'bug-pocket-cross-workspace-inspect-'));
  const localPath = join(dataDir, 'local.sqlite');
  const workspaceAPath = join(dataDir, 'ws_A.sqlite');
  const workspaceBPath = join(dataDir, 'ws_B.sqlite');
  const attachmentsDir = join(dataDir, 'attachments');
  const backupPath = join(dataDir, 'workspace-A.bugpocket');

  try {
    createSqliteFixture(localPath, 'local');
    mkdirSync(attachmentsDir, { recursive: true });
    writeFileSync(join(attachmentsDir, 'file_A.png'), Buffer.from('workspace A image'));
    writeFileSync(join(attachmentsDir, 'file_B.png'), Buffer.from('workspace B image'));

    for (const [databasePath, fileName] of [[workspaceAPath, 'file_A.png'], [workspaceBPath, 'file_B.png']] as const) {
      const workspaceDb = new Database(databasePath);
      workspaceDb.exec(`
        CREATE TABLE attachments (
          id INTEGER PRIMARY KEY,
          bug_id INTEGER NULL,
          parent_id INTEGER NULL,
          content_hash TEXT NOT NULL,
          file_extension TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      workspaceDb.prepare(
        'INSERT INTO attachments (id, bug_id, parent_id, content_hash, file_extension, created_at) VALUES (1, NULL, NULL, ?, ?, ?)'
      ).run(fileName.replace(/\.png$/, ''), '.png', new Date().toISOString());
      workspaceDb.close();
    }

    const activeWorkspaceId = 'A';
    const source: BackupArchiveSource = {
      checkpoint: () => {},
      getBackupDatabaseFiles: () => [
        { archiveName: 'local.sqlite', filePath: localPath, role: 'local' },
        { archiveName: 'ws_A.sqlite', filePath: workspaceAPath, role: 'workspace', workspaceId: activeWorkspaceId }
      ],
      screenshotsDir: attachmentsDir,
      listBackupAttachmentFiles: () => {
        const activeDb = new Database(workspaceAPath, { readonly: true, fileMustExist: true });
        try {
          return (activeDb.prepare('SELECT * FROM attachments').all() as Array<{
            id: number;
            bug_id: number | null;
            parent_id: number | null;
            content_hash: string;
            file_extension: string;
            created_at: string;
          }>).map((attachment) => ({
            ...attachment,
            file_name: `${attachment.content_hash}${attachment.file_extension}`,
            file_path: join(attachmentsDir, `${attachment.content_hash}${attachment.file_extension}`)
          }));
        } finally {
          activeDb.close();
        }
      }
    };

    const result = await createBackupArchive(backupPath, source, dataDir);
    assert.equal(result.success, true, result.error);

    const extractZipModule = (await import('extract-zip')) as unknown as {
      default?: (zipPath: string, options: { dir: string }) => Promise<void>;
    } & ((zipPath: string, options: { dir: string }) => Promise<void>);
    const extractZip = extractZipModule.default ?? extractZipModule;
    await extractZip(backupPath, { dir: inspectDir });

    assert.equal(existsSync(join(inspectDir, 'ws_A.sqlite')), true);
    assert.equal(existsSync(join(inspectDir, 'ws_B.sqlite')), false, 'the inactive workspace database itself is scoped out');
    assert.equal(existsSync(join(inspectDir, 'attachments', 'file_A.png')), true);
    assert.equal(
      existsSync(join(inspectDir, 'attachments', 'file_B.png')),
      false,
      'workspace B attachment bytes must not appear in workspace A backup'
    );

    const manifest = JSON.parse(readFileSync(join(inspectDir, 'manifest.json'), 'utf8')) as {
      archived_attachments: Array<{ file_name: string; content_hash: string; file_size: number }>;
    };
    assert.deepEqual(manifest.archived_attachments, [
      {
        file_name: 'file_A.png',
        content_hash: 'file_A',
        file_size: Buffer.byteLength('workspace A image')
      }
    ]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(inspectDir, { recursive: true, force: true });
  }
});

test('restore replaces only manifest-declared attachments and preserves unrelated workspace blobs', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-attachment-restore-scope-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'bug-pocket-attachment-restore-source-'));
  const localPath = join(dataDir, 'local.sqlite');
  const workspacePath = join(dataDir, 'ws_test.sqlite');
  const backupPath = join(dataDir, 'scoped-attachments.bugpocket');
  const attachmentsDir = join(dataDir, 'attachments');
  const restoredHash = 'a'.repeat(64);
  const unrelatedHash = 'b'.repeat(64);
  const restoredName = `${restoredHash}.png`;
  const unrelatedName = `${unrelatedHash}.png`;
  const replacementBytes = Buffer.from('restored workspace A attachment', 'utf8');
  const unrelatedBytes = Buffer.from('workspace B attachment must survive', 'utf8');

  try {
    createSqliteFixture(localPath, 'old-local');
    createSqliteFixture(workspacePath, 'old-workspace');
    const replacementLocal = createSqliteFixture(join(sourceDir, 'local.sqlite'), 'new-local');
    const replacementWorkspace = createSqliteFixture(join(sourceDir, 'ws_test.sqlite'), 'new-workspace');
    mkdirSync(attachmentsDir, { recursive: true });
    writeFileSync(join(attachmentsDir, restoredName), Buffer.from('old workspace A attachment', 'utf8'));
    writeFileSync(join(attachmentsDir, unrelatedName), unrelatedBytes);

    const manifest = {
      ...dualDatabaseManifest(),
      archived_attachments: [
        { file_name: restoredName, content_hash: restoredHash, file_size: replacementBytes.length }
      ]
    };
    await writeBackupArchive(backupPath, [
      { name: 'local.sqlite', bytes: replacementLocal },
      { name: 'ws_test.sqlite', bytes: replacementWorkspace },
      { name: `attachments/${restoredName}`, bytes: replacementBytes },
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest), 'utf8') }
    ]);

    await restoreBackupArchive(backupPath, dataDir, { beforeCommit: () => {} });

    assert.deepEqual(readFileSync(join(attachmentsDir, restoredName)), replacementBytes);
    assert.deepEqual(
      readFileSync(join(attachmentsDir, unrelatedName)),
      unrelatedBytes,
      'restore must not replace the shared attachments directory'
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('restore rollback restores touched attachment files and leaves unrelated blobs intact', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-attachment-restore-rollback-'));
  const sourceDir = mkdtempSync(join(tmpdir(), 'bug-pocket-attachment-restore-rollback-source-'));
  const localPath = join(dataDir, 'local.sqlite');
  const workspacePath = join(dataDir, 'ws_test.sqlite');
  const backupPath = join(dataDir, 'scoped-attachments-rollback.bugpocket');
  const attachmentsDir = join(dataDir, 'attachments');
  const restoredHash = 'c'.repeat(64);
  const unrelatedHash = 'd'.repeat(64);
  const restoredName = `${restoredHash}.webp`;
  const unrelatedName = `${unrelatedHash}.jpg`;
  const originalBytes = Buffer.from('original restored attachment', 'utf8');
  const replacementBytes = Buffer.from('replacement restored attachment', 'utf8');
  const unrelatedBytes = Buffer.from('unrelated workspace attachment', 'utf8');

  try {
    createSqliteFixture(localPath, 'old-local');
    createSqliteFixture(workspacePath, 'old-workspace');
    const replacementLocal = createSqliteFixture(join(sourceDir, 'local.sqlite'), 'new-local');
    const replacementWorkspace = createSqliteFixture(join(sourceDir, 'ws_test.sqlite'), 'new-workspace');
    mkdirSync(attachmentsDir, { recursive: true });
    writeFileSync(join(attachmentsDir, restoredName), originalBytes);
    writeFileSync(join(attachmentsDir, unrelatedName), unrelatedBytes);

    const manifest = {
      ...dualDatabaseManifest(),
      archived_attachments: [
        { file_name: restoredName, content_hash: restoredHash, file_size: replacementBytes.length }
      ]
    };
    await writeBackupArchive(backupPath, [
      { name: 'local.sqlite', bytes: replacementLocal },
      { name: 'ws_test.sqlite', bytes: replacementWorkspace },
      { name: `attachments/${restoredName}`, bytes: replacementBytes },
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest), 'utf8') }
    ]);

    await assert.rejects(
      restoreBackupArchive(backupPath, dataDir, {
        beforeCommit: () => {},
        afterCommit: () => {
          throw new Error('simulated reopen failure after attachment swap');
        }
      }),
      /simulated reopen failure/
    );

    assert.deepEqual(readFileSync(join(attachmentsDir, restoredName)), originalBytes);
    assert.deepEqual(readFileSync(join(attachmentsDir, unrelatedName)), unrelatedBytes);
    assert.equal(existsSync(join(dataDir, '.restore_rollback')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('restore rejects malformed attachment hashes before touching live files', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-malformed-attachment-manifest-'));
  const localPath = join(dataDir, 'local.sqlite');
  const workspacePath = join(dataDir, 'ws_test.sqlite');
  const backupPath = join(dataDir, 'malformed-attachment.bugpocket');
  const attachmentBytes = Buffer.from('malformed attachment fixture', 'utf8');

  try {
    const localBytes = createSqliteFixture(localPath, 'old-local');
    const workspaceBytes = createSqliteFixture(workspacePath, 'old-workspace');
    const manifest = {
      ...dualDatabaseManifest(),
      archived_attachments: [
        { file_name: 'not-a-sha256.png', content_hash: 'not-a-sha256', file_size: attachmentBytes.length }
      ]
    };
    await writeBackupArchive(backupPath, [
      { name: 'local.sqlite', bytes: localBytes },
      { name: 'ws_test.sqlite', bytes: workspaceBytes },
      { name: 'attachments/not-a-sha256.png', bytes: attachmentBytes },
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest), 'utf8') }
    ]);

    let beforeCommitCalled = false;
    await assert.rejects(
      restoreBackupArchive(backupPath, dataDir, {
        beforeCommit: () => {
          beforeCommitCalled = true;
        }
      }),
      /expected exactly 64 hexadecimal SHA-256 characters/i
    );
    assert.equal(beforeCommitCalled, false);
    assert.equal(readSentinel(localPath), 'old-local');
    assert.equal(readSentinel(workspacePath), 'old-workspace');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
