import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export const syncTables: Record<string, string> = {
  bug: 'bugs', attachment: 'attachments', application: 'applications',
  module: 'modules', environment: 'environments',
  device: 'devices', browser: 'browsers', user_role: 'user_roles'
};
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export interface SyncIdentity { sync_uuid: string; revision: number; last_op: string | null; uncertain: number; deleted: number; }

export function installSyncIdentity(db: Database.Database): void {
  db.function('new_sync_uuid', () => randomUUID());
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_identity (
      entity_type TEXT NOT NULL, local_id TEXT NOT NULL, sync_uuid TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0, last_op TEXT, uncertain INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(entity_type, local_id), UNIQUE(entity_type, sync_uuid)
    );
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      op_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      payload TEXT NOT NULL, remote_payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_workspace (id INTEGER PRIMARY KEY CHECK(id=1), workspace_id TEXT NOT NULL);
  `);
  const identityColumns = db.prepare('PRAGMA table_info(sync_identity)').all() as Array<{ name: string }>;
  if (!identityColumns.some(column => column.name === 'deleted')) db.exec('ALTER TABLE sync_identity ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  for (const [kind, table] of Object.entries(syncTables)) {
    const columns = db.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.length) continue;
    const hasRemote = columns.some(c => c.name === 'remote_id');
    const rows = db.prepare(`SELECT * FROM main.${table}`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const remote = isUuid(row.remote_id) ? row.remote_id : isUuid(row.id) ? row.id : null;
      const uncertain = !remote && Boolean(row.last_sync_at || row.sync_status === 'Synced');
      db.prepare('INSERT OR IGNORE INTO sync_identity(entity_type,local_id,sync_uuid,uncertain) VALUES(?,?,?,?)')
        .run(kind, String(row.id), remote ?? randomUUID(), Number(uncertain));
    }
    // The identity is committed by the INSERT itself, before any queue or network work.
    db.exec(`CREATE TRIGGER IF NOT EXISTS sync_identity_${kind} AFTER INSERT ON main.${table}
      BEGIN
        INSERT OR IGNORE INTO sync_identity(entity_type,local_id,sync_uuid)
        VALUES ('${kind}', CAST(NEW.id AS TEXT),
          COALESCE(${hasRemote ? "NULLIF(NEW.remote_id, '')," : ''}
            CASE WHEN length(CAST(NEW.id AS TEXT)) = 36 THEN CAST(NEW.id AS TEXT) END, new_sync_uuid()));
      END;`);
  }
}

export function identityFor(db: Database.Database, kind: string, id: string | number): SyncIdentity {
  const row = db.prepare('SELECT sync_uuid,revision,last_op,uncertain,deleted FROM sync_identity WHERE entity_type=? AND local_id=?')
    .get(kind, String(id)) as SyncIdentity | undefined;
  if (!row) throw new Error('Missing durable sync identity for ' + kind + ' ' + id);
  return row;
}
