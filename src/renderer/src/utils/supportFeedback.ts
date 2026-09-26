import type { FeedbackPayload } from '../../../shared/types';
import {
  SUPPORT_FEEDBACK_ERRORS,
  validateSupportImageFile
} from '../../../shared/supportFeedback';

type FeedbackResult = { success: boolean; error?: string };
type FeedbackSender = (payload: FeedbackPayload) => Promise<FeedbackResult>;

const safeFeedbackErrors = new Set<string>(Object.values(SUPPORT_FEEDBACK_ERRORS));

export { validateSupportImageFile };

export function sanitizeSupportFeedbackError(error: unknown): string {
  if (typeof error === 'string' && safeFeedbackErrors.has(error)) return error;
  return SUPPORT_FEEDBACK_ERRORS.generic;
}

export async function submitSupportFeedback(
  sender: FeedbackSender,
  payload: FeedbackPayload
): Promise<FeedbackResult> {
  try {
    const result = await sender(payload);
    if (result.success) return result;
    return {
      success: false,
      error: sanitizeSupportFeedbackError(result.error)
    };
  } catch {
    return {
      success: false,
      error: SUPPORT_FEEDBACK_ERRORS.generic
    };
  }
}
