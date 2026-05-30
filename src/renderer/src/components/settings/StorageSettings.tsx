import React from 'react';
import type { SettingsData } from '../../../../shared/types';
import { DataManagementPanel } from './DataManagementPanel';

interface StorageSettingsProps {
  settings: SettingsData;
  refresh: () => Promise<void>;
  showToast: (message: string) => void;
}

export function StorageSettings({ settings, refresh, showToast }: StorageSettingsProps) {
  return (
    <div className="settings-tab-stack">
      <DataManagementPanel settings={settings} refresh={refresh} showToast={showToast} />
    </div>
  );
}
