import assert from 'node:assert/strict';
import test from 'node:test';
import type { FeedbackPayload } from '../../shared/types';
import {
  MAX_SUPPORT_IMAGE_BYTES,
  SUPPORT_FEEDBACK_ERRORS,
  validateSupportImageFile
} from '../../shared/supportFeedback';
import {
  EXAMEN_QA_SUPPORT_ENDPOINT,
  sendFeedbackToExamenQa,
  type SupportFetch
} from './feedbackService';
import { submitSupportFeedback } from '../../renderer/src/utils/supportFeedback';

const textOnlyPayload: FeedbackPayload = {
  type: 'Bug',
  message: 'The application stopped responding after capture.'
};

test('local-only users can submit text feedback without a Supabase client', async () => {
  let requestedUrl = '';
  let requestBody: Record<string, unknown> = {};
  const fetchMock: SupportFetch = async (url, init) => {
    requestedUrl = url;
    requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    };
  };

  const result = await sendFeedbackToExamenQa(textOnlyPayload, fetchMock);

  assert.deepEqual(result, { success: true });
  assert.equal(requestedUrl, EXAMEN_QA_SUPPORT_ENDPOINT);
  assert.equal(requestBody.message, textOnlyPayload.message);
  assert.equal(requestBody.image_base64, undefined);
  assert.equal(requestBody.image_mime_type, undefined);
});

test('invalid image MIME types and oversized files are rejected before upload', async () => {
  assert.equal(
    validateSupportImageFile({ type: 'image/gif', size: 128 }),
    SUPPORT_FEEDBACK_ERRORS.invalidImage
  );
  assert.equal(
    validateSupportImageFile({ type: 'image/png', size: MAX_SUPPORT_IMAGE_BYTES + 1 }),
    SUPPORT_FEEDBACK_ERRORS.imageTooLarge
  );

  let fetchCalls = 0;
  const fetchMock: SupportFetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };
  const result = await sendFeedbackToExamenQa({
    ...textOnlyPayload,
    image_base64: 'R0lGODlhAQABAIAAAP',
    image_mime_type: 'image/gif' as 'image/png'
  }, fetchMock);

  assert.equal(result.success, false);
  assert.equal(result.error, SUPPORT_FEEDBACK_ERRORS.invalidImage);
  assert.equal(fetchCalls, 0);
});

test('network failures return sanitized errors to the support UI', async () => {
  const rawNetworkDetail = 'fetch failed: socket exposed internal-host.example';
  const serviceResult = await sendFeedbackToExamenQa(
    textOnlyPayload,
    async () => { throw new Error(rawNetworkDetail); }
  );

  assert.equal(serviceResult.success, false);
  assert.equal(serviceResult.error, SUPPORT_FEEDBACK_ERRORS.network);
  assert.doesNotMatch(serviceResult.error ?? '', /internal-host/i);

  const serverFailure = await sendFeedbackToExamenQa(
    textOnlyPayload,
    async () => ({ ok: false, status: 503 })
  );
  assert.equal(serverFailure.success, false);
  assert.equal(serverFailure.error, SUPPORT_FEEDBACK_ERRORS.unavailable);

  const uiResult = await submitSupportFeedback(
    async () => { throw new Error(rawNetworkDetail); },
    textOnlyPayload
  );
  assert.equal(uiResult.success, false);
  assert.equal(uiResult.error, SUPPORT_FEEDBACK_ERRORS.generic);
  assert.doesNotMatch(uiResult.error ?? '', /internal-host/i);
});
