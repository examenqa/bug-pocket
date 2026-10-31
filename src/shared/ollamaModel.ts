import { AiPublicError } from './aiError';

export const DEFAULT_OLLAMA_MODEL_NAME = 'qwen3-vl:8b';
const modelNameRegex = /^[a-zA-Z0-9\-:._]+$/;

// Preserve the native adapter's existing grammar and blank-value default.
export function normalizeOllamaModelName(value: string): string {
  const model = value.trim() || DEFAULT_OLLAMA_MODEL_NAME;
  if (!modelNameRegex.test(model)) throw new AiPublicError('AI_NATIVE_MODEL_INVALID');
  return model;
}
