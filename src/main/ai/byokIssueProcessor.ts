import { nativeImage, safeStorage } from 'electron';
import type { AiByokConfig, AiIssueProcessPayload, AiIssueProcessResult, AiProvider, AiProviderTarget } from '../../shared/types';
import type { BugPocketDatabase } from '../database';

const legacyDefaultSystemPrompts = [
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. Identify exact UI elements, button states, and error messages. You MUST generate the following details as a strict JSON object with exactly these keys:\n\ntitle: A strict limit of 50 characters maximum (5-7 words). Do not include error codes or lengthy descriptions here.\n\nbugNote: A highly detailed description of the failure and visual UI state.\n\nstepsToReproduce: You MUST write 3 to 5 numbered steps reverse-engineered from the visual context. NEVER leave this blank and NEVER use placeholders. Assume the logical journey required to reach the screen.\n\nexpectedResult: What should have happened.\n\nactualResult: What actually happened.\nDo not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. Identify exact UI elements, button states, and error messages. You MUST generate the following details as a strict JSON object with exactly these keys:\n\ntitle: A strict limit of 100 characters maximum (7-10 words). Do not include error codes or lengthy descriptions here.\n\nbugNote: A highly detailed description of the failure and visual UI state.\n\nstepsToReproduce: You MUST write 3 to 5 numbered steps reverse-engineered from the visual context. NEVER leave this blank and NEVER use placeholders. Assume the logical journey required to reach the screen.\n\nexpectedResult: What should have happened.\n\nactualResult: What actually happened.\nDo not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Rewrite the tester input as a concise, professional issue report. Preserve confirmed facts, do not invent unsupported details, and use clear Markdown suitable for issue trackers.',
  'You are an expert QA Engineer. Expand the user\'s input into a highly descriptive, comprehensive bug report. Do not truncate details. You must respond ONLY with a valid JSON object using exactly these keys: bugNote, stepsToReproduce, expectedResult, actualResult. Do not include any conversational text or markdown formatting outside of the JSON object.',
  'You are a QA Engineer writing strictly for internal developers. Never explain what the application does. Extract the details into a strict JSON object with exactly these keys: title (a concise technical summary), bugNote (only the core description of the issue), stepsToReproduce, expectedResult, actualResult. Do not output any markdown outside this JSON object.',
  'You are an expert QA Engineer writing for internal developers. Analyze the user\'s text and the provided screenshot. Extract missing details (e.g., specific error codes, visible UI state, device/browser context) directly from the image if present. Extract the details into a strict JSON object with exactly these keys: title, bugNote, stepsToReproduce, expectedResult, actualResult. Do not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. You must be highly descriptive. Identify the exact UI elements, button states, and error messages visible in the image. Expand the user\'s brief notes into a comprehensive, professional bug report. Extract the details into a strict JSON object with exactly these keys: title (a concise technical summary), bugNote (a highly detailed description of the failure and visual UI state), stepsToReproduce (numbered, granular steps), expectedResult, actualResult. Do not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. You must be highly descriptive. Identify the exact UI elements, button states, and error messages visible in the image. If explicit steps to reproduce are missing, reverse-engineer the logical user journey required to reach the failed state shown in the UI. Extract the details into a strict JSON object with exactly these keys: title, bugNote, stepsToReproduce (numbered, granular steps), expectedResult, actualResult. Do not output any markdown outside this JSON object.',
];
const defaultSystemPrompt = `You are a Senior QA Engineer analyzing a user's text and a provided Base64 screenshot. Identify exact UI elements, button states, and error messages.

You MUST generate the output as a strict, valid JSON object using exactly the structure below. Do not output any markdown, code blocks, or text outside of this JSON object.

{
"title": "A strict limit of 75 characters maximum (7-10 words). Do not include error codes or lengthy descriptions.",
"bugNote": "A highly detailed description of the failure and visual UI state.",
"stepsToReproduce": [
"Step 1: Infer the necessary preceding actions based on standard UI/UX patterns leading to this state.",
"Step 2: Explicitly list the interactions.",
"Step 3: State the final action that triggers the issue."
],
"expectedResult": "What should have happened.",
"actualResult": "What actually happened."
}`;

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; type?: string; code?: string } | string;
  message?: string;
  detail?: string;
};

type AiProviderRequestTarget = Required<AiProviderTarget> & {
  apiKey: string;
};

const providerDefaultBaseUrls: Record<AiProvider, string> = {
  OpenAI: 'https://api.openai.com/v1',
  Grok: 'https://api.x.ai/v1',
  OpenRouter: 'https://openrouter.ai/api/v1',
  Gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  'Custom/Local': 'http://localhost:11434/v1'
};

