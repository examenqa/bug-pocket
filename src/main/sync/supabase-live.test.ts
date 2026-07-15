import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const localUrl = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321';
const publishableKey =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  process.env.SUPABASE_LOCAL_PUBLISHABLE_KEY ??
  process.env.ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY;

function requireLoopbackUrl(value: string): string {
  const parsed = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error(`Refusing to run live security fixtures against a non-local Supabase URL: ${value}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is required. Start local Supabase and copy the local credentials from "supabase status -o env".`
    );
  }
  return value;
}

function localClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

async function createConfirmedUser(
  service: SupabaseClient,
  email: string,
  password: string
): Promise<{ id: string; email: string }> {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (error || !data.user?.email) {
    throw new Error(`Could not create confirmed local test user: ${error?.message ?? 'No user returned.'}`);
  }
  return { id: data.user.id, email: data.user.email };
}

async function signIn(client: SupabaseClient, email: string, password: string): Promise<void> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`Could not authenticate local test user: ${error?.message ?? 'No user returned.'}`);
}

test('live Supabase invitation RPC boundaries', async (context) => {
  const url = requireLoopbackUrl(localUrl);
  const anonKey = requireValue(publishableKey, 'SUPABASE_LOCAL_ANON_KEY');
  const serviceKey = requireValue(serviceRoleKey, 'SUPABASE_LOCAL_SERVICE_ROLE_KEY');
  const service = localClient(url, serviceKey);
  const ownerClient = localClient(url, anonKey);
  const memberClient = localClient(url, anonKey);
  const inviteeClient = localClient(url, anonKey);
  const suffix = randomUUID();
  const password = `BugPocket-Live-${randomUUID()}!aA1`;
  const userIds: string[] = [];
  let ownerWorkspaceId = '';
  let inviteeEmail = '';

  try {
    const owner = await createConfirmedUser(service, `owner-${suffix}@example.com`, password);
    const member = await createConfirmedUser(service, `member-${suffix}@example.com`, password);
    userIds.push(owner.id, member.id);

    const ownerMembership = await service
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', owner.id)
      .eq('role', 'owner')
      .single();
    if (ownerMembership.error || !ownerMembership.data) {
      throw new Error(`Could not resolve the owner's personal workspace: ${ownerMembership.error?.message ?? 'No membership returned.'}`);
    }
    ownerWorkspaceId = String(ownerMembership.data.workspace_id);

    const memberGrant = await service.from('workspace_members').insert({
      workspace_id: ownerWorkspaceId,
      user_id: member.id,
      role: 'member'
    });
    if (memberGrant.error) throw new Error(`Could not create the member fixture: ${memberGrant.error.message}`);

    await signIn(ownerClient, owner.email, password);
    await signIn(memberClient, member.email, password);
    inviteeEmail = `invitee-${suffix}@example.com`;

    await context.test('owner can create a pending workspace invitation', async () => {
      const result = await ownerClient.rpc('invite_user_to_workspace', {
        target_workspace_id: ownerWorkspaceId,
        target_email: inviteeEmail,
        target_role: 'member'
      });

      assert.equal(result.status, 200);
      assert.equal(result.error, null);
      assert.match(String(result.data), /^[0-9a-f-]{36}$/i);

      const persistedInvite = await service
        .from('workspace_invites')
        .select('workspace_id, email, role, accepted_at')
        .eq('id', result.data)
        .single();
      assert.equal(persistedInvite.error, null);
      assert.deepEqual(persistedInvite.data, {
        workspace_id: ownerWorkspaceId,
        email: inviteeEmail,
        role: 'member',
        accepted_at: null
      });
    });

    await context.test('standard member cannot create workspace invitations', async () => {
      const result = await memberClient.rpc('invite_user_to_workspace', {
        target_workspace_id: ownerWorkspaceId,
        target_email: `blocked-${suffix}@example.com`,
        target_role: 'member'
      });

      assert.ok(result.error, 'Expected the non-admin invitation RPC to be rejected.');
      assert.equal(result.error.code, '42501');
      assert.equal(result.data, null);
    });

    await context.test('confirmed invitee can claim the pending membership after login', async () => {
      const invitee = await createConfirmedUser(service, inviteeEmail, password);
      userIds.push(invitee.id);
      await signIn(inviteeClient, invitee.email, password);

      const claim = await inviteeClient.rpc('claim_pending_invite');
      assert.equal(claim.status, 200);
      assert.equal(claim.error, null);
      assert.equal(claim.data, ownerWorkspaceId);

      const membership = await service
        .from('workspace_members')
        .select('workspace_id, user_id, role')
        .eq('workspace_id', ownerWorkspaceId)
        .eq('user_id', invitee.id)
        .single();
      assert.equal(membership.error, null);
      assert.deepEqual(membership.data, {
        workspace_id: ownerWorkspaceId,
        user_id: invitee.id,
        role: 'member'
      });
    });
  } finally {
    await Promise.all([
      ownerClient.auth.signOut().catch(() => undefined),
      memberClient.auth.signOut().catch(() => undefined),
      inviteeClient.auth.signOut().catch(() => undefined)
    ]);
    if (ownerWorkspaceId) await service.from('workspaces').delete().eq('id', ownerWorkspaceId);
    if (userIds.length) await service.from('workspaces').delete().in('created_by', userIds);
    for (const userId of userIds.reverse()) {
      await service.auth.admin.deleteUser(userId);
    }
  }
});
