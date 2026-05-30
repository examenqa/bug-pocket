import React from 'react';

interface AiSettingsProps {
  enabled: boolean;
  modelName: string;
  mutationReady: boolean;
  refresh: () => Promise<void>;
}

export function AiSettings(_props: AiSettingsProps) {
  return (
    <div className="settings-tab-stack">
      <div className="panel ai-options-panel ai-coming-soon-panel">
        <div className="panel-heading">
          <div>
            <h2>AI Triage</h2>
            <p className="settings-helper">Coming soon. We are keeping this locked while the desktop capture workflow is finalized.</p>
          </div>
        </div>
        <div className="coming-soon-note">
          <strong>AI-powered report cleanup is planned, but disabled in this build.</strong>
          <p>Bug Pocket will continue to save entries locally and generate template-based reports without sending anything to an AI service.</p>
        </div>
      </div>
    </div>
  );
}