export function getByokAiConfig(database: BugPocketDatabase): AiByokConfig {
  const provider = database.getByokAiProvider();
  const encryptedKeys = database.getEncryptedByokAiApiKeys();
  const apiKeys = decryptApiKeyMap(encryptedKeys);
  const hasApiKeys = Object.fromEntries(
    Object.entries(encryptedKeys).map(([key, value]) => [key, Boolean(value)])
  ) as Partial<Record<AiProvider, boolean>>;

  return {
    provider,
    baseUrl: database.getByokAiBaseUrl(),
    modelId: database.getByokAiModelId(),
    hasApiKey: Boolean(encryptedKeys[provider]),
    hasApiKeys,
    apiKey: apiKeys[provider] ?? '',
    apiKeys,
    customSystemPrompt: database.getByokAiCustomSystemPrompt(),
    providerQueue: database.getByokAiProviderQueue()
  };
}

export function saveByokAiConfig(
  database: BugPocketDatabase,
  input: { provider: AiProvider; baseUrl: string; modelId: string; apiKey?: string; clearApiKey?: boolean; customSystemPrompt: string; providerQueue?: AiProviderTarget[] }
): AiByokConfig {
  let encryptedApiKey: string | null | undefined;
  if (input.clearApiKey) encryptedApiKey = '';
  else if (input.apiKey?.trim()) encryptedApiKey = encryptApiKey(input.apiKey.trim());

  database.updateByokAiConfig(input.provider, normalizeBaseUrl(input.baseUrl), input.modelId.trim(), encryptedApiKey, input.customSystemPrompt, normalizeProviderQueue(input.providerQueue));
  return getByokAiConfig(database);
}

export async function processIssueWithByokAi(database: BugPocketDatabase, payload: AiIssueProcessPayload): Promise<AiIssueProcessResult> {
  const config = getByokAiConfig(database);
  const providerQueue = buildProviderQueue(database, config);
  if (providerQueue.length === 0) return { success: false, provider: config.provider, error: 'AI API key is not configured.' };

  const systemPrompt = normalizeSystemPrompt(config.customSystemPrompt);
  const userPrompt = buildIssuePrompt(payload);

  try {
    const result = await executeAiChatWithFallback(providerQueue, { systemPrompt, userPrompt });
    return { success: true, output: result.output, provider: result.provider };
  } catch (caught) {
    return { success: false, provider: config.provider, error: caught instanceof Error ? caught.message : 'AI processing failed.' };
  }
}
export async function triageBugWithByokAi(database: BugPocketDatabase, bugData: unknown): Promise<string> {
  const config = getByokAiConfig(database);
  const providerQueue = buildProviderQueue(database, config);
  if (providerQueue.length === 0) throw new Error('AI API key is not configured. Add one in Settings > AI Processing.');

  const systemPrompt = normalizeSystemPrompt(config.customSystemPrompt);
  const userPrompt = buildTriagePrompt(bugData);
  const imageDataUrl = readBugImageDataUrl(bugData);
  const result = await executeAiChatWithFallback(providerQueue, { systemPrompt, userPrompt, imageDataUrl });
  return extractJsonObjectString(result.output);
}

function encryptApiKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is not available on this Windows profile.');
  return safeStorage.encryptString(apiKey).toString('base64');
}

function decryptApiKey(encryptedValue: string): string {
  if (!encryptedValue || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
  } catch {
    return '';
  }
}

