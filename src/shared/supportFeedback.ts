import type { FeedbackPayload } from './types';

// Deliberate source gate. Configuration or credentials cannot enable submission.
export const SUPPORT_FORWARDING_ENABLED = false;
export const SUPPORT_EMAIL_RECIPIENT = 'valisheik@examenqa.com';
export const MAX_SUPPORT_MESSAGE_BYTES = 10_000;
export const MAX_SUPPORT_BODY_BYTES = 16 * 1024;
export const MAX_SUPPORT_EMAIL_LENGTH = 254;

export const SUPPORT_FEEDBACK_ERRORS = {
  generic: 'Could not send feedback right now. Please try again.',
  network: 'Could not reach Bug Pocket Support. Check your connection and try again.',
  unavailable: 'Support reporting is unavailable. Nothing has been sent. Your draft stays in memory until you discard it or close the app.',
  rateLimited: 'Too many support requests were sent. Please wait before trying again.',
  invalidRequest: 'The support request could not be submitted. Check the form and try again.',
  invalidImage: 'Support reporting accepts text only. Remove the image before sending.',
  imageTooLarge: 'Support reporting accepts text only. Remove the image before sending.',
  imageUnsupported: 'Support reporting accepts text only. Remove the image before sending.',
  messageTooLarge: 'The message must be 10,000 UTF-8 bytes or smaller.',
  bodyTooLarge: 'The complete support request must be 16 KiB or smaller. Shorten the message.',
  invalidEmail: 'Enter a valid email address of 254 characters or fewer, or leave it blank.',
  deliveryUnknown: 'We could not confirm whether support received this report. It may have arrived. Retrying may send a duplicate.'
} as const;

const errorForCode = {
  invalid_request: SUPPORT_FEEDBACK_ERRORS.invalidRequest,
  message_too_large: SUPPORT_FEEDBACK_ERRORS.messageTooLarge,
  body_too_large: SUPPORT_FEEDBACK_ERRORS.bodyTooLarge,
  invalid_email: SUPPORT_FEEDBACK_ERRORS.invalidEmail,
  images_not_supported: SUPPORT_FEEDBACK_ERRORS.imageUnsupported,
  unavailable: SUPPORT_FEEDBACK_ERRORS.unavailable,
  rate_limited: SUPPORT_FEEDBACK_ERRORS.rateLimited,
  delivery_unknown: SUPPORT_FEEDBACK_ERRORS.deliveryUnknown
} as const;

export type SupportFeedbackCode = keyof typeof errorForCode;
export type SupportDeliveryStatus = 'accepted_by_recipient' | 'not_sent' | 'unknown';
export interface SupportFeedbackResult {
  success: boolean;
  error?: string;
  code?: SupportFeedbackCode;
  delivery_status?: SupportDeliveryStatus;
  report_id?: string;
}

export interface NormalizedSupportFeedbackPayload {
  type: FeedbackPayload['type'];
  message: string;
  report_kind: 'feedback' | 'ai_output';
  user_email?: string;
}

type PreparedSupportFeedback =
  | { success: true; payload: NormalizedSupportFeedbackPayload; body: string }
  | { success: false; result: SupportFeedbackResult };

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function supportFailure(
  code: SupportFeedbackCode,
  deliveryStatus: 'not_sent' | 'unknown' = 'not_sent'
): SupportFeedbackResult {
  const safeCode = deliveryStatus === 'unknown' || code === 'delivery_unknown' ? 'delivery_unknown' : code;
  return {
    success: false,
    delivery_status: safeCode === 'delivery_unknown' ? 'unknown' : 'not_sent',
    code: safeCode,
    error: errorForCode[safeCode]
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

const allowedPayloadFields = new Set([
  'type', 'message', 'user_email', 'report_kind', 'image_base64', 'image_mime_type', 'image_url'
]);
const invalidControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

export function normalizeSupportFeedbackPayload(value: unknown): PreparedSupportFeedback {
  const reject = (code: SupportFeedbackCode): PreparedSupportFeedback => ({ success: false, result: supportFailure(code) });
  if (!isPlainObject(value)) return reject('invalid_request');
  if (Object.keys(value).some(key => !allowedPayloadFields.has(key))) return reject('invalid_request');
  // Undefined optional IPC properties serialize as absent. Every defined image
  // property, including empty/null values and MIME-only requests, is refused.
  if (['image_base64', 'image_mime_type', 'image_url'].some(key => value[key] !== undefined)) {
    return reject('images_not_supported');
  }
  if ((value.type !== 'Bug' && value.type !== 'Feature') || typeof value.message !== 'string') {
    return reject('invalid_request');
  }
  const reportKind = value.report_kind === undefined ? 'feedback' : value.report_kind;
  if ((reportKind !== 'feedback' && reportKind !== 'ai_output')
    || (reportKind === 'ai_output' && value.type !== 'Bug')) return reject('invalid_request');
  // Bound string work before trimming/encoding. A string this long cannot fit
  // the agreed serialized body even if it consists of whitespace.
  if (value.message.length > MAX_SUPPORT_BODY_BYTES) return reject('body_too_large');
  if (invalidControls.test(value.message) || hasUnpairedSurrogate(value.message)) return reject('invalid_request');
  const message = value.message.trim();
  if (!message) return reject('invalid_request');
  if (utf8ByteLength(message) > MAX_SUPPORT_MESSAGE_BYTES) return reject('message_too_large');
  if (value.user_email !== undefined && typeof value.user_email !== 'string') return reject('invalid_email');
  if (typeof value.user_email === 'string' && value.user_email.length > MAX_SUPPORT_BODY_BYTES) return reject('body_too_large');
  const email = typeof value.user_email === 'string' ? value.user_email.trim() : '';
  if (email && (email.length > MAX_SUPPORT_EMAIL_LENGTH || invalidControls.test(email) || hasUnpairedSurrogate(email)
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return reject('invalid_email');
  const payload: NormalizedSupportFeedbackPayload = {
    type: value.type,
    message,
    report_kind: reportKind,
    ...(email ? { user_email: email } : {})
  };
  const body = JSON.stringify(payload);
  if (utf8ByteLength(body) > MAX_SUPPORT_BODY_BYTES) return reject('body_too_large');
  return { success: true, payload, body };
}

function safeReportId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : undefined;
}

// No caller may turn a boolean/HTTP success alone into a claimed receipt.
export function safeSupportFeedbackResult(value: unknown): SupportFeedbackResult {
  const unknown = (): SupportFeedbackResult => supportFailure('delivery_unknown', 'unknown');
  if (!isPlainObject(value)) return unknown();
  const reportId = safeReportId(value.report_id);
  if (value.success === true && value.delivery_status === 'accepted_by_recipient' && reportId) {
    return { success: true, delivery_status: 'accepted_by_recipient', report_id: reportId };
  }
  if (value.success !== false || typeof value.code !== 'string'
    || !Object.prototype.hasOwnProperty.call(errorForCode, value.code)) return unknown();
  const code = value.code as SupportFeedbackCode;
  if (value.delivery_status === 'unknown') return { ...unknown(), ...(reportId ? { report_id: reportId } : {}) };
  if (value.delivery_status !== 'not_sent' || code === 'delivery_unknown') return unknown();
  return { ...supportFailure(code), ...(reportId ? { report_id: reportId } : {}) };
}
