import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type SchemaObjectKind = 'constraint' | 'extension' | 'function' | 'index' | 'policy' | 'table' | 'trigger';

interface SchemaObjectEvent {
  action: 'create' | 'drop';
  guarded: boolean;
  key: string;
  kind: SchemaObjectKind;
  offset: number;
}

function schemaObjectEvents(sql: string): SchemaObjectEvent[] {
  const events: SchemaObjectEvent[] = [];
  const collect = (
    pattern: RegExp,
    kind: SchemaObjectKind,
    action: 'create' | 'drop',
    keyFor: (match: RegExpExecArray) => string,
    guardedAt: number
  ): void => {
    for (const match of sql.matchAll(pattern)) {
      events.push({
        action,
        guarded: Boolean(match[guardedAt]),
        key: keyFor(match).toLowerCase(),
        kind,
        offset: match.index ?? 0
      });
    }
  };

  collect(/create\s+table\s+(if\s+not\s+exists\s+)?(?:public\.)?([a-z_][\w]*)/gi, 'table', 'create', (match) => match[2], 1);
  collect(/create\s+extension\s+(if\s+not\s+exists\s+)?([a-z_][\w]*)/gi, 'extension', 'create', (match) => match[2], 1);
  collect(/create\s+(or\s+replace\s+)?function\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi, 'function', 'create', (match) => match[2], 1);
  collect(/create\s+(?:unique\s+)?index\s+(if\s+not\s+exists\s+)?([a-z_][\w]*)/gi, 'index', 'create', (match) => match[2], 1);
  collect(/drop\s+policy\s+(if\s+exists\s+)?"([^"]+)"\s+on\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi, 'policy', 'drop', (match) => `${match[3]}:${match[2]}`, 1);
  collect(/create\s+policy\s+"([^"]+)"\s+on\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi, 'policy', 'create', (match) => `${match[2]}:${match[1]}`, -1);
  collect(/drop\s+trigger\s+(if\s+exists\s+)?([a-z_][\w]*)\s+on\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi, 'trigger', 'drop', (match) => `${match[3]}:${match[2]}`, 1);
  collect(/create\s+trigger\s+([a-z_][\w]*)[\s\S]*?\s+on\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi, 'trigger', 'create', (match) => `${match[2]}:${match[1]}`, -1);
  collect(/alter\s+table\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)\s+drop\s+constraint\s+(if\s+exists\s+)?([a-z_][\w]*)/gi, 'constraint', 'drop', (match) => `${match[1]}:${match[3]}`, 2);
  collect(/alter\s+table\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)\s+add\s+constraint\s+([a-z_][\w]*)/gi, 'constraint', 'create', (match) => `${match[1]}:${match[2]}`, -1);

  for (const match of sql.matchAll(/\(\s*'(public)'\s*,\s*'([a-z_][\w]*)'\s*,\s*'([^']+)'\s*,/gi)) {
    events.push({
      action: 'create',
      guarded: true,
      key: `${match[1]}.${match[2]}:${match[3]}`.toLowerCase(),
      kind: 'policy',
      offset: match.index ?? 0
    });
  }
  for (const match of sql.matchAll(/\(\s*'(workspace (?:members|writers) can [^']+ attachment objects)'\s*,/gi)) {
    events.push({
      action: 'create',
      guarded: true,
      key: `storage.objects:${match[1]}`.toLowerCase(),
      kind: 'policy',
      offset: match.index ?? 0
    });
  }

  return events.sort((left, right) => left.offset - right.offset);
}

function executeSchemaObjects(events: SchemaObjectEvent[], catalog: Set<string>): void {
  for (const event of events) {
    const catalogKey = `${event.kind}:${event.key}`;
    if (event.action === 'drop') {
      if (!catalog.delete(catalogKey) && !event.guarded) {
        throw new Error(`${event.kind} "${event.key}" does not exist`);
      }
      continue;
    }

    if (catalog.has(catalogKey)) {
      if (!event.guarded) {
        const objectName = event.kind === 'table' ? 'relation' : event.kind;
        throw new Error(`${objectName} "${event.key}" already exists`);
      }
      continue;
    }
    catalog.add(catalogKey);
  }
}

