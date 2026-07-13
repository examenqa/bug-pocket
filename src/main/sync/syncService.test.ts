export {};

const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { createHash }: typeof import('node:crypto') = require('node:crypto');
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

test('rejects a corrupted attachment download and removes temporary bytes', async () => {
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

    const remoteRows: Record<string, Array<Record<string, unknown>>> = {
      bugs: [],
      attachments: [{
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
      }]
    };

    const client = {
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
            data: (remoteRows[table] ?? [])
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
          return {
            download: async (storageKey: string) => {
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
            }
          };
        }
      }
    };

    const syncEngine = new SyncEngine(database) as unknown as {
      pullRemoteChangesFor(client: unknown, activeWorkspaceId: string): Promise<boolean>;
    };
    const targetPath = join(database.screenshotsDir, `${expectedHash}.png`);
    const temporaryPath = join(database.screenshotsDir, `${expectedHash}.tmp`);
    await assert.rejects(
      syncEngine.pullRemoteChangesFor(client, workspaceId),
      /attachment integrity check failed.*SHA-256 mismatch/i
    );

    assert.deepEqual(downloadedKeys, [`${workspaceId}/${expectedHash}.png`]);
    assert.equal(existsSync(temporaryPath), false);
    assert.equal(existsSync(targetPath), false);
    assert.deepEqual(database.getRemoteSyncCursor(workspaceId, 'attachment'), {
      updated_at: '1970-01-01T00:00:00.000Z',
      id: ''
    });

    const workspaceDb = (database as unknown as {
      workspaceDb: {
        prepare(sql: string): {
          get(...params: unknown[]): unknown;
        };
      } | null;
    }).workspaceDb;
    assert.ok(workspaceDb);
    const persisted = workspaceDb
      .prepare('SELECT content_hash, sync_status FROM attachments WHERE remote_id = ?')
      .get(remoteAttachmentId) as { content_hash: string; sync_status: string } | undefined;
    assert.deepEqual(persisted, { content_hash: expectedHash, sync_status: 'Synced' });
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
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.match(url, /\/auth\/v1\/token\?grant_type=password$/);
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
    };

    database.updateSupabaseSettings('https://test.supabase.co', 'test-anon-key');
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
    assert.equal((await restartedClient.auth.getSession()).data.session?.access_token, accessToken);
    restartedClient.auth.stopAutoRefresh();
    restartedEngine.stop();
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
