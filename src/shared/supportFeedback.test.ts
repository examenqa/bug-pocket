import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SUPPORT_BODY_BYTES,
  MAX_SUPPORT_MESSAGE_BYTES,
  normalizeSupportFeedbackPayload,
  safeSupportFeedbackResult,
  utf8ByteLength
} from './supportFeedback';

const payload = { type: 'Bug', message: 'Synthetic report' };

test('legacy text normalizes categories and omitted optional IPC values without introducing content', () => {
  const result = normalizeSupportFeedbackPayload({
    ...payload, message: '  Synthetic report\nSecond line  ', user_email: '  ',
    image_base64: undefined, image_mime_type: undefined
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.payload, { type: 'Bug', message: 'Synthetic report\nSecond line', report_kind: 'feedback' });
  assert.equal(result.body.includes('image'), false);
});

test('UTF-8 message bytes and serialized escaping are separate enforced boundaries', () => {
  assert.equal(normalizeSupportFeedbackPayload({ ...payload, message: 'a'.repeat(MAX_SUPPORT_MESSAGE_BYTES) }).success, true);
  assert.equal(normalizeSupportFeedbackPayload({ ...payload, message: 'a'.repeat(MAX_SUPPORT_MESSAGE_BYTES + 1) }).success, false);
  assert.equal(utf8ByteLength('🚀'.repeat(2500)), MAX_SUPPORT_MESSAGE_BYTES);
  assert.equal(normalizeSupportFeedbackPayload({ ...payload, message: '🚀'.repeat(2500) }).success, true);
  assert.equal(normalizeSupportFeedbackPayload({ ...payload, message: '🚀'.repeat(2501) }).success, false);
  const overhead = utf8ByteLength(JSON.stringify({ type: 'Bug', message: '', report_kind: 'feedback' }));
  const room = MAX_SUPPORT_BODY_BYTES - overhead;
  const message = '"'.repeat(Math.floor(room / 2)) + 'a'.repeat(room % 2);
  const edge = normalizeSupportFeedbackPayload({ ...payload, message });
  assert.equal(edge.success, true);
  if (edge.success) assert.equal(utf8ByteLength(edge.body), MAX_SUPPORT_BODY_BYTES);
  const over = normalizeSupportFeedbackPayload({ ...payload, message: message + 'a' });
  assert.equal(over.success, false);
  if (!over.success) assert.equal(over.result.code, 'body_too_large');
});

test('strict fields, categories, controls and email fail before preparation', () => {
  const invalid = [
    null, [], { ...payload, type: 'Other' }, { ...payload, report_kind: 'other' },
    { ...payload, type: 'Feature', report_kind: 'ai_output' },
    { ...payload, message: 42 }, { ...payload, message: '  ' },
    { ...payload, message: 'control\u0000text' }, { ...payload, destination: 'https://example.invalid' },
    { ...payload, message: 'lone high \ud800' }, { ...payload, message: 'lone low \udfff' },
    { ...payload, user_email: '\ud800@example.invalid' },
    { ...payload, user_email: null }, { ...payload, user_email: 'invalid' },
    { ...payload, user_email: 'a'.repeat(250) + '@x.io' }
  ];
  for (const value of invalid) assert.equal(normalizeSupportFeedbackPayload(value).success, false);
  assert.equal(normalizeSupportFeedbackPayload({ ...payload, user_email: 'a'.repeat(249) + '@x.io' }).success, true);
  assert.equal(normalizeSupportFeedbackPayload({ ...payload, message: 'Line one\n\tLine two\r\n' }).success, true);
  assert.equal(normalizeSupportFeedbackPayload({ ...payload, report_kind: 'ai_output' }).success, true);
});

test('safe outcome projection requires service acknowledgment and strips arbitrary diagnostics', () => {
  for (const value of [undefined, { success: true }, { success: true, delivery_status: 'accepted_by_recipient', report_id: '<unsafe>' }]) {
    assert.equal(safeSupportFeedbackResult(value).delivery_status, 'unknown');
  }
  const accepted = safeSupportFeedbackResult({
    success: true, delivery_status: 'accepted_by_recipient', report_id: 'synthetic-report-02', extra: 'hidden response'
  });
  assert.deepEqual(accepted, { success: true, delivery_status: 'accepted_by_recipient', report_id: 'synthetic-report-02' });
  const failure = safeSupportFeedbackResult({
    success: false, delivery_status: 'not_sent', code: 'unavailable', error: 'untrusted upstream body', report_id: 'synthetic-report-03'
  });
  assert.equal(failure.delivery_status, 'not_sent');
  assert.doesNotMatch(JSON.stringify(failure), /untrusted upstream/);
  assert.equal(safeSupportFeedbackResult({ success: false, delivery_status: 'not_sent', code: 'unrecognized' }).delivery_status, 'unknown');
});
