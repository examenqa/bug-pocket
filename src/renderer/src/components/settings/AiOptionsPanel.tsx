import React, { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';

type VisionModel = {
  id: string;
  name: string;
  reqs: string;
  cmd: string;
  url: string;
};

const CUSTOM_VENDOR = 'Custom / Other';
const DEFAULT_MODEL = 'qwen3-vl:8b';

const VISION_MODELS: Record<string, VisionModel[]> = {
  'Qwen (Alibaba)': [
    { id: 'qwen3-vl:8b', name: 'Qwen 3 VL (8B)', reqs: '8GB+ VRAM', cmd: 'ollama run qwen3-vl:8b', url: 'https://ollama.com/library/qwen3-vl' },
    { id: 'qwen2.5-vl:7b', name: 'Qwen 2.5 VL (7B)', reqs: '8GB+ VRAM', cmd: 'ollama run qwen2.5-vl', url: 'https://ollama.com/library/qwen2.5-vl' },
    { id: 'qwen2.5-vl:3b', name: 'Qwen 2.5 VL (3B)', reqs: '4GB+ VRAM (Fast)', cmd: 'ollama run qwen2.5-vl:3b', url: 'https://ollama.com/library/qwen2.5-vl' }
  ],
  'Llama (Meta)': [
    { id: 'llama3.2-vision', name: 'Llama 3.2 Vision (11B)', reqs: '12GB+ VRAM', cmd: 'ollama run llama3.2-vision', url: 'https://ollama.com/library/llama3.2-vision' },
    { id: 'llama3.2-vision:90b', name: 'Llama 3.2 Vision (90B)', reqs: '40GB+ VRAM (Pro Workstation)', cmd: 'ollama run llama3.2-vision:90b', url: 'https://ollama.com/library/llama3.2-vision' }
  ],
  'Llava (Open Source)': [
    { id: 'llava:7b', name: 'Llava (7B)', reqs: '8GB+ VRAM', cmd: 'ollama run llava', url: 'https://ollama.com/library/llava' },
    { id: 'llava-llama3', name: 'Llava Llama-3 (8B)', reqs: '8GB+ VRAM', cmd: 'ollama run llava-llama3', url: 'https://ollama.com/library/llava-llama3' },
    { id: 'llava-phi3', name: 'Llava Phi-3 (3.8B)', reqs: '4GB+ VRAM (Laptop Friendly)', cmd: 'ollama run llava-phi3', url: 'https://ollama.com/library/llava-phi3' }
  ],
  'Mistral & Others': [
    { id: 'pixtral', name: 'Pixtral 12B', reqs: '12GB+ VRAM', cmd: 'ollama run pixtral', url: 'https://ollama.com/library/pixtral' },
    { id: 'minicpm-v', name: 'MiniCPM-V (8B)', reqs: '8GB+ VRAM', cmd: 'ollama run minicpm-v', url: 'https://ollama.com/library/minicpm-v' },
    { id: 'moondream', name: 'Moondream 2 (1.8B)', reqs: '2GB+ VRAM (Extremely Fast)', cmd: 'ollama run moondream', url: 'https://ollama.com/library/moondream' }
  ],
  [CUSTOM_VENDOR]: []
};

function findVisionModel(modelId: string): { vendor: string; model: VisionModel } | null {
  for (const [vendor, models] of Object.entries(VISION_MODELS)) {
    const model = models.find((item) => item.id === modelId);
    if (model) return { vendor, model };
  }
  return null;
}

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
  const initialModel = modelName || DEFAULT_MODEL;
  const initialMatch = findVisionModel(initialModel);
  const [draftModel, setDraftModel] = useState(initialModel);
  const [selectedVendor, setSelectedVendor] = useState(initialMatch?.vendor ?? CUSTOM_VENDOR);
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [status, setStatus] = useState('');
  const debouncedModel = useDebounce(draftModel, 700);
  const vendors = useMemo(() => Object.keys(VISION_MODELS), []);
  const vendorModels = VISION_MODELS[selectedVendor] ?? [];
  const selectedModel = vendorModels.find((item) => item.id === draftModel) ?? null;

  useEffect(() => {
    const nextModel = modelName || DEFAULT_MODEL;
    const match = findVisionModel(nextModel);
    setDraftModel(nextModel);
    setSelectedVendor(match?.vendor ?? CUSTOM_VENDOR);
  }, [modelName]);

  useEffect(() => {
    setLocalEnabled(enabled);
  }, [enabled]);

  const saveOptions = async (nextEnabled: boolean, nextModel: string): Promise<void> => {
    if (!mutationReady) return;
    const cleanedModel = nextModel.trim() || DEFAULT_MODEL;
    await window.bugPocket.updateAiTriageOptions(nextEnabled, cleanedModel);
    await refresh();
    setStatus('AI options saved.');
    window.setTimeout(() => setStatus(''), 1400);
  };

  useEffect(() => {
    if (!mutationReady) return;
    const cleanedDraft = debouncedModel.trim() || DEFAULT_MODEL;
    if (cleanedDraft === (modelName || DEFAULT_MODEL)) return;
    void saveOptions(localEnabled, cleanedDraft);
  }, [debouncedModel]);

  const toggleEnabled = async (nextEnabled: boolean): Promise<void> => {
    setLocalEnabled(nextEnabled);
    await saveOptions(nextEnabled, draftModel);
  };

  const changeVendor = (vendor: string): void => {
    setSelectedVendor(vendor);
    const firstModel = VISION_MODELS[vendor]?.[0];
    if (firstModel) setDraftModel(firstModel.id);
  };

  const copyInstallCommand = async (): Promise<void> => {
    if (!selectedModel) return;
    await window.bugPocket.copyText(selectedModel.cmd);
    setStatus('Ollama command copied.');
    window.setTimeout(() => setStatus(''), 1400);
  };

  const openModelPage = async (): Promise<void> => {
    if (!selectedModel) return;
    await window.bugPocket.openExternalUrl(selectedModel.url);
  };

  return (
    <div className={`panel ai-options-panel${localEnabled ? '' : ' ai-options-panel-disabled'}`}>
      <div className="panel-heading">
        <div>
          <h2>Local AI Triage</h2>
          <p className="settings-helper">Optional AI-powered triage. Choose a vision-capable model because Bug Pocket may send screenshots with the note.</p>
        </div>
      </div>
      <label className="settings-compact-toggle ai-enable-row">
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

      <div className="ai-model-grid">
        <label className="ai-model-field">
          <span>Model family</span>
          <select disabled={!mutationReady || !localEnabled} value={selectedVendor} onChange={(event) => changeVendor(event.target.value)}>
            {vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
          </select>
        </label>

        {selectedVendor === CUSTOM_VENDOR ? (
          <label className="ai-model-field">
            <span>Custom Ollama model tag</span>
            <input
              value={draftModel}
              disabled={!mutationReady || !localEnabled}
              onChange={(event) => setDraftModel(event.target.value)}
              onBlur={() => void saveOptions(localEnabled, draftModel)}
              placeholder={DEFAULT_MODEL}
            />
          </label>
        ) : (
          <label className="ai-model-field">
            <span>Vision model</span>
            <select disabled={!mutationReady || !localEnabled} value={selectedModel?.id ?? vendorModels[0]?.id ?? ''} onChange={(event) => setDraftModel(event.target.value)}>
              {vendorModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {selectedModel && (
        <div className="ai-model-card">
          <div className="ai-model-card-header">
            <div>
              <strong>Suggested: {selectedModel.name}</strong>
              <span>{selectedModel.reqs}. Use this if you do not already have a preferred compatible vision model.</span>
            </div>
            <button type="button" className="ai-model-link" onClick={() => void openModelPage()}>
              <ExternalLink size={14} /> Ollama page
            </button>
          </div>
          <div className="ai-command-row">
            <div className="ai-command-copy">
              <small>Ollama command, useful for installing or launching this model:</small>
              <code>{selectedModel.cmd}</code>
            </div>
            <button type="button" onClick={() => void copyInstallCommand()}><Copy size={14} /> Copy</button>
          </div>
        </div>
      )}

      {selectedVendor === CUSTOM_VENDOR && (
        <p className="settings-helper ai-custom-helper">Custom models are allowed for power users, but non-vision models may fail when screenshots are included.</p>
      )}
      {status && <p className="settings-save-note">{status}</p>}
    </div>
  );
}
