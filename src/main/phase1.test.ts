import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync, createWriteStream, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createBackupArchive, restoreBackupArchive } from './sync/backupService';
import { BugPocketDatabase } from './database';

const hash = 'a'.repeat(64);
const input = (note: string, attachment_ids: number[] = []) => ({ entry_type: 'Bug', application_id: null, module_id: null, environment_id: null, user_role_id: null, note, attachment_ids });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'bug-pocket-phase1-'));
  const db = new BugPocketDatabase(dir);
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('deleting a workspace attachment preserves a local reference to the same blob', () => {
  const f = fixture();
  try {
    const local = f.db.createAttachment(hash, '.png');
    const file = f.db.resolveAttachmentPath(hash, '.png');
    writeFileSync(file, 'image');
    f.db.connectToWorkspace('test');
    const remote = f.db.createAttachment(hash, '.png');
    f.db.deleteAttachment(remote);
    assert.equal(existsSync(file), true);
    f.db.connectToWorkspace('');
    assert.ok(f.db.getAttachment(local));
    f.db.deleteAttachment(local);
    assert.equal(existsSync(file), false);
  } finally { f.close(); }
});

test('modern local-only restore keeps reports writable in local.sqlite', () => {
  const f = fixture();
  try {
    const bug = f.db.createQuickBug(input('local report'));
    writeFileSync(join(f.dir, 'manifest.json'), JSON.stringify({ databases: { local_db: 'local.sqlite', workspace_db: null, current_workspace_id: null } }));
    f.db.applyAfterRestorePatch();
    assert.equal(f.db.getCurrentWorkspaceId(), null);
    assert.equal(f.db.getWorkspacePermissions(null).canWrite, true);
    assert.equal(f.db.getBug(bug.id)?.note, 'local report');
    f.db.applyAfterRestorePatch();
    assert.equal(f.db.getBug(bug.id)?.note, 'local report');
  } finally { f.close(); }
});

function native(db: BugPocketDatabase): Database.Database {
  const exposed = db as unknown as { localDb: Database.Database; workspaceDb: Database.Database | null };
  return exposed.workspaceDb ?? exposed.localDb;
}

for (const deletion of ['attachment', 'bug'] as const) {
  test(deletion + ' deletion preserves inactive workspace/annotation references until the last one', () => {
    const f = fixture();
    try {
      f.db.connectToWorkspace('first');
      const original = f.db.createAttachment(hash, '.png');
      const report = f.db.createQuickBug(input('workspace report', [original]));
      const annotation = f.db.createAnnotatedAttachment(original, hash, '.png');
      const file = f.db.resolveAttachmentPath(hash, '.png');
      writeFileSync(file, 'shared image');
      f.db.connectToWorkspace('second');
      const second = f.db.createAttachment(hash, '.png');
      f.db.connectToWorkspace('');
      const local = f.db.createAttachment(hash, '.png');
      const localBug = f.db.createQuickBug(input('local report', [local]));
      if (deletion === 'attachment') f.db.deleteAttachment(local); else f.db.deleteBug(localBug.id);
      assert.equal(existsSync(file), true);
      f.db.connectToWorkspace('first');
      f.db.deleteAttachment(original);
      assert.equal(existsSync(file), true, 'annotation still owns the shared bytes');
      assert.ok(f.db.getAttachment(annotation.id));
      f.db.deleteBug(report.id);
      assert.equal(existsSync(file), true, 'second workspace is inactive but still owns the bytes');
      f.db.connectToWorkspace('second');
      assert.ok(f.db.getAttachment(second));
      f.db.deleteAttachment(second);
      assert.equal(existsSync(file), false);
    } finally { f.close(); }
  });
}

test('unreadable database makes garbage collection fail closed', () => {
  const f = fixture();
  try {
    const id = f.db.createAttachment(hash, '.png');
    const file = f.db.resolveAttachmentPath(hash, '.png');
    writeFileSync(file, 'image');
    writeFileSync(join(f.dir, 'ws_broken.sqlite'), 'not sqlite');
    f.db.deleteAttachment(id);
    assert.equal(existsSync(file), true);
  } finally { f.close(); }
});

for (const action of ['clear', 'cancel'] as const) {
  test('capture -> ' + action + ' removes only proven pending records, preserving shared and legacy ownership', () => {
    const f = fixture();
    try {
      const legacy = f.db.createAttachment(hash, '.png');
      const pending = f.db.createAttachment(hash, '.png', 'image/png', 'snip', true);
      const file = f.db.resolveAttachmentPath(hash, '.png');
      writeFileSync(file, 'image');
      assert.equal(f.db.listPendingCaptures().length, 1);
      f.db.discardPendingCaptures(); // Both main-process clear/cancel entry points use this operation.
      assert.equal(f.db.getAttachment(pending), null);
      assert.ok(f.db.getAttachment(legacy));
      assert.equal(existsSync(file), true);
      f.db.deleteAttachment(legacy);
      assert.equal(existsSync(file), false);
    } finally { f.close(); }
  });
}

