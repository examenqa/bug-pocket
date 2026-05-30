import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { SettingsData } from '../../../shared/types';
import { ShortcutSettingsPanel } from '../components/settings/ShortcutSettingsPanel';
import { CapturePreferencesPanel } from '../components/settings/CapturePreferencesPanel';
import { PresetManager } from '../components/settings/PresetManager';
import { ModuleManager } from '../components/settings/ModuleManager';
import { OptionManager } from '../components/settings/OptionManager';
import { DataManagementPanel } from '../components/settings/DataManagementPanel';
import { JiraWorkspacePanel } from '../components/settings/JiraWorkspacePanel';
import { AiOptionsPanel } from '../components/settings/AiOptionsPanel';
import { TemplateManager } from '../components/settings/TemplateManager';
import { hasSettingsMutationBridge } from '../components/settings/settingsUtils';
import { restorePendingKey, restoreSuccessKey, restoreSettingsSegmentKey } from '../utils/settingsKeys';

type SettingsSegment = 'preferences' | 'taxonomy' | 'outbound';

const settingsSegments: Array<{ id: SettingsSegment; label: string; description: string }> = [
  { id: 'preferences', label: 'Preferences', description: 'Capture behavior, shortcuts, and presets' },
  { id: 'taxonomy', label: 'Taxonomy', description: 'Applications, modules, statuses, and field values' },
  { id: 'outbound', label: 'Outbound', description: 'Issue platforms, Jira, and report templates' }
];

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
  const [activeSegment, setActiveSegment] = useState<SettingsSegment>('preferences');
  const [settingsToast, setSettingsToast] = useState('');
  const [restoreNotice, setRestoreNotice] = useState('');
  const requestedCard = new URLSearchParams(route.split('?')[1] ?? '').get('card');

  useEffect(() => {
    const segment = window.sessionStorage.getItem(restoreSettingsSegmentKey) as SettingsSegment | null;
    if (segment && settingsSegments.some((item) => item.id === segment)) setActiveSegment(segment);
    if (window.sessionStorage.getItem(restoreSuccessKey) === '1') {
      setActiveSegment('outbound');
      setRestoreNotice('Workspace backup restored successfully. Bug Pocket reloaded your local database and attachments.');
      setSettingsToast('Workspace backup restored successfully.');
      window.setTimeout(() => setSettingsToast(''), 3200);
    }
    window.sessionStorage.removeItem(restorePendingKey);
    window.sessionStorage.removeItem(restoreSuccessKey);
    window.sessionStorage.removeItem(restoreSettingsSegmentKey);
  }, []);

  useEffect(() => {
    if (!requestedCard) return;
    if (requestedCard === 'presets') { setActiveSegment('preferences'); setOpenSettingsCard('presets'); return; }
    if (['entry-types', 'applications', 'modules', 'environments', 'devices', 'browsers', 'severity-values'].includes(requestedCard)) {
      setActiveSegment('taxonomy'); setOpenSettingsCard(requestedCard); return;
    }
    if (['issue-platforms', 'templates', 'jira-workspace', 'ai-options'].includes(requestedCard)) {
      setActiveSegment('outbound'); setOpenSettingsCard(requestedCard);
    }
  }, [requestedCard]);

  const toggleSettingsCard = (cardId: string): void => { setOpenSettingsCard((current) => (current === cardId ? null : cardId)); };
  const showSettingsToast = (message: string): void => { setSettingsToast(message); window.setTimeout(() => setSettingsToast(''), 2600); };
  const runPresetLockedDelete = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not update setting.';
      if (message.includes('active preset')) showSettingsToast('Cannot delete because it is currently used by an active preset. Please update or delete the preset first.');
      throw caught;
    }
  };

  return (
    <section className="page settings-page">
      <header className="page-header">
        <div><h1>Settings</h1><p>Keep quick capture dropdowns tidy.</p></div>
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
      <nav className="settings-segment-nav" aria-label="Settings sections">
        {settingsSegments.map((segment) => (
          <button
            key={segment.id}
            className={activeSegment === segment.id ? 'active' : ''}
            onClick={() => setActiveSegment(segment.id)}
            type="button"
          >
            <strong>{segment.label}</strong>
            <span>{segment.description}</span>
          </button>
        ))}
      </nav>
      <div className="settings-segment-body">
        {activeSegment === 'preferences' && (
          <>
            <ShortcutSettingsPanel shortcuts={settings.shortcuts} refresh={refresh} />
            <CapturePreferencesPanel screenshotReviewEnabled={settings.quickCaptureAnnotateScreenshots} runOnSystemStartup={settings.runOnSystemStartup} refresh={refresh} />
            <PresetManager settings={settings} mutationReady={settingsMutationBridgeReady} refresh={refresh} showToast={showSettingsToast} open={openSettingsCard === 'presets'} onToggle={() => toggleSettingsCard('presets')} />
          </>
        )}
        {activeSegment === 'taxonomy' && (
          <div className="settings-grid taxonomy-grid">
            <OptionManager
              title="Applications"
              open={openSettingsCard === 'applications'}
              onToggle={() => toggleSettingsCard('applications')}
              mutationReady={settingsMutationBridgeReady}
              items={settings.applications.map((item) => ({ id: item.id, label: item.name, contextDescription: item.context_description ?? '', isSynced: item.is_synced !== 0 }))}
              onAdd={async (value) => { await window.bugPocket.addApplication(value); await refresh(); }}
              onUpdate={async (id, value, item) => { await window.bugPocket.updateApplication(id, value, item.contextDescription ?? ''); await refresh(); }}
              onUpdateContext={async (id, contextDescription) => { await window.bugPocket.updateApplicationContext(id, contextDescription); await refresh(); }}
              onDelete={async (id) => runPresetLockedDelete(async () => { await window.bugPocket.deleteApplication(id); await refresh(); })}
              onToggleSync={async (id, isSynced) => { await window.bugPocket.updateApplicationSync(id, isSynced); await refresh(); }}
            />
            <ModuleManager open={openSettingsCard === 'modules'} onToggle={() => toggleSettingsCard('modules')} applications={settings.applications} modules={settings.modules} mutationReady={settingsMutationBridgeReady} refresh={refresh} showToast={showSettingsToast} />
            <OptionManager
              title="Environments"
              open={openSettingsCard === 'environments'}
              onToggle={() => toggleSettingsCard('environments')}
              mutationReady={settingsMutationBridgeReady}
              items={settings.environments.map((item) => ({ id: item.id, label: item.value }))}
              onAdd={async (value) => { await window.bugPocket.addEnvironment(value); await refresh(); }}
              onUpdate={async (id, value) => { await window.bugPocket.updateEnvironment(id, value); await refresh(); }}
              onDelete={async (id) => runPresetLockedDelete(async () => { await window.bugPocket.deleteEnvironment(id); await refresh(); })}
              onMerge={async (sourceId, targetId) => { await window.bugPocket.mergeReference('environment', sourceId, targetId); await refresh(); }}
            />
            <OptionManager
              title="Devices"
              open={openSettingsCard === 'devices'}
              onToggle={() => toggleSettingsCard('devices')}
              mutationReady={settingsMutationBridgeReady}
              items={settings.devices.map((item) => ({ id: item.id, label: item.value }))}
              onAdd={async (value) => { await window.bugPocket.addDevice(value); await refresh(); }}
              onUpdate={async (id, value) => { await window.bugPocket.updateDevice(id, value); await refresh(); }}
              onDelete={async (id) => { await window.bugPocket.deleteDevice(id); await refresh(); }}
              onMerge={async (sourceId, targetId) => { await window.bugPocket.mergeReference('device', sourceId, targetId); await refresh(); }}
            />
            <OptionManager
              title="Browsers"
              open={openSettingsCard === 'browsers'}
              onToggle={() => toggleSettingsCard('browsers')}
              mutationReady={settingsMutationBridgeReady}
              items={settings.browsers.map((item) => ({ id: item.id, label: item.value }))}
              onAdd={async (value) => { await window.bugPocket.addBrowser(value); await refresh(); }}
              onUpdate={async (id, value) => { await window.bugPocket.updateBrowser(id, value); await refresh(); }}
              onDelete={async (id) => { await window.bugPocket.deleteBrowser(id); await refresh(); }}
              onMerge={async (sourceId, targetId) => { await window.bugPocket.mergeReference('browser', sourceId, targetId); await refresh(); }}
            />
            <OptionManager
              title="Entry Types"
              open={openSettingsCard === 'entry-types'}
              onToggle={() => toggleSettingsCard('entry-types')}
              mutationReady={settingsMutationBridgeReady}
              items={settings.entryTypes.map((item) => ({ id: item.id, label: item.value }))}
              onAdd={async (value) => { await window.bugPocket.addConfigOption('entry_type', value); await refresh(); }}
              onUpdate={async (id, value) => { await window.bugPocket.updateConfigOption(id, value); await refresh(); }}
              onDelete={async (id) => runPresetLockedDelete(async () => { await window.bugPocket.deleteConfigOption(id); await refresh(); })}
            />
            <OptionManager
              title="Severity Values"
              open={openSettingsCard === 'severity-values'}
              onToggle={() => toggleSettingsCard('severity-values')}
              mutationReady={settingsMutationBridgeReady}
              items={settings.severities.map((item) => ({ id: item.id, label: item.value }))}
              onAdd={async (value) => { await window.bugPocket.addConfigOption('severity', value); await refresh(); }}
              onUpdate={async (id, value) => { await window.bugPocket.updateConfigOption(id, value); await refresh(); }}
              onDelete={async (id) => { await window.bugPocket.deleteConfigOption(id); await refresh(); }}
            />
          </div>
        )}
        {activeSegment === 'outbound' && (
          <div className="settings-grid outbound-grid">
            <DataManagementPanel settings={settings} refresh={refresh} showToast={showSettingsToast} />
            <OptionManager
              title="Report Destinations"
              open={openSettingsCard === 'issue-platforms'}
              onToggle={() => toggleSettingsCard('issue-platforms')}
              mutationReady={settingsMutationBridgeReady}
              items={settings.issuePlatforms.map((item) => ({ id: item.id, label: item.value }))}
              onAdd={async (value) => { await window.bugPocket.addConfigOption('issue_platform', value); await refresh(); }}
              onUpdate={async (id, value) => { await window.bugPocket.updateConfigOption(id, value); await refresh(); }}
              onDelete={async (id) => { await window.bugPocket.deleteConfigOption(id); await refresh(); }}
            />
            {settings.issuePlatforms.some((platform) => platform.value.toLowerCase() === 'jira') && (
              <JiraWorkspacePanel value={settings.jiraWorkspaceUrl} mutationReady={settingsMutationBridgeReady} refresh={refresh} />
            )}
            <AiOptionsPanel enabled={settings.aiTriageEnabled} modelName={settings.ollamaModelName} mutationReady={settingsMutationBridgeReady} refresh={refresh} />
            <TemplateManager templates={settings.reportTemplates} refresh={refresh} />
          </div>
        )}
      </div>
      {settingsToast && <div className="toast">{settingsToast}</div>}
    </section>
  );
}
