import assert from 'node:assert/strict';
import test from 'node:test';
import { pingSupabase, type SupabaseKeepAliveSettings } from './keepAlive';

function settings(projectUrl: string | null, anonKey: string | null): SupabaseKeepAliveSettings {
  return {
    getSupabaseProjectUrl: () => projectUrl,
    getSupabaseAnonKey: () => anonKey
  };
}

test('pingSupabase sends the expected lightweight REST request', async () => {
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;

  await pingSupabase(settings('https://example.supabase.co', 'publishable-key'), async (input, init) => {
    requestedUrl = input.toString();
    requestedInit = init;
    return new Response('[]', { status: 200 });
  });

  assert.equal(requestedUrl, 'https://example.supabase.co/rest/v1/workspaces?select=id&limit=1');
  assert.equal(requestedInit?.method, 'GET');
  assert.deepEqual(requestedInit?.headers, {
    apikey: 'publishable-key',
    Authorization: 'Bearer publishable-key'
  });
});

test('pingSupabase skips requests when credentials are incomplete', async () => {
  let requestCount = 0;
  const fetchImplementation: typeof fetch = async () => {
    requestCount += 1;
    return new Response(null, { status: 200 });
  };

  await pingSupabase(settings(null, 'publishable-key'), fetchImplementation);
  await pingSupabase(settings('https://example.supabase.co', null), fetchImplementation);

  assert.equal(requestCount, 0);
});

test('pingSupabase silently absorbs network and configuration failures', async () => {
  const rejectedFetch: typeof fetch = async () => {
    throw new Error('offline');
  };

  await assert.doesNotReject(() => pingSupabase(settings('https://example.supabase.co', 'key'), rejectedFetch));
  await assert.doesNotReject(() => pingSupabase(settings('not a URL', 'key'), rejectedFetch));
});
