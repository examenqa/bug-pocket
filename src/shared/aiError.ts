/** Public AI failures contain app-owned categories only, never upstream diagnostics. */
const aiErrorMessages = {
  AI_FAILED: 'AI processing failed. Please check your AI settings and retry.',
  AI_TRIAGE_BLOCKED: 'AI triage is unavailable. Check workspace access and app state, then retry.',
  AI_AUTH: 'Invalid API Key. Please check your AI Settings.',
  AI_CREDITS: 'API Key lacks sufficient funds or credits.',
  AI_FORBIDDEN: 'The AI account does not have access to this request. Check its permissions.',
  AI_MODEL_UNAVAILABLE: 'The AI model is unavailable. Check the configured model and account access.',
  AI_RATE_LIMIT: 'API rate limit or free tier quota exceeded.',
  AI_SERVER: 'AI Provider is currently experiencing server issues.',
  AI_CONNECTION: 'Could not connect to the AI provider. Check the endpoint and connection.',
  AI_KEY_NOT_CONFIGURED: 'AI API key is not configured. Add one in Settings > AI Processing.',
  AI_NOT_CONFIGURED: 'AI triage is not configured. Add a BYOK API key or enable local Ollama triage in Settings.',
  AI_BASE_URL_REQUIRED: 'AI Base URL is required.',
  AI_BASE_URL_INVALID: 'AI Base URL must use HTTPS. HTTP is allowed only for localhost or a loopback IP address.',
  AI_BASE_URL_CREDENTIALS: 'AI Base URL must not contain credentials. Use the API Key field instead.',
  AI_BASE_URL_QUERY: 'AI Base URL must not contain a query string or fragment.',
  AI_MODEL_REQUIRED: 'AI Model ID is required.',
  AI_SECURE_STORAGE_UNAVAILABLE: 'Secure key storage is not available on this Windows profile.',
  AI_REPLACEMENT_KEY_EMPTY: 'Replacement API key cannot be empty.',
  AI_IMAGE_ENCODING: 'Image payload failed to encode. Select a valid local image and retry.',
  AI_ATTACHMENT_INVALID: 'AI attachment ID is invalid.',
  AI_ATTACHMENT_UNAVAILABLE: 'The selected AI attachment is unavailable.',
  AI_ATTACHMENT_MISSING: 'The selected AI attachment file is missing.',
  AI_EMPTY_RESPONSE: 'AI provider returned an empty or invalid success response.',
  AI_NATIVE_CONNECTION: 'Could not connect to Ollama at http://localhost:11434. Is the daemon running?',
  AI_NATIVE_MODEL_INVALID: 'Invalid Ollama model name. Use only alphanumeric characters, hyphens, colons, underscores, and periods.',
  AI_NATIVE_MODEL_UNAVAILABLE: 'Ollama model is not available locally. Check the configured model.',
  AI_NATIVE_RESOURCE: 'Ollama hardware or runtime error. Check the local model and available resources.',
  AI_NATIVE_RESPONSE_INVALID: 'Ollama returned an invalid response. Check the configured model and retry.',
  AI_NATIVE_FAILED: 'Ollama triage failed. Check the local service and model, then retry.'
} as const;

export type AiErrorCode = keyof typeof aiErrorMessages;

// Trust is attached to the actual constructed instance, not forgeable public fields.
const ownedErrorCodes = new WeakMap<object, AiErrorCode>();

function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(aiErrorMessages, value);
}

export function getAiErrorMessage(code: unknown): string {
  return aiErrorMessages[isAiErrorCode(code) ? code : 'AI_FAILED'];
}

export class AiPublicError extends Error {
  constructor(code: AiErrorCode) {
    const safeCode = isAiErrorCode(code) ? code : 'AI_FAILED';
    super(getAiErrorMessage(safeCode));
    this.name = 'AiPublicError';
    ownedErrorCodes.set(this, safeCode);
  }
}

/** Only locally constructed errors retain their category across the main boundary. */
export function serializeAiError(error: unknown): string {
  const code = error !== null && (typeof error === 'object' || typeof error === 'function')
    ? ownedErrorCodes.get(error) ?? 'AI_FAILED'
    : 'AI_FAILED';
  return JSON.stringify({ code });
}

/** Decode only the finite wire category, never arbitrary provider objects or text. */
export function parseAiErrorCode(value: unknown): AiErrorCode | null {
  try {
    const serialized = typeof value === 'string' ? value : value instanceof Error ? value.message : null;
    if (typeof serialized !== 'string' || serialized.length > 128) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== 'code') return null;
    const code = (parsed as { code?: unknown }).code;
    return isAiErrorCode(code) ? code : null;
  } catch {
    return null;
  }
}

/** Read a bounded wire category; never display provider-controlled text or details. */
export function parseAiErrorMessage(value: unknown): string | null {
  const code = parseAiErrorCode(value);
  return code === null ? null : getAiErrorMessage(code);
}

/** Numeric status is used for classification; no upstream response field is trusted. */
export function providerErrorCode(status: number): AiErrorCode {
  if (status === 401) return 'AI_AUTH';
  if (status === 402) return 'AI_CREDITS';
  if (status === 403) return 'AI_FORBIDDEN';
  if (status === 404) return 'AI_MODEL_UNAVAILABLE';
  if (status === 429) return 'AI_RATE_LIMIT';
  if (Number.isInteger(status) && status >= 500 && status <= 599) return 'AI_SERVER';
  return 'AI_FAILED';
}
