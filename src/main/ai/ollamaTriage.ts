import type { AiDispatchGuard } from './triageDispatchGuard';
import { withAiDeadline } from '../../shared/aiRequest';
import { normalizeOllamaModelName } from '../../shared/ollamaModel';
import { AiPublicError, serializeAiError } from '../../shared/aiError';
import { readFile } from 'node:fs/promises';
import { nativeImage } from 'electron';
import type { AiTriageBugPayload, AiTriageResponse, AiTriageResult } from '../../shared/types';

const ollamaChatUrl = 'http://localhost:11434/api/chat';
const maxVisionImageEdge = 1280;
const visionJpegQuality = 78;

const systemPrompt =
  "You are an Expert QA Tester. Transform a rough bug note, screenshot, and app context into a concise professional bug report. Do not repeat the user's input verbatim. Infer only what is directly supported by the screenshot and context. Keep every field brief and actionable. You MUST output a raw JSON object wrapped in a markdown code block (for example ```json { ... } ```). Do not include any other text.";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  error?: string;
}

export async function triageBugWithOllama(
  payload: AiTriageBugPayload,
  configuredModelName: string,
  verifiedImagePath?: string,
  signal?: AbortSignal,
  dispatchGuard?: AiDispatchGuard
): Promise<AiTriageResponse> {
  return withAiDeadline(async requestSignal => {
    try {
      const imageBase64 = verifiedImagePath ? await readImageAsBase64(verifiedImagePath).catch(() => {
        requestSignal.throwIfAborted();
        throw new AiPublicError('AI_IMAGE_ENCODING');
      }) : '';
      const model = normalizeOllamaModelName(configuredModelName);

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
          num_ctx: 4096,
          num_predict: 900,
          temperature: 0.2
        },
        stream: false
      };
      const request: RequestInit = {
        method: 'POST',
        // Local AI must not redirect captured evidence to another endpoint.
        redirect: 'error',
        signal: requestSignal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      };
      // Preparation may outlive cancellation, maintenance or a permission refresh.
      requestSignal.throwIfAborted();
      dispatchGuard?.(requestSignal);
      const response = await fetch(ollamaChatUrl, request).catch(() => {
        requestSignal.throwIfAborted();
        throw new AiPublicError('AI_NATIVE_CONNECTION');
      });

      // Failed responses may echo credentials or captured evidence. Do not read them.
      if (!response.ok) {
        try { void response.body?.cancel().catch(() => {}); } catch { /* Discard cleanup diagnostics. */ }
        throw classifyOllamaHttpError(response.status);
      }
      const body = await response.json().catch(() => {
        throw new AiPublicError('AI_NATIVE_RESPONSE_INVALID');
      }) as OllamaChatResponse;
      if (body?.error) throw new AiPublicError('AI_NATIVE_FAILED');
      if (typeof body?.message?.content !== 'string') throw new AiPublicError('AI_NATIVE_RESPONSE_INVALID');

      let result: AiTriageResult;
      try {
        result = parseTriageJson(body.message.content);
      } catch {
        throw new AiPublicError('AI_NATIVE_RESPONSE_INVALID');
      }

      return {
        success: true,
        model,
        result
      };
    } catch (caught) {
      requestSignal.throwIfAborted();
      return {
        success: false,
        model: 'fallback',
        error: serializeAiError(caught),
        result: fallbackTriage(payload)
      };
    }
  }, signal);
}

async function readImageAsBase64(filePath: string): Promise<string> {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(filePath.trim())) return stripBase64Prefix(filePath);

  const optimized = await readOptimizedImageAsBase64(filePath);
  if (optimized) return optimized;

  const bytes = await readFile(filePath);
  const maybeDataUrl = bytes.toString('utf8').trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(maybeDataUrl)) return stripBase64Prefix(maybeDataUrl);
  return stripBase64Prefix(bytes.toString('base64'));
}

async function readOptimizedImageAsBase64(filePath: string): Promise<string> {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return '';

    const size = image.getSize();
    const largestEdge = Math.max(size.width, size.height);
    const optimizedImage = largestEdge > maxVisionImageEdge
      ? image.resize({
          width: size.width >= size.height ? maxVisionImageEdge : undefined,
          height: size.height > size.width ? maxVisionImageEdge : undefined,
          quality: 'good'
        })
      : image;

    return optimizedImage.toJPEG(visionJpegQuality).toString('base64');
  } catch (caught) {
    return '';
  }
}

function stripBase64Prefix(value: string): string {
  return value.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
}

function buildBugTriagePrompt(payload: AiTriageBugPayload): string {
  const refinementNote = cleanString(payload.refinement_note);
  return [
    '# Context',
    `Application: ${payload.application || 'Unknown'}`,
    `Application context: ${payload.application_context || 'Not provided'}`,
    `Module: ${payload.module || 'Unknown'}`,
    `Module context: ${payload.module_context || 'Not provided'}`,
    `Environment: ${payload.environment || 'Unknown'}`,
    `Device/browser: ${payload.device || 'Unknown'} / ${payload.browser || 'Unknown'}`,
    `User role: ${payload.user_role || 'Unknown'}`,
    `Entry type: ${payload.entry_type || 'Bug'}`,
    '',
    '# Tester note and existing fields',
    `Tester note: ${payload.note || 'Not provided'}`,
    `Current title: ${payload.title || ''}`,
    `Current severity: ${payload.severity || ''}`,
    `Steps: ${payload.steps_to_reproduce || ''}`,
    `Expected: ${payload.expected_result || ''}`,
    `Actual: ${payload.actual_result || ''}`,
    `Other details: ${payload.other_details || ''}`,
    refinementNote ? `Correction request: ${refinementNote}` : '',
    '',
    '# Task',
    'Analyze the screenshot only as needed. Return concise fields suitable for direct insertion into the form.',
    'visual_analysis must be one short sentence. refined_summary must be 1-2 sentences. steps_to_reproduce should be short numbered steps.',
    'Return exactly this JSON shape and no extra keys:',
    '{',
    '  "visual_analysis": "...",',
    '  "bug_title": "...",',
    '  "refined_summary": "...",',
    '  "severity_level": "...",',
    '  "steps_to_reproduce": "1. ...\n2. ...",',
    '  "expected_result": "...",',
    '  "actual_result": "..."',
    '}'
  ].filter(Boolean).join('\n');
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

function classifyOllamaHttpError(status: number): AiPublicError {
  if (status === 404) return new AiPublicError('AI_NATIVE_MODEL_UNAVAILABLE');
  if (status === 503 || status === 500) return new AiPublicError('AI_NATIVE_RESOURCE');
  return new AiPublicError('AI_NATIVE_FAILED');
}
