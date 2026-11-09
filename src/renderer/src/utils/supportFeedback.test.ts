import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORT_FEEDBACK_ERRORS } from '../../../shared/supportFeedback';
import { sanitizeSupportFeedbackError, submitSupportFeedback } from './supportFeedback';

test('actual renderer wrapper cannot invoke even a synthetic sender for a valid disabled submission', async () => {
  let calls = 0;
  const result = await submitSupportFeedback(async () => {
    calls += 1;
    return { success: true, delivery_status: 'accepted_by_recipient', report_id: 'synthetic-report-001' };
  }, { type: 'Bug', message: 'Synthetic local draft', report_kind: 'ai_output' });
  assert.equal(calls, 0);
  assert.equal(result.success, false);
  assert.equal(result.delivery_status, 'not_sent');
  assert.equal(result.code, 'unavailable');
});

test('image-bearing renderer requests are refused as a whole without dispatch or text-only retry', async () => {
  let calls = 0;
  const result = await submitSupportFeedback(async () => { calls += 1; return {}; }, {
    type: 'Bug', message: 'Synthetic text with disallowed image', image_base64: 'not-an-upload'
  });
  assert.equal(calls, 0);
  assert.equal(result.success, false);
  assert.equal(result.code, 'images_not_supported');
});

test('renderer never reflects arbitrary upstream diagnostics', () => {
  assert.equal(sanitizeSupportFeedbackError('synthetic secret/customer context'), SUPPORT_FEEDBACK_ERRORS.generic);
  assert.equal(sanitizeSupportFeedbackError(SUPPORT_FEEDBACK_ERRORS.unavailable), SUPPORT_FEEDBACK_ERRORS.unavailable);
});
