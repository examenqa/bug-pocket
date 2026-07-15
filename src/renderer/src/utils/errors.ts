export function parseErrorForUI(error: unknown): string {
  console.error('Raw application error:', error);

  const status = extractErrorStatus(error);
  const rawMessage = extractErrorMessage(error);
  const normalized = rawMessage.replace(/^Error:\s*/i, '').trim();

  // IPC validation errors must remain visible. They are renderer/main-process
  // contract failures, not evidence that an AI provider is unavailable.
  if (/invalid ipc payload|validation|typeerror/i.test(normalized)) {
    return normalized.startsWith('Validation Error:') ? normalized : `Validation Error: ${normalized}`;
  }

  if (status === 401) return 'Invalid API Key. Please check your settings.';
  if (status === 429) return 'AI Provider rate limit reached. Please wait a moment and try again.';
  if (status !== null && status >= 500 && status < 600) return 'AI Provider is currently overloaded or down. Try again later.';

  if (normalized) {
    try {
      const parsed = JSON.parse(normalized) as { userMessage?: unknown; rawDetails?: unknown };
      if (typeof parsed.userMessage === 'string' && parsed.userMessage.trim()) return parsed.userMessage.trim();
    } catch {
      // Fall through to pattern-based sanitization.
    }
  }

  const haystack = `${normalized} ${String(error ?? '')}`;
  if (/\bHTTP\s+429\b/i.test(haystack)) {
    return 'AI Provider rate limit reached. Please wait a moment and try again.';
  }
  if (/\bHTTP\s+5\d{2}\b/i.test(haystack) || /fetch failed/i.test(haystack)) {
    return 'AI Provider is currently overloaded or down. Try again later.';
  }

  const lowerHaystack = haystack.toLowerCase();
  if (lowerHaystack.includes('401') || lowerHaystack.includes('unauthorized') || lowerHaystack.includes('invalid api key')) {
    return 'Invalid API Key. Please check your settings.';
  }
  if (lowerHaystack.includes('402') || lowerHaystack.includes('insufficient funds') || lowerHaystack.includes('credits')) return 'API key lacks sufficient funds or credits.';
  if (lowerHaystack.includes('rate limit') || lowerHaystack.includes('quota')) {
    return 'AI Provider rate limit reached. Please wait a moment and try again.';
  }
  if (lowerHaystack.includes('timeout') || lowerHaystack.includes('aborterror') || lowerHaystack.includes('econnaborted')) {
    return 'The request timed out. The image payload might be too large or your connection dropped.';
  }

  const fallback = normalized || extractErrorMessage(error) || String(error ?? '').trim();
  return `An unknown network error occurred: ${fallback || 'No additional details were provided.'}`;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
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
