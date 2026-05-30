import React, { useEffect, useState } from 'react';
import { useDebounce } from '../../hooks/useDebounce';

export function AiOptionsPanel({
  enabled,
  modelName,
  mutationReady,
  refresh
}: {
  enabled: boolean;
  modelName: string;
  mutationReady: boolean;
  refresh: () => Promise<void>;
}) {
  const [draftModel, setDraftModel] = useState(modelName || 'qwen3-vl:8b');
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [status, setStatus] = useState('');
  const debouncedModel = useDebounce(draftModel, 700);

  useEffect(() => {
    setDraftModel(modelName || 'qwen3-vl:8b');
  }, [modelName]);

  useEffect(() => {
    setLocalEnabled(enabled);
  }, [enabled]);

  const saveOptions = async (nextEnabled: boolean, nextModel: string): Promise<void> => {
    if (!mutationReady) return;
    const cleanedModel = nextModel.trim() || 'qwen3-vl:8b';
    await window.bugPocket.updateAiTriageOptions(nextEnabled, cleanedModel);
    await refresh();
    setStatus('AI options saved.');
    window.setTimeout(() => setStatus(''), 1400);
  };

  useEffect(() => {
    if (!mutationReady) return;
    const cleanedDraft = debouncedModel.trim() || 'qwen3-vl:8b';
    if (cleanedDraft === (modelName || 'qwen3-vl:8b')) return;
    void saveOptions(localEnabled, cleanedDraft);
  }, [debouncedModel]);

  const toggleEnabled = async (nextEnabled: boolean): Promise<void> => {
    setLocalEnabled(nextEnabled);
    await saveOptions(nextEnabled, draftModel);
  };

  return (
    <div className="panel ai-options-panel">
      <div className="panel-heading">
        <div>
          <h2>Local AI Triage</h2>
          <p className="settings-helper">Optional Ollama-powered triage. Nothing is sent unless you click the AI action in an entry.</p>
        </div>
      </div>
      <label className="capture-preference-toggle">
        <input
          type="checkbox"
          checked={localEnabled}
          disabled={!mutationReady}
          onChange={(event) => void toggleEnabled(event.target.checked)}
        />
        <span>
          <strong>Enable Triage with Local AI</strong>
          <small>Shows the local AI action in Bug Details and routes requests to Ollama on this machine.</small>
        </span>
      </label>
      <label className="ai-model-field">
        <span>Ollama model name</span>
        <input
          value={draftModel}
          disabled={!mutationReady}
          onChange={(event) => setDraftModel(event.target.value)}
          onBlur={() => void saveOptions(localEnabled, draftModel)}
          placeholder="qwen3-vl:8b"
        />
      </label>
      {status && <p className="settings-save-note">{status}</p>}
    </div>
  );
}
