const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

// Authorization regression: this script passes only when an authenticated user
// cannot self-enroll in another user's workspace through the public client.
const supabaseUrl =
  process.env.SUPABASE_LOCAL_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_URL ||
  'http://127.0.0.1:54321';
const publishableKey =
  process.env.SUPABASE_LOCAL_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.ANON_KEY ||
  process.env.PUBLISHABLE_KEY;
const serviceRoleKey =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY;

function requireLocalSupabaseUrl(value) {
  const parsed = new URL(value);
  if (!['127.0.0.1', 'localhost', 'host.docker.internal'].includes(parsed.hostname)) {
    throw new Error(`Refusing to run destructive authorization fixtures against non-local Supabase URL: ${value}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function requireEnvironmentValue(value, name) {
  if (!value) {
    throw new Error(
      `${name} is required. Start local Supabase, run \"supabase status -o env\", and export the matching local key.`
    );
  }
  return value;
}

function createTestClient(url, key) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

async function mustSucceed(operation, label) {
  const result = await operation;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function run() {
  const localUrl = requireLocalSupabaseUrl(supabaseUrl);
  const localPublishableKey = requireEnvironmentValue(publishableKey, 'SUPABASE_ANON_KEY');
  const localServiceRoleKey = requireEnvironmentValue(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY');
  const service = createTestClient(localUrl, localServiceRoleKey);
  const userBClient = createTestClient(localUrl, localPublishableKey);
  const suffix = randomUUID();
  const password = `BugPocket-RLS-${randomUUID()}!aA1`;
  const createdUserIds = [];
  let workspaceAId = null;

  try {
    const userAResult = await service.auth.admin.createUser({
      email: `bug-pocket-user-a-${suffix}@example.com`,
      password,
      email_confirm: true
    });
    if (userAResult.error || !userAResult.data.user) {
      throw new Error(`Create User A: ${userAResult.error?.message || 'No user returned.'}`);
    }
    const userA = userAResult.data.user;
    createdUserIds.push(userA.id);

    const userBResult = await service.auth.admin.createUser({
      email: `bug-pocket-user-b-${suffix}@example.com`,
      password,
      email_confirm: true
    });
    if (userBResult.error || !userBResult.data.user) {
      throw new Error(`Create User B: ${userBResult.error?.message || 'No user returned.'}`);
    }
    const userB = userBResult.data.user;
    createdUserIds.push(userB.id);

    const workspaceA = await mustSucceed(
      service
        .from('workspaces')
        .insert({ name: `User A Workspace ${suffix}`, created_by: userA.id })
        .select('id')
        .single(),
      'Create User A workspace'
    );
    workspaceAId = workspaceA.id;

    await mustSucceed(
      service.from('workspace_members').insert({
        workspace_id: workspaceAId,
        user_id: userA.id,
        role: 'owner'
      }),
      'Create User A owner membership'
    );

    const membershipBefore = await mustSucceed(
      service
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceAId)
        .eq('user_id', userB.id),
      'Check User B membership precondition'
    );
    assert.equal(membershipBefore.length, 0, 'Precondition failed: User B is already a workspace member.');

    const signInResult = await userBClient.auth.signInWithPassword({
      email: userB.email,
      password
    });
    if (signInResult.error || !signInResult.data.user) {
      throw new Error(`Authenticate User B: ${signInResult.error?.message || 'No authenticated user returned.'}`);
    }
    assert.equal(signInResult.data.user.id, userB.id, 'The exploit client is not authenticated as User B.');

    await assert.rejects(
      userBClient
        .from('workspace_members')
        .insert({
          workspace_id: workspaceAId,
          user_id: userB.id,
          role: 'member'
        })
        .throwOnError(),
      (error) => {
        assert.equal(
          error?.code,
          '42501',
          `Expected SQLSTATE 42501 for direct self-enrollment, received ${error?.code || 'no error code'}: ${error?.message}`
        );
        return true;
      },
      'Expected User B self-enrollment to be rejected.'
    );

    const membershipAfter = await mustSucceed(
      service
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceAId)
        .eq('user_id', userB.id),
      'Verify User B was not enrolled'
    );
    assert.equal(membershipAfter.length, 0, 'User B membership was created despite the authorization error.');

    console.log('AUTHORIZATION ENFORCED: direct self-enrollment was rejected with SQLSTATE 42501.');
  } finally {
    await userBClient.auth.signOut().catch(() => undefined);
    if (createdUserIds.length > 0) {
      await service.from('workspaces').delete().in('created_by', createdUserIds);
    }
    for (const userId of createdUserIds.reverse()) {
      await service.auth.admin.deleteUser(userId);
    }
  }
}

run().catch((error) => {
  console.error('Workspace self-enrollment authorization test failed:', error);
  process.exitCode = 1;
});
