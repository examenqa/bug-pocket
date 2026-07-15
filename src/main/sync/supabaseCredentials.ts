const hostedSupabaseHostSuffix = '.supabase.co';
const localSupabaseHosts = new Set(['localhost', '127.0.0.1']);

function invalidUrlError(): Error {
  return new Error('Use a hosted https://<project>.supabase.co URL or local http://localhost/127.0.0.1 for Supabase.');
}

export function normalizeSupabaseProjectUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw invalidUrlError();
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw invalidUrlError();
  }

  const hostname = parsed.hostname.toLowerCase();
  const hostedProject = parsed.protocol === 'https:' && hostname.endsWith(hostedSupabaseHostSuffix);
  const localProject = parsed.protocol === 'http:' && localSupabaseHosts.has(hostname);
  if (!hostedProject && !localProject) throw invalidUrlError();

  return parsed.toString().replace(/\/$/, '');
}

function isLegacyAnonJwt(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3 || !parts.every(Boolean)) return false;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

export function normalizeSupabasePublishableKey(value: string): string {
  const key = value.trim();
  const lowered = key.toLowerCase();
  if (!key || key.length > 20_000 || lowered.includes('service_role') || lowered.includes('secret') || lowered.startsWith('sb_secret_')) {
    throw new Error('Use a Supabase Publishable or legacy anon key. Secret and service_role keys are not allowed.');
  }

  // Current publishable keys use this prefix. Rejecting every "sb_" key would
  // also reject legitimate publishable keys, so only the secret variant is blocked.
  const publishableKey = /^sb_publishable_[A-Za-z0-9_-]{8,}$/i.test(key);
  if (!publishableKey && !isLegacyAnonJwt(key)) {
    throw new Error('Use a structurally valid Supabase Publishable or legacy anon key.');
  }

  return key;
}

export function normalizeSupabaseCredentials(projectUrl: string, anonKey: string): { projectUrl: string; anonKey: string } {
  return {
    projectUrl: normalizeSupabaseProjectUrl(projectUrl),
    anonKey: normalizeSupabasePublishableKey(anonKey)
  };
}
