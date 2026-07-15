import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeInviteCode, generateInviteCode, INVITE_TTL_MS } from './inviteToken';

const projectUrl = 'https://team-example.supabase.co';
const anonKey = 'sb_publishable_example_key';
const workspaceId = '550e8400-e29b-41d4-a716-446655440000';
const passphrase = 'correct horse battery staple';
const targetEmail = 'qa.engineer@example.com';

test('invite token round trip preserves the project configuration', () => {
  const token = generateInviteCode(projectUrl, anonKey, workspaceId, passphrase, ' QA.Engineer@Example.com ');
  assert.match(token, /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);

  const payload = decodeInviteCode(token, passphrase);
  assert.equal(payload.version, 2);
  assert.equal(payload.url, projectUrl);
  assert.equal(payload.anonKey, anonKey);
  assert.equal(payload.teamId, workspaceId);
  assert.equal(payload.targetEmail, targetEmail);
  assert.ok(Date.parse(payload.issuedAt));
  assert.ok(Date.parse(payload.expiresAt));
  assert.equal(Date.parse(payload.expiresAt) - Date.parse(payload.issuedAt), INVITE_TTL_MS);
});

test('invite token rejects an incorrect passphrase without exposing decrypted data', () => {
  const token = generateInviteCode(projectUrl, anonKey, workspaceId, passphrase, targetEmail);
  assert.throws(() => decodeInviteCode(token, 'a different secure passphrase'), /Unable to decrypt invite code/);
});

test('invite token rejects malformed input', () => {
  assert.throws(() => decodeInviteCode('not:a:valid:token', passphrase), /Unable to decrypt invite code/);
  assert.throws(() => decodeInviteCode('invalid', passphrase), /Unable to decrypt invite code/);
});

test('invite token rejects expired and untrusted project credentials', () => {
  const originalNow = Date.now;
  const issuedAt = originalNow();
  try {
    const token = generateInviteCode(projectUrl, anonKey, workspaceId, passphrase, targetEmail);
    Date.now = () => issuedAt + INVITE_TTL_MS + 1;
    assert.throws(() => decodeInviteCode(token, passphrase), /invite code has expired/i);
  } finally {
    Date.now = originalNow;
  }

  assert.throws(
    () => generateInviteCode('https://attacker.example', anonKey, workspaceId, passphrase, targetEmail),
    /Supabase/i
  );
  assert.throws(
    () => generateInviteCode(projectUrl, 'sb_secret_compromised_key', workspaceId, passphrase, targetEmail),
    /Secret and service_role keys are not allowed/i
  );
  assert.throws(
    () => generateInviteCode(projectUrl, anonKey, workspaceId, passphrase, 'not-an-email'),
    /valid invitee email/i
  );
});
