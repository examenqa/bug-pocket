import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { TeamInvitePayload } from '../../shared/types';
import { normalizeSupabaseCredentials } from './supabaseCredentials';

export type { TeamInvitePayload } from '../../shared/types';

const INVITE_VERSION = 2 as const;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 310_000;
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function inviteError(): Error {
  return new Error('Unable to decrypt invite code. Check the code and passphrase.');
}

function validatePassphrase(passphrase: string): string {
  const cleaned = passphrase.trim();
  if (cleaned.length < 12 || cleaned.length > 512) {
    throw new Error('Use an invite passphrase between 12 and 512 characters.');
  }
  return cleaned;
}

export function normalizeInviteTargetEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 320) {
    throw new Error('A valid invitee email address is required.');
  }
  return normalized;
}

function validatePayload(
  url: string,
  anonKey: string,
  teamId: string,
  targetEmail: string,
  timestamps?: Pick<TeamInvitePayload, 'issuedAt' | 'expiresAt'>
): TeamInvitePayload {
  const credentials = normalizeSupabaseCredentials(url, anonKey);
  if (!UUID_PATTERN.test(teamId.trim())) {
    throw new Error('A valid workspace ID is required.');
  }

  const createdAtMs = Date.now();
  const issuedAt = timestamps?.issuedAt ?? new Date(createdAtMs).toISOString();
  const expiresAt = timestamps?.expiresAt ?? new Date(createdAtMs + INVITE_TTL_MS).toISOString();
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAtMs) {
    throw inviteError();
  }

  return {
    version: INVITE_VERSION,
    url: credentials.projectUrl,
    anonKey: credentials.anonKey,
    teamId: teamId.trim(),
    targetEmail: normalizeInviteTargetEmail(targetEmail),
    issuedAt,
    expiresAt
  };
}

function deriveKey(passphrase: string, iv: Buffer): Buffer {
  const salt = Buffer.concat([Buffer.from('bug-pocket-invite:v1:', 'utf8'), iv]);
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

function fromBase64Url(part: string): Buffer {
  if (!part || !BASE64_URL_PATTERN.test(part)) throw inviteError();
  try {
    return Buffer.from(part, 'base64url');
  } catch {
    throw inviteError();
  }
}

export function generateInviteCode(url: string, anonKey: string, teamId: string, passphrase: string, targetEmail: string): string {
  const payload = validatePayload(url, anonKey, teamId, targetEmail);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(validatePassphrase(passphrase), iv);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}:${authTag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decodeInviteCode(token: string, passphrase: string): TeamInvitePayload {
  const [ivPart, authTagPart, ciphertextPart, extraPart] = token.trim().split(':');
  if (!ivPart || !authTagPart || !ciphertextPart || extraPart) throw inviteError();

  try {
    const iv = fromBase64Url(ivPart);
    const authTag = fromBase64Url(authTagPart);
    const ciphertext = fromBase64Url(ciphertextPart);
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || !ciphertext.length) throw inviteError();

    const key = deriveKey(validatePassphrase(passphrase), iv);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as Partial<TeamInvitePayload>;
    if (parsed.version !== INVITE_VERSION || typeof parsed.url !== 'string' || typeof parsed.anonKey !== 'string' || typeof parsed.teamId !== 'string' || typeof parsed.targetEmail !== 'string' || typeof parsed.issuedAt !== 'string' || typeof parsed.expiresAt !== 'string') {
      throw inviteError();
    }
    const payload = validatePayload(parsed.url, parsed.anonKey, parsed.teamId, parsed.targetEmail, {
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt
    });
    if (Date.now() > Date.parse(payload.expiresAt)) {
      throw new Error('This invite code has expired. Ask your workspace admin for a new one.');
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === 'Use an invite passphrase between 12 and 512 characters.') throw error;
    if (error instanceof Error && error.message === 'This invite code has expired. Ask your workspace admin for a new one.') throw error;
    throw inviteError();
  }
}
