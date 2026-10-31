import assert from 'node:assert/strict';
import test from 'node:test';
import { getAiErrorMessage } from '../../../shared/aiError';
import { parseErrorForUI } from './errors';

test('preserves fixed IPC field guidance without reflecting argument values', () => {
  const message = parseErrorForUI(new TypeError('Invalid IPC payload at arguments[0].environment: expected a short string.'));
  assert.match(message, /Invalid IPC payload/);
  assert.match(message, /environment/);
  assert.doesNotMatch(message, /AI Provider is currently/);
});

test('recognizes actual Electron IPC rejection prefix for the AI contract', () => {
  assert.match(parseErrorForUI(new Error("Error invoking remote method 'ai:triageBug': TypeError: Invalid IPC payload at arguments[0].attachment_id: expected a non-empty string.")), /Invalid IPC payload for attachment/);
});

test('maps only owned public error codes to fixed provider guidance', () => {
  for (const code of ['AI_AUTH', 'AI_CREDITS', 'AI_FORBIDDEN', 'AI_MODEL_UNAVAILABLE', 'AI_RATE_LIMIT', 'AI_SERVER', 'AI_CONNECTION']) {
    assert.equal(parseErrorForUI(new Error(JSON.stringify({ code }))), getAiErrorMessage(code));
  }
});

test('untrusted response text, legacy envelopes and causes never become UI text or logs', () => {
  const secret = 'SYNTHETIC_CREDENTIAL_REPORT_IMAGE_MARKER';
  const originalError = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => { captured.push(args); };
  try {
    for (const value of [
      new Error(`HTTP 404 ${secret}`),
      new Error(`fetch failed ${secret}`),
      new Error(`validation TypeError ${secret}`),
      new Error(JSON.stringify({ userMessage: secret, rawDetails: `HTTP 401 validation ${secret}` })),
      new Error(JSON.stringify({ code: 'AI_AUTH', rawDetails: secret })),
      { message: `Validation failed: ${secret}`, cause: { status: 503, message: secret } },
      { status: 401, message: secret },
      secret
    ]) {
      assert.equal(parseErrorForUI(value), getAiErrorMessage('AI_FAILED'));
    }
    assert.deepEqual(captured, []);
  } finally {
    console.error = originalError;
  }
});

test('unknown IPC fields and expectations provide fixed contract guidance only', () => {
  const secret = 'SYNTHETIC_UNTRUSTED_FIELD';
  const result = parseErrorForUI(new Error(`Invalid IPC payload at arguments[0].${secret}: expected ${secret}.`));
  assert.match(result, /application contract/);
  assert.doesNotMatch(result, new RegExp(secret));
  assert.equal(parseErrorForUI(new Error(`Validation failed: ${secret}`)), getAiErrorMessage('AI_FAILED'));
});

test('hostile error accessors cannot escape the formatter or become diagnostics', () => {
  const error = new Error();
  Object.defineProperty(error, 'message', { get() { throw new Error('SYNTHETIC_HOSTILE_ACCESSOR'); } });
  assert.equal(parseErrorForUI(error), getAiErrorMessage('AI_FAILED'));
});

test('renderer lifecycle failures require a public category envelope or generic fixed guidance', () => {
  const providerUnavailable = 'provider unavailable';
  const publicEnvelope = JSON.stringify({ code: 'AI_SERVER' });
  for (const value of [publicEnvelope, new Error(publicEnvelope)]) {
    assert.equal(parseErrorForUI(value), getAiErrorMessage('AI_SERVER'));
  }
  for (const value of [providerUnavailable, new Error(providerUnavailable)]) {
    const guidance = parseErrorForUI(value);
    assert.equal(guidance, getAiErrorMessage('AI_FAILED'));
    assert.equal(guidance.includes(providerUnavailable), false);
  }
});
