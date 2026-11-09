import type { FeedbackPayload } from '../../shared/types';
import {
  normalizeSupportFeedbackPayload,
  safeSupportFeedbackResult,
  supportFailure,
  utf8ByteLength,
  type SupportFeedbackResult
} from '../../shared/supportFeedback';

export const EXAMEN_QA_SUPPORT_ENDPOINT = 'https://bugpocket.app/api/support/feedback';

type SupportFetchResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
};
export type SupportFetch = (url: string, init: RequestInit) => Promise<SupportFetchResponse>;

const MAX_SUPPORT_REPLY_BYTES = 1024;

async function readSupportReply(response: SupportFetchResponse, signal: AbortSignal): Promise<unknown> {
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let reachedEnd = false;
    const parts: string[] = [];
    const cancelRead = (): void => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancelRead, { once: true });
    if (signal.aborted) cancelRead();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) { reachedEnd = true; break; }
        if (!part.value) throw new Error('Invalid response stream.');
        size += part.value.byteLength;
        if (size > MAX_SUPPORT_REPLY_BYTES) {
          cancelRead();
          return null;
        }
        parts.push(decoder.decode(part.value, { stream: true }));
      }
      text = parts.join('') + decoder.decode();
    } finally {
      signal.removeEventListener('abort', cancelRead);
      if (!reachedEnd) cancelRead();
      reader.releaseLock();
    }
  } else {
    // Synthetic response fixtures can supply text without a native stream.
    // This bounds JSON parsing, not the fixture's own string allocation.
    if (!response.text) return null;
    text = await response.text();
    if (text.length > MAX_SUPPORT_REPLY_BYTES || utf8ByteLength(text) > MAX_SUPPORT_REPLY_BYTES) return null;
  }
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

/** Actual IPC entry. No configuration, credentials or transport can enable it. */
export async function sendFeedbackToExamenQa(
  payload: FeedbackPayload,
  _unusedTransport?: SupportFetch
): Promise<SupportFeedbackResult> {
  const prepared = normalizeSupportFeedbackPayload(payload);
  if (!prepared.success) return prepared.result;
  return supportFailure('unavailable');
}

/** Isolated protocol fixture seam; never called by the production IPC entry. */
export async function sendFeedbackUsingInjectedTransport(
  payload: FeedbackPayload,
  transport: SupportFetch,
  options: { timeoutMs?: number } = {}
): Promise<SupportFeedbackResult> {
  const prepared = normalizeSupportFeedbackPayload(payload);
  if (!prepared.success) return prepared.result;
  const controller = new AbortController();
  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
    ? Math.min(20_000, Math.max(1, options.timeoutMs)) : 20_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SupportFeedbackResult>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(supportFailure('delivery_unknown', 'unknown'));
    }, timeoutMs);
  });
  try {
    const attempt = async (): Promise<SupportFeedbackResult> => {
      const response = await transport(EXAMEN_QA_SUPPORT_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        redirect: 'error',
        body: prepared.body,
        signal: controller.signal
      });
      // Regional WAF rejection can have platform-formatted non-JSON content.
      if (response.status === 429) return supportFailure('rate_limited');
      const body = await readSupportReply(response, controller.signal);
      const result = safeSupportFeedbackResult(body);
      if (response.status === 200 && result.success) return result;
      if (response.status >= 200 && response.status < 300) return supportFailure('delivery_unknown', 'unknown');
      if (!result.success) return result;
      return supportFailure('delivery_unknown', 'unknown');
    };
    return await Promise.race([attempt(), deadline]);
  } catch {
    // Once transport was invoked, a timeout or lost response cannot prove that
    // the recipient did not receive it. Never repeat the request automatically.
    return supportFailure('delivery_unknown', 'unknown');
  } finally {
    clearTimeout(timeout);
  }
}
