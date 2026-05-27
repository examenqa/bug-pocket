import { readFile } from 'node:fs/promises';
import type { AiTriageBugPayload, AiTriageResponse, AiTriageResult } from '../../shared/types';

const ollamaChatUrl = 'http://localhost:11434/api/chat';
const modelNameRegex = /^[a-zA-Z0-9\-:._]+$/;

const systemPrompt =
  "You are an Expert QA Tester. Your task is to take a rough bug note, a screenshot, and the application context, and transform them into a fully polished, professional bug report. DO NOT just repeat the user's input. You have permission to expand, infer, and deduce the missing details. You must rewrite the user's rough tester note into a highly polished, professional, 1-2 sentence executive summary. You MUST output your response as a raw JSON object wrapped in a markdown code block (e.g., ```json { ... } ```). Do not include any other text.";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  error?: string;
}

export async function triageBugWithOllama(payload: AiTriageBugPayload, configuredModelName: string): Promise<AiTriageResponse> {
  const imageBase64 = payload.image_file_path ? await readImageAsBase64(payload.image_file_path) : '';

  try {
    const model = configuredModelName.trim() || 'qwen3-vl:8b';
    if (!modelNameRegex.test(model)) {
      throw new Error(
        `Invalid model name configured: '${configuredModelName}'. Only alphanumeric characters, hyphens, colons, underscores, and periods are allowed.`
      );
    }

    const requestBody = {
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: buildBugTriagePrompt(payload),
          images: imageBase64 ? [imageBase64] : undefined
        }
      ],
      options: {
        num_ctx: 8192
      },
      stream: false
    };
    const sanitizedRequestBody = {
      ...requestBody,
      messages: requestBody.messages.map((message) => ({
        ...message,
        images: message.images ? [`[base64 omitted: ${message.images[0]?.length ?? 0} chars]`] : undefined
      }))
    };
    console.log('[OLLAMA REQUEST BODY]', JSON.stringify(sanitizedRequestBody, null, 2));
    if (imageBase64) console.log('[OLLAMA IMAGE BASE64 FIRST 50]', imageBase64.substring(0, 50));

    const response = await fetch(ollamaChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const body = (await response.json().catch(() => ({}))) as OllamaChatResponse;
    console.log('[OLLAMA RAW RESPONSE]', body.message?.content ?? '');
    if (!response.ok) throw new Error(classifyOllamaHttpError(response.status, body.error));
    if (body.error) throw new Error(classifyOllamaMessage(body.error));

    return {
      success: true,
      model,
      result: parseTriageJson(body.message?.content ?? '')
    };
  } catch (caught) {
    console.error('[OLLAMA TRIAGE ERROR]', caught instanceof Error ? caught.stack || caught.message : caught);
    return {
      success: false,
      model: 'fallback',
      error: normalizeOllamaError(caught),
      result: fallbackTriage(payload)
    };
  }
}

async function readImageAsBase64(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  const maybeDataUrl = bytes.toString('utf8').trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(maybeDataUrl)) return stripBase64Prefix(maybeDataUrl);
  return stripBase64Prefix(bytes.toString('base64'));
}

function stripBase64Prefix(value: string): string {
  return value.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
}

