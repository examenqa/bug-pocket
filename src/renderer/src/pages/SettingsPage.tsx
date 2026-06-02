import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Cloud, Database, Keyboard, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SettingsData } from '../../../shared/types';
import { AiSettings } from '../components/settings/AiSettings';
import { GeneralSettings } from '../components/settings/GeneralSettings';
import { PresetSettings } from '../components/settings/PresetSettings';
import { StorageSettings } from '../components/settings/StorageSettings';
import { SyncSettings } from '../components/settings/SyncSettings';
import { hasSettingsMutationBridge } from '../components/settings/settingsUtils';
import { ToastBanner, type ToastVariant } from '../components/shared/ToastBanner';
import { restorePendingKey, restoreSuccessKey, restoreSettingsSegmentKey } from '../utils/settingsKeys';

type SettingsTab = 'general' | 'presets' | 'ai' | 'storage' | 'sync';

const settingsTabs: Array<{ id: SettingsTab; label: string; description: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General & Hotkeys', description: 'Shortcuts, system behavior, fields, and report output', icon: Keyboard },
  { id: 'presets', label: 'Capture Presets', description: 'Three fast Quick Panel preset slots', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI Processing', description: 'BYOK provider, key, and prompt formatting', icon: Bot },
  { id: 'storage', label: 'Storage & Backups', description: 'Export, restore, and rolling backups', icon: Database },
  { id: 'sync', label: 'Cloud Sync', description: 'Supabase credentials and future sync', icon: Cloud }
];

const oldSegmentToTab: Record<string, SettingsTab> = {
  preferences: 'general',
  taxonomy: 'general',
  outbound: 'storage'
};

function tabForRequestedCard(card: string | null): { tab: SettingsTab; card: string | null } | null {
  if (!card) return null;
  if (card === 'presets') return { tab: 'presets', card: 'presets' };
  if (card === 'ai-options') return { tab: 'ai', card };
  if (['backup', 'data-management', 'storage'].includes(card)) return { tab: 'storage', card };
  if (['cloud-sync', 'sync'].includes(card)) return { tab: 'sync', card };
  if (['entry-types', 'applications', 'modules', 'environments', 'devices', 'browsers', 'user-roles', 'severity-values', 'issue-platforms', 'templates', 'jira-workspace'].includes(card)) {
    return { tab: 'general', card };
  }
  return null;
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
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settingsToast, setSettingsToast] = useState('');
  const [settingsToastVariant, setSettingsToastVariant] = useState<ToastVariant>('success');
  const [restoreNotice, setRestoreNotice] = useState('');
  const requestedCard = new URLSearchParams(route.split('?')[1] ?? '').get('card');

  useEffect(() => {
    const savedSegment = window.sessionStorage.getItem(restoreSettingsSegmentKey);
    if (savedSegment) {
      const nextTab = settingsTabs.some((item) => item.id === savedSegment)
        ? savedSegment as SettingsTab
        : oldSegmentToTab[savedSegment] ?? 'general';
      setActiveTab(nextTab);
    }
    if (window.sessionStorage.getItem(restoreSuccessKey) === '1') {
      setActiveTab('storage');
      setRestoreNotice('Workspace backup restored successfully. Bug Pocket reloaded your local database and attachments.');
      setSettingsToastVariant('success');
      setSettingsToast('Workspace backup restored successfully.');
    }
    window.sessionStorage.removeItem(restorePendingKey);
    window.sessionStorage.removeItem(restoreSuccessKey);
    window.sessionStorage.removeItem(restoreSettingsSegmentKey);
  }, []);

  useEffect(() => {
    const destination = tabForRequestedCard(requestedCard);
    if (!destination) return;
    setActiveTab(destination.tab);
    setOpenSettingsCard(destination.card);
  }, [requestedCard]);

  const toggleSettingsCard = (cardId: string): void => { setOpenSettingsCard((current) => (current === cardId ? null : cardId)); };
  const showSettingsToast = useCallback((message: string, variant: ToastVariant = 'success'): void => {
    setSettingsToastVariant(variant);
    setSettingsToast(message);
  }, []);
  const closeSettingsToast = useCallback(() => setSettingsToast(''), []);

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
          <Check size={18} />
          <span>{restoreNotice}</span>
          <button type="button" aria-label="Dismiss restore message" onClick={() => setRestoreNotice('')}><X size={15} /></button>
        </div>
      )}
      <div className="settings-layout">
        <aside className="settings-sidebar-nav" aria-label="Settings sections">
          {settingsTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'presets') setOpenSettingsCard('presets');
                }}
                type="button"
              >
                <Icon size={17} />
                <span>
                  <strong>{tab.label}</strong>
                  <small>{tab.description}</small>
                </span>
              </button>
            );
          })}
        </aside>
        <div className="settings-content-panel">
          {activeTab === 'general' && (
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
            <AiSettings enabled={settings.aiTriageEnabled} modelName={settings.ollamaModelName} mutationReady={settingsMutationBridgeReady} refresh={refresh} />
          )}
          {activeTab === 'storage' && (
            <StorageSettings settings={settings} refresh={refresh} showToast={showSettingsToast} />
          )}
          {activeTab === 'sync' && <SyncSettings settings={settings} mutationReady={settingsMutationBridgeReady} refresh={refresh} showToast={showSettingsToast} />}
        </div>
      </div>
      {settingsToast && (
        <ToastBanner message={settingsToast} variant={settingsToastVariant} onClose={closeSettingsToast} />
      )}
    </section>
  );
}


