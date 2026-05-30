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
      <section className="settings-section-group" aria-labelledby="settings-storage-heading">
        <div className="settings-section-heading">
          <h2 id="settings-storage-heading">Storage & Backups</h2>
          <p>Manage local workspace backups, restore flows, and automated backup location.</p>
        </div>
        <DataManagementPanel settings={settings} refresh={refresh} showToast={showToast} />
      </section>
    </div>
  );
}
