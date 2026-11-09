import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeedbackPayload } from '../../shared/types';
import { SUPPORT_FEEDBACK_ERRORS } from '../../shared/supportFeedback';
import {
  EXAMEN_QA_SUPPORT_ENDPOINT,
  sendFeedbackToExamenQa,
  sendFeedbackUsingInjectedTransport,
  type SupportFetch
} from './feedbackService';

const textPayload: FeedbackPayload = { type: 'Bug', message: 'A disposable synthetic report.' };
const accepted = { success: true, delivery_status: 'accepted_by_recipient', report_id: 'synthetic-report-01' };
const reply = (status: number, value: unknown) => ({
  ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value)
});

test('actual IPC service is unconditionally disabled even with injected credentials and transport', async () => {
  let calls = 0;
  let credentialReads = 0;
  let globalDispatches = 0;
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    globalDispatches += 1;
    throw new Error('Real network dispatch is forbidden in this synthetic fixture.');
  };
  process.env = new Proxy(originalEnv, {
    get(target, key) {
      if (key === 'SLACK_WEBHOOK_URL' || key === 'SUPPORT_FORWARDING_ENABLED') {
        credentialReads += 1;
        return key === 'SUPPORT_FORWARDING_ENABLED' ? 'true' : 'synthetic-credential';
      }
      return Reflect.get(target, key);
    }
  });
  try {
    const result = await sendFeedbackToExamenQa(textPayload, async () => {
      calls += 1;
      return reply(200, accepted);
    });
    assert.equal(result.success, false);
    assert.equal(result.delivery_status, 'not_sent');
    assert.equal(result.code, 'unavailable');
    assert.equal(calls, 0);
    assert.equal(credentialReads, 0);
    assert.equal(globalDispatches, 0);
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

test('isolated transport prepares legacy text and optional AI kind without hidden content', async () => {
  for (const payload of [textPayload, { ...textPayload, type: 'Feature' as const }, { ...textPayload, report_kind: 'ai_output' as const }]) {
    let calls = 0;
    const transport: SupportFetch = async (url, init) => {
      calls += 1;
      assert.equal(url, EXAMEN_QA_SUPPORT_ENDPOINT);
      assert.equal(init.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init.body)), {
        type: payload.type,
        message: payload.message,
        report_kind: 'report_kind' in payload ? payload.report_kind : 'feedback'
      });
      return reply(200, accepted);
    };
    assert.deepEqual(await sendFeedbackUsingInjectedTransport(payload, transport), accepted);
    assert.equal(calls, 1);
  }
});

test('all defined image fields refuse the entire request before transport, without decoding', async () => {
  let calls = 0;
  const transport: SupportFetch = async () => { calls += 1; return reply(200, accepted); };
  for (const field of ['image_base64', 'image_mime_type', 'image_url']) {
    for (const value of ['', null, 'synthetic-image-value']) {
      const payload = { ...textPayload, [field]: value } as unknown as FeedbackPayload;
      const result = await sendFeedbackUsingInjectedTransport(payload, transport);
      assert.equal(result.code, 'images_not_supported');
      assert.equal(result.delivery_status, 'not_sent');
      assert.equal((await sendFeedbackToExamenQa(payload, transport)).code, 'images_not_supported');
    }
  }
  assert.equal(calls, 0);
});

test('malformed or bare successful HTTP responses never become accepted reports', async () => {
  const responses = [
    { ok: true, status: 200 },
    { ok: true, status: 200, text: async () => '' },
    { ok: true, status: 200, text: async () => '<html>login</html>' },
    reply(200, { success: true }),
    reply(200, { success: true, delivery_status: 'accepted_by_recipient' }),
    reply(202, accepted),
    reply(500, accepted)
  ];
  for (const response of responses) {
    const result = await sendFeedbackUsingInjectedTransport(textPayload, async () => response);
    assert.equal(result.success, false);
    assert.equal(result.delivery_status, 'unknown');
  }
});

