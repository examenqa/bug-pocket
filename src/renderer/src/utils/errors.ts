export function parseErrorForUI(error: unknown): string {
  console.error('Raw application error:', error);

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
  if (haystack.includes('401') || haystack.includes('unauthorized') || haystack.includes('invalid api key')) return 'Invalid API Key';
  if (haystack.includes('402') || haystack.includes('insufficient funds') || haystack.includes('credits')) return 'API key lacks sufficient funds or credits.';
  if (haystack.includes('429') || haystack.includes('rate limit') || haystack.includes('quota')) return 'API rate limit or free tier quota exceeded.';
  if (haystack.includes('networkerror') || haystack.includes('failed to fetch') || haystack.includes('connection') || haystack.includes('econnrefused')) return 'Connection failed.';
  if (haystack.includes('timeout') || haystack.includes('aborterror')) return 'The request timed out.';

  return 'An unexpected error occurred.';
}