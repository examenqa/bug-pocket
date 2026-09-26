export {};

const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { createHash }: typeof import('node:crypto') = require('node:crypto');
const { createClient }: typeof import('@supabase/supabase-js') = require('@supabase/supabase-js');
const {
  existsSync,
  mkdtempSync,
  rmSync
}: typeof import('node:fs') = require('node:fs');
const { tmpdir }: typeof import('node:os') = require('node:os');
const { isAbsolute, join, relative: relativePath, resolve, sep }: typeof import('node:path') = require('node:path');
const { BugPocketDatabase }: typeof import('../database') = require('../database.ts');
const {
  SyncEngine,
  resolveRemoteTaxonomyId
}: typeof import('./syncService') = require('./syncService.ts');
const { SafeStorageAdapter }: typeof import('./SafeStorageAdapter') = require('./SafeStorageAdapter.ts');
const {
  AttachmentMetadataValidationError,
  buildAttachmentDownloadTarget
}: typeof import('./attachmentPaths') = require('./attachmentPaths.ts');
const {
  pullWithCompositeCursors
}: typeof import('./compositeCursorPull') = require('./compositeCursorPull.ts');

const attachmentsDirectory = resolve('.unit-test-data', 'userData', 'attachments');
const workspaceId = 'workspace-a';
const validHash = 'a1'.repeat(32);
const canonicalCloudTaxonomyId = '550e8400-e29b-41d4-a716-446655440000';

test('remote taxonomy IDs derive legacy IDs but preserve canonical cloud UUIDs', () => {
  const derivedLegacyId = resolveRemoteTaxonomyId(workspaceId, 'application', 42);
  const repeatedLegacyId = resolveRemoteTaxonomyId(workspaceId, 'application', 42);
  const preservedCloudId = resolveRemoteTaxonomyId(workspaceId, 'application', canonicalCloudTaxonomyId);

  assert.match(derivedLegacyId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(repeatedLegacyId, derivedLegacyId, 'legacy numeric IDs should map deterministically');
  assert.equal(preservedCloudId, canonicalCloudTaxonomyId, 'cloud UUIDs must bypass deterministic hashing');
  assert.notEqual(derivedLegacyId, canonicalCloudTaxonomyId);
});

function createTestAuthStorage(database: InstanceType<typeof BugPocketDatabase>) {
  return new SafeStorageAdapter(database, {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const value = encrypted.toString('utf8');
      if (!value.startsWith('encrypted:')) throw new Error('Invalid test ciphertext.');
      return value.slice('encrypted:'.length);
    }
  });
}

function createAttachmentPullClient(
  remoteAttachments: Array<Record<string, unknown>>,
  download: (storageKey: string) => Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: unknown }>
): unknown {
  return {
    from(table: string) {
      let requestedWorkspace = '';
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          requestedWorkspace = value;
          return query;
        },
        gte: () => query,
        or: () => query,
        order: () => query,
        limit: async (limit: number) => ({
          data: (table === 'attachments' ? remoteAttachments : [])
            .filter((row) => row.workspace_id === requestedWorkspace)
            .slice(0, limit),
          error: null
        })
      };
      return query;
    },
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, 'attachments');
        return { download };
      }
    }
  };
}
function isInsideAttachmentsDirectory(filePath: string): boolean {
  const childPath = relativePath(attachmentsDirectory, filePath);
  return childPath === '' || (!childPath.startsWith(`..${sep}`) && childPath !== '..' && !isAbsolute(childPath));
}

test('rejects traversal through a malicious content_hash', () => {
  assert.throws(
    () => buildAttachmentDownloadTarget(
      attachmentsDirectory,
      workspaceId,
      '../../../etc/passwd',
      '.png'
    ),
    (error: unknown) =>
      error instanceof AttachmentMetadataValidationError &&
      /content_hash.*64 hexadecimal SHA-256/i.test(error.message)
  );
});

test('rejects traversal through a malicious file_extension', () => {
  const fileExtension = '../../../exe';
  assert.throws(
    () => buildAttachmentDownloadTarget(
      attachmentsDirectory,
      workspaceId,
      validHash,
      fileExtension
    ),
    (error: unknown) =>
      error instanceof AttachmentMetadataValidationError &&
      /file_extension.*png, jpg, jpeg, or webp/i.test(error.message)
  );
});

