import React from 'react';
import { AiOptionsPanel } from './AiOptionsPanel';

interface AiSettingsProps {
  enabled: boolean;
  modelName: string;
  mutationReady: boolean;
  refresh: () => Promise<void>;
}

export function AiSettings({ enabled, modelName, mutationReady, refresh }: AiSettingsProps) {
  return (
    <div className="settings-tab-stack">
      <section className="settings-section-group" aria-labelledby="settings-ai-heading">
        <div className="settings-section-heading">
          <h2 id="settings-ai-heading">AI Triage</h2>
          <p>Configure local Ollama-powered assistance for turning saved entries into polished bug reports.</p>
        </div>
        <AiOptionsPanel enabled={enabled} modelName={modelName} mutationReady={mutationReady} refresh={refresh} />
      </section>
    </div>
  );
}
