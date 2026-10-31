import assert from 'node:assert/strict';
import test from 'node:test';
import { AiRequestRegistry } from './aiRequestRegistry';
import { callOpenAiCompatibleChatWithFallback } from './openAiCompatibleChat';
import { getAiErrorMessage, providerErrorCode, serializeAiError } from '../../shared/aiError';
import { AiCancelledError, AiTimeoutError, withAiDeadline } from '../../shared/aiRequest';
import { parseErrorForUI } from '../../renderer/src/utils/errors';

const marker = 'SYNTHETIC_EXA64_CREDENTIAL_REPORT_IMAGE';
const input = {
  apiKey: marker,
  baseUrl: 'https://synthetic.invalid/v1',
  modelId: 'configured-model',
  provider: 'OpenAI' as const,
  systemPrompt: 'Return JSON.',
  userPrompt: marker,
  imageDataUrl: `data:image/jpeg;base64,${Buffer.from(marker).toString('base64')}`
};

for (const status of [400, 401, 402, 403, 404, 422, 429, 500, 503]) {
  test(`HTTP ${status} emits fixed guidance without consuming error body or statusText`, async () => {
    const original = globalThis.fetch;
    let reads = 0;
    try {
      globalThis.fetch = (async () => ({
        ok: false, status,
        get statusText() { throw new Error(marker); },
        text: async () => { reads++; return marker; },
        json: async () => { reads++; return { error: marker, code: 'AI_AUTH', type: 'validation' }; }
      } as unknown as Response)) as typeof fetch;
      const result = await new AiRequestRegistry().run(1, 'error', signal =>
        callOpenAiCompatibleChatWithFallback({ ...input, signal }));
      assert.equal(result.status, 'failed');
      if (result.status !== 'failed') assert.fail('Expected failure');
      assert.equal(result.message, JSON.stringify({ code: providerErrorCode(status) }));
      assert.equal(parseErrorForUI(new Error(result.message)), getAiErrorMessage(providerErrorCode(status)));
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|rawDetails|cause|stack/);
      assert.equal(reads, 0);
    } finally { globalThis.fetch = original; }
  });
}

test('success preserves request parameters, image payload and successful content', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, options) => {
      assert.equal(url, 'https://synthetic.invalid/v1/chat/completions');
      assert.equal(options?.redirect, 'error');
      assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${marker}`);
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, input.modelId);
      assert.equal(body.temperature, 0.2);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(body.messages[1].content[1].image_url.url, input.imageDataUrl);
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: `  ${marker}  ` } }] }) } as Response;
    }) as typeof fetch;
    assert.equal(await callOpenAiCompatibleChatWithFallback(input), marker);
  } finally { globalThis.fetch = original; }
});

test('unread error streams are cancelled and cleanup failures cannot replace the fixed status error', async () => {
  const original = globalThis.fetch;
  try {
    for (const rejectCancel of [false, true]) {
      let cancellations = 0, reads = 0;
      const body = new ReadableStream({
        start(controller) { controller.enqueue(marker); },
        cancel() { cancellations++; if (rejectCancel) throw new Error(marker); }
      });
      globalThis.fetch = (async () => ({
        ok: false, status: 401, body,
        text: async () => { reads++; return marker; }
      } as unknown as Response)) as typeof fetch;
      const result = await new AiRequestRegistry().run(1, 'stream', signal => callOpenAiCompatibleChatWithFallback({ ...input, signal }));
      assert.deepEqual(result, { status: 'failed', message: '{"code":"AI_AUTH"}' });
      assert.equal(cancellations, 1);
      assert.equal(reads, 0);
      await Promise.resolve();
    }
  } finally { globalThis.fetch = original; }
});

test('Gemini preserves configured ordering and deduplicates retry models', async () => {
  const original = globalThis.fetch, originalInfo = console.info;
  const models: string[] = [], logs: unknown[][] = [];
  try {
    console.info = (...args) => { logs.push(args); };
    globalThis.fetch = (async (_url, options) => {
      models.push(JSON.parse(String(options?.body)).model);
      return models.length < 3
        ? { ok: false, status: models.length === 1 ? 429 : 503, text: () => { throw new Error(marker); } } as unknown as Response
        : { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'success' } }] }) } as Response;
    }) as typeof fetch;
    assert.equal(await callOpenAiCompatibleChatWithFallback({ ...input, provider: 'Gemini', modelId: 'gemini-3.5-flash' }), 'success');
    assert.deepEqual(models, ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']);
    assert.doesNotMatch(JSON.stringify(logs), /SYNTHETIC/);
  } finally { globalThis.fetch = original; console.info = originalInfo; }
});

for (const status of [401, 404, 429, 503]) {
  test(`Gemini HTTP ${status} retains retry boundary and internal status`, async () => {
    const original = globalThis.fetch, originalInfo = console.info;
    let calls = 0;
    try {
      console.info = () => {};
      globalThis.fetch = (async () => { calls++; return { ok: false, status } as Response; }) as typeof fetch;
      await assert.rejects(callOpenAiCompatibleChatWithFallback({ ...input, provider: 'Gemini', modelId: 'custom-primary' }), error => {
        assert.equal((error as { status: number }).status, status);
        assert.equal(serializeAiError(error), JSON.stringify({ code: providerErrorCode(status) }));
        return true;
      });
      assert.equal(calls, status === 429 || status === 503 ? 4 : 1);
    } finally { globalThis.fetch = original; console.info = originalInfo; }
  });
}

test('unknown transport diagnostics and forged status/codes do not become public or cause retries', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => {
      calls++;
      throw Object.assign(new Error(marker, { cause: new Error(marker) }), { code: 'AI_AUTH', name: 'AiPublicError', status: 503 });
    }) as typeof fetch;
    const result = await new AiRequestRegistry().run(1, 'transport', signal =>
      callOpenAiCompatibleChatWithFallback({ ...input, provider: 'Gemini', signal }));
    assert.deepEqual(result, { status: 'failed', message: '{"code":"AI_CONNECTION"}' });
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC/);
  } finally { globalThis.fetch = original; }
});

test('cancellation and a short injected deadline retain registry classifications', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Promise<Response>(() => {})) as typeof fetch;
    const controller = new AbortController();
    const cancelled = callOpenAiCompatibleChatWithFallback({ ...input, signal: controller.signal });
    controller.abort(new AiCancelledError());
    await assert.rejects(cancelled, AiCancelledError);
    const result = await new AiRequestRegistry().run(1, 'timeout', signal =>
      withAiDeadline(child => callOpenAiCompatibleChatWithFallback({ ...input, signal: child }), signal, 5));
    assert.equal(result.status, 'timed_out');
    await assert.rejects(withAiDeadline(() => new Promise(() => {}), undefined, 5), AiTimeoutError);
  } finally { globalThis.fetch = original; }
});
