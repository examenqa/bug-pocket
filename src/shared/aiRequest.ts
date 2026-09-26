// One total deadline for an AI operation, including response bodies and fallbacks.
export const AI_REQUEST_TIMEOUT_MS = 120_000;
export class AiCancelledError extends Error {
  constructor() { super('AI request cancelled.'); this.name = 'AiCancelledError'; }
}
export class AiTimeoutError extends Error {
  constructor() { super('AI request timed out after 120 seconds. Please retry.'); this.name = 'AiTimeoutError'; }
}
export type AiRequestResult<T> = { status: 'completed'; value: T } | { status: 'cancelled' | 'timed_out'; message: string } | { status: 'failed'; message: string };

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new AiCancelledError());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    // Both branches remain observed even if a non-cooperative provider resolves late.
    work.then(value => { if (!signal.aborted) resolve(value); }, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function withAiDeadline<T>(work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal, timeoutMs = AI_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason ?? new AiCancelledError());
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new AiTimeoutError()), timeoutMs);
  try {
    controller.signal.throwIfAborted();
    return await abortable(work(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
