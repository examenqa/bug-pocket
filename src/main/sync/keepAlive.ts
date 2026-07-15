export const SUPABASE_KEEP_ALIVE_INTERVAL_MS = 86_400_000;
export const SUPABASE_INITIAL_KEEP_ALIVE_DELAY_MS = 300_000;

const KEEP_ALIVE_TIMEOUT_MS = 15_000;

export interface SupabaseKeepAliveSettings {
  getSupabaseProjectUrl(): string | null;
  getSupabaseAnonKey(): string | null;
}

export async function pingSupabase(
  settings: SupabaseKeepAliveSettings,
  fetchImplementation: typeof fetch = globalThis.fetch
): Promise<void> {
  try {
    const projectUrl = settings.getSupabaseProjectUrl()?.trim();
    const anonKey = settings.getSupabaseAnonKey()?.trim();
    if (!projectUrl || !anonKey) return;

    const endpoint = new URL('/rest/v1/workspaces', projectUrl);
    if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') return;
    endpoint.searchParams.set('select', 'id');
    endpoint.searchParams.set('limit', '1');

    await fetchImplementation(endpoint, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      signal: AbortSignal.timeout(KEEP_ALIVE_TIMEOUT_MS)
    });
  } catch {
    // Keep-alive traffic must never interrupt the app or surface UI errors.
  }
}

export function startSupabaseKeepAlive(settings: SupabaseKeepAliveSettings): () => void {
  const runPing = (): void => {
    void pingSupabase(settings);
  };

  const initialTimer = setTimeout(runPing, SUPABASE_INITIAL_KEEP_ALIVE_DELAY_MS);
  const recurringTimer = setInterval(runPing, SUPABASE_KEEP_ALIVE_INTERVAL_MS);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(recurringTimer);
  };
}
