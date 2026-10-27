export {};

const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const {
  callOpenAiCompatibleChatWithFallback,
  extractJsonObjectString,
  saveByokAiConfig
}: typeof import('./byokIssueProcessor') = require('./byokIssueProcessor.ts');

test('rejects an insecure saved endpoint before replacing credentials or updating settings', () => {
  let writes = 0;
  const database = { updateByokAiConfig: () => { writes += 1; } };
  assert.throws(() => saveByokAiConfig(database as never, {
    provider: 'Custom/Local',
    baseUrl: 'http://remote.example.test/v1',
    modelId: 'configured-model',
    customSystemPrompt: '',
    apiKeyOperation: { action: 'replace', value: 'test-secret' }
  }), /must use HTTPS/);
  assert.equal(writes, 0);
});

test('incomplete configuration cannot replace persisted credentials or settings', () => {
  const { BugPocketDatabase } = require('../database.ts') as typeof import('../database');
  const { mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'bug-pocket-ai-invalid-config-'));
  const database = new BugPocketDatabase(directory);
  try {
    database.updateByokAiConfig('Gemini', 'https://example.test/v1', 'saved-model', 'saved-ciphertext', 'saved-prompt');
    const connection = (database as unknown as { localDb: import('better-sqlite3').Database }).localDb;
    const snapshot = () => connection.prepare('SELECT key, value FROM app_settings ORDER BY key').all();
    const before = snapshot();
    for (const fields of [
      { baseUrl: '', modelId: 'new-model' },
      { baseUrl: '  ', modelId: 'new-model' },
      { baseUrl: 'https://example.test/v2', modelId: '' },
      { baseUrl: 'https://example.test/v2', modelId: '  ' }
    ]) {
      assert.throws(() => saveByokAiConfig(database, {
        provider: 'Custom/Local', ...fields, customSystemPrompt: 'new-prompt',
        apiKeyOperation: { action: 'replace', value: 'replacement-secret' }
      }), /required|not configured/i);
      assert.deepEqual(snapshot(), before, 'invalid configuration must not mutate saved settings or ciphertext');
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const replacement of [undefined, 'new-provider-ciphertext']) {
  test(`switching providers preserves a legacy-only credential across restart (replacement=${Boolean(replacement)})`, () => {
    const { BugPocketDatabase } = require('../database.ts') as typeof import('../database');
    const { mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs');
    const { tmpdir } = require('node:os') as typeof import('node:os');
    const { join } = require('node:path') as typeof import('node:path');
    const directory = mkdtempSync(join(tmpdir(), 'bug-pocket-ai-legacy-provider-'));
    let database = new BugPocketDatabase(directory);
    try {
      database.updateByokAiConfig('Gemini', 'https://example.test/v1', 'gemini-model', undefined, 'prompt');
      const connection = (database as unknown as { localDb: import('better-sqlite3').Database }).localDb;
      connection.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('legacy-gemini-ciphertext', 'byok_ai_api_key_encrypted');
      database.updateByokAiConfig('Custom/Local', 'http://localhost:11434/v1', 'local-model', replacement, 'prompt');
      database.close();
      database = new BugPocketDatabase(directory);
      assert.equal(database.getEncryptedByokAiApiKey('Gemini'), 'legacy-gemini-ciphertext');
      assert.equal(database.getEncryptedByokAiApiKey('Custom/Local'), replacement ?? '');
      database.clearByokAiApiKey('Custom/Local');
      database.close();
      database = new BugPocketDatabase(directory);
      assert.equal(database.getEncryptedByokAiApiKey('Gemini'), 'legacy-gemini-ciphertext');
      assert.equal(database.getEncryptedByokAiApiKey('Custom/Local'), '');
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('credential removal rolls back both key settings if the legacy-key write fails', () => {
  const { BugPocketDatabase } = require('../database.ts') as typeof import('../database');
  const { mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'bug-pocket-ai-clear-rollback-'));
  let database = new BugPocketDatabase(directory);
  try {
    database.updateByokAiConfig('Gemini', 'https://example.test/v1', 'saved-model', 'gemini-ciphertext', 'saved-prompt');
    database.updateByokAiConfig('Custom/Local', 'http://localhost:11434/v1', 'local-model', 'local-ciphertext', 'prompt');
    const connection = (database as unknown as { localDb: import('better-sqlite3').Database }).localDb;
    connection.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('legacy-ciphertext', 'byok_ai_api_key_encrypted');
    const before = connection.prepare('SELECT key, value FROM app_settings ORDER BY key').all();
    connection.exec(`CREATE TEMP TRIGGER reject_legacy_clear BEFORE UPDATE OF value ON app_settings
      WHEN NEW.key = 'byok_ai_api_key_encrypted' AND NEW.value = ''
      BEGIN SELECT RAISE(ABORT, 'simulated legacy-key write failure'); END`);
    assert.throws(() => database.clearByokAiApiKey('Custom/Local'), /simulated legacy-key write failure/);
    assert.deepEqual(connection.prepare('SELECT key, value FROM app_settings ORDER BY key').all(), before);
    database.close();
    database = new BugPocketDatabase(directory);
    assert.equal(database.getEncryptedByokAiApiKey('Gemini'), 'gemini-ciphertext');
    assert.equal(database.getEncryptedByokAiApiKey('Custom/Local'), 'local-ciphertext');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('OpenAI selection and legacy key removal retain their provider identity', () => {
  const { BugPocketDatabase } = require('../database.ts') as typeof import('../database');
  const { mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'bug-pocket-ai-openai-provider-'));
  let database = new BugPocketDatabase(directory);
  try {
    database.updateByokAiConfig('OpenAI', 'https://api.openai.com/v1', 'openai-model', undefined, 'prompt');
    assert.equal(database.getByokAiProvider(), 'OpenAI');
    const connection = (database as unknown as { localDb: import('better-sqlite3').Database }).localDb;
    connection.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('legacy-openai-ciphertext', 'byok_ai_api_key_encrypted');
    assert.equal(database.getEncryptedByokAiApiKey('OpenAI'), 'legacy-openai-ciphertext');
    assert.equal(database.getEncryptedByokAiApiKey('OpenRouter'), '');
    database.clearByokAiApiKey('OpenAI');
    database.close();
    database = new BugPocketDatabase(directory);
    assert.equal(database.getByokAiProvider(), 'OpenAI');
    assert.equal(database.getEncryptedByokAiApiKey('OpenAI'), '');
    assert.equal(database.getEncryptedByokAiApiKey('OpenRouter'), '');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const legacyOnly of [false, true]) {
  test(`clearing a key remains possible with an old HTTP endpoint and cannot resurrect legacy ciphertext (legacy-only=${legacyOnly})`, () => {
    const { BugPocketDatabase } = require('../database.ts') as typeof import('../database');
    const { mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs');
    const { tmpdir } = require('node:os') as typeof import('node:os');
    const { join } = require('node:path') as typeof import('node:path');
    const directory = mkdtempSync(join(tmpdir(), 'bug-pocket-ai-key-clear-'));
    let database = new BugPocketDatabase(directory);
    try {
      database.updateByokAiConfig('Custom/Local', 'http://remote.example.test/v1', 'old-model', legacyOnly ? undefined : 'current-ciphertext', 'old-prompt');
      const connection = (database as unknown as { localDb: import('better-sqlite3').Database }).localDb;
      connection.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('legacy-ciphertext', 'byok_ai_api_key_encrypted');
      assert.ok(database.getEncryptedByokAiApiKey('Custom/Local'));

      const result = saveByokAiConfig(database, {
        provider: 'Custom/Local', baseUrl: legacyOnly ? '' : 'http://remote.example.test/v1', modelId: '', customSystemPrompt: '',
        apiKeyOperation: { action: 'clear' }
      });
      assert.equal(result.hasApiKey, false);
      assert.equal(database.getEncryptedByokAiApiKey('Custom/Local'), '');
      assert.equal(database.getByokAiBaseUrl(), 'http://remote.example.test/v1', 'key removal does not rewrite unrelated saved configuration');
      assert.equal(database.getByokAiModelId(), 'old-model');
      assert.equal(database.getByokAiCustomSystemPrompt(), 'old-prompt');
      database.close();
      database = new BugPocketDatabase(directory);
      assert.equal(database.getEncryptedByokAiApiKey('Custom/Local'), '', 'cleared credentials must stay cleared after restart');
    } finally {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

test('clearing one provider retains other provider keys, including a retained legacy key', () => {
  const { BugPocketDatabase } = require('../database.ts') as typeof import('../database');
  const { mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'bug-pocket-ai-key-preserve-'));
  const database = new BugPocketDatabase(directory);
  try {
    database.updateByokAiConfig('Custom/Local', 'http://localhost:11434/v1', 'local-model', undefined, 'prompt');
    const connection = (database as unknown as { localDb: import('better-sqlite3').Database }).localDb;
    connection.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('legacy-ciphertext', 'byok_ai_api_key_encrypted');
    database.clearByokAiApiKey('OpenAI');
    assert.equal(database.getEncryptedByokAiApiKey('Custom/Local'), 'legacy-ciphertext');

    database.updateByokAiConfig('OpenAI', 'https://api.openai.com/v1', 'openai-model', 'other-ciphertext', 'prompt');
    saveByokAiConfig(database, { provider: 'Custom/Local', baseUrl: '', modelId: '', customSystemPrompt: '', apiKeyOperation: { action: 'clear' } });
    assert.equal(database.getEncryptedByokAiApiKey('Custom/Local'), '');
    assert.equal(database.getEncryptedByokAiApiKey('OpenAI'), 'other-ciphertext');
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects legacy insecure endpoints before sending text, images or credentials', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = (async () => { requests += 1; throw new Error('Unexpected network call'); }) as typeof fetch;
    await assert.rejects(callOpenAiCompatibleChatWithFallback({
      apiKey: 'test-secret', baseUrl: 'http://remote.example.test/v1',
      provider: 'Gemini', modelId: 'configured-model', systemPrompt: 'test',
      userPrompt: 'private report', imageDataUrl: 'data:image/jpeg;base64,dGVzdA=='
    }), /must use HTTPS/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not follow a redirect carrying AI request content', async () => {
  const { createServer } = require('node:http') as typeof import('node:http');
  const { once } = require('node:events') as typeof import('node:events');
  let initialRequests = 0;
  let redirectedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/v1/chat/completions') {
      initialRequests += 1;
      response.writeHead(307, { Location: '/redirected' });
    } else {
      redirectedRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
    }
    response.end(JSON.stringify({ choices: [{ message: { content: 'unexpected redirect' } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(callOpenAiCompatibleChatWithFallback({
      apiKey: 'test-secret', baseUrl: `http://127.0.0.1:${address.port}/v1`,
      provider: 'Custom/Local', modelId: 'local-model', systemPrompt: 'test',
      userPrompt: 'private report', imageDataUrl: 'data:image/jpeg;base64,dGVzdA=='
    }));
    assert.equal(initialRequests, 1);
    assert.equal(redirectedRequests, 0);
  } finally {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
});

test('steps through the active Gemini model cascade after retryable failures', async () => {
  const originalFetch = globalThis.fetch;
  const requestedModels: string[] = [];

  try {
    globalThis.fetch = (async (_input, init) => {
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body)) as { model?: string };
      requestedModels.push(String(body.model));

      if (requestedModels.length < 3) {
        const status = requestedModels.length === 1 ? 429 : 503;
        return new Response(JSON.stringify({ error: { message: 'Model temporarily unavailable' } }), {
          status,
          statusText: status === 429 ? 'Too Many Requests' : 'Service Unavailable',
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
    assert.deepEqual(requestedModels, [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not hide a non-retryable Gemini model error behind a fallback', async () => {
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

test('extracts the first balanced triage object when the model adds trailing noise', () => {
  const malformedResponse = `Here is the result:
{
  "title": "Ad draft fails to display",
  "bugNote": "The panel shows {no draft} even though the agent says one exists.",
  "stepsToReproduce": ["Open the panel", "Request a draft"],
  "expectedResult": "The draft appears.",
  "actualResult": "The empty state remains."
}
}`;

  const extracted = extractJsonObjectString(malformedResponse);
  const parsed = JSON.parse(extracted) as { title: string; stepsToReproduce: string[] };
  assert.equal(parsed.title, 'Ad draft fails to display');
  assert.deepEqual(parsed.stepsToReproduce, ['Open the panel', 'Request a draft']);
});

for (const modelId of ['gemini-custom-one','gemini-custom-two','']) {
  test(`Gemini sends configured primary model ${modelId || '(default)'}`,async()=>{
    const original=globalThis.fetch;const models:string[]=[];
    try {
      globalThis.fetch=(async(_input,init)=>{models.push(JSON.parse(String(init?.body)).model);return new Response(JSON.stringify({choices:[{message:{content:'result'}}]}));}) as typeof fetch;
      await callOpenAiCompatibleChatWithFallback({apiKey:'test',baseUrl:'https://example.test',modelId,provider:'Gemini',systemPrompt:'test',userPrompt:'test'});
      assert.deepEqual(models,[modelId || 'gemini-3.5-flash']);
    }finally{globalThis.fetch=original;}
  });
}
test('OpenAI-compatible requests preserve their model and propagate cancellation without fallback',async()=>{
  const original=globalThis.fetch,controller=new AbortController();let requests=0;let signal:AbortSignal|undefined;
  try{
    globalThis.fetch=(async(_input,init)=>{requests++;signal=init?.signal as AbortSignal;assert.equal(JSON.parse(String(init?.body)).model,'configured-openai');return new Promise<Response>(()=>{});}) as typeof fetch;
    const pending=callOpenAiCompatibleChatWithFallback({apiKey:'test',baseUrl:'https://example.test',modelId:'configured-openai',provider:'OpenAI',systemPrompt:'test',userPrompt:'test',signal:controller.signal});
    controller.abort(new Error('intentional cancel'));
    await assert.rejects(pending,/intentional cancel/);assert.equal(signal?.aborted,true);assert.equal(requests,1);
  }finally{globalThis.fetch=original;}
});
test('Ollama preserves its model and aborts when its owning request is cancelled',async()=>{
  const {triageBugWithOllama}=require('./ollamaTriage.ts') as typeof import('./ollamaTriage');
  const original=globalThis.fetch,controller=new AbortController();let signal:AbortSignal|undefined;
  try {
    globalThis.fetch=(async(_input,init)=>{signal=init?.signal as AbortSignal;assert.equal(JSON.parse(String(init?.body)).model,'qwen3-vl:8b');return new Promise<Response>(()=>{});}) as typeof fetch;
    const pending=triageBugWithOllama({note:'example'},'qwen3-vl:8b',undefined,controller.signal);
    controller.abort(new Error('cancel Ollama'));await assert.rejects(pending,/cancel Ollama/);assert.equal(signal?.aborted,true);
  } finally {globalThis.fetch=original;}
});