test('schema-install.sql remains repeatable across 100 executions', () => {
  const schemaPath = fileURLToPath(new URL('../../../supabase/schema-install.sql', import.meta.url));
  const sql = readFileSync(schemaPath, 'utf8');
  const events = schemaObjectEvents(sql);
  const catalog = new Set<string>();

  assert.ok(events.length > 0, 'The schema simulator did not discover any PostgreSQL objects.');
  assert.ok(events.some((event) => event.kind === 'policy'), 'The schema simulator did not discover any RLS policies.');
  const policyBlocks = sql.match(/do\s+\$\$[\s\S]*?from\s+pg_policies[\s\S]*?'create policy %I[\s\S]*?end\s+\$\$;/gi) ?? [];
  assert.equal(policyBlocks.length, 2, 'Public and Storage policy installers must both check pg_policies.');
  const triggerCount = (sql.match(/create\s+trigger\s+/gi) ?? []).length;
  const guardedTriggerCount = (sql.match(/drop\s+trigger\s+if\s+exists\s+([a-z_][\w]*)\s+on\s+[^;]+;\s*create\s+trigger\s+\1/gi) ?? []).length;
  assert.equal(guardedTriggerCount, triggerCount, 'Every trigger must be dropped immediately before it is created.');
  assert.match(
    sql,
    /insert\s+into\s+storage\.buckets[\s\S]*?on\s+conflict\s*\(id\)\s+do\s+nothing;/i,
    'Storage bucket provisioning must ignore existing bucket IDs.'
  );
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+workspace_invites/i, 'The installer must provision pending email invitations.');
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.invite_user_to_workspace/i, 'The installer must provide the admin invitation RPC.');
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.claim_pending_invite/i, 'The installer must provide a verified post-login invitation claim RPC.');
  assert.match(sql, /revoke\s+insert,\s*update,\s*delete\s+on\s+table\s+public\.workspace_invites\s+from\s+anon,\s*authenticated/i, 'Pending invitations must not accept direct client writes.');
  const onboardingFunction = sql.match(/create\s+or\s+replace\s+function\s+public\.handle_new_user_onboarding\(\)[\s\S]*?\$\$\s+language\s+plpgsql/i)?.[0] ?? '';
  assert.doesNotMatch(onboardingFunction, /workspace_invites/i, 'The onboarding trigger must not claim pending invitations.');
  const claimFunction = sql.match(/create\s+or\s+replace\s+function\s+public\.claim_pending_invite\(\)[\s\S]*?\$\$\s+language\s+plpgsql/i)?.[0] ?? '';
  assert.match(claimFunction, /email_confirmed_at\s+is\s+null/i, 'Invite claims must require a confirmed email address.');
  assert.match(claimFunction, /insert\s+into\s+public\.workspace_members/i, 'The post-login claim RPC must create the workspace membership.');
  assert.doesNotThrow(
    () => {
      for (let execution = 0; execution < 100; execution += 1) {
        executeSchemaObjects(events, catalog);
      }
    },
    'One hundred schema executions must not fail with relation, policy, trigger, index, or constraint already exists.'
  );
});

const configuredUrl =
  process.env.SUPABASE_LOCAL_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_URL ||
  'http://127.0.0.1:54321';
const configuredPublishableKey =
  process.env.SUPABASE_LOCAL_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.ANON_KEY ||
  process.env.PUBLISHABLE_KEY;
const configuredServiceRoleKey =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY;

function requireLocalSupabaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!['127.0.0.1', 'localhost', 'host.docker.internal'].includes(parsed.hostname)) {
    throw new Error(`Refusing to run destructive integration fixtures against non-local Supabase URL: ${value}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function requireEnvironmentValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is required. Start local Supabase, run "supabase status -o env", and export the matching local key.`
    );
  }
  return value;
}

function testClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

async function requireData<T>(
  operation: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>,
  label: string
): Promise<NonNullable<T>> {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  if (data === null) throw new Error(`${label}: Supabase returned no data.`);
  return data as NonNullable<T>;
}