test('rejects a malformed non-hex content_hash', () => {
  assert.throws(
    () => buildAttachmentDownloadTarget(
      attachmentsDirectory,
      workspaceId,
      'not-a-valid-sha256',
      '.png'
    ),
    (error: unknown) =>
      error instanceof AttachmentMetadataValidationError &&
      /content_hash.*64 hexadecimal SHA-256/i.test(error.message)
  );
});

test('rejects an empty content_hash instead of treating it as a pruning tombstone', () => {
  assert.throws(
    () => buildAttachmentDownloadTarget(
      attachmentsDirectory,
      workspaceId,
      '',
      '.png'
    ),
    (error: unknown) =>
      error instanceof AttachmentMetadataValidationError &&
      /content_hash.*64 hexadecimal SHA-256/i.test(error.message)
  );
});

test('keeps a validated attachment target inside the attachments directory', () => {
  const target = buildAttachmentDownloadTarget(
    attachmentsDirectory,
    workspaceId,
    validHash,
    'WEBP'
  );

  assert.equal(target.extension, '.webp');
  assert.equal(target.storageKey, `${workspaceId}/${validHash}.webp`);
  assert.equal(isInsideAttachmentsDirectory(target.localPath), true);
  assert.equal(relativePath(attachmentsDirectory, target.localPath), `${validHash}.webp`);
});

test('drains 21 attachments and 4 bugs independently without watermark starvation', async () => {
  const batchSize = 20;
  const initialCursor = { updated_at: '2026-01-01T00:00:00.000Z', id: '' };
  const attachmentRows = Array.from({ length: 21 }, (_, index) => ({
    id: `attachment-${String(index + 1).padStart(3, '0')}`,
    workspace_id: workspaceId,
    updated_at: index < 19
      ? `2026-01-01T00:00:${String(index + 1).padStart(2, '0')}.000Z`
      : '2026-01-01T00:00:30.000Z',
    content_hash: validHash,
    file_extension: '.png'
  }));
  const bugRows = Array.from({ length: 4 }, (_, index) => ({
    id: `bug-${String(index + 1).padStart(3, '0')}`,
    workspace_id: workspaceId,
    updated_at: `2026-01-01T00:00:29.${String((index + 1) * 100).padStart(3, '0')}Z`
  }));
  const remoteRows: Record<string, Array<Record<string, unknown>>> = {
    bugs: bugRows,
    attachments: attachmentRows
  };
  const observedQueries: Array<{ table: string; limit: number; order: string[] }> = [];
  const client = {
    from(table: string) {
      let requestedWorkspace = '';
      let predicate = (_row: Record<string, unknown>): boolean => true;
      const orderColumns: string[] = [];
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          requestedWorkspace = value;
          return query;
        },
        gte: (_column: string, value: string) => {
          predicate = (row: Record<string, unknown>) => String(row.updated_at) >= value;
          return query;
        },
        or: (filter: string) => {
          const match = filter.match(/^updated_at\.gt\.([^,]+),and\(updated_at\.eq\.([^,]+),id\.gt\.([^)]+)\)$/);
          assert.ok(match, `Unexpected composite cursor filter: ${filter}`);
          const [, greaterTimestamp, equalTimestamp, greaterId] = match;
          predicate = (row: Record<string, unknown>) =>
            String(row.updated_at) > greaterTimestamp ||
            (String(row.updated_at) === equalTimestamp && String(row.id) > greaterId);
          return query;
        },
        order: (column: string) => {
          orderColumns.push(column);
          return query;
        },
        limit: async (limit: number) => {
          observedQueries.push({ table, limit, order: [...orderColumns] });
          const data = (remoteRows[table] ?? [])
            .filter((row) => row.workspace_id === requestedWorkspace && predicate(row))
            .sort((left, right) =>
              String(left.updated_at).localeCompare(String(right.updated_at)) ||
              String(left.id).localeCompare(String(right.id))
            )
            .slice(0, limit);
          return { data, error: null };
        }
      };
      return query;
    }
  } as unknown as import('./compositeCursorPull').RemotePullClient;

  const cursors = {
    bug: { ...initialCursor },
    attachment: { ...initialCursor }
  };
  const localBugIds = new Set<string>();
  const localAttachmentIds = new Set<string>();
  const lifecycle: string[] = [];

  await pullWithCompositeCursors({
    client,
    workspaceId,
    batchSize,
    getCursor: (entityType) => ({ ...cursors[entityType] }),
    applyBugBatch: (rows) => {
      lifecycle.push(`apply:bug:${rows.length}`);
      rows.forEach((row) => localBugIds.add(row.id));
      return true;
    },
    applyAttachmentBatch: (rows) => {
      lifecycle.push(`apply:attachment:${rows.length}`);
      rows.forEach((row) => localAttachmentIds.add(row.id));
      return true;
    },
    updateCursor: (entityType, cursor) => {
      lifecycle.push(`cursor:${entityType}:${cursor.id}`);
      cursors[entityType] = { ...cursor };
    },
    emitChanged: () => { lifecycle.push('emit'); }
  });

  assert.equal(localBugIds.size, 4);
  assert.equal(localAttachmentIds.size, 21);
  assert.deepEqual([...localBugIds].sort(), bugRows.map((row) => row.id));
  assert.deepEqual([...localAttachmentIds].sort(), attachmentRows.map((row) => row.id));
  assert.deepEqual(cursors.bug, {
    updated_at: '2026-01-01T00:00:29.400Z',
    id: 'bug-004'
  });
  assert.deepEqual(cursors.attachment, {
    updated_at: '2026-01-01T00:00:30.000Z',
    id: 'attachment-021'
  });
  assert.deepEqual(observedQueries, [
    { table: 'bugs', limit: 20, order: ['updated_at', 'id'] },
    { table: 'attachments', limit: 20, order: ['updated_at', 'id'] },
    { table: 'attachments', limit: 20, order: ['updated_at', 'id'] }
  ]);
  assert.deepEqual(lifecycle, [
    'apply:bug:4',
    'cursor:bug:bug-004',
    'apply:attachment:20',
    'cursor:attachment:attachment-020',
    'apply:attachment:1',
    'cursor:attachment:attachment-021',
    'emit'
  ]);
});

