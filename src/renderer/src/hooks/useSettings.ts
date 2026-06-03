import { useEffect, useState } from 'react';
import type { SettingsData } from '../../../shared/types';

const emptySettings: SettingsData = {
  applications: [],
  modules: [],
  statuses: [],
  scenarioStatuses: [],
  severities: [],
  issuePlatforms: [],
  entryTypes: [],
  environments: [],
  devices: [],
  browsers: [],
  userRoles: [],
  reportTemplates: [],
  shortcuts: [],
  jiraWorkspaceUrl: null,
  autoBackupDirectoryPath: null,
  quickCaptureAnnotateScreenshots: true,
  runOnSystemStartup: false,
  aiTriageEnabled: false,
  ollamaModelName: 'qwen3-vl:8b',
  supabaseProjectUrl: null,
  supabaseAnonKey: null,
  currentWorkspaceId: null,
  cloudSyncActive: false,
  presets: []
};

export function useSettings() {
  const [settings, setSettings] = useState<SettingsData>(emptySettings);

  const refresh = async (): Promise<void> => {
    setSettings(await window.bugPocket.getSettings());
  };

  useEffect(() => {
    refresh();
    const unsubscribeShortcuts = window.bugPocket.onShortcutsChanged(refresh);
    const unsubscribeSettings = window.bugPocket.onSettingsChanged(refresh);
    return () => {
      unsubscribeShortcuts();
      unsubscribeSettings();
    };
  }, []);

  return { settings, refresh };
}
