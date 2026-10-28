import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { restoreBackupArchive } from './backupService';
import { zipFixture } from './backupZipFixtures.test-helper';

function sqlite(path: string, value: string): Buffer {
  const db = new Database(path);
  try {
    db.exec('CREATE TABLE sentinel(value TEXT NOT NULL)');
    db.prepare('INSERT INTO sentinel VALUES (?)').run(value);
  } finally { db.close(); }
  return readFileSync(path);
}

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'bug-pocket-restore-recovery-'));
  const live = join(root, 'live');
  const source = join(root, 'source');
  mkdirSync(live); mkdirSync(source);
  const local = sqlite(join(live, 'local.sqlite'), 'old local');
  const workspace = sqlite(join(live, 'ws_test.sqlite'), 'old workspace');
  const archive = join(root, 'backup.bugpocket');
  writeFileSync(archive, zipFixture([
    { name: 'local.sqlite', bytes: sqlite(join(source, 'local.sqlite'), 'new local') },
    { name: 'ws_test.sqlite', bytes: sqlite(join(source, 'ws_test.sqlite'), 'new workspace') },
    { name: 'manifest.json', bytes: JSON.stringify({
      format_version: 2,
      databases: { local_db: 'local.sqlite', workspace_db: 'ws_test.sqlite', current_workspace_id: 'test' },
      archived_attachments: []
    }) }
  ]));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, live, archive, local, workspace };
}

function noStaging(directory: string): void {
  assert.equal(readdirSync(directory).some(name => name.startsWith('.staging_restore-')), false);
}

