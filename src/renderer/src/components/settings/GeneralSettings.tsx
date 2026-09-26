import React from 'react';
import type { SettingsData } from '../../../../shared/types';
import { CapturePreferencesPanel } from './CapturePreferencesPanel';
import { ModuleManager } from './ModuleManager';
import { OptionManager } from './OptionManager';
import { ShortcutSettingsPanel } from './ShortcutSettingsPanel';

interface GeneralSettingsProps {
  settings: SettingsData;
  mutationReady: boolean;
  openSettingsCard: string | null;
  refresh: () => Promise<void>;
  showToast: (message: string, variant?: 'success' | 'info' | 'error') => void;
  toggleSettingsCard: (cardId: string) => void;
}

export function GeneralSettings({
  settings,
  mutationReady,
  openSettingsCard,
  refresh,
  showToast,
  toggleSettingsCard
}: GeneralSettingsProps) {
  const runPresetLockedDelete = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not update setting.';
      if (message.includes('active preset')) showToast('Cannot delete because it is currently used by an active preset. Please update or delete the preset first.', 'error');
    }
  };
  const taxonomyReadOnly = !settings.currentWorkspaceCanWrite;
  const taxonomyReadOnlyMessage = 'Your workspace role is read-only. Taxonomy is managed by workspace writers.';

  return (
    <div className="settings-tab-stack">
      <section className="settings-section-group" aria-labelledby="settings-system-heading">
        <div className="settings-section-heading">
          <h2 id="settings-system-heading">System Behavior & Hotkeys</h2>
          <p>Control desktop launch behavior, screenshot review, and global shortcuts.</p>
        </div>
        <div className="settings-section-grid single-column">
          <ShortcutSettingsPanel shortcuts={settings.shortcuts} refresh={refresh} />
          <CapturePreferencesPanel screenshotReviewEnabled={settings.quickCaptureAnnotateScreenshots} runOnSystemStartup={settings.runOnSystemStartup} refresh={refresh} />
        </div>
      </section>

      <section className="settings-section-group" aria-labelledby="settings-taxonomy-heading">
        <div className="settings-section-heading">
          <h2 id="settings-taxonomy-heading">Workspace Field Lists</h2>
          <p>Keep applications, modules, environments, devices, browsers, user roles, entry types, and severities tidy. New applications automatically get a General module for routing continuity.</p>
        </div>
        <div className="settings-grid taxonomy-grid">
          <OptionManager
            title="Applications"
            open={openSettingsCard === 'applications'}
            onToggle={() => toggleSettingsCard('applications')}
            mutationReady={mutationReady}
            items={settings.applications.map((item) => ({ id: item.id, label: item.name, issuePrefix: item.issue_prefix, contextDescription: item.context_description ?? '', isSynced: item.is_synced !== 0 }))}
            addPlaceholder="Application name"
            addButtonLabel="Add"
            addContextLabel="Application Description"
            addContextRequired={true}
            addCodeLabel="Issue Prefix"
            addCodeRequired={true}
            readOnly={taxonomyReadOnly}
            readOnlyMessage={taxonomyReadOnlyMessage}
            onAdd={async (value, contextDescription = '', issuePrefix = '') => { await window.bugPocket.addApplication(value, contextDescription, issuePrefix); await refresh(); }}
            onUpdate={async (id, value, item) => { await window.bugPocket.updateApplication(id, value, item.contextDescription ?? '', item.issuePrefix ?? ''); await refresh(); }}
            onUpdateContext={async (id, contextDescription) => { await window.bugPocket.updateApplicationContext(id, contextDescription); await refresh(); }}
            onDelete={async (id) => runPresetLockedDelete(async () => { await window.bugPocket.deleteApplication(id); await refresh(); })}
            onToggleSync={async (id, isSynced) => { await window.bugPocket.updateApplicationSync(id, isSynced); await refresh(); }}
          />
          <ModuleManager open={openSettingsCard === 'modules'} onToggle={() => toggleSettingsCard('modules')} applications={settings.applications} modules={settings.modules} mutationReady={mutationReady} refresh={refresh} showToast={showToast} readOnly={taxonomyReadOnly} readOnlyMessage={taxonomyReadOnlyMessage} />
          <OptionManager
            title="Environments"
            open={openSettingsCard === 'environments'}
            onToggle={() => toggleSettingsCard('environments')}
            mutationReady={mutationReady}
            items={settings.environments.map((item) => ({ id: item.id, label: item.value }))}
            readOnly={taxonomyReadOnly}
            readOnlyMessage={taxonomyReadOnlyMessage}
            onAdd={async (value) => { await window.bugPocket.addEnvironment(value); await refresh(); }}
            onUpdate={async (id, value) => { await window.bugPocket.updateEnvironment(id, value); await refresh(); }}
            onDelete={async (id) => runPresetLockedDelete(async () => { await window.bugPocket.deleteEnvironment(id); await refresh(); })}
            onMerge={async (sourceId, targetId) => { await window.bugPocket.mergeReference('environment', sourceId, targetId); await refresh(); }}
          />
          <OptionManager
            title="Devices"
            open={openSettingsCard === 'devices'}
            onToggle={() => toggleSettingsCard('devices')}
            mutationReady={mutationReady}
            readOnly={taxonomyReadOnly}
            readOnlyMessage={taxonomyReadOnlyMessage}
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
            mutationReady={mutationReady}
            readOnly={taxonomyReadOnly}
            readOnlyMessage={taxonomyReadOnlyMessage}
            items={settings.browsers.map((item) => ({ id: item.id, label: item.value }))}
            onAdd={async (value) => { await window.bugPocket.addBrowser(value); await refresh(); }}
            onUpdate={async (id, value) => { await window.bugPocket.updateBrowser(id, value); await refresh(); }}
            onDelete={async (id) => { await window.bugPocket.deleteBrowser(id); await refresh(); }}
            onMerge={async (sourceId, targetId) => { await window.bugPocket.mergeReference('browser', sourceId, targetId); await refresh(); }}
          />
          <OptionManager
            title="User Roles"
            open={openSettingsCard === 'user-roles'}
            onToggle={() => toggleSettingsCard('user-roles')}
            mutationReady={mutationReady}
            readOnly={taxonomyReadOnly}
            readOnlyMessage={taxonomyReadOnlyMessage}
            items={settings.userRoles.map((item) => ({ id: item.id, label: item.value }))}
            onAdd={async (value) => { await window.bugPocket.addUserRole(value); await refresh(); }}
            onUpdate={async (id, value) => { await window.bugPocket.updateUserRole(id, value); await refresh(); }}
            onDelete={async (id) => { await window.bugPocket.deleteUserRole(id); await refresh(); }}
            onMerge={async (sourceId, targetId) => { await window.bugPocket.mergeReference('user_role', sourceId, targetId); await refresh(); }}
          />
          <OptionManager
            title="Entry Types"
            open={openSettingsCard === 'entry-types'}
            onToggle={() => toggleSettingsCard('entry-types')}
            mutationReady={mutationReady}
            readOnly={taxonomyReadOnly}
            readOnlyMessage={taxonomyReadOnlyMessage}
            items={settings.entryTypes.map((item) => ({ id: item.id, label: item.value }))}
            onAdd={async (value) => { await window.bugPocket.addConfigOption('entry_type', value); await refresh(); }}
            onUpdate={async (id, value) => { await window.bugPocket.updateConfigOption(id, value); await refresh(); }}
            onDelete={async (id) => runPresetLockedDelete(async () => { await window.bugPocket.deleteConfigOption(id); await refresh(); })}
          />
          <OptionManager
            title="Severity Values"
            open={openSettingsCard === 'severity-values'}
            onToggle={() => toggleSettingsCard('severity-values')}
            mutationReady={mutationReady}
            readOnly={taxonomyReadOnly}
            readOnlyMessage={taxonomyReadOnlyMessage}
            items={settings.severities.map((item) => ({ id: item.id, label: item.value }))}
            onAdd={async (value) => { await window.bugPocket.addConfigOption('severity', value); await refresh(); }}
            onUpdate={async (id, value) => { await window.bugPocket.updateConfigOption(id, value); await refresh(); }}
            onDelete={async (id) => { await window.bugPocket.deleteConfigOption(id); await refresh(); }}
          />
        </div>
      </section>
</div>
  );
}