test('capture -> failed save retains the pending screenshot; successful retry promotes it atomically', () => {
  const f = fixture();
  try {
    const pending = f.db.createAttachment(hash, '.png', 'image/png', 'snip', true);
    writeFileSync(f.db.resolveAttachmentPath(hash, '.png'), 'image');
    assert.throws(() => f.db.createQuickBug(input('failed', [pending, 999999])), /no longer available/);
    assert.equal(f.db.getTotalBugCount(), 0, 'failed transaction does not leave a partial report');
    assert.equal(f.db.listPendingCaptures().length, 1);
    const saved = f.db.createQuickBug(input('successful', [pending]));
    assert.equal(f.db.listPendingCaptures().length, 0);
    assert.equal(f.db.getAttachment(pending)?.bug_id, saved.id);
    f.db.discardPendingCaptures();
    assert.ok(f.db.getAttachment(pending));
    assert.equal(f.db.listBackupAttachmentFiles().length, 1);
  } finally { f.close(); }
});

test('restart recovers unexpired captures and expires only marked captures across inactive databases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bug-pocket-phase1-restart-'));
  let db = new BugPocketDatabase(dir);
  try {
    const legacy = db.createAttachment(hash, '.png');
    const recovered = db.createAttachment('b'.repeat(64), '.png', 'image/png', 'snip', true);
    writeFileSync(db.resolveAttachmentPath('b'.repeat(64), '.png'), 'recoverable');
    db.connectToWorkspace('inactive');
    db.createAttachment('c'.repeat(64), '.png', 'image/png', 'snip', true);
    const expiredPath = db.resolveAttachmentPath('c'.repeat(64), '.png');
    writeFileSync(expiredPath, 'expired');
    native(db).prepare('UPDATE attachments SET pending_capture_until = ?').run('2000-01-01T00:00:00.000Z');
    db.connectToWorkspace('');
    db.close();
    db = new BugPocketDatabase(dir);
    assert.equal(db.listPendingCaptures()[0]?.id, recovered);
    assert.ok(db.getAttachment(legacy));
    assert.equal(existsSync(expiredPath), false);
    db.cleanupExpiredCaptures('2999-01-01T00:00:00.000Z');
    assert.equal(db.listPendingCaptures().length, 0);
    assert.ok(db.getAttachment(legacy), 'unmarked historical orphans never become expiry candidates');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

async function extract(archive: string, dir: string): Promise<void> {
  const unzip = (await import('extract-zip')).default;
  await unzip(archive, { dir });
}

async function writeArchive(path: string, entries: Array<{ name: string; bytes: Buffer }>): Promise<void> {
  const { ZipArchive } = await import('archiver') as unknown as { ZipArchive: new (options: object) => {
    append(bytes: Buffer, entry: { name: string }): void; pipe(stream: NodeJS.WritableStream): void;
    on(event: string, handler: (error: Error) => void): void; finalize(): Promise<void>;
  } };
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    output.on('close', resolve); output.on('error', reject); archive.on('error', reject);
    archive.pipe(output);
    entries.forEach(entry => archive.append(entry.bytes, { name: entry.name }));
    void archive.finalize().catch(reject);
  });
}

