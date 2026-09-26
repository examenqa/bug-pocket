export const SUPPORT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
export type SupportImageMimeType = (typeof SUPPORT_IMAGE_MIME_TYPES)[number];

export const MAX_SUPPORT_IMAGE_BYTES = 5 * 1024 * 1024;

export const SUPPORT_FEEDBACK_ERRORS = {
  generic: 'Could not send feedback right now. Please try again.',
  network: 'Could not reach Bug Pocket Support. Check your connection and try again.',
  unavailable: 'Bug Pocket Support is temporarily unavailable. Please try again later.',
  rateLimited: 'Too many support requests were sent. Please wait a moment and try again.',
  invalidRequest: 'The support request could not be submitted. Check the form and try again.',
  invalidImage: 'Please attach a valid PNG or JPEG image.',
  imageTooLarge: 'The attached image must be 5 MB or smaller.'
} as const;

export function isSupportImageMimeType(value: string): value is SupportImageMimeType {
  return SUPPORT_IMAGE_MIME_TYPES.includes(value as SupportImageMimeType);
}

export function validateSupportImageFile(file: { type: string; size: number }): string | null {
  if (!isSupportImageMimeType(file.type)) return SUPPORT_FEEDBACK_ERRORS.invalidImage;
  if (!Number.isFinite(file.size) || file.size <= 0) return SUPPORT_FEEDBACK_ERRORS.invalidImage;
  if (file.size > MAX_SUPPORT_IMAGE_BYTES) return SUPPORT_FEEDBACK_ERRORS.imageTooLarge;
  return null;
}
