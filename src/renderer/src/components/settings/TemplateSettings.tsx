import React from 'react';
import type { SettingsData } from '../../../../shared/types';
import { JiraWorkspacePanel } from './JiraWorkspacePanel';
import { OptionManager } from './OptionManager';
import { TemplateManager } from './TemplateManager';

export function TemplateSettings({
  settings,
  mutationReady,
  openSettingsCard,
  refresh,
  toggleSettingsCard
}: {
  settings: SettingsData;
  mutationReady: boolean;
  openSettingsCard: string | null;
  refresh: () => Promise<void>;
  toggleSettingsCard: (cardId: string) => void;
}) {
  return (
    <div className="settings-tab-stack">
      <section className="settings-section-group" aria-labelledby="settings-output-heading">
        <div className="settings-section-heading">
          <h2 id="settings-output-heading">Output & Templates</h2>
          <p>Manage report destinations, Jira routing, and copy-ready report formats. Destinations control the export actions available in Bug Details.</p>
        </div>
        <div className="settings-grid outbound-grid">
          <OptionManager
            title="Report Destinations"
            open={openSettingsCard === 'issue-platforms'}
            onToggle={() => toggleSettingsCard('issue-platforms')}
            mutationReady={mutationReady}
            items={settings.issuePlatforms.map((item) => ({ id: item.id, label: item.value }))}
            onAdd={async (value) => { await window.bugPocket.addConfigOption('issue_platform', value); await refresh(); }}
            onUpdate={async (id, value) => { await window.bugPocket.updateConfigOption(id, value); await refresh(); }}
            onDelete={async (id) => { await window.bugPocket.deleteConfigOption(id); await refresh(); }}
          />
          {settings.issuePlatforms.some((platform) => platform.value.toLowerCase() === 'jira') && (
            <JiraWorkspacePanel value={settings.jiraWorkspaceUrl} mutationReady={mutationReady} refresh={refresh} />
          )}
        </div>
      </section>

      <section className="settings-section-group" aria-labelledby="settings-templates-heading">
        <div className="settings-section-heading">
          <h2 id="settings-templates-heading">Report Templates</h2>
          <p>Manage the copy-ready report formats used by Quick Report, Full Bug Report, Linear, and Jira actions.</p>
        </div>
        <TemplateManager templates={settings.reportTemplates} refresh={refresh} />
      </section>
    </div>
  );
}
