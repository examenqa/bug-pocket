const endpointError = 'AI Base URL must use HTTPS. HTTP is allowed only for localhost or a loopback IP address.';

/** Validate at save time and again before sending credentials or captured evidence. */
export function normalizeByokBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // WHATWG URL parsing repairs missing slashes, backslashes and embedded controls.
  // Require the explicit endpoint form the user entered before normalizing it.
  const authority = /^https?:\/\/([^/?#]+)/i.exec(trimmed)?.[1];
  if (!authority || /[\u0000-\u0020\u007f\\]/.test(trimmed)) {
    throw new Error(endpointError);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(trimmed);
  } catch {
    throw new Error(endpointError);
  }

  const loopback = endpoint.hostname === 'localhost'
    || endpoint.hostname === '[::1]'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new Error(endpointError);
  }
  if (authority.includes('@') || endpoint.username || endpoint.password) {
    throw new Error('AI Base URL must not contain credentials. Use the API Key field instead.');
  }
  if (endpoint.href.includes('?') || endpoint.href.includes('#')) {
    throw new Error('AI Base URL must not contain a query string or fragment.');
  }

  return endpoint.toString().replace(/\/+$/, '');
}
