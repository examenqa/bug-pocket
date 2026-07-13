import React, { useEffect, useRef, useState } from 'react';
import type { AiByokConfig, AiConfigSaveInput, AiProvider } from '../../../../shared/types';

interface AiSettingsProps {
  mutationReady: boolean;
  refresh: () => Promise<void>;
}

const legacyDefaultPrompts = [
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. Identify exact UI elements, button states, and error messages. You MUST generate the following details as a strict JSON object with exactly these keys:\n\ntitle: A strict limit of 50 characters maximum (5-7 words). Do not include error codes or lengthy descriptions here.\n\nbugNote: A highly detailed description of the failure and visual UI state.\n\nstepsToReproduce: You MUST write 3 to 5 numbered steps reverse-engineered from the visual context. NEVER leave this blank and NEVER use placeholders. Assume the logical journey required to reach the screen.\n\nexpectedResult: What should have happened.\n\nactualResult: What actually happened.\nDo not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Rewrite the tester input as a concise, professional issue report. Preserve confirmed facts, do not invent unsupported details, and use clear Markdown suitable for issue trackers.',
  'You are an expert QA Engineer. Expand the user\'s input into a highly descriptive, comprehensive bug report. Do not truncate details. You must respond ONLY with a valid JSON object using exactly these keys: bugNote, stepsToReproduce, expectedResult, actualResult. Do not include any conversational text or markdown formatting outside of the JSON object.',
  'You are a QA Engineer writing strictly for internal developers. Never explain what the application does. Extract the details into a strict JSON object with exactly these keys: title (a concise technical summary), bugNote (only the core description of the issue), stepsToReproduce, expectedResult, actualResult. Do not output any markdown outside this JSON object.',
  'You are an expert QA Engineer writing for internal developers. Analyze the user\'s text and the provided screenshot. Extract missing details (e.g., specific error codes, visible UI state, device/browser context) directly from the image if present. Extract the details into a strict JSON object with exactly these keys: title, bugNote, stepsToReproduce, expectedResult, actualResult. Do not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. You must be highly descriptive. Identify the exact UI elements, button states, and error messages visible in the image. Expand the user\'s brief notes into a comprehensive, professional bug report. Extract the details into a strict JSON object with exactly these keys: title (a concise technical summary), bugNote (a highly detailed description of the failure and visual UI state), stepsToReproduce (numbered, granular steps), expectedResult, actualResult. Do not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. You must be highly descriptive. Identify the exact UI elements, button states, and error messages visible in the image. If explicit steps to reproduce are missing, reverse-engineer the logical user journey required to reach the failed state shown in the UI. Extract the details into a strict JSON object with exactly these keys: title, bugNote, stepsToReproduce (numbered, granular steps), expectedResult, actualResult. Do not output any markdown outside this JSON object.',
  'You are a Senior QA Engineer. Analyze the user\'s text and the provided Base64 screenshot. Identify exact UI elements, button states, and error messages. You MUST generate the following details as a strict JSON object with exactly these keys:\n\ntitle: A strict limit of 100 characters maximum (7-10 words). Do not include error codes or lengthy descriptions here.\n\nbugNote: A highly detailed description of the failure and visual UI state.\n\nstepsToReproduce: You MUST write 3 to 5 numbered steps reverse-engineered from the visual context. NEVER leave this blank and NEVER use placeholders. Assume the logical journey required to reach the screen.\n\nexpectedResult: What should have happened.\n\nactualResult: What actually happened.\nDo not output any markdown outside this JSON object.'
];
const defaultPrompt = `You are a Senior QA Engineer analyzing a user's text and a provided Base64 screenshot. Identify exact UI elements, button states, and error messages.

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

function normalizePrompt(value: string | null | undefined): string {
  const prompt = value?.trim() ?? '';
  return !prompt || legacyDefaultPrompts.includes(prompt) ? defaultPrompt : prompt;
}

const providerPresets: Record<AiProvider, { baseUrl: string; modelId: string }> = {
  OpenAI: {
    baseUrl: 'https://api.openai.com/v1',
    modelId: ''
  },
  Grok: {
    baseUrl: 'https://api.x.ai/v1',
    modelId: ''
  },
  OpenRouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'google/gemma-4-31b-it:free'
  },
  Gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'gemini-3.5-flash'
  },
  'Custom/Local': {
    baseUrl: 'http://localhost:11434/v1',
    modelId: 'qwen3-vl:8b'
  }
};

export function AiSettings({ mutationReady, refresh }: AiSettingsProps) {
  const [provider, setProvider] = useState<AiProvider>('OpenRouter');
  const [baseUrl, setBaseUrl] = useState(providerPresets.OpenRouter.baseUrl);
  const [modelId, setModelId] = useState(providerPresets.OpenRouter.modelId);
  const [apiKey, setApiKey] = useState('');
  const [configuredProviders, setConfiguredProviders] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [customSystemPrompt, setCustomSystemPrompt] = useState(defaultPrompt);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [promptBeforeEdit, setPromptBeforeEdit] = useState(defaultPrompt);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const hasApiKey = Boolean(configuredProviders[provider]);

  const loadConfig = async (): Promise<void> => {
    const config = (await window.bugPocket.getAiConfig()) as AiByokConfig;
    setProvider(config.provider);
    setBaseUrl(config.baseUrl || providerPresets[config.provider].baseUrl);
    setModelId(config.modelId || providerPresets[config.provider].modelId);
    setConfiguredProviders(config.configuredProviders);
    const normalizedPrompt = normalizePrompt(config.customSystemPrompt);
    setCustomSystemPrompt(normalizedPrompt);
    setPromptBeforeEdit(normalizedPrompt);
    setIsEditingPrompt(false);
    setApiKey('');
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [customSystemPrompt]);

  useEffect(() => {
    if (!isEditingPrompt) return;
    window.setTimeout(() => promptTextareaRef.current?.focus(), 0);
  }, [isEditingPrompt]);

  const chooseProvider = (nextProvider: AiProvider): void => {
    setProvider(nextProvider);
    setBaseUrl(providerPresets[nextProvider].baseUrl);
    setModelId(providerPresets[nextProvider].modelId);
    setApiKey('');
    setStatus('');
    setError('');
  };

  const saveConfig = async (clearApiKey = false): Promise<void> => {
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const cleanedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
      const cleanedModelId = modelId.trim();
      if (!cleanedBaseUrl) throw new Error('Base URL is required.');
      if (!cleanedModelId) throw new Error('Model ID is required.');
      const replacementKey = apiKey.trim();
      const apiKeyOperation: AiConfigSaveInput['apiKeyOperation'] = clearApiKey
        ? { action: 'clear' }
        : replacementKey
          ? { action: 'replace', value: replacementKey }
          : undefined;
      const config = (await window.bugPocket.saveAiConfig({
        provider,
        baseUrl: cleanedBaseUrl,
        modelId: cleanedModelId,
        apiKeyOperation,
        customSystemPrompt: customSystemPrompt.trim() || defaultPrompt
      })) as AiByokConfig;
      setProvider(config.provider);
      setBaseUrl(config.baseUrl || cleanedBaseUrl);
      setModelId(config.modelId || cleanedModelId);
      setConfiguredProviders(config.configuredProviders);
      const normalizedPrompt = normalizePrompt(config.customSystemPrompt);
      setCustomSystemPrompt(normalizedPrompt);
      setPromptBeforeEdit(normalizedPrompt);
      setIsEditingPrompt(false);
      setApiKey('');
      await refresh();
      setStatus(clearApiKey ? `${provider} API key cleared.` : 'AI processing settings saved.');
      window.setTimeout(() => setStatus(''), 1800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save AI settings.');
    } finally {
      setSaving(false);
    }
  };

  const beginPromptEdit = (): void => {
    setPromptBeforeEdit(customSystemPrompt);
    setIsEditingPrompt(true);
  };

  const cancelPromptEdit = (): void => {
    setCustomSystemPrompt(promptBeforeEdit);
    setIsEditingPrompt(false);
  };

  const savePromptEdit = async (): Promise<void> => {
    await saveConfig(false);
  };

  const resetPrompt = (): void => {
    setCustomSystemPrompt(defaultPrompt);
    if (!isEditingPrompt) setPromptBeforeEdit(defaultPrompt);
  };

  return (
    <div className="settings-tab-stack">
      <div className="panel ai-processing-panel">
        <div className="panel-heading">
          <div>
            <h2>AI Processing</h2>
            <p className="settings-helper">Bug Pocket stores your API key encrypted on this PC and only uses AI for explicit issue formatting or triage actions.</p>
          </div>
        </div>

        <div className="ai-processing-grid ai-processing-grid-three">
          <label>
            <span>Provider preset</span>
            <select value={provider} onChange={(event) => chooseProvider(event.target.value as AiProvider)} disabled={saving || !mutationReady}>
              {Object.keys(providerPresets).map((name) => <option key={name} value={name}>{name === 'Gemini' ? 'Gemini (Recommended)' : name}</option>)}
            </select>
          </label>
          <label>
            <span>Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={saving || !mutationReady} placeholder="https://api.openai.com/v1" />
          </label>
          <label>
            <span>Model ID</span>
            <input value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={saving || !mutationReady} placeholder="google/gemma-4-31b-it:free" />
          </label>
        </div>

        <label className="ai-prompt-field">
          <span>API key {hasApiKey && <em>saved for {provider}</em>}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasApiKey ? '••••••••' : 'Paste your API key'}
            disabled={saving || !mutationReady}
          />
        </label>

        {provider === 'Gemini' && (
          <p className="settings-helper ai-api-key-helper">Get a free API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.</p>
        )}

        <div className="settings-warning ai-privacy-warning">⚠️ Privacy Notice: If you are using a Free Tier Gemini key, Google's Terms of Service allow them to log and review your inputs (including screenshots and bug text) for model training. Do not use a Free Tier key for confidential, proprietary, or unreleased company data.</div>

        <label className="ai-prompt-field ai-system-prompt-field">
          <span className="ai-prompt-label-row">
            Custom System Prompt
            <span className="ai-prompt-button-group">
              <button className="ai-prompt-action-button" type="button" disabled={saving || !mutationReady} onClick={resetPrompt}>Reset to Default</button>
              {!isEditingPrompt ? (
                <button className="ai-prompt-action-button" type="button" disabled={saving || !mutationReady} onClick={beginPromptEdit}>Edit Context</button>
              ) : (
                <>
                  <button className="ai-prompt-action-button" type="button" disabled={saving || !mutationReady} onClick={() => void savePromptEdit()}>Save</button>
                  <button className="ai-prompt-action-button" type="button" disabled={saving} onClick={cancelPromptEdit}>Cancel</button>
                </>
              )}
            </span>
          </span>
          <textarea
            ref={promptTextareaRef}
            value={customSystemPrompt}
            onChange={(event) => setCustomSystemPrompt(event.target.value)}
            readOnly={!isEditingPrompt}
            aria-readonly={!isEditingPrompt}
            disabled={saving || !mutationReady}
            className={!isEditingPrompt ? 'readonly' : ''}
            placeholder="Return only the strict JSON object."
          />
        </label>

        <div className="sync-action-row">
          <button className="primary" type="button" disabled={saving || !mutationReady} onClick={() => void saveConfig(false)}>{saving ? 'Saving...' : 'Save AI Settings'}</button>
          <button type="button" disabled={saving || !mutationReady || !hasApiKey} onClick={() => void saveConfig(true)}>Clear Key</button>
          {status && <span className="sync-test-result success">{status}</span>}
          {error && <span className="sync-test-result warning">{error}</span>}
        </div>
      </div>
    </div>
  );
}