function buildBugTriagePrompt(payload: AiTriageBugPayload): string {
  const refinementNote = cleanString(payload.refinement_note);
  return [
    `App Context: Application: ${payload.application || 'Unknown'}\n${payload.application_context || '[No application context provided]'}`,
    `Module Context: Module: ${payload.module || 'Unknown'}\n${payload.module_context || '[No module context provided]'}`,
    `Tester Note: ${payload.note || '[No tester note provided]'}`,
    [
      refinementNote
        ? `CRITICAL: The user has reviewed the current draft and requested the following specific correction: '${refinementNote}'. Apply this correction strictly to the existing data.`
        : '',
      'Task: Analyze the screenshot and context to deduce the exact steps required to reach the visual state.',
      "Use the context to infer the 'Expected Result'.",
      "Expand the rough note into a clear 'Actual Result'.",
      "Rewrite the rough tester note into a polished 1-2 sentence refined_summary.",
      "Generate a concise 'Bug Title'.",
      'Fill out the JSON schema with visual_analysis, bug_title, refined_summary, severity_level, steps_to_reproduce, expected_result, and actual_result.'
    ].filter(Boolean).join(' '),
    '',
    'Existing Manual Fields:',
    `Entry type: ${payload.entry_type || 'Bug'}`,
    `Environment: ${payload.environment || 'Unknown'}`,
    `Device: ${payload.device || 'Unknown'}`,
    `Browser: ${payload.browser || 'Unknown'}`,
    `Current severity: ${payload.severity || 'Unknown'}`,
    `Current status: ${payload.status || 'Unknown'}`,
    `Title: ${payload.title || ''}`,
    `Steps to reproduce: ${payload.steps_to_reproduce || ''}`,
    `Expected result: ${payload.expected_result || ''}`,
    `Actual result: ${payload.actual_result || ''}`,
    `Other details: ${payload.other_details || ''}`,
    '',
    'Return exactly this JSON shape:',
    '{',
    '  "visual_analysis": "Briefly describe what you see in the screenshot and the UI state here before generating the rest of the report.",',
    '  "bug_title": "...",',
    '  "refined_summary": "Rewrite the rough note into a polished 1-2 sentence summary.",',
    '  "severity_level": "...",',
    '  "steps_to_reproduce": "1. ...\\n2. ...",',
    '  "expected_result": "...",',
    '  "actual_result": "..."',
    '}'
  ].join('\n');
}

function parseTriageJson(raw: string): AiTriageResult {
  const parsed = JSON.parse(extractJsonPayload(raw)) as Partial<AiTriageResult>;
  return {
    visual_analysis: cleanString(parsed.visual_analysis),
    bug_title: cleanString(parsed.bug_title),
    refined_summary: cleanString(parsed.refined_summary),
    severity_level: cleanString(parsed.severity_level),
    steps_to_reproduce: cleanString(parsed.steps_to_reproduce),
    expected_result: cleanString(parsed.expected_result),
    actual_result: cleanString(parsed.actual_result)
  };
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedJson?.[1]) return fencedJson[1].trim();

  const inlineJson = trimmed.match(/`(?:json)?\s*({[\s\S]*})\s*`/i);
  if (inlineJson?.[1]) return inlineJson[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);

  return trimmed;
}

function fallbackTriage(payload: AiTriageBugPayload): AiTriageResult {
  const title = cleanString(payload.title) || deriveFallbackTitle(payload.note);
  const steps = cleanString(payload.steps_to_reproduce) || '[Add steps to reproduce]';
  const expected = cleanString(payload.expected_result) || '[Add expected result]';
  const actual = cleanString(payload.actual_result) || cleanString(payload.note) || '[Add actual result]';
  return {
    visual_analysis: '',
    bug_title: title,
    refined_summary: cleanString(payload.note),
    severity_level: cleanString(payload.severity) || 'Unknown',
    steps_to_reproduce: steps,
    expected_result: expected,
    actual_result: actual
  };
}

function deriveFallbackTitle(note: string): string {
  const normalized = cleanString(note);
  if (!normalized) return 'Untitled bug';
  return normalized.split(/[.!?]/)[0]?.split(/\s+/).slice(0, 10).join(' ') || 'Untitled bug';
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function classifyOllamaHttpError(status: number, message = ''): string {
  if (status === 404) return `Ollama model is not available locally. ${message}`.trim();
  if (status === 503 || status === 500) return `Ollama hardware/runtime error. ${message}`.trim();
  return `Ollama request failed with HTTP ${status}. ${message}`.trim();
}

function classifyOllamaMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('memory') || normalized.includes('cuda') || normalized.includes('gpu') || normalized.includes('resource')) {
    return `Ollama hardware resource error: ${message}`;
  }
  return message;
}

function normalizeOllamaError(caught: unknown): string {
  if (caught instanceof Error && caught.name === 'AbortError') return 'Ollama request was aborted before completing.';
  if (caught instanceof TypeError) return 'Could not connect to Ollama at http://localhost:11434. Is the daemon running?';
  if (caught instanceof Error) return caught.message;
  return 'Ollama triage failed.';
}