test('does not advance a composite cursor when a local batch transaction fails', async () => {
  const cursorUpdates: unknown[] = [];
  const row = {
    id: 'bug-001',
    workspace_id: workspaceId,
    updated_at: '2026-01-01T00:00:01.000Z'
  };
  const client = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        or: () => query,
        order: () => query,
        limit: async () => ({ data: table === 'bugs' ? [row] : [], error: null })
      };
      return query;
    }
  } as unknown as import('./compositeCursorPull').RemotePullClient;

  await assert.rejects(
    pullWithCompositeCursors({
      client,
      workspaceId,
      batchSize: 20,
      getCursor: () => ({ updated_at: '1970-01-01T00:00:00.000Z', id: '' }),
      applyBugBatch: () => { throw new Error('SQLite transaction failed'); },
      applyAttachmentBatch: () => true,
      updateCursor: (_entityType, cursor) => { cursorUpdates.push(cursor); },
      emitChanged: () => {}
    }),
    /SQLite transaction failed/
  );
  assert.deepEqual(cursorUpdates, []);
});

test('null-hash pruning tombstones commit metadata and advance the attachment cursor', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-null-hash-pull-'));
  const database = new BugPocketDatabase(dataDir);
  const remoteAttachmentId = 'attachment-pruned-remotely';
  const oldHash = '1a'.repeat(32);

  try {
    database.connectToWorkspace(workspaceId);
    const workspaceDb = (database as unknown as {
      workspaceDb: {
        prepare(sql: string): {
          run(...params: unknown[]): { lastInsertRowid: number | bigint };
          get(...params: unknown[]): unknown;
        };
      } | null;
    }).workspaceDb;
    assert.ok(workspaceDb);
    workspaceDb.prepare('INSERT INTO attachments (remote_id, content_hash, file_extension, mime_type, source_type, sync_status, last_sync_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(remoteAttachmentId, oldHash, '.png', 'image/png', 'snip', 'Synced', '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');

    const remoteRow = {
      id: remoteAttachmentId,
      workspace_id: workspaceId,
      content_hash: null,
      file_extension: '.png',
      mime_type: 'image/png',
      source_type: 'snip',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:01.000Z',
      deleted_at: null
    };
    const client = createAttachmentPullClient([remoteRow], async () => {
      throw new Error('Null-hash tombstones must never trigger a download.');
    });
    const syncEngine = new SyncEngine(database) as unknown as {
      pullRemoteChangesFor(client: unknown, activeWorkspaceId: string): Promise<boolean>;
    };

    await syncEngine.pullRemoteChangesFor(client, workspaceId);

    assert.deepEqual(database.getRemoteSyncCursor(workspaceId, 'attachment'), {
      updated_at: remoteRow.updated_at,
      id: remoteAttachmentId
    });
    assert.deepEqual(database.getPendingAttachmentDownloads(), []);
    const persisted = workspaceDb
      .prepare('SELECT content_hash FROM attachments WHERE remote_id = ?')
      .get(remoteAttachmentId) as { content_hash: string | null } | undefined;
    assert.equal(persisted?.content_hash, null);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('deleted remote attachments clear download intents and never fetch binary data', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-deleted-attachment-pull-'));
  const database = new BugPocketDatabase(dataDir);
  const remoteAttachmentId = 'attachment-deleted-remotely';
  const oldHash = '2b'.repeat(32);
  let downloadCalls = 0;

  try {
    database.connectToWorkspace(workspaceId);
    const workspaceDb = (database as unknown as {
      workspaceDb: {
        prepare(sql: string): {
          run(...params: unknown[]): { lastInsertRowid: number | bigint };
          get(...params: unknown[]): unknown;
        };
      } | null;
    }).workspaceDb;
    assert.ok(workspaceDb);
    const inserted = workspaceDb.prepare('INSERT INTO attachments (remote_id, content_hash, file_extension, mime_type, source_type, sync_status, last_sync_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(remoteAttachmentId, oldHash, '.png', 'image/png', 'snip', 'Synced', '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    workspaceDb.prepare('INSERT INTO attachment_download_queue (attachment_id, content_hash, file_extension, retry_count, last_error) VALUES (?, ?, ?, 0, NULL)')
      .run(Number(inserted.lastInsertRowid), oldHash, '.png');

    const remoteRow = {
      id: remoteAttachmentId,
      workspace_id: workspaceId,
      content_hash: '../../../malformed-deleted-hash',
      file_extension: '../../../exe',
      updated_at: '2026-01-01T00:00:02.000Z',
      deleted_at: '2026-01-01T00:00:02.000Z'
    };
    const client = createAttachmentPullClient([remoteRow], async () => {
      downloadCalls += 1;
      return { data: null, error: { message: 'should not download', statusCode: 404 } };
    });
    const syncEngine = new SyncEngine(database) as unknown as {
      pullRemoteChangesFor(client: unknown, activeWorkspaceId: string): Promise<boolean>;
      drainAttachmentDownloadQueue(client: unknown, activeWorkspaceId: string): Promise<void>;
    };

    await syncEngine.pullRemoteChangesFor(client, workspaceId);
    await syncEngine.drainAttachmentDownloadQueue(client, workspaceId);

    assert.equal(downloadCalls, 0);
    assert.deepEqual(database.getPendingAttachmentDownloads(), []);
    assert.equal(
      workspaceDb.prepare('SELECT id FROM attachments WHERE remote_id = ?').get(remoteAttachmentId),
      undefined
    );
    assert.deepEqual(database.getRemoteSyncCursor(workspaceId, 'attachment'), {
      updated_at: remoteRow.updated_at,
      id: remoteAttachmentId
    });
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a 404 binary download does not block later attachment metadata or binaries', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-download-404-continue-'));
  const database = new BugPocketDatabase(dataDir);
  const missingBytes = Buffer.from('missing remote attachment', 'utf8');
  const availableBytes = Buffer.from('available remote attachment', 'utf8');
  const missingHash = createHash('sha256').update(missingBytes).digest('hex');
  const availableHash = createHash('sha256').update(availableBytes).digest('hex');
  const missingId = 'attachment-404';
  const availableId = 'attachment-available';

  try {
    database.connectToWorkspace(workspaceId);
    const remoteRows = [
      {
        id: missingId,
        workspace_id: workspaceId,
        content_hash: missingHash,
        file_extension: '.png',
        mime_type: 'image/png',
        source_type: 'snip',
        created_at: '2026-01-01T00:00:01.000Z',
        updated_at: '2026-01-01T00:00:01.000Z',
        deleted_at: null
      },
      {
        id: availableId,
        workspace_id: workspaceId,
        content_hash: availableHash,
        file_extension: '.png',
        mime_type: 'image/png',
        source_type: 'snip',
        created_at: '2026-01-01T00:00:02.000Z',
        updated_at: '2026-01-01T00:00:02.000Z',
        deleted_at: null
      }
    ];
    const client = createAttachmentPullClient(remoteRows, async (storageKey) => {
      if (storageKey.includes(missingHash)) {
        return { data: null, error: { message: 'Object not found', statusCode: 404 } };
      }
      return {
        data: {
          arrayBuffer: async () => availableBytes.buffer.slice(
            availableBytes.byteOffset,
            availableBytes.byteOffset + availableBytes.byteLength
          )
        },
        error: null
      };
    });
    const syncEngine = new SyncEngine(database) as unknown as {
      pullRemoteChangesFor(client: unknown, activeWorkspaceId: string): Promise<boolean>;
      drainAttachmentDownloadQueue(client: unknown, activeWorkspaceId: string): Promise<void>;
    };

    await syncEngine.pullRemoteChangesFor(client, workspaceId);
    assert.deepEqual(database.getRemoteSyncCursor(workspaceId, 'attachment'), {
      updated_at: '2026-01-01T00:00:02.000Z',
      id: availableId
    });

    await syncEngine.drainAttachmentDownloadQueue(client, workspaceId);

    const queued = database.getPendingAttachmentDownloads(25, 6);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.content_hash, missingHash);
    assert.equal(queued[0]?.retry_count, 1);
    assert.match(queued[0]?.last_error ?? '', /object not found/i);
    const diagnostic = database.getSyncDiagnostics().find((row) => row.queue_type === 'download');
    assert.equal(diagnostic?.operation, 'DOWNLOAD');
    assert.equal(diagnostic?.missing_binary, true);
    assert.match(diagnostic?.last_error ?? '', /object not found/i);
    assert.equal(database.attachmentFileExists(availableHash, '.png'), true);
    assert.equal(database.attachmentFileExists(missingHash, '.png'), false);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects a corrupted queued attachment download without rewinding metadata', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-corrupt-download-'));
  const database = new BugPocketDatabase(dataDir);
  const remoteAttachmentId = 'attachment-integrity-test';
  const knownImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const expectedHash = createHash('sha256').update(knownImage).digest('hex');
  const corruptedBytes = knownImage.subarray(0, 18);
  const downloadedKeys: string[] = [];

  try {
    database.connectToWorkspace(workspaceId);
    const remoteRow = {
      id: remoteAttachmentId,
      workspace_id: workspaceId,
      content_hash: expectedHash,
      file_extension: '.png',
      mime_type: 'image/png',
      source_type: 'snip',
      sync_status: 'Synced',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:01.000Z',
      deleted_at: null
    };
    const client = createAttachmentPullClient([remoteRow], async (storageKey) => {
      downloadedKeys.push(storageKey);
      return {
        data: {
          arrayBuffer: async () => corruptedBytes.buffer.slice(
            corruptedBytes.byteOffset,
            corruptedBytes.byteOffset + corruptedBytes.byteLength
          )
        },
        error: null
      };
    });
    const syncEngine = new SyncEngine(database) as unknown as {
      pullRemoteChangesFor(client: unknown, activeWorkspaceId: string): Promise<boolean>;
      drainAttachmentDownloadQueue(client: unknown, activeWorkspaceId: string): Promise<void>;
    };
    const targetPath = join(database.screenshotsDir, expectedHash + '.png');
    const temporaryPath = join(database.screenshotsDir, expectedHash + '.tmp');

    await syncEngine.pullRemoteChangesFor(client, workspaceId);
    await syncEngine.drainAttachmentDownloadQueue(client, workspaceId);

    assert.deepEqual(downloadedKeys, [workspaceId + '/' + expectedHash + '.png']);
    assert.equal(existsSync(temporaryPath), false);
    assert.equal(existsSync(targetPath), false);
    assert.deepEqual(database.getRemoteSyncCursor(workspaceId, 'attachment'), {
      updated_at: remoteRow.updated_at,
      id: remoteAttachmentId
    });
    const queued = database.getPendingAttachmentDownloads(25, 6);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.retry_count, 1);
    assert.match(queued[0]?.last_error ?? '', /attachment integrity check failed.*SHA-256 mismatch/i);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a missing local upload never creates dangling remote attachment metadata', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-missing-local-upload-'));
  const database = new BugPocketDatabase(dataDir);
  const contentHash = '7e'.repeat(32);
  let metadataUpserts = 0;
  let uploads = 0;

  try {
    database.connectToWorkspace(workspaceId);
    const client = {
      storage: {
        from: (bucket: string) => {
          assert.equal(bucket, 'attachments');
          return {
            exists: async () => ({
              data: false,
              error: { message: 'Object not found', statusCode: 404 }
            }),
            upload: async () => {
              uploads += 1;
              return { data: null, error: null };
            }
          };
        }
      },
      from: (table: string) => {
        assert.equal(table, 'attachments');
        return {
          upsert: async () => {
            metadataUpserts += 1;
            return { data: null, error: null };
          }
        };
      }
    };
    const syncEngine = new SyncEngine(database) as unknown as {
      syncAttachmentEvent(
        client: unknown,
        activeWorkspaceId: string,
        event: Record<string, unknown>,
        payload: Record<string, unknown>
      ): Promise<void>;
    };
    const event = {
      id: 1,
      local_seq: 1,
      op_id: 'missing-local-upload',
      entity_type: 'attachment',
      entity_id: 999,
      operation: 'INSERT',
      payload: '{}',
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null
    };

    await assert.rejects(
      syncEngine.syncAttachmentEvent(client, workspaceId, event, {
        content_hash: contentHash,
        file_extension: '.png',
        mime_type: 'image/png',
        source_type: 'snip'
      }),
      /binary is missing locally and does not exist remotely.*metadata was not created/i
    );

    assert.equal(uploads, 0);
    assert.equal(metadataUpserts, 0);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
test('restores the encrypted authenticated session after client reinitialization', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-session-restart-'));
  const database = new BugPocketDatabase(dataDir);
  const originalFetch = globalThis.fetch;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessToken = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({
      aud: 'authenticated',
      exp: nowSeconds + 3600,
      iat: nowSeconds,
      role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000001'
    })).toString('base64url'),
    'test-signature'
  ].join('.');

  type AuthClient = {
    auth: {
      signInWithPassword(credentials: { email: string; password: string }): Promise<{
        data: { session: { access_token: string } | null };
        error: { message: string } | null;
      }>;
      getSession(): Promise<{
        data: { session: { access_token: string } | null };
        error: { message: string } | null;
      }>;
      stopAutoRefresh(): void;
    };
  };
  type ExposedSyncEngine = {
    client: AuthClient | null;
  };

  try {
    const workspaceId = '10000000-0000-4000-8000-000000000001';
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (/\/auth\/v1\/token\?grant_type=password$/.test(url)) {
        return new Response(JSON.stringify({
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: nowSeconds + 3600,
          refresh_token: 'test-refresh-token',
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'tester@example.com',
            app_metadata: { provider: 'email', providers: ['email'] },
            user_metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (/\/auth\/v1\/user$/.test(url)) {
        return new Response(JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'tester@example.com',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (/\/rest\/v1\/workspace_members\?/.test(url)) {
        return new Response(JSON.stringify([{ workspace_id: workspaceId, role: 'owner' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (/\/rest\/v1\//.test(url)) {
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`Unexpected Supabase test request: ${url}`);
    };

    database.updateSupabaseSettings('https://test.supabase.co', 'sb_publishable_test_key');
    const initialEngine = new SyncEngine(database, () => {}, createTestAuthStorage(database));
    initialEngine.initialize();
    const initialClient = (initialEngine as unknown as ExposedSyncEngine).client;
    assert.ok(initialClient);

    const signIn = await initialClient.auth.signInWithPassword({
      email: 'tester@example.com',
      password: 'correct-horse-battery-staple'
    });
    assert.equal(signIn.error, null);
    assert.equal(signIn.data.session?.access_token, accessToken);
    assert.equal((await initialClient.auth.getSession()).data.session?.access_token, accessToken);

    const localDb = (database as unknown as {
      localDb: {
        prepare(sql: string): { all(): Array<{ value: string }> };
      };
    }).localDb;
    const encryptedRows = localDb
      .prepare("SELECT value FROM app_settings WHERE key LIKE 'supabase_auth_%'")
      .all();
    assert.ok(encryptedRows.length > 0, 'the Supabase session should be persisted in local.sqlite');
    assert.equal(
      encryptedRows.some((row) => row.value.includes(accessToken)),
      false,
      'local.sqlite must not contain the plaintext access token'
    );

    initialClient.auth.stopAutoRefresh();
    initialEngine.stop();
    (initialEngine as unknown as ExposedSyncEngine).client = null;

    const restartedEngine = new SyncEngine(database, () => {}, createTestAuthStorage(database));
    restartedEngine.initialize();
    const restartedClient = (restartedEngine as unknown as ExposedSyncEngine).client;
    assert.ok(restartedClient);
    assert.equal(await restartedEngine.restorePersistedSession(), true);
    assert.equal(database.getCurrentWorkspaceId(), workspaceId, 'the sole accessible workspace is mounted after restart');
    assert.equal((await restartedClient.auth.getSession()).data.session?.access_token, accessToken);
    restartedClient.auth.stopAutoRefresh();
    await restartedEngine.stopAndDrain();
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('translates a Supabase 503 into PROJECT_PAUSED and halts automatic retries', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'bug-pocket-paused-project-'));
  const database = new BugPocketDatabase(dataDir);
  const capturedErrors: unknown[][] = [];
  const emittedStatuses: Array<{
    status: 'error';
    code: 'PROJECT_PAUSED';
    message: 'Supabase project is paused';
  } | null> = [];
  const originalConsoleError = console.error;
  let restRequestCount = 0;
  let serviceRestored = false;

  try {
    database.updateSupabaseSettings('https://paused-project.supabase.co', 'sb_publishable_test_key');
    database.connectToWorkspace(workspaceId);

    const fetch503: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/rest/v1/')) {
        restRequestCount += 1;
        if (serviceRestored) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ message: 'Service Unavailable' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`Unexpected request during paused-project test: ${url}`);
    };

    const client = createClient('https://paused-project.supabase.co', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetch503 }
    });
    client.auth.getUser = async () => ({
      data: {
        user: {
          id: '00000000-0000-4000-8000-000000000001'
        }
      },
      error: null
    }) as Awaited<ReturnType<typeof client.auth.getUser>>;

    const syncEngine = new SyncEngine(
      database,
      () => {},
      createTestAuthStorage(database),
      (status) => emittedStatuses.push(status)
    ) as unknown as {
      client: typeof client;
      processQueue(): Promise<void>;
      retrySyncQueueNow(): Promise<void>;
      getRuntimeStatus(): (typeof emittedStatuses)[number];
      stop(): void;
    };
    syncEngine.client = client;
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args);
    };

    await syncEngine.processQueue();

    const requestsWhenPaused = restRequestCount;
    assert.ok(requestsWhenPaused > 0, 'the sync engine should reach the paused Supabase project');
    assert.deepEqual(syncEngine.getRuntimeStatus(), {
      status: 'error',
      code: 'PROJECT_PAUSED',
      message: 'Supabase project is paused'
    });
    assert.deepEqual(emittedStatuses, [syncEngine.getRuntimeStatus()]);

    await syncEngine.processQueue();
    assert.equal(restRequestCount, requestsWhenPaused, 'automatic sync cycles must stop while the project is paused');

    const renderedErrors = capturedErrors.flat().map(String).join(' ');
    assert.doesNotMatch(renderedErrors, /Background sync cycle failed\. The worker will retry on the next interval\./i);

    serviceRestored = true;
    await syncEngine.retrySyncQueueNow();
    assert.equal(syncEngine.getRuntimeStatus(), null, 'manual Sync Now should clear the latch after recovery');
    assert.ok(restRequestCount > requestsWhenPaused, 'manual Sync Now should resume network activity');
    assert.equal(emittedStatuses.at(-1), null);
    syncEngine.stop();
  } finally {
    console.error = originalConsoleError;
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
