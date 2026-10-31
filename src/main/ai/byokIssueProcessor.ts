import type { AiDispatchGuard } from './triageDispatchGuard';
import { AiCancelledError, AiTimeoutError } from '../../shared/aiRequest';
import { AiPublicError, serializeAiError } from '../../shared/aiError';
import { callOpenAiCompatibleChatWithFallback, GEMINI_MODEL_CASCADE } from './openAiCompatibleChat';
export { callOpenAiCompatibleChatWithFallback } from './openAiCompatibleChat';
import { nativeImage, safeStorage } from 'electron';
import type { AiByokConfig, AiConfigSaveInput, AiIssueProcessPayload, AiIssueProcessResult, AiProvider, AiTriageBugPayload } from '../../shared/types';
import type { BugPocketDatabase } from '../database';
import { buildRendererByokAiConfig, decryptStoredApiKey } from './byokConfigResponse';
import { resolveVerifiedTriageAttachmentPath } from './triageAttachment';
import { normalizeByokBaseUrl } from './byokEndpoint';

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
"Infer the necessary preceding actions based on standard UI/UX patterns leading to this state.",
"Explicitly list the interactions.",
"State the final action that triggers the issue."
],
"expectedResult": "What should have happened.",
"actualResult": "What actually happened."
}`;

export function getByokAiConfig(database: BugPocketDatabase): AiByokConfig {
  return buildRendererByokAiConfig(database);
}

export function saveByokAiConfig(
  database: BugPocketDatabase,
  input: AiConfigSaveInput
): AiByokConfig {
  // Credential removal must work even when legacy endpoint settings are invalid.
  if (input.apiKeyOperation?.action === 'clear') {
    database.clearByokAiApiKey(input.provider);
    return getByokAiConfig(database);
  }
  const baseUrl = normalizeByokBaseUrl(input.baseUrl);
  const modelId = input.modelId.trim();
  if (!baseUrl) throw new AiPublicError('AI_BASE_URL_REQUIRED');
  if (!modelId) throw new AiPublicError('AI_MODEL_REQUIRED');
  let encryptedApiKey: string | null | undefined;
  if (input.apiKeyOperation?.action === 'replace') {
    const replacementKey = input.apiKeyOperation.value.trim();
    if (!replacementKey) throw new AiPublicError('AI_REPLACEMENT_KEY_EMPTY');
    encryptedApiKey = encryptApiKey(replacementKey);
  }

  database.updateByokAiConfig(input.provider, baseUrl, modelId, encryptedApiKey, input.customSystemPrompt);
  return getByokAiConfig(database);
}

export async function processIssueWithByokAi(database: BugPocketDatabase, payload: AiIssueProcessPayload, signal?: AbortSignal): Promise<AiIssueProcessResult> {
  const config = getByokAiConfig(database);
  const apiKey = decryptStoredApiKey(database.getEncryptedByokAiApiKey(config.provider), safeStorage);
  if (!apiKey) return { success: false, provider: config.provider, error: serializeAiError(new AiPublicError('AI_KEY_NOT_CONFIGURED')) };

  const baseUrl = normalizeByokBaseUrl(config.baseUrl);
  const modelId = config.modelId.trim() || (config.provider === 'Gemini' ? GEMINI_MODEL_CASCADE[0] : '');
  if (!baseUrl) return { success: false, provider: config.provider, error: serializeAiError(new AiPublicError('AI_BASE_URL_REQUIRED')) };
  if (!modelId) return { success: false, provider: config.provider, error: serializeAiError(new AiPublicError('AI_MODEL_REQUIRED')) };

  const systemPrompt = normalizeSystemPrompt(config.customSystemPrompt);
  const userPrompt = buildIssuePrompt(payload);

  try {
    const output = await callOpenAiCompatibleChatWithFallback({
      apiKey,
      baseUrl,
      modelId,
      provider: config.provider,
      systemPrompt,
      userPrompt,
      signal
    });
    return { success: true, output, provider: config.provider };
  } catch (caught) {
    signal?.throwIfAborted();
    if (caught instanceof AiCancelledError || caught instanceof AiTimeoutError) throw caught;
    return { success: false, provider: config.provider, error: serializeAiError(caught) };
  }
}
export async function triageBugWithByokAi(database: BugPocketDatabase, bugData: unknown, signal?: AbortSignal, dispatchGuard?: AiDispatchGuard): Promise<string> {
  const config = getByokAiConfig(database);
  const apiKey = decryptStoredApiKey(database.getEncryptedByokAiApiKey(config.provider), safeStorage);
  if (!apiKey) throw new AiPublicError('AI_KEY_NOT_CONFIGURED');

  const baseUrl = normalizeByokBaseUrl(config.baseUrl);
  const modelId = config.modelId.trim() || (config.provider === 'Gemini' ? GEMINI_MODEL_CASCADE[0] : '');
  if (!baseUrl) throw new AiPublicError('AI_BASE_URL_REQUIRED');
  if (!modelId) throw new AiPublicError('AI_MODEL_REQUIRED');

  const systemPrompt = normalizeSystemPrompt(config.customSystemPrompt);
  const userPrompt = buildTriagePrompt(bugData);
  const imageDataUrl = readBugImageDataUrl(database, bugData);
  const output = await callOpenAiCompatibleChatWithFallback({ apiKey, baseUrl, modelId, provider: config.provider, systemPrompt, userPrompt, imageDataUrl, signal, dispatchGuard });
  return extractJsonObjectString(output);
}

function encryptApiKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new AiPublicError('AI_SECURE_STORAGE_UNAVAILABLE');
  return safeStorage.encryptString(apiKey).toString('base64');
}

function normalizeSystemPrompt(value: string): string {
  const prompt = value.trim();
  return !prompt || legacyDefaultSystemPrompts.includes(prompt) ? defaultSystemPrompt : prompt;
}

export function extractJsonObjectString(value: string): string {
  const trimmed = value.trim();
  const start = trimmed.indexOf('{');
  if (start < 0) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }

  return trimmed;
}

function readBugImageDataUrl(database: BugPocketDatabase, bugData: unknown): string | undefined {
  const imageFilePath = resolveVerifiedTriageAttachmentPath(database, bugData as AiTriageBugPayload);
  if (!imageFilePath) return undefined;

  const image = nativeImage.createFromPath(imageFilePath);
  if (image.isEmpty()) {
    throw new AiPublicError('AI_IMAGE_ENCODING');
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
  'attachment_id',
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
    'Task: Return only a valid JSON object with exactly these keys: title, bugNote, stepsToReproduce, expectedResult, actualResult. Keep title under 75 characters. stepsToReproduce must be an array of three or more explicit action strings without numbers or Step X prefixes. Use the screenshot when provided, but do not explain what the application does.'
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
    `Operating system: ${taxonomy.os || 'Not specified'}`,
    `Entry type: ${taxonomy.entry_type || 'Bug'}`,
    `Severity: ${taxonomy.severity || 'Not specified'}`,
    '',
    'Task: Return only the final formatted issue text. Do not include prefaces, explanations, or code fences.'
  ].join('\n');
}







