import type { AiDispatchGuard } from './triageDispatchGuard';
import { withAiDeadline } from '../../shared/aiRequest';
import { AiPublicError, providerErrorCode } from '../../shared/aiError';
import type { AiProvider } from '../../shared/types';
import { normalizeByokBaseUrl } from './byokEndpoint';

export const GEMINI_MODEL_CASCADE = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash'
] as const;

type ChatInput = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  provider: AiProvider;
  systemPrompt: string;
  userPrompt: string;
  imageDataUrl?: string;
  signal?: AbortSignal;
  dispatchGuard?: AiDispatchGuard;
};

/** Status stays internal for retry decisions; no response diagnostics are retained. */
class AiProviderError extends AiPublicError {
  constructor(readonly status: number) {
    super(providerErrorCode(status));
  }
}

async function callOpenAiCompatibleChat(input: ChatInput & { signal: AbortSignal }): Promise<string> {
  const baseUrl = normalizeByokBaseUrl(input.baseUrl);
  if (!baseUrl) throw new AiPublicError('AI_BASE_URL_REQUIRED');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json'
  };
  if (input.provider === 'OpenRouter') {
    headers['HTTP-Referer'] = 'https://bugpocket.app';
    headers['X-Title'] = 'Bug Pocket';
  }

  const request: RequestInit = {
    method: 'POST',
    redirect: 'error',
    signal: input.signal,
    headers,
    body: JSON.stringify({
      model: input.modelId,
      messages: [
        { role: 'system', content: input.systemPrompt },
        {
          role: 'user',
          content: input.imageDataUrl
            ? [
                { type: 'text', text: input.userPrompt },
                { type: 'image_url', image_url: { url: input.imageDataUrl } }
              ]
            : input.userPrompt
        }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  };
  // No await or request preparation may separate this check from dispatch.
  // Keep it outside the connection-error catch: denial is not a transport error.
  input.signal.throwIfAborted();
  input.dispatchGuard?.(input.signal);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, request);
  } catch {
    input.signal.throwIfAborted();
    throw new AiPublicError('AI_CONNECTION');
  }

  // Error bodies can echo credentials, reports and images. Do not consume them.
  if (!response.ok) {
    // Release an unread error stream without waiting on or exposing its contents.
    try { void response.body?.cancel().catch(() => {}); } catch { /* No diagnostics cross this boundary. */ }
    throw new AiProviderError(response.status);
  }

  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch {
    input.signal?.throwIfAborted();
    throw new AiPublicError('AI_CONNECTION');
  }
  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new AiPublicError('AI_EMPTY_RESPONSE');
  }
  const output = data?.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new AiPublicError('AI_EMPTY_RESPONSE');
  return output.trim();
}

export async function callOpenAiCompatibleChatWithFallback(input: ChatInput): Promise<string> {
  return withAiDeadline(async signal => {
    const configured = input.modelId.trim();
    const models = input.provider === 'Gemini'
      ? [...new Set([configured || GEMINI_MODEL_CASCADE[0], ...GEMINI_MODEL_CASCADE])]
      : [configured];
    for (let index = 0; index < models.length; index += 1) {
      signal.throwIfAborted();
      try {
        const output = await callOpenAiCompatibleChat({ ...input, signal, modelId: models[index] });
        signal.throwIfAborted();
        return output;
      } catch (caught) {
        signal.throwIfAborted();
        if (index === models.length - 1 || !(caught instanceof AiProviderError)
          || !(caught.status === 429 || (caught.status >= 500 && caught.status <= 599))) throw caught;
        console.info('[Bug Pocket AI] Retrying Gemini with fallback model', models[index + 1]);
      }
    }
    throw new AiPublicError('AI_EMPTY_RESPONSE');
  }, input.signal);
}
