import type { FeedbackPayload } from '../../../shared/types';
import {
  normalizeSupportFeedbackPayload,
  safeSupportFeedbackResult,
  supportFailure,
  SUPPORT_FEEDBACK_ERRORS,
  SUPPORT_FORWARDING_ENABLED,
  type SupportFeedbackResult
} from '../../../shared/supportFeedback';

export type FeedbackSender = (payload: FeedbackPayload) => Promise<unknown>;

const safeFeedbackErrors = new Set<string>(Object.values(SUPPORT_FEEDBACK_ERRORS));

export function sanitizeSupportFeedbackError(error: unknown): string {
  if (typeof error === 'string' && safeFeedbackErrors.has(error)) return error;
  return SUPPORT_FEEDBACK_ERRORS.generic;
}

export async function submitSupportFeedback(
  sender: FeedbackSender,
  payload: FeedbackPayload
): Promise<SupportFeedbackResult> {
  const validation = normalizeSupportFeedbackPayload(payload);
  if (!validation.success) return validation.result;

  // This source-only disabled release cannot dispatch, even with an injected sender.
  if (!SUPPORT_FORWARDING_ENABLED) return supportFailure('unavailable');

  try {
    return safeSupportFeedbackResult(await sender(validation.payload));
  } catch {
    // Once a future sender is invoked, a lost response cannot prove non-delivery.
    return supportFailure('delivery_unknown', 'unknown');
  }
}
