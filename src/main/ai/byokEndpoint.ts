import { AiPublicError } from '../../shared/aiError';

/** Validate at save time and again before sending credentials or captured evidence. */
export function normalizeByokBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // WHATWG URL parsing repairs missing slashes, backslashes and embedded controls.
  // Require the explicit endpoint form the user entered before normalizing it.
  const authority = /^https?:\/\/([^/?#]+)/i.exec(trimmed)?.[1];
  if (!authority || /[\u0000-\u0020\u007f\\]/.test(trimmed)) {
    throw new AiPublicError('AI_BASE_URL_INVALID');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(trimmed);
  } catch {
    throw new AiPublicError('AI_BASE_URL_INVALID');
  }

  const loopback = endpoint.hostname === 'localhost'
    || endpoint.hostname === '[::1]'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new AiPublicError('AI_BASE_URL_INVALID');
  }
  if (authority.includes('@') || endpoint.username || endpoint.password) {
    throw new AiPublicError('AI_BASE_URL_CREDENTIALS');
  }
  if (endpoint.href.includes('?') || endpoint.href.includes('#')) {
    throw new AiPublicError('AI_BASE_URL_QUERY');
  }

  return endpoint.toString().replace(/\/+$/, '');
}
