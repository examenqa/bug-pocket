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

    database.updateSupabaseSettings('https://test.supabase.co', 'test-anon-key');
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

test('factory reset removes every workspace and taxonomy while retaining settings and presets', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-factory-reset-contract-'));
  const database = new BugPocketDatabase(dataDir);
  const exposed = database as unknown as ExposedDatabase;
  const timestamp = new Date().toISOString();

  try {
    database.updateSupabaseSettings('https://retained.supabase.co', 'retained-publishable-key');
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
    assert.equal(database.getSupabaseAnonKey(), 'retained-publishable-key');

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