test('Supabase keeps developer access read-only while preserving workspace boundaries', async () => {
  const url = requireLocalSupabaseUrl(configuredUrl);
  const publishableKey = requireEnvironmentValue(configuredPublishableKey, 'SUPABASE_ANON_KEY');
  const serviceRoleKey = requireEnvironmentValue(configuredServiceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY');
  const service = testClient(url, serviceRoleKey);
  const userAClient = testClient(url, publishableKey);
  const userBClient = testClient(url, publishableKey);
  const suffix = randomUUID();
  const password = `BugPocket-Boundary-${randomUUID()}!aA1`;
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const uploadedObjects: string[] = [];

  try {
    const userAResult = await service.auth.admin.createUser({
      email: `bug-pocket-boundary-user-a-${suffix}@example.com`,
      password,
      email_confirm: true
    });
    if (userAResult.error || !userAResult.data.user) {
      throw new Error(`Create User A: ${userAResult.error?.message || 'No user returned.'}`);
    }
    const userA = userAResult.data.user;
    createdUserIds.push(userA.id);

    const userBResult = await service.auth.admin.createUser({
      email: `bug-pocket-boundary-user-b-${suffix}@example.com`,
      password,
      email_confirm: true
    });
    if (userBResult.error || !userBResult.data.user) {
      throw new Error(`Create User B: ${userBResult.error?.message || 'No user returned.'}`);
    }
    const userB = userBResult.data.user;
    createdUserIds.push(userB.id);

    const workspaceAName = `Workspace A ${suffix}`;
    const workspaceBName = `Workspace B ${suffix}`;
    const workspaceA = await requireData(
      service.from('workspaces').insert({ name: workspaceAName, created_by: userA.id }).select('id, name').single(),
      'Create Workspace A'
    );
    const workspaceB = await requireData(
      service.from('workspaces').insert({ name: workspaceBName, created_by: userB.id }).select('id, name').single(),
      'Create Workspace B'
    );
    createdWorkspaceIds.push(workspaceA.id, workspaceB.id);

    await requireData(
      service.from('workspace_members').insert([
        { workspace_id: workspaceA.id, user_id: userA.id, role: 'owner' },
        { workspace_id: workspaceB.id, user_id: userB.id, role: 'owner' },
        { workspace_id: workspaceA.id, user_id: userB.id, role: 'developer' }
      ]),
      'Create owner and developer memberships'
    );

    for (const [client, user, label] of [
      [userAClient, userA, 'User A'],
      [userBClient, userB, 'User B']
    ] as const) {
      const signIn = await client.auth.signInWithPassword({ email: user.email!, password });
      if (signIn.error || signIn.data.user?.id !== user.id) {
        throw new Error(`Authenticate ${label}: ${signIn.error?.message || 'Unexpected authenticated user.'}`);
      }
    }

    const ownedWorkspacePath = `${workspaceA.id}/owned-${suffix}.png`;
    const ownedUpload = await userAClient.storage
      .from('attachments')
      .upload(ownedWorkspacePath, Buffer.from('workspace-a-storage-probe', 'utf8'), {
        contentType: 'image/png',
        upsert: false
      });
    if (ownedUpload.error) throw new Error(`Workspace A attachment upload failed: ${ownedUpload.error.message}`);
    uploadedObjects.push(ownedWorkspacePath);

    const crossWorkspacePath = `${workspaceA.id}/cross-workspace-${suffix}.png`;
    const crossWorkspaceUpload = await userBClient.storage
      .from('attachments')
      .upload(crossWorkspacePath, Buffer.from('cross-workspace-storage-probe', 'utf8'), {
        contentType: 'image/png',
        upsert: false
      });
    if (!crossWorkspaceUpload.error) uploadedObjects.push(crossWorkspacePath);
    assert.ok(crossWorkspaceUpload.error, 'User B must not upload objects beneath Workspace A.');
    const storageStatus = Number(
      (crossWorkspaceUpload.error as unknown as { statusCode?: string | number; status?: string | number }).statusCode ??
      (crossWorkspaceUpload.error as unknown as { status?: string | number }).status
    );
    assert.equal(
      storageStatus,
      403,
      `Expected HTTP 403 for User B's cross-workspace upload, received ${storageStatus || 'no status'}: ` +
      crossWorkspaceUpload.error.message
    );

    const developerMembership = await requireData(
      userBClient
        .from('workspace_members')
        .select('workspace_id, user_id, role')
        .eq('workspace_id', workspaceA.id)
        .eq('user_id', userB.id)
        .single(),
      'Verify User B developer membership'
    );
    assert.equal(developerMembership.role, 'developer');

    const developerBugInsert = await userBClient
      .from('bugs')
      .insert({
        workspace_id: workspaceA.id,
        created_by: userB.id,
        title: `Developer mutation probe ${suffix}`,
        note: 'Characterization fixture: developer role currently retains workspace-member write access.'
      })
      .select('id, workspace_id, created_by')
      .single();

    assert.ok(developerBugInsert.error, 'Developer bug INSERT must be rejected by RLS.');
    assert.equal(
      developerBugInsert.error.code,
      '42501',
      `Expected insufficient_privilege (42501), received ${developerBugInsert.error.code || 'no code'}: ${developerBugInsert.error.message}`
    );
    assert.equal(developerBugInsert.data, null);

    const renamedWorkspaceA = `${workspaceAName} Renamed`;
    const renameAttempt = await userAClient
      .from('workspaces')
      .update({ name: renamedWorkspaceA })
      .eq('id', workspaceA.id)
      .select('id, name');

    if (renameAttempt.error) throw new Error(`Workspace owner rename failed: ${renameAttempt.error.message}`);
    assert.deepEqual(renameAttempt.data, [{ id: workspaceA.id, name: renamedWorkspaceA }]);

    const persistedWorkspace = await requireData(
      service.from('workspaces').select('name').eq('id', workspaceA.id).single(),
      'Verify Workspace A name'
    );
    assert.equal(persistedWorkspace.name, renamedWorkspaceA, 'Workspace A rename did not persist.');
  } finally {
    await Promise.all([
      userAClient.auth.signOut().catch(() => undefined),
      userBClient.auth.signOut().catch(() => undefined)
    ]);
    if (uploadedObjects.length > 0) {
      await service.storage.from('attachments').remove(uploadedObjects).catch(() => undefined);
    }
    if (createdWorkspaceIds.length > 0) {
      await service.from('workspaces').delete().in('id', createdWorkspaceIds);
    }
    if (createdUserIds.length > 0) {
      // Auth onboarding creates an additional default workspace for each user.
      await service.from('workspaces').delete().in('created_by', createdUserIds);
    }
    for (const userId of createdUserIds.reverse()) {
      await service.auth.admin.deleteUser(userId);
    }
  }
});