function decryptApiKeyMap(encryptedKeys: Partial<Record<AiProvider, string>>): Partial<Record<AiProvider, string>> {
  const decrypted: Partial<Record<AiProvider, string>> = {};
  (Object.entries(encryptedKeys) as Array<[AiProvider, string]>).forEach(([provider, encryptedValue]) => {
    const apiKey = decryptApiKey(encryptedValue);
    if (apiKey) decrypted[provider] = apiKey;
  });
  return decrypted;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeProviderQueue(queue: AiProviderTarget[] | undefined): AiProviderTarget[] | undefined {
  if (!queue) return undefined;
  return queue
    .map((target) => ({
      provider: target.provider,
      modelId: target.modelId.trim(),
      ...(target.baseUrl?.trim() ? { baseUrl: normalizeBaseUrl(target.baseUrl) } : {})
    }))
    .filter((target) => Boolean(target.modelId));
}

function buildProviderQueue(database: BugPocketDatabase, config: AiByokConfig): AiProviderRequestTarget[] {
  const configuredTargets = config.providerQueue?.length
    ? config.providerQueue
    : defaultProviderQueue(config.provider, config.baseUrl, config.modelId);
  const targets = dedupeProviderTargets([
    { provider: config.provider, baseUrl: config.baseUrl, modelId: config.modelId },
    ...configuredTargets
  ]);

  return targets.flatMap((target) => {
    const apiKey = decryptApiKey(database.getEncryptedByokAiApiKey(target.provider));
    const baseUrl = normalizeBaseUrl(target.baseUrl || providerDefaultBaseUrls[target.provider]);
    const modelId = target.modelId.trim();
    return apiKey && baseUrl && modelId ? [{ provider: target.provider, baseUrl, modelId, apiKey }] : [];
  });
}

function defaultProviderQueue(provider: AiProvider, baseUrl: string, modelId: string): AiProviderTarget[] {
  const queue: AiProviderTarget[] = [
    { provider, baseUrl, modelId },
    { provider: 'Gemini', baseUrl: providerDefaultBaseUrls.Gemini, modelId: 'gemini-3.5-flash' },
    { provider: 'Gemini', baseUrl: providerDefaultBaseUrls.Gemini, modelId: 'gemini-2.5-flash' },
    { provider: 'Gemini', baseUrl: providerDefaultBaseUrls.Gemini, modelId: 'gemini-3.1-flash-lite' }
  ];
  if (provider !== 'OpenRouter') {
    queue.push({ provider: 'OpenRouter', baseUrl: providerDefaultBaseUrls.OpenRouter, modelId: 'meta-llama/llama-3-8b-instruct:free' });
  }
  return queue;
}

function dedupeProviderTargets(targets: AiProviderTarget[]): AiProviderTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const modelId = target.modelId.trim();
    const baseUrl = normalizeBaseUrl(target.baseUrl || providerDefaultBaseUrls[target.provider]);
    const key = `${target.provider}:${baseUrl}:${modelId}`;
    if (!modelId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSystemPrompt(value: string): string {
  const prompt = value.trim();
  return !prompt || legacyDefaultSystemPrompts.includes(prompt) ? defaultSystemPrompt : prompt;
}

function extractJsonObjectString(value: string): string {
  const match = value.match(/\{[\s\S]*\}/);
  return (match ? match[0] : value).trim();
}

function readBugImageDataUrl(bugData: unknown): string | undefined {
  const payload = bugData as { image_file_path?: unknown } | null;
  const imageFilePath = typeof payload?.image_file_path === 'string' ? payload.image_file_path : '';
  if (!imageFilePath) return undefined;

  const image = nativeImage.createFromPath(imageFilePath);
  if (image.isEmpty()) {
    throw new Error('Image payload failed to encode. The AI cannot process this request without visual context.');
  }

  const size = image.getSize();
  const optimizedImage = size.width > 1024 ? image.resize({ width: 1024 }) : image;
  const jpegBuffer = optimizedImage.toJPEG(80);
  return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
}

const aiPromptOmittedKeys = new Set([
  'attachment',
  'attachments',
  'attachment_path',
  'attachment_paths',
  'content_hash',
  'file_extension',
  'file_name',
  'file_path',
  'filename',
  'image_file_path',
  'mime_type',
  'path'
]);

function sanitizeBugDataForPrompt(bugData: unknown): unknown {
  return stripAiPromptOnlyFields(bugData);
}

function stripAiPromptOnlyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAiPromptOnlyFields);
  if (!value || typeof value !== 'object') return value;

  const safePayload: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
    if (aiPromptOmittedKeys.has(key.toLowerCase())) return;
    safePayload[key] = stripAiPromptOnlyFields(nestedValue);
  });
  return safePayload;
}
function buildTriagePrompt(bugData: unknown): string {
  return [
    'Bug data to triage:',
    JSON.stringify(sanitizeBugDataForPrompt(bugData), null, 2),
    '',
    'Task: Return only a valid JSON object with exactly these keys: title, bugNote, stepsToReproduce, expectedResult, actualResult. Keep title under 75 characters. stepsToReproduce must be an array of three or more explicit step strings. Use the screenshot when provided, but do not explain what the application does.'
  ].join('\n');
}

function buildIssuePrompt(payload: AiIssueProcessPayload): string {
  const taxonomy = payload.taxonomy ?? {};
  return [
    'Raw tester input:',
    payload.rawInput,
    '',
    'Taxonomy/context:',
    `Application: ${taxonomy.application || 'Not specified'}`,
    `Module: ${taxonomy.module || 'Not specified'}`,
    `Environment: ${taxonomy.environment || 'Not specified'}`,
    `User role: ${taxonomy.user_role || 'Not specified'}`,
    `Device: ${taxonomy.device || 'Not specified'}`,
    `Browser: ${taxonomy.browser || 'Not specified'}`,
    `Entry type: ${taxonomy.entry_type || 'Bug'}`,
    `Severity: ${taxonomy.severity || 'Not specified'}`,
    '',
    'Task: Return only the final formatted issue text. Do not include prefaces, explanations, or code fences.'
  ].join('\n');
}

function parseChatCompletionResponse(rawBody: string): ChatCompletionResponse {
  if (!rawBody.trim()) return {};
  try {
    return JSON.parse(rawBody) as ChatCompletionResponse;
  } catch {
    return { message: rawBody.trim() };
  }
}

