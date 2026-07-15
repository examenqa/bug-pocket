export {};

const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const {
  callOpenAiCompatibleChatWithFallback
}: typeof import('./byokIssueProcessor') = require('./byokIssueProcessor.ts');

test('retries Gemini with the secondary model after a retryable primary failure', async () => {
  const originalFetch = globalThis.fetch;
  const requestedModels: string[] = [];

  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      requestedModels.push(String(body.model));

      if (requestedModels.length === 1) {
        return new Response(JSON.stringify({ error: { message: 'Primary model unavailable' } }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"title":"Fallback succeeded"}' } }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    const result = await callOpenAiCompatibleChatWithFallback({
      apiKey: 'test-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      modelId: 'gemini-3.5-flash',
      provider: 'Gemini',
      systemPrompt: 'Return JSON.',
      userPrompt: 'Format this issue.'
    });

    assert.equal(result, '{"title":"Fallback succeeded"}');
    assert.deepEqual(requestedModels, ['gemini-3.5-flash', 'gemini-1.5-flash']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not hide an invalid Gemini model error behind a fallback', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  try {
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ error: { message: 'Model not found' } }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    await assert.rejects(
      callOpenAiCompatibleChatWithFallback({
        apiKey: 'test-key',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        modelId: 'gemini-does-not-exist',
        provider: 'Gemini',
        systemPrompt: 'Return JSON.',
        userPrompt: 'Format this issue.'
      }),
      (error: unknown) => {
        assert.equal(requestCount, 1);
        assert.ok(error instanceof Error);
        assert.match(error.message, /Model not found/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
