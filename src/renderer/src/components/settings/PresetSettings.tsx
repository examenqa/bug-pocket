import React from 'react';
import type { SettingsData } from '../../../../shared/types';
import { PresetManager } from './PresetManager';

interface PresetSettingsProps {
  settings: SettingsData;
  mutationReady: boolean;
  open: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string) => void;
  onToggle: () => void;
}

export function PresetSettings({ settings, mutationReady, open, refresh, showToast, onToggle }: PresetSettingsProps) {
  return (
    <div className="settings-tab-stack">
      <section className="settings-section-group" aria-labelledby="settings-presets-heading">
        <div className="settings-section-heading">
          <h2 id="settings-presets-heading">Capture Presets</h2>
          <p>Configure the three Quick Panel preset slots used by Alt+1, Alt+2, and Alt+3.</p>
        </div>
        <PresetManager settings={settings} mutationReady={mutationReady} refresh={refresh} showToast={showToast} open={open} onToggle={onToggle} />
      </section>
    </div>
  );
}
