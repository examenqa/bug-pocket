import test from 'node:test';
import assert from 'node:assert/strict';
import { AiPublicError, getAiErrorMessage, parseAiErrorCode, parseAiErrorMessage, providerErrorCode, serializeAiError, type AiErrorCode } from './aiError';

const secretMarker = 'SYNTHETIC-KEY-REPORT-IMAGE-MARKER';

test('owned AI categories survive serialization without mutable error diagnostics', () => {
  const error = new AiPublicError('AI_AUTH');
  error.message = secretMarker;
  error.stack = secretMarker;
  Object.assign(error, { cause: new Error(secretMarker), rawDetails: secretMarker, code: 'AI_CREDITS' });
  const serialized = serializeAiError(error);
  assert.equal(serialized, '{"code":"AI_AUTH"}');
  assert.equal(parseAiErrorMessage(serialized), getAiErrorMessage('AI_AUTH'));
  assert.doesNotMatch(serialized, new RegExp(secretMarker));
});

test('untrusted strings and forged errors cannot acquire a main-boundary category', () => {
  const forged = Object.assign(new Error('{"code":"AI_AUTH"}'), { name: 'AiPublicError', code: 'AI_AUTH', type: 'AI_AUTH', rawDetails: secretMarker });
  for (const error of [secretMarker, '{"code":"AI_AUTH"}', { code: 'AI_AUTH' }, forged, Object.create(AiPublicError.prototype), new TypeError(secretMarker), undefined, null]) {
    assert.equal(serializeAiError(error), '{"code":"AI_FAILED"}');
  }
});

test('main serialization does not access untrusted properties or conversion hooks', () => {
  const hostile = new Proxy({}, { get: () => { throw new Error(secretMarker); } });
  assert.equal(serializeAiError(hostile), '{"code":"AI_FAILED"}');
  assert.equal(serializeAiError({ toJSON: () => { throw new Error(secretMarker); } }), '{"code":"AI_FAILED"}');
});

test('renderer parsing accepts only a bounded single-code envelope and fixed text', () => {
  assert.equal(parseAiErrorCode('{"code":"AI_NATIVE_MODEL_UNAVAILABLE"}'), 'AI_NATIVE_MODEL_UNAVAILABLE');
  assert.equal(parseAiErrorMessage('{"code":"AI_MODEL_UNAVAILABLE"}'), getAiErrorMessage('AI_MODEL_UNAVAILABLE'));
  assert.equal(parseAiErrorMessage(new Error('{"code":"AI_AUTH"}')), getAiErrorMessage('AI_AUTH'));
  for (const value of [secretMarker, { code: 'AI_AUTH' }, '{"code":"unknown"}', '{"code":"toString"}', '{"code":"__proto__"}', '{"code":"AI_AUTH","rawDetails":"'+secretMarker+'"}', '{"userMessage":"'+secretMarker+'"}', '[{"code":"AI_AUTH"}]', 'null', '"AI_AUTH"', ' '.repeat(129)]) {
    assert.equal(parseAiErrorCode(value), null);
    assert.equal(parseAiErrorMessage(value), null);
  }
  const hostileError = new Error();
  Object.defineProperty(hostileError, 'message', { get: () => { throw new Error(secretMarker); } });
  assert.equal(parseAiErrorMessage(hostileError), null);
});

test('unknown runtime categories cannot inject app-owned message content', () => {
  assert.equal(serializeAiError(new AiPublicError(secretMarker as AiErrorCode)), '{"code":"AI_FAILED"}');
  for (const code of [secretMarker, '__proto__', 'toString', {}, null, undefined]) {
    assert.equal(getAiErrorMessage(code), getAiErrorMessage('AI_FAILED'));
  }
});

test('provider numeric status classification preserves actionable categories without raw input', () => {
  const cases: Array<[number, AiErrorCode]> = [[401, 'AI_AUTH'], [402, 'AI_CREDITS'], [403, 'AI_FORBIDDEN'], [404, 'AI_MODEL_UNAVAILABLE'], [429, 'AI_RATE_LIMIT'], [500, 'AI_SERVER'], [503, 'AI_SERVER'], [599, 'AI_SERVER'], [400, 'AI_FAILED'], [422, 'AI_FAILED'], [600, 'AI_FAILED'], [500.5, 'AI_FAILED'], [NaN, 'AI_FAILED'], [Infinity, 'AI_FAILED']];
  for (const [status, code] of cases) {
    assert.equal(providerErrorCode(status), code);
    assert.equal(parseAiErrorMessage(serializeAiError(new AiPublicError(code))), getAiErrorMessage(code));
  }
});
