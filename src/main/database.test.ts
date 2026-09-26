import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { BugPocketDatabase } from './database';
import { SyncEngine } from './sync/syncService';
import { SafeStorageAdapter } from './sync/SafeStorageAdapter';

type ExposedDatabase = {
  localDb: Database.Database;
  workspaceDb: Database.Database | null;
};

type ExposedSyncEngine = {
  client: {
    auth: {
      signOut: () => Promise<{ error: null }>;
      stopAutoRefresh: () => void;
    };
  };
};

test('logout closes and unmounts the active workspace database', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-logout-'));
  const database = new BugPocketDatabase(dataDir);

  try {
    database.connectToWorkspace('test_A');
    assert.equal(database.getCurrentWorkspaceId(), 'test_A');
    assert.equal(existsSync(join(dataDir, 'ws_test_A.sqlite')), true);

    database.updateSupabaseSettings('https://test.supabase.co', 'sb_publishable_test_key');
    const syncEngine = new SyncEngine(database, () => {}, new SafeStorageAdapter(database, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (encrypted) => encrypted.toString('utf8')
    }));
    syncEngine.initialize();
    const initializedClient = (syncEngine as unknown as {
      client: {
        auth: {
          getSession: () => Promise<unknown>;
          stopAutoRefresh: () => void;
        };
      } | null;
    }).client;
    assert.ok(initializedClient);
    await initializedClient.auth.getSession();
    initializedClient.auth.stopAutoRefresh();
    (syncEngine as unknown as ExposedSyncEngine).client = {
      auth: {
        signOut: async () => ({ error: null }),
        stopAutoRefresh: () => {}
      }
    };

    const workspaceDb = (database as unknown as ExposedDatabase).workspaceDb;
    assert.ok(workspaceDb, 'the test workspace should be mounted before logout');

    const result = await syncEngine.authSignOut();
    assert.equal(result.success, true);
    assert.equal(database.getCurrentWorkspaceId(), null, 'logout should clear the logical workspace selection');
    assert.equal(
      (database as unknown as ExposedDatabase).workspaceDb,
      null,
      'logout should unmount the workspace database handle'
    );

    const timestamp = new Date().toISOString();
    assert.throws(
      () => workspaceDb
        .prepare('INSERT INTO bugs (title, created_at, updated_at) VALUES (?, ?, ?)')
        .run('Written after logout', timestamp, timestamp),
      /database connection is not open/i
    );
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('project disconnect closes the mounted workspace before credentials are replaced', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-project-disconnect-'));
  const database = new BugPocketDatabase(dataDir);

  try {
    database.connectToWorkspace('test_A');
    database.updateSupabaseSettings('https://test.supabase.co', 'sb_publishable_test_key');
    const syncEngine = new SyncEngine(database, () => {}, new SafeStorageAdapter(database, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (encrypted) => encrypted.toString('utf8')
    }));
    syncEngine.initialize();
    const initializedClient = (syncEngine as unknown as {
      client: { auth: { getSession: () => Promise<unknown>; stopAutoRefresh: () => void } } | null;
    }).client;
    if (initializedClient) {
      await initializedClient.auth.getSession();
      initializedClient.auth.stopAutoRefresh();
    }

    let signOutCalls = 0;
    (syncEngine as unknown as ExposedSyncEngine).client = {
      auth: {
        signOut: async () => {
          signOutCalls += 1;
          return { error: null };
        },
        stopAutoRefresh: () => {}
      }
    };
    const mountedWorkspace = (database as unknown as ExposedDatabase).workspaceDb;
    assert.ok(mountedWorkspace);

    await syncEngine.disconnectWorkspace();

    assert.equal(signOutCalls, 1);
    assert.equal(database.getCurrentWorkspaceId(), null);
    assert.equal((database as unknown as ExposedDatabase).workspaceDb, null);
    assert.throws(() => mountedWorkspace.prepare('SELECT 1').get(), /database connection is not open/i);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Supabase settings accept only trusted project URLs and publishable keys', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-supabase-settings-'));
  const database = new BugPocketDatabase(dataDir);

  try {
    assert.throws(
      () => database.updateSupabaseSettings('https://untrusted.example', 'sb_publishable_valid_key'),
      /Supabase/i
    );
    assert.throws(
      () => database.updateSupabaseSettings('https://team.supabase.co', 'sb_secret_sensitive_key'),
      /Secret and service_role keys are not allowed/i
    );

    const saved = database.updateSupabaseSettings('https://team.supabase.co/', 'sb_publishable_valid_key');
    assert.deepEqual(saved, {
      projectUrl: 'https://team.supabase.co',
      anonKey: 'sb_publishable_valid_key'
    });
    assert.equal(database.updateSupabaseInviteEmail(' Invited.User@Example.com '), 'invited.user@example.com');
    assert.equal(database.getSupabaseInviteEmail(), 'invited.user@example.com');
    assert.throws(() => database.updateSupabaseInviteEmail('not-an-email'), /valid invitee email/i);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('seeds release pipeline environments for local and workspace databases', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-environments-'));
  const database = new BugPocketDatabase(dataDir);

  try {
    assert.deepEqual(
      database.getSettings().environments.map((environment) => environment.name),
      ['Dev', 'QA', 'Staging', 'Production']
    );

    database.connectToWorkspace('release-pipeline');
    database.connectToWorkspace('release-pipeline');
    const workspaceDb = (database as unknown as ExposedDatabase).workspaceDb;
    assert.ok(workspaceDb, 'the workspace database should be mounted');

    const environments = workspaceDb
      .prepare('SELECT id, name, value, created_at, updated_at FROM environments ORDER BY sort_order')
      .all() as Array<{ id: string; name: string; value: string; created_at: string; updated_at: string }>;

    assert.deepEqual(environments.map((environment) => environment.name), ['Dev', 'QA', 'Staging', 'Production']);
    const duplicateNames = workspaceDb
      .prepare('SELECT name, COUNT(*) AS count FROM environments GROUP BY name HAVING COUNT(*) > 1')
      .all();
    assert.deepEqual(duplicateNames, []);
    environments.forEach((environment) => {
      assert.match(environment.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(environment.value, environment.name);
      assert.match(environment.created_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(environment.updated_at, /^\d{4}-\d{2}-\d{2}T/);
    });
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('deduplicates workspace environments by name before seeding and preserves bug routing', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-environment-dedupe-'));
  const database = new BugPocketDatabase(dataDir);

  try {
    database.connectToWorkspace('environment-dedupe');
    const workspaceDb = (database as unknown as ExposedDatabase).workspaceDb;
    assert.ok(workspaceDb, 'the workspace database should be mounted');

    const oldestId = '11111111-1111-4111-8111-111111111111';
    const duplicateId = '22222222-2222-4222-8222-222222222222';
    workspaceDb.prepare(
      'INSERT INTO environments (id, name, value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(oldestId, 'Duplicate QA', 'Duplicate QA', 20, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
    workspaceDb.prepare(
      'INSERT INTO environments (id, name, value, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(duplicateId, 'Duplicate QA', 'Duplicate QA', 21, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    const stamp = '2025-01-01T00:00:00.000Z';
    const bugId = Number(workspaceDb.prepare(
      'INSERT INTO bugs (environment_id, title, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(duplicateId, 'Duplicate environment fixture', '', stamp, stamp).lastInsertRowid);

    database.connectToWorkspace('environment-dedupe');
    const reopenedWorkspaceDb = (database as unknown as ExposedDatabase).workspaceDb;
    assert.ok(reopenedWorkspaceDb, 'the workspace database should reopen');

    const environments = reopenedWorkspaceDb
      .prepare('SELECT id FROM environments WHERE name = ?')
      .all('Duplicate QA') as Array<{ id: string }>;
    assert.deepEqual(environments, [{ id: oldestId }]);
    const bug = reopenedWorkspaceDb.prepare('SELECT environment_id FROM bugs WHERE id = ?').get(bugId) as { environment_id: string };
    assert.equal(bug.environment_id, oldestId);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('taxonomy CRUD routes to the active workspace and falls back locally only when disconnected', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-taxonomy-routing-'));
  const database = new BugPocketDatabase(dataDir);
  const workspaceId = '550e8400-e29b-41d4-a716-446655440099';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  try {
    const localApplication = database.addApplication('Local Routing App', 'Local-only context');
    const localEnvironment = database.addEnvironment('Local Routing Environment');
    assert.equal(typeof localApplication.id, 'number');
    assert.equal(typeof localEnvironment.id, 'number');

    database.connectToWorkspace(workspaceId);
    const workspaceApplication = database.addApplication('Workspace Routing App', 'Workspace context');
    const workspaceEnvironment = database.addEnvironment('Workspace Routing Environment');
    assert.match(String(workspaceApplication.id), uuidPattern);
    assert.match(String(workspaceEnvironment.id), uuidPattern);

    const workspaceSettings = database.getSettings();
    assert.ok(workspaceSettings.applications.some((application) => application.id === workspaceApplication.id));
    assert.ok(workspaceSettings.environments.some((environment) => environment.id === workspaceEnvironment.id));
    assert.equal(workspaceSettings.applications.some((application) => application.id === localApplication.id), false);
    assert.equal(workspaceSettings.environments.some((environment) => environment.id === localEnvironment.id), false);

    database.deleteApplication(workspaceApplication.id);
    database.deleteEnvironment(workspaceEnvironment.id);
    const afterWorkspaceDelete = database.getSettings();
    assert.equal(afterWorkspaceDelete.applications.some((application) => application.id === workspaceApplication.id), false);
    assert.equal(afterWorkspaceDelete.environments.some((environment) => environment.id === workspaceEnvironment.id), false);

    database.disconnectWorkspace();
    const localSettings = database.getSettings();
    assert.ok(localSettings.applications.some((application) => application.id === localApplication.id));
    assert.ok(localSettings.environments.some((environment) => environment.id === localEnvironment.id));
    assert.equal(localSettings.applications.some((application) => application.id === workspaceApplication.id), false);
    assert.equal(localSettings.environments.some((environment) => environment.id === workspaceEnvironment.id), false);

    const localDb = (database as unknown as ExposedDatabase).localDb;
    for (const table of ['bugs', 'presets']) {
      const columns = localDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>;
      for (const columnName of ['application_id', 'module_id', 'environment_id']) {
        const column = columns.find((candidate) => candidate.name === columnName);
        assert.equal(column?.type.toUpperCase(), 'TEXT', `${table}.${columnName} must store numeric IDs and UUIDs`);
      }
    }

    const bugColumns = localDb.prepare('PRAGMA table_info(bugs)').all() as Array<{ name: string; type: string }>;
    for (const columnName of ['note', 'other_details', 'steps_to_reproduce', 'expected_result', 'actual_result']) {
      const column = bugColumns.find((candidate) => candidate.name === columnName);
      assert.equal(column?.type.toUpperCase(), 'TEXT', `bugs.${columnName} must support diagnostic text blocks`);
    }

    database.connectToWorkspace(workspaceId);
    const reopenedWorkspaceSettings = database.getSettings();
    assert.equal(reopenedWorkspaceSettings.applications.some((application) => application.id === localApplication.id), false);
    assert.equal(reopenedWorkspaceSettings.environments.some((environment) => environment.id === localEnvironment.id), false);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('backup attachment references combine local and active workspace rows but exclude inactive workspaces', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-backup-attachment-scope-'));
  const database = new BugPocketDatabase(dataDir);
  const localHash = 'a'.repeat(64);
  const workspaceAHash = 'b'.repeat(64);
  const workspaceBHash = 'c'.repeat(64);

  try {
    database.createAttachment(localHash, '.png');
    database.connectToWorkspace('A');
    database.createAttachment(workspaceAHash, '.png');
    database.connectToWorkspace('B');
    database.createAttachment(workspaceBHash, '.png');
    database.connectToWorkspace('A');

    const referencedHashes = database.listBackupAttachmentFiles().map((attachment) => attachment.content_hash);
    assert.ok(referencedHashes.includes(localHash));
    assert.ok(referencedHashes.includes(workspaceAHash));
    assert.equal(referencedHashes.includes(workspaceBHash), false);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('clearing the current workspace preserves shared attachments referenced by inactive workspaces', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-workspace-clear-scope-'));
  const database = new BugPocketDatabase(dataDir);
  const sharedHash = 'd'.repeat(64);
  const extension = '.png';

  try {
    database.connectToWorkspace('A');
    database.createAttachment(sharedHash, extension);
    const sharedAttachmentPath = database.resolveAttachmentPath(sharedHash, extension);
    writeFileSync(sharedAttachmentPath, Buffer.from('shared attachment fixture', 'utf8'));

    database.connectToWorkspace('B');
    database.createAttachment(sharedHash, extension);
    const workspaceBRowBeforeReset = (database as unknown as ExposedDatabase).workspaceDb
      ?.prepare('SELECT id FROM attachments WHERE content_hash = ?')
      .get(sharedHash);
    assert.ok(workspaceBRowBeforeReset, 'Workspace B should reference the shared attachment before reset');

    database.connectToWorkspace('A');
    assert.equal(existsSync(join(dataDir, 'local.sqlite')), true);
    assert.equal(existsSync(join(dataDir, 'ws_A.sqlite')), true);
    assert.equal(existsSync(join(dataDir, 'ws_B.sqlite')), true);
    assert.equal(existsSync(sharedAttachmentPath), true);

    const result = await database.clearCurrentWorkspace();

    assert.equal(result.workspaceId, 'A');
    assert.equal(result.deletedAttachmentFiles, 0);
    assert.equal(database.getCurrentWorkspaceId(), null);
    assert.equal((database as unknown as ExposedDatabase).workspaceDb, null);
    assert.equal(existsSync(join(dataDir, 'ws_A.sqlite')), false, 'Workspace A database should be deleted');
    assert.equal(existsSync(join(dataDir, 'ws_B.sqlite')), true, 'Workspace B database must remain intact');
    assert.equal(
      existsSync(sharedAttachmentPath),
      true,
      'the shared physical attachment must remain while Workspace B references it'
    );

    database.connectToWorkspace('B');
    const workspaceBRowAfterReset = (database as unknown as ExposedDatabase).workspaceDb
      ?.prepare('SELECT id, content_hash, file_extension FROM attachments WHERE content_hash = ?')
      .get(sharedHash) as { id: number; content_hash: string; file_extension: string } | undefined;
    assert.ok(workspaceBRowAfterReset, 'Workspace B should still retain its attachment reference');
    assert.equal(workspaceBRowAfterReset.content_hash, sharedHash);
    assert.equal(workspaceBRowAfterReset.file_extension, extension);
    assert.equal(
      database.attachmentFileExists(sharedHash, extension),
      true,
      'Workspace B should retain both its database row and physical attachment'
    );
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('pruning stale attachments preserves blobs referenced by another workspace database', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-prune-cross-workspace-'));
  const database = new BugPocketDatabase(dataDir);
  const sharedHash = '9'.repeat(64);
  const extension = '.png';
  const oldTimestamp = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    database.connectToWorkspace('A');
    const workspaceA = (database as unknown as ExposedDatabase).workspaceDb;
    assert.ok(workspaceA);
    const bugId = Number(workspaceA
      .prepare('INSERT INTO bugs (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('Discarded attachment fixture', 'Discarded', oldTimestamp, oldTimestamp).lastInsertRowid);
    const attachmentId = database.createAttachment(sharedHash, extension);
    workspaceA.prepare('UPDATE attachments SET bug_id = ? WHERE id = ?').run(bugId, attachmentId);
    const sharedPath = database.resolveAttachmentPath(sharedHash, extension);
    writeFileSync(sharedPath, Buffer.from('shared workspace attachment', 'utf8'));

    database.connectToWorkspace('B');
    database.createAttachment(sharedHash, extension);

    database.connectToWorkspace('A');
    assert.equal(database.pruneStaleAttachments(), 1);
    assert.equal(existsSync(sharedPath), true, 'Workspace B still references the shared physical blob');

    const prunedRow = (database as unknown as ExposedDatabase).workspaceDb
      ?.prepare('SELECT content_hash FROM attachments WHERE id = ?')
      .get(attachmentId) as { content_hash: string | null } | undefined;
    assert.equal(prunedRow?.content_hash, null, 'Workspace A metadata should still be tombstoned');

    database.connectToWorkspace('B');
    const workspaceBReference = (database as unknown as ExposedDatabase).workspaceDb
      ?.prepare('SELECT content_hash FROM attachments WHERE content_hash = ?')
      .get(sharedHash) as { content_hash: string } | undefined;
    assert.equal(workspaceBReference?.content_hash, sharedHash);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('factory reset removes every workspace and taxonomy while retaining settings and presets', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-factory-reset-contract-'));
  const database = new BugPocketDatabase(dataDir);
  const exposed = database as unknown as ExposedDatabase;
  const timestamp = new Date().toISOString();

  try {
    database.updateSupabaseSettings('https://retained.supabase.co', 'sb_publishable_retained_key');
    exposed.localDb
      .prepare(
        `INSERT INTO presets (
          name, application_id, module_id, environment_id, user_role_id, entry_type_id, created_at, updated_at
        ) VALUES (?, NULL, NULL, NULL, NULL, NULL, ?, ?)`
      )
      .run('Retained preset', timestamp, timestamp);

    database.connectToWorkspace('A');
    database.createAttachment('e'.repeat(64), '.png');
    database.connectToWorkspace('B');
    database.createAttachment('f'.repeat(64), '.png');
    writeFileSync(join(database.screenshotsDir, `${'f'.repeat(64)}.png`), Buffer.from('factory reset fixture'));

    await database.factoryReset();

    assert.equal(existsSync(join(dataDir, 'ws_A.sqlite')), false);
    assert.equal(existsSync(join(dataDir, 'ws_B.sqlite')), false);
    assert.deepEqual(readdirSync(database.screenshotsDir), []);
    assert.equal(database.getCurrentWorkspaceId(), null);
    assert.equal(database.getSupabaseProjectUrl(), 'https://retained.supabase.co');
    assert.equal(database.getSupabaseAnonKey(), 'sb_publishable_retained_key');

    const retainedPreset = exposed.localDb
      .prepare('SELECT name, application_id, module_id, environment_id, user_role_id, entry_type_id FROM presets WHERE name = ?')
      .get('Retained preset') as Record<string, unknown> | undefined;
    assert.deepEqual(retainedPreset, {
      name: 'Retained preset',
      application_id: null,
      module_id: null,
      environment_id: null,
      user_role_id: null,
      entry_type_id: null
    });

    for (const table of ['bugs', 'attachments', 'sync_queue', 'applications', 'modules', 'environments', 'devices', 'browsers', 'user_roles', 'config_options']) {
      const row = exposed.localDb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      assert.equal(row.count, 0, `${table} should be empty after factory reset`);
    }
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
