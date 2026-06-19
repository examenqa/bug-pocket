export function parseErrorForUI(error: unknown): string {
  console.error('Raw application error:', error);

  const status = extractErrorStatus(error);
  if (status === 401) return 'Invalid API Key. Please check your settings.';
  if (status === 429) return 'AI Provider rate limit reached. Please wait a moment and try again.';
  if (status === 500 || status === 503) return 'AI Provider is currently overloaded or down. Try again later.';

  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = rawMessage.replace(/^Error:\s*/i, '').trim();

  if (normalized) {
    try {
      const parsed = JSON.parse(normalized) as { userMessage?: unknown; rawDetails?: unknown };
      if (typeof parsed.userMessage === 'string' && parsed.userMessage.trim()) return parsed.userMessage.trim();
    } catch {
      // Fall through to pattern-based sanitization.
    }
  }

  const haystack = `${normalized} ${String(error ?? '')}`.toLowerCase();
  if (haystack.includes('401') || haystack.includes('unauthorized') || haystack.includes('invalid api key')) {
    return 'Invalid API Key. Please check your settings.';
  }
  if (haystack.includes('402') || haystack.includes('insufficient funds') || haystack.includes('credits')) return 'API key lacks sufficient funds or credits.';
  if (haystack.includes('429') || haystack.includes('rate limit') || haystack.includes('quota')) {
    return 'AI Provider rate limit reached. Please wait a moment and try again.';
  }
  if (haystack.includes('500') || haystack.includes('503') || haystack.includes('server issues') || haystack.includes('overloaded')) {
    return 'AI Provider is currently overloaded or down. Try again later.';
  }
  if (haystack.includes('timeout') || haystack.includes('aborterror') || haystack.includes('econnaborted')) {
    return 'The request timed out. The image payload might be too large or your connection dropped.';
  }

  const fallback = normalized || (error instanceof Error ? error.message : String(error ?? '')).trim();
  return `An unknown network error occurred: ${fallback || 'No additional details were provided.'}`;
}

function extractErrorStatus(error: unknown): number | null {
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: { status?: unknown; statusCode?: unknown };
  } | null;
  const values = [candidate?.status, candidate?.statusCode, candidate?.response?.status, candidate?.cause?.status, candidate?.cause?.statusCode];
  for (const value of values) {
    const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(status)) return status;
  }
  return null;
}
