import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Cloud, Lock } from 'lucide-react';
import type { SettingsData } from '../../../shared/types';
import { hasSettingsMutationBridge } from '../components/settings/settingsUtils';
import { useToast } from '../components/shared/ToastContext';
import { restorePendingKey, restoreSuccessKey, restoreSettingsSegmentKey } from '../utils/settingsKeys';

const GeneralSettings = lazy(() => import('../components/settings/GeneralSettings').then((module) => ({ default: module.GeneralSettings })));
const PresetSettings = lazy(() => import('../components/settings/PresetSettings').then((module) => ({ default: module.PresetSettings })));
const AiSettings = lazy(() => import('../components/settings/AiSettings').then((module) => ({ default: module.AiSettings })));
const TemplateSettings = lazy(() => import('../components/settings/TemplateSettings').then((module) => ({ default: module.TemplateSettings })));
const StorageSettings = lazy(() => import('../components/settings/StorageSettings').then((module) => ({ default: module.StorageSettings })));
const SyncSettings = lazy(() => import('../components/settings/SyncSettings').then((module) => ({ default: module.SyncSettings })));

type SettingsTab = 'workspace' | 'presets' | 'ai' | 'output' | 'storage' | 'sync';

const oldSegmentToTab: Record<string, SettingsTab> = {
  preferences: 'workspace',
  taxonomy: 'workspace',
  outbound: 'output',
  general: 'workspace',
  templates: 'output'
};

function tabForRequestedCard(card: string | null): { tab: SettingsTab; card: string | null } | null {
  if (!card) return null;
  if (card === 'presets') return { tab: 'presets', card: 'presets' };
  if (card === 'ai-options') return { tab: 'ai', card };
  if (card === 'templates') return { tab: 'output', card };
  if (['backup', 'data-management', 'storage'].includes(card)) return { tab: 'storage', card };
  if (['cloud-sync', 'sync'].includes(card)) return { tab: 'sync', card };
  if (['issue-platforms', 'jira-workspace'].includes(card)) {
    return { tab: 'output', card };
  }
  if (['entry-types', 'applications', 'modules', 'environments', 'devices', 'browsers', 'user-roles', 'severity-values'].includes(card)) {
    return { tab: 'workspace', card };
  }
  return null;
}

function tabFromRoute(route: string): SettingsTab {
  const path = route.split('?')[0];
  const segment = path.split('/')[2] ?? 'workspace';
  if (segment === 'sync') return 'sync';
  if (segment === 'presets' || segment === 'ai' || segment === 'output' || segment === 'storage' || segment === 'workspace') return segment;
  return oldSegmentToTab[segment] ?? 'workspace';
}

function CloudSyncComingSoon() {
  return (
    <div className="panel sync-placeholder-panel cloud-sync-locked-panel">
      <div className="cloud-sync-locked-icon" aria-hidden="true">
        <Cloud size={28} />
        <Lock size={15} />
      </div>
      <div>
        <h2>Cloud Sync</h2>
        <p className="settings-helper">Coming soon. Bug Pocket remains fully local-first while workspace sync is being prepared for a stable release.</p>
      </div>
      <div className="cloud-sync-locked-note">
        Captures, screenshots, templates, shortcuts, and backups continue to work locally. Cloud workspace login and background sync controls are intentionally locked in this build.
      </div>
    </div>
  );
}

export function SettingsPage({
  settings,
  refresh,
  route
}: {
  settings: SettingsData;
  refresh: () => Promise<void>;
  route: string;
}) {
  const settingsMutationBridgeReady = hasSettingsMutationBridge();
  const [openSettingsCard, setOpenSettingsCard] = useState<string | null>(null);
  const showSettingsToast = useToast();
  const [restoreNotice, setRestoreNotice] = useState('');
  const requestedCard = new URLSearchParams(route.split('?')[1] ?? '').get('card');
  const activeTab = tabForRequestedCard(requestedCard)?.tab ?? tabFromRoute(route);

  useEffect(() => {
    const savedSegment = window.sessionStorage.getItem(restoreSettingsSegmentKey);
    if (savedSegment && !route.startsWith('/settings/')) {
      const nextTab = oldSegmentToTab[savedSegment] ?? (['workspace', 'presets', 'ai', 'output', 'storage', 'sync'].includes(savedSegment) ? savedSegment : 'workspace');
      window.location.hash = `/settings/${nextTab}`;
    }
    if (window.sessionStorage.getItem(restoreSuccessKey) === '1') {
      setRestoreNotice('Workspace backup restored successfully. Bug Pocket reloaded your local database and attachments.');
      showSettingsToast('Workspace backup restored successfully.');
    }
    window.sessionStorage.removeItem(restorePendingKey);
    window.sessionStorage.removeItem(restoreSuccessKey);
    window.sessionStorage.removeItem(restoreSettingsSegmentKey);
  }, []);

  useEffect(() => {
    const destination = tabForRequestedCard(requestedCard);
    setOpenSettingsCard(destination?.card ?? null);
  }, [requestedCard]);

  const toggleSettingsCard = (cardId: string): void => { setOpenSettingsCard((current) => (current === cardId ? null : cardId)); };
  return (
    <section className="page settings-page">
      <header className="page-header">
        <div><h1>Settings</h1><p>Keep Bug Pocket focused, fast, and local-first.</p></div>
      </header>
      {!settingsMutationBridgeReady && (
        <div className="settings-warning">
          Restart Bug Pocket to finish loading settings edit and remove actions.
        </div>
      )}
      {restoreNotice && (
        <div className="settings-restore-success" role="status" aria-live="polite">
          <span>{restoreNotice}</span>
          <button type="button" aria-label="Dismiss restore message" onClick={() => setRestoreNotice('')}>Dismiss</button>
        </div>
      )}
      <div className="settings-full-panel">
        <Suspense fallback={<div className="panel">Loading settings...</div>}>
        {activeTab === 'workspace' && (
          <GeneralSettings
            settings={settings}
            mutationReady={settingsMutationBridgeReady}
            openSettingsCard={openSettingsCard}
            refresh={refresh}
            showToast={showSettingsToast}
            toggleSettingsCard={toggleSettingsCard}
          />
        )}
        {activeTab === 'presets' && (
          <PresetSettings
            settings={settings}
            mutationReady={settingsMutationBridgeReady}
            open={true}
            refresh={refresh}
            showToast={showSettingsToast}
            onToggle={() => setOpenSettingsCard('presets')}
          />
        )}
        {activeTab === 'ai' && (
          <AiSettings mutationReady={settingsMutationBridgeReady} refresh={refresh} />
        )}
        {activeTab === 'output' && (
          <TemplateSettings
            settings={settings}
            mutationReady={settingsMutationBridgeReady}
            openSettingsCard={openSettingsCard}
            refresh={refresh}
            toggleSettingsCard={toggleSettingsCard}
          />
        )}
        {activeTab === 'storage' && (
          <StorageSettings settings={settings} refresh={refresh} showToast={showSettingsToast} />
        )}
        {activeTab === 'sync' && (
          import.meta.env.DEV
            ? <SyncSettings settings={settings} mutationReady={settingsMutationBridgeReady} refresh={refresh} showToast={showSettingsToast} />
            : <CloudSyncComingSoon />
        )}
        </Suspense>
      </div>
    </section>
  );
}




