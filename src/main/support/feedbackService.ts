import { Buffer } from 'node:buffer';
import type { FeedbackPayload } from '../../shared/types';
import {
  MAX_SUPPORT_IMAGE_BYTES,
  SUPPORT_FEEDBACK_ERRORS,
  isSupportImageMimeType,
  validateSupportImageFile,
  type SupportImageMimeType
} from '../../shared/supportFeedback';

export const EXAMEN_QA_SUPPORT_ENDPOINT = 'https://bugpocket.app/api/support/feedback';

type SupportFetchResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
};

export type SupportFetch = (url: string, init: RequestInit) => Promise<SupportFetchResponse>;

type PreparedSupportImage = {
  image_base64: string;
  image_mime_type: SupportImageMimeType;
};

function hasPngSignature(bytes: Buffer): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function hasJpegSignature(bytes: Buffer): boolean {
  return bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
}

function prepareSupportImage(payload: FeedbackPayload): PreparedSupportImage | undefined {
  if (!payload.image_base64) return undefined;

  const declaredMimeType = payload.image_mime_type ?? '';
  if (!isSupportImageMimeType(declaredMimeType)) {
    throw new Error(SUPPORT_FEEDBACK_ERRORS.invalidImage);
  }

  const dataUrlMatch = payload.image_base64.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (dataUrlMatch && dataUrlMatch[1].toLowerCase() !== declaredMimeType) {
    throw new Error(SUPPORT_FEEDBACK_ERRORS.invalidImage);
  }

  const compactBase64 = (dataUrlMatch?.[2] ?? payload.image_base64).replace(/\s/g, '');
  if (
    !compactBase64
    || compactBase64.length % 4 !== 0
    || !/^[a-z0-9+/]+={0,2}$/i.test(compactBase64)
  ) {
    throw new Error(SUPPORT_FEEDBACK_ERRORS.invalidImage);
  }

  const bytes = Buffer.from(compactBase64, 'base64');
  const metadataError = validateSupportImageFile({ type: declaredMimeType, size: bytes.length });
  if (metadataError) throw new Error(metadataError);

  const signatureIsValid = declaredMimeType === 'image/png'
    ? hasPngSignature(bytes)
    : hasJpegSignature(bytes);
  if (!signatureIsValid) throw new Error(SUPPORT_FEEDBACK_ERRORS.invalidImage);

  return {
    image_base64: compactBase64,
    image_mime_type: declaredMimeType
  };
}

function errorForStatus(status: number): string {
  if (status === 400 || status === 401 || status === 403 || status === 422) {
    return SUPPORT_FEEDBACK_ERRORS.invalidRequest;
  }
  if (status === 413) return SUPPORT_FEEDBACK_ERRORS.imageTooLarge;
  if (status === 429) return SUPPORT_FEEDBACK_ERRORS.rateLimited;
  if (status >= 500) return SUPPORT_FEEDBACK_ERRORS.unavailable;
  return SUPPORT_FEEDBACK_ERRORS.generic;
}

function safeErrorMessage(caught: unknown): string {
  if (caught instanceof Error && Object.values(SUPPORT_FEEDBACK_ERRORS).includes(
    caught.message as (typeof SUPPORT_FEEDBACK_ERRORS)[keyof typeof SUPPORT_FEEDBACK_ERRORS]
  )) {
    return caught.message;
  }
  return SUPPORT_FEEDBACK_ERRORS.network;
}

export async function sendFeedbackToExamenQa(
  payload: FeedbackPayload,
  fetchImpl: SupportFetch = (url, init) => fetch(url, init)
): Promise<{ success: boolean; error?: string }> {
  const message = payload.message.trim();
  if (!message) {
    return { success: false, error: SUPPORT_FEEDBACK_ERRORS.invalidRequest };
  }

  try {
    const image = prepareSupportImage(payload);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 20_000);
    let response: SupportFetchResponse;
    try {
      response = await fetchImpl(EXAMEN_QA_SUPPORT_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: payload.type === 'Feature' ? 'Feature' : 'Bug',
          message,
          user_email: payload.user_email?.trim() || undefined,
          ...image
        }),
        signal: abortController.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return { success: false, error: errorForStatus(response.status) };
    }

    if (response.json) {
      const body = await response.json().catch(() => null) as { success?: boolean } | null;
      if (body?.success === false) {
        return { success: false, error: SUPPORT_FEEDBACK_ERRORS.unavailable };
      }
    }

    return { success: true };
  } catch (caught) {
    return { success: false, error: safeErrorMessage(caught) };
  }
}