test('safe failures ignore server text and a platform non-JSON 429 needs no parsing', async () => {
  const rejected = await sendFeedbackUsingInjectedTransport(textPayload, async () => reply(503, {
    success: false, delivery_status: 'not_sent', code: 'unavailable', error: 'secret internal diagnostic'
  }));
  assert.equal(rejected.delivery_status, 'not_sent');
  assert.equal(rejected.error, SUPPORT_FEEDBACK_ERRORS.unavailable);
  assert.doesNotMatch(JSON.stringify(rejected), /secret|internal diagnostic/);
  const limited = await sendFeedbackUsingInjectedTransport(textPayload, async () => ({
    ok: false, status: 429, text: async () => { throw new Error('This must not be read.'); }
  }));
  assert.equal(limited.code, 'rate_limited');
  assert.equal(limited.delivery_status, 'not_sent');
});

test('transport failure and unrecognized server 5xx remain unknown, with one attempt', async () => {
  let calls = 0;
  const result = await sendFeedbackUsingInjectedTransport(textPayload, async () => {
    calls += 1;
    throw new Error('socket exposed synthetic-secret.example');
  });
  assert.equal(calls, 1);
  assert.equal(result.delivery_status, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
  const serverFailure = await sendFeedbackUsingInjectedTransport(textPayload, async () => reply(503, { error: 'unrecognized' }));
  assert.equal(serverFailure.delivery_status, 'unknown');
});

test('deadline includes a response body that never settles, without retry', async () => {
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  const result = await sendFeedbackUsingInjectedTransport(textPayload, async (_url, init) => {
    calls += 1;
    signal = init.signal;
    return { ok: true, status: 200, text: () => new Promise<string>(() => {}) };
  }, { timeoutMs: 1 });
  assert.equal(result.delivery_status, 'unknown');
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
});

test('oversized response stream is canceled before JSON parsing', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1025)); },
    cancel() { canceled = true; }
  });
  const result = await sendFeedbackUsingInjectedTransport(textPayload, async () => ({ ok: true, status: 200, body }));
  assert.equal(result.delivery_status, 'unknown');
  assert.equal(canceled, true);
});

test('deadline cancels a stalled response stream even if injected transport ignores its signal', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  const result = await sendFeedbackUsingInjectedTransport(textPayload, async () => ({ ok: true, status: 200, body }), { timeoutMs: 1 });
  await Promise.resolve();
  assert.equal(result.delivery_status, 'unknown');
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

test('UTF-8 reply bytes are bounded independently of character count', async () => {
  const result = await sendFeedbackUsingInjectedTransport(textPayload, async () => reply(200, {
    ...accepted, padding: '🚀'.repeat(300)
  }));
  assert.equal(result.delivery_status, 'unknown');
});

test('malformed UTF-8 cannot become an accepted acknowledgement through replacement decoding', async () => {
  const prefix = new TextEncoder().encode('{"success":true,"delivery_status":"accepted_by_recipient","report_id":"synthetic-report-01","extra":"');
  const suffix = new TextEncoder().encode('"}');
  const bytes = new Uint8Array(prefix.length + 1 + suffix.length);
  bytes.set(prefix);
  bytes[prefix.length] = 0xff;
  bytes.set(suffix, prefix.length + 1);
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); },
    cancel() { canceled = true; }
  });
  const result = await sendFeedbackUsingInjectedTransport(textPayload, async () => ({ ok: true, status: 200, body }));
  assert.equal(result.success, false);
  assert.equal(result.delivery_status, 'unknown');
  assert.equal(canceled, true);
});

test('JSON-only fixture responses are not trusted or parsed without a bounded text/stream reply', async () => {
  let reads = 0;
  const result = await sendFeedbackUsingInjectedTransport(textPayload, async () => ({
    ok: true, status: 200, json: () => { reads += 1; return new Promise<unknown>(() => {}); }
  }));
  assert.equal(result.delivery_status, 'unknown');
  assert.equal(reads, 0);
});
