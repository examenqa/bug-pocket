type SupabaseFailureResult = {
  error?: unknown;
  status?: number;
  statusText?: string;
};

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export class SupabaseRequestError extends Error {
  readonly status: number | null;
  readonly upstreamError: unknown;

  constructor(result: SupabaseFailureResult, context = 'Supabase request failed') {
    const status = Number.isInteger(result.status) ? Number(result.status) : httpStatusFromError(result.error);
    const fallback = result.statusText?.trim() || context;
    super(errorText(result.error, fallback));
    this.name = 'SupabaseRequestError';
    this.status = status;
    this.upstreamError = result.error;
  }
}

export function httpStatusFromError(error: unknown, visited = new Set<unknown>()): number | null {
  if (!error || visited.has(error)) return null;
  visited.add(error);

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['status', 'statusCode']) {
      const candidate = Number(record[key]);
      if (Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) return candidate;
    }
    for (const key of ['cause', 'error', 'upstreamError']) {
      const nestedStatus = httpStatusFromError(record[key], visited);
      if (nestedStatus !== null) return nestedStatus;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:HTTP|status(?:Code)?)\s*[:=]?\s*(\d{3})/i);
  return match ? Number(match[1]) : null;
}

export function throwIfSupabaseError(result: SupabaseFailureResult, context?: string): void {
  if (result.error) throw new SupabaseRequestError(result, context);
}
