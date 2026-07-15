import type { RemoteSyncCursor } from '../../shared/types';
import { throwIfSupabaseError } from './supabaseErrors';

export type RemotePullRow = Record<string, unknown> & {
  id: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export interface RemotePullClient {
  from(table: string): any;
}

type RemoteTable = 'bugs' | 'attachments';
type CursorType = 'bug' | 'attachment';

interface CompositeCursorPullOptions {
  client: RemotePullClient;
  workspaceId: string;
  batchSize: number;
  getCursor(entityType: CursorType): RemoteSyncCursor;
  applyBugBatch(rows: RemotePullRow[]): boolean | Promise<boolean>;
  applyAttachmentBatch(rows: RemotePullRow[]): boolean | Promise<boolean>;
  updateCursor(entityType: CursorType, cursor: RemoteSyncCursor): void;
  emitChanged(): void;
}

function validateCursor(cursor: RemoteSyncCursor): void {
  if (Number.isNaN(Date.parse(cursor.updated_at))) throw new Error('Remote sync cursor timestamp is invalid.');
  if (cursor.id && !/^[a-zA-Z0-9_.:-]{1,128}$/.test(cursor.id)) throw new Error('Remote sync cursor ID is invalid.');
}

function cursorFromRow(row: RemotePullRow): RemoteSyncCursor {
  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at.trim() : '';
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const cursor = { updated_at: updatedAt, id };
  validateCursor(cursor);
  if (!id) throw new Error('Remote row ID is required for composite cursor advancement.');
  return cursor;
}

async function fetchBatch(
  client: RemotePullClient,
  table: RemoteTable,
  workspaceId: string,
  cursor: RemoteSyncCursor,
  batchSize: number
): Promise<RemotePullRow[]> {
  validateCursor(cursor);
  let query = client
    .from(table)
    .select('*')
    .eq('workspace_id', workspaceId);

  query = cursor.id
    ? query.or(
      `updated_at.gt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.gt.${cursor.id})`
    )
    : query.gte('updated_at', cursor.updated_at);

  const result = await query
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(batchSize);
  throwIfSupabaseError(result, `Unable to pull ${table}`);
  return (result.data ?? []) as RemotePullRow[];
}

async function drainTable(
  options: CompositeCursorPullOptions,
  table: RemoteTable,
  cursorType: CursorType,
  applyBatch: (rows: RemotePullRow[]) => boolean | Promise<boolean>
): Promise<boolean> {
  let cursor = options.getCursor(cursorType);
  let changed = false;

  while (true) {
    const rows = await fetchBatch(options.client, table, options.workspaceId, cursor, options.batchSize);
    if (rows.length === 0) break;

    if (await applyBatch(rows)) changed = true;
    cursor = cursorFromRow(rows[rows.length - 1]);
    options.updateCursor(cursorType, cursor);

    if (rows.length < options.batchSize) break;
  }

  return changed;
}

export async function pullWithCompositeCursors(options: CompositeCursorPullOptions): Promise<boolean> {
  const bugsChanged = await drainTable(options, 'bugs', 'bug', options.applyBugBatch);
  const attachmentsChanged = await drainTable(
    options,
    'attachments',
    'attachment',
    options.applyAttachmentBatch
  );
  const changed = bugsChanged || attachmentsChanged;
  if (changed) options.emitChanged();
  return changed;
}