// Node opens Windows files with delete sharing. A separate real .NET handle
// models another process denying rename/delete, rather than mocking fs.rename.
async function denyDelete(path: string): Promise<() => Promise<void>> {
  const script = `$ErrorActionPreference='Stop'; $held=[IO.File]::Open('${path.replace(/'/g, "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $held.Dispose() }`;
  const child: ChildProcessWithoutNullStreams = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let diagnostic = '';
  child.stderr.on('data', data => { diagnostic += data.toString(); });
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Lock helper exited ${code}: ${diagnostic}`)));
  });
  // Observe failures immediately even while waiting for the lock marker.
  void closed.catch(() => {});
  const deadline = setTimeout(() => child.kill(), 15_000);
  try {
    for await (const data of child.stdout) {
      output += data.toString();
      if (output.includes('LOCKED')) break;
    }
    if (!output.includes('LOCKED')) {
      await closed;
      throw new Error(`Windows lock helper did not acquire the file: ${diagnostic}`);
    }
  } catch (error) {
    child.kill();
    await closed.catch(() => {});
    clearTimeout(deadline);
    throw error;
  }
  return async () => {
    child.stdin.end('\n');
    try { await closed; } finally { clearTimeout(deadline); }
  };
}

test('beforeCommit rejection preserves live bytes and removes private staging', async t => {
  const f = fixture(t);
  await assert.rejects(restoreBackupArchive(f.archive, f.live, {
    beforeCommit: () => { throw new Error('operations did not stop'); }
  }), /operations did not stop/);
  assert.deepEqual(readFileSync(join(f.live, 'local.sqlite')), f.local);
  assert.deepEqual(readFileSync(join(f.live, 'ws_test.sqlite')), f.workspace);
  noStaging(f.live);
  assert.equal(existsSync(join(f.live, '.restore_rollback')), false);
  await restoreBackupArchive(f.archive, f.live, { beforeCommit: () => {} });
  noStaging(f.live);
});

test('a pre-swap directory setup failure preserves data and permits retry', async t => {
  const f = fixture(t);
  const obstruction = join(f.live, 'attachments');
  writeFileSync(obstruction, 'not a directory');
  await assert.rejects(restoreBackupArchive(f.archive, f.live, { beforeCommit: () => {} }), /EEXIST|ENOTDIR/i);
  assert.deepEqual(readFileSync(join(f.live, 'local.sqlite')), f.local);
  assert.deepEqual(readFileSync(join(f.live, 'ws_test.sqlite')), f.workspace);
  assert.equal(existsSync(join(f.live, '.restore_rollback')), false);
  noStaging(f.live);
  rmSync(obstruction);
  await restoreBackupArchive(f.archive, f.live, { beforeCommit: () => {} });
  noStaging(f.live);
});

test('Windows locked workspace rolls the already moved local database back; retry succeeds', {
  skip: process.platform !== 'win32', timeout: 30_000
}, async t => {
  const f = fixture(t);
  const release = await denyDelete(join(f.live, 'ws_test.sqlite'));
  let rollbackCalled = false;
  try {
    await assert.rejects(restoreBackupArchive(f.archive, f.live, {
      beforeCommit: () => {}, beforeRollback: () => { rollbackCalled = true; }
    }), /EPERM|EACCES|EBUSY|operation not permitted|permission denied/i);
    assert.equal(rollbackCalled, true);
    assert.deepEqual(readFileSync(join(f.live, 'local.sqlite')), f.local);
    assert.deepEqual(readFileSync(join(f.live, 'ws_test.sqlite')), f.workspace);
    noStaging(f.live);
  } finally { await release(); }
  await restoreBackupArchive(f.archive, f.live, { beforeCommit: () => {} });
  assert.notDeepEqual(readFileSync(join(f.live, 'local.sqlite')), f.local);
  assert.equal(existsSync(join(f.live, '.restore_rollback')), false);
  noStaging(f.live);
});

test('pending recovery artifacts are preserved and block a subsequent restore before lifecycle', async t => {
  const f = fixture(t);
  const rollback = join(f.live, '.restore_rollback');
  mkdirSync(rollback);
  writeFileSync(join(rollback, 'local.sqlite'), f.local);
  let beforeCommit = false;
  await assert.rejects(restoreBackupArchive(f.archive, f.live, {
    beforeCommit: () => { beforeCommit = true; }
  }), /recover|rollback/i);
  assert.equal(beforeCommit, false);
  assert.deepEqual(readFileSync(join(rollback, 'local.sqlite')), f.local);
  assert.deepEqual(readFileSync(join(f.live, 'local.sqlite')), f.local);
  noStaging(f.live);
});

test('a rejected rollback hook retains both errors and original recovery files', async t => {
  const f = fixture(t);
  await assert.rejects(restoreBackupArchive(f.archive, f.live, {
    beforeCommit: () => {},
    afterCommit: () => { throw new Error('synthetic reopen failure'); },
    beforeRollback: () => { throw new Error('synthetic close failure'); }
  }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /synthetic reopen failure/);
    assert.match(error.message, /synthetic close failure/);
    assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.errors.length, 2);
    return true;
  });
  assert.deepEqual(readFileSync(join(f.live, '.restore_rollback', 'local.sqlite')), f.local);
  assert.deepEqual(readFileSync(join(f.live, '.restore_rollback', 'ws_test.sqlite')), f.workspace);
  noStaging(f.live);
});

test('Windows rollback blocked by an external lock retains original files and reports both failures', {
  skip: process.platform !== 'win32', timeout: 30_000
}, async t => {
  const f = fixture(t);
  let release: (() => Promise<void>) | undefined;
  try {
    await assert.rejects(restoreBackupArchive(f.archive, f.live, {
      beforeCommit: () => {},
      afterCommit: async () => {
        release = await denyDelete(join(f.live, 'local.sqlite'));
        throw new Error('database reopen failed');
      },
      // Production closes its DB in a guarded callback; the external handle remains.
      beforeRollback: () => {}
    }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /database reopen failed/);
      assert.match(error.message, /recover|rollback/i);
      return true;
    });
    const rollback = join(f.live, '.restore_rollback');
    assert.deepEqual(readFileSync(join(rollback, 'local.sqlite')), f.local);
    noStaging(f.live);
    await assert.rejects(restoreBackupArchive(f.archive, f.live, { beforeCommit: () => {} }), /recover|rollback/i);
    assert.deepEqual(readFileSync(join(rollback, 'local.sqlite')), f.local);
  } finally { await release?.(); }
});

test('Windows recovery cleanup failure after a successful commit keeps validated live files', {
  skip: process.platform !== 'win32', timeout: 30_000
}, async t => {
  const f = fixture(t);
  let release: (() => Promise<void>) | undefined;
  let rollbackCalled = false;
  let installedLocal: Buffer | undefined;
  let installedWorkspace: Buffer | undefined;
  try {
    await assert.rejects(restoreBackupArchive(f.archive, f.live, {
      beforeCommit: () => {},
      afterCommit: async () => {
        installedLocal = readFileSync(join(f.live, 'local.sqlite'));
        installedWorkspace = readFileSync(join(f.live, 'ws_test.sqlite'));
        release = await denyDelete(join(f.live, '.restore_rollback', 'ws_test.sqlite'));
      },
      beforeRollback: () => { rollbackCalled = true; }
    }), /restored.*cleanup|cleanup.*restored/i);
    assert.equal(rollbackCalled, false, 'Successful commit cleanup must not initiate destructive rollback');
    assert.deepEqual(readFileSync(join(f.live, 'local.sqlite')), installedLocal);
    assert.deepEqual(readFileSync(join(f.live, 'ws_test.sqlite')), installedWorkspace);
    assert.deepEqual(readFileSync(join(f.live, '.restore_rollback', 'ws_test.sqlite')), f.workspace);
    noStaging(f.live);
  } finally { await release?.(); }
});