test('pending and explicitly cleared captures are absent from backup files AND database metadata', async () => {
  const f = fixture();
  try {
    const pending = f.db.createAttachment(hash, '.png', 'image/png', 'snip', true);
    writeFileSync(f.db.resolveAttachmentPath(hash, '.png'), 'image');
    for (const clear of [false, true]) {
      if (clear) f.db.discardPendingCaptures();
      const archive = join(f.dir, 'backup-' + clear + '.bugpocket');
      assert.equal((await createBackupArchive(archive, f.db, f.dir)).success, true);
      const extracted = join(f.dir, 'extracted-' + clear);
      mkdirSync(extracted);
      await extract(archive, extracted);
      const snapshot = new Database(join(extracted, 'local.sqlite'));
      try { assert.equal((snapshot.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n, 0); }
      finally { snapshot.close(); }
      assert.equal(existsSync(join(extracted, 'attachments', hash + '.png')), false);
      if (!clear) assert.ok(f.db.getAttachment(pending), 'backup must not delete the live recovery capture');
    }
  } finally { f.close(); }
});

for (const kind of ['local', 'mixed', 'legacy-single', 'legacy-mapped'] as const) {
  test(kind + ' archive restores twice through production database hooks with ownership and permissions intact', async () => {
    const source = fixture();
    const destination = mkdtempSync(join(tmpdir(), 'bug-pocket-phase1-restore-'));
    let restored = new BugPocketDatabase(destination);
    try {
      const bytes = Buffer.from('round-trip screenshot');
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const attachment = source.db.createAttachment(contentHash, '.png');
      writeFileSync(source.db.resolveAttachmentPath(contentHash, '.png'), bytes);
      source.db.createQuickBug(input('local original', [attachment]));
      if (kind === 'mixed') {
        source.db.connectToWorkspace('cloud');
        source.db.updateWorkspacePermissions('cloud', true, false);
        source.db.createQuickBug(input('cloud original'));
      }
      const archive = join(source.dir, 'roundtrip.bugpocket');
      if (kind.startsWith('legacy')) {
        source.db.checkpoint();
        const single = kind === 'legacy-single';
        const name = single ? 'bug-pocket.sqlite' : 'local.sqlite';
        const manifest = {
          ...(single ? { database: name } : { databases: { local_db: name, workspace_db: null, current_workspace_id: null } }),
          archived_attachments: [{ file_name: contentHash + '.png', source: 'referenced' }]
        };
        await writeArchive(archive, [
          { name, bytes: readFileSync(join(source.dir, 'local.sqlite')) },
          { name: 'backup-manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
          { name: 'attachments/' + contentHash + '.png', bytes }
        ]);
      } else {
        assert.equal((await createBackupArchive(archive, source.db, source.dir)).success, true);
      }
      for (let pass = 0; pass < 2; pass++) {
        await restoreBackupArchive(archive, destination, {
          beforeCommit: () => restored.close(),
          afterCommit: () => { restored = new BugPocketDatabase(destination, { restoring: true }); restored.applyAfterRestorePatch(); },
          beforeRollback: () => restored.close()
        });
        assert.equal(restored.getCurrentWorkspaceId(), kind === 'mixed' ? 'cloud' : null);
        if (kind === 'mixed') {
          assert.equal(restored.getTotalBugCount(), 1);
          assert.equal(restored.getBug(1)?.note, 'cloud original');
          assert.deepEqual(restored.getWorkspacePermissions('cloud'), { canRead: true, canWrite: false });
          restored.connectToWorkspace('');
        }
        assert.equal(restored.getTotalBugCount(), 1);
        assert.equal(restored.getBug(1)?.note, 'local original');
        assert.deepEqual(restored.getWorkspacePermissions(null), { canRead: true, canWrite: true });
        assert.deepEqual(readFileSync(restored.resolveAttachmentPath(contentHash, '.png')), bytes);
        assert.equal(existsSync(join(destination, 'ws_default-local.sqlite')), false);
        restored.createQuickBug(input('local is writable'));
      }
    } finally { restored.close(); source.close(); rmSync(destination, { recursive: true, force: true }); }
  });
}

test('legacy single-database installation migrates locally without clearing reports', () => {
  const source = fixture();
  const destination = mkdtempSync(join(tmpdir(), 'bug-pocket-phase1-legacy-install-'));
  try {
    source.db.createQuickBug(input('legacy installation'));
    source.db.checkpoint();
    copyFileSync(join(source.dir, 'local.sqlite'), join(destination, 'bug-pocket.sqlite'));
    const restored = new BugPocketDatabase(destination);
    try {
      assert.equal(restored.getCurrentWorkspaceId(), null);
      assert.equal(restored.getBug(1)?.note, 'legacy installation');
      assert.equal(restored.getWorkspacePermissions(null).canWrite, true);
    } finally { restored.close(); }
  } finally { source.close(); rmSync(destination, { recursive: true, force: true }); }
});


test('temporary capture deletion retries failed filesystem cleanup without sweeping unrelated files', () => {
  const f = fixture();
  try {
    const id = f.db.createAttachment(hash, '.png', 'image/png', 'snip', true);
    const file = f.db.resolveAttachmentPath(hash, '.png');
    mkdirSync(file); // unlink fails deterministically, analogous to a locked file.
    f.db.discardPendingCaptures();
    assert.equal(f.db.getAttachment(id), null);
    assert.equal((native(f.db).prepare('SELECT COUNT(*) AS n FROM attachment_gc').get() as { n: number }).n, 1);
    rmSync(file, { recursive: true });
    writeFileSync(file, 'retry');
    const unrelated = f.db.resolveAttachmentPath('d'.repeat(64), '.png');
    writeFileSync(unrelated, 'unknown ownership');
    f.db.cleanupExpiredCaptures();
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(unrelated), true);
    assert.equal((native(f.db).prepare('SELECT COUNT(*) AS n FROM attachment_gc').get() as { n: number }).n, 0);
  } finally { f.close(); }
});

test('schema 3 migration preserves historical unattached rows and does not mark them temporary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bug-pocket-phase1-migration-'));
  let db = new BugPocketDatabase(dir);
  try {
    const id = db.createAttachment(hash, '.png');
    native(db).exec('ALTER TABLE attachments DROP COLUMN pending_capture_until; DROP TABLE attachment_gc; PRAGMA user_version = 3;');
    db.close();
    db = new BugPocketDatabase(dir);
    assert.equal(native(db).pragma('user_version', { simple: true }), 4);
    assert.ok(db.getAttachment(id));
    assert.equal(db.listPendingCaptures().length, 0);
    db.cleanupExpiredCaptures('2999-01-01T00:00:00.000Z');
    assert.ok(db.getAttachment(id));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