function extractProviderErrorMessage(body: ChatCompletionResponse, rawBody: string): string {
  if (typeof body.error === 'string') return body.error;
  if (body.error?.message) return body.error.message;
  if (body.message) return body.message;
  if (body.detail) return body.detail;
  return rawBody.trim();
}

async function executeAiChatWithFallback(
  queue: AiProviderRequestTarget[],
  payload: { systemPrompt: string; userPrompt: string; imageDataUrl?: string }
): Promise<{ output: string; provider: AiProvider }> {
  let lastFallbackError: unknown = null;

  for (const target of queue) {
    try {
      const output = await callOpenAiCompatibleChat({
        apiKey: target.apiKey,
        baseUrl: target.baseUrl,
        modelId: target.modelId,
        provider: target.provider,
        systemPrompt: payload.systemPrompt,
        userPrompt: payload.userPrompt,
        imageDataUrl: payload.imageDataUrl
      });
      return { output, provider: target.provider };
    } catch (caught) {
      if (!isFallbackEligibleError(caught)) throw caught;
      lastFallbackError = caught;
      console.warn(`AI provider ${target.provider} (${target.modelId}) failed with a retryable error. Trying next fallback.`);
    }
  }

  const error = new Error(
    JSON.stringify({
      userMessage: 'All AI providers are currently unavailable. Please try again later.',
      rawDetails: errorDetails(lastFallbackError)
    })
  );
  (error as { status?: number }).status = 503;
  throw error;
}

async function callOpenAiCompatibleChat(input: {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  provider: AiProvider;
  systemPrompt: string;
  userPrompt: string;
  imageDataUrl?: string;
}): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json'
  };

  if (input.provider === 'OpenRouter') {
    headers['HTTP-Referer'] = 'https://bugpocket.app';
    headers['X-Title'] = 'Bug Pocket';
  }

  let response: Response;
  try {
    response = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
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
    });
  } catch (caught) {
    throw createAiNetworkError(caught);
  }

  const rawBody = await response.text();
  const data = parseChatCompletionResponse(rawBody);

  if (!response.ok) {
    throw createAiProviderError(response.status, response.statusText, data, rawBody);
  }

  if (!data.choices || data.choices.length === 0) {
    throw new Error('AI provider returned an empty success response.');
  }

  const output = data.choices[0]?.message?.content?.trim();
  if (!output) throw new Error('AI provider returned an empty success response.');
  return output;
}
function createAiProviderError(status: number, statusText: string, data: ChatCompletionResponse, rawBody: string): Error {
  let userMessage = 'An unexpected AI provider error occurred.';
  if (status === 401) userMessage = 'Invalid API Key. Please check your settings.';
  else if (status === 402) userMessage = 'API Key lacks sufficient funds or credits.';
  else if (status === 429) userMessage = 'AI Provider rate limit reached. Please wait a moment and try again.';
  else if (status === 500 || status === 503) userMessage = 'AI Provider is currently overloaded or down. Try again later.';
  else if (status >= 500) userMessage = 'AI Provider is currently experiencing server issues.';
  else {
    const providerMessage = extractProviderErrorMessage(data, rawBody);
    if (providerMessage) userMessage = providerMessage;
  }

  const rawDetailsBody = rawBody.trim() || JSON.stringify(data);
  const error = new Error(
    JSON.stringify({
      userMessage,
      rawDetails: `HTTP ${status}: ${rawDetailsBody || statusText}`
    })
  );
  (error as { status?: number }).status = status;
  return error;
}

function createAiNetworkError(caught: unknown): Error {
  const message = caught instanceof Error ? caught.message : String(caught ?? '');
  const haystack = `${caught instanceof Error ? caught.name : ''} ${message}`.toLowerCase();
  const isTimeout = haystack.includes('timeout') || haystack.includes('econnaborted') || haystack.includes('aborterror');
  const userMessage = haystack.includes('timeout') || haystack.includes('econnaborted') || haystack.includes('aborterror')
    ? 'The request timed out. The image payload might be too large or your connection dropped.'
    : `An unknown network error occurred: ${message || 'Unable to reach the AI provider.'}`;

  const error = new Error(
    JSON.stringify({
      userMessage,
      rawDetails: message || String(caught ?? '')
    })
  );
  (error as { retryableNetworkError?: boolean }).retryableNetworkError = isTimeout;
  return error;
}

function isFallbackEligibleError(error: unknown): boolean {
  const candidate = error as { status?: unknown; retryableNetworkError?: unknown } | null;
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  return status === 429 || (status !== null && status >= 500) || candidate?.retryableNetworkError === true;
}

function errorDetails(error: unknown): string {
  if (!error) return 'No provider returned a successful response.';
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}







