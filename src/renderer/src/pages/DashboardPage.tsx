import React, { useEffect, useState } from 'react';
import type { Attachment } from '../../../shared/types';
import { Camera, ChevronLeft, ChevronRight, Filter, Gauge, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { Bug, BugFilters, BugStatusCounts, SettingsData } from '../../../shared/types';
import { Badge } from '../components/shared/Badge';
import { Select } from '../components/shared/Select';
import { ScreenshotAnnotator } from '../components/ScreenshotAnnotator';
import { formatDate } from '../services/reports';
import { getEntryDisplay, formatTableDate, severityClass, statusPillClass, syncClass, shortcutDisplay, isCloudSyncActive, effectiveSyncStatus } from '../utils/display';
import { getActiveFilterChips, getModulesForApplication } from '../utils/filters';
import { loadAttachmentLineage, SpotlightState } from '../utils/spotlight';
import { resolveTaxonomyId } from '../utils/taxonomyIds';

export function Dashboard({ settings, onSelect }: { settings: SettingsData; onSelect: (id: number) => void }) {
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [filters, setFilters] = useState<BugFilters>({ reported: 'all' });
  const [statusCounts, setStatusCounts] = useState<BugStatusCounts>({ total: 0, draft: 0, reported: 0, discarded: 0 });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);

  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const [nextBugs, nextStatusCounts] = await Promise.all([
        window.bugPocket.listBugs(filters) as Promise<Bug[]>,
        window.bugPocket.getBugStatusCounts()
      ]);
      setBugs(nextBugs);
      setStatusCounts(nextStatusCounts);
    };
    void refresh();
    return window.bugPocket.onBugsChanged(() => { void refresh(); });
  }, [filters]);

  const moduleFilterOptions = getModulesForApplication(settings, filters.applicationId === 'all' ? null : filters.applicationId ?? null);
  const activeFilterChips = getActiveFilterChips(filters, settings);
  const quickPanelShortcut = shortcutDisplay(settings.shortcuts.find((shortcut) => shortcut.action === 'quick_capture'), 'Ctrl+Alt+P');
  const globalScreenshotShortcut = shortcutDisplay(settings.shortcuts.find((shortcut) => shortcut.action === 'global_screenshot'), 'Ctrl+Alt+S');
  const clearFilters = (): void => setFilters({ reported: 'all', search: filters.search ?? '' });
  const currentSpotlightAttachment = spotlight?.attachments[spotlight.index] ?? null;
  const currentSpotlightPreview = currentSpotlightAttachment ? spotlight?.previews[currentSpotlightAttachment.id] ?? '' : '';
  const cloudSyncActive = isCloudSyncActive(settings);
  const developerReadOnly = !settings.currentWorkspaceCanWrite;

  const loadSpotlightPreview = async (attachment: Attachment): Promise<void> => {
    setSpotlight((current) => (current ? { ...current, loading: true, error: '' } : current));
    const [dataUrl, lineageData] = await Promise.all([
      window.bugPocket.getAttachmentPreview(attachment.id) as Promise<string>,
      loadAttachmentLineage(attachment.id)
    ]);
    setSpotlight((current) => {
      if (!current) return current;
      return {
        ...current,
        previews: { ...current.previews, [attachment.id]: dataUrl },
        lineage: lineageData.lineage,
        lineagePreviews: { ...current.lineagePreviews, ...lineageData.lineagePreviews },
        loading: false,
        error: dataUrl ? '' : 'Preview unavailable.'
      };
    });
  };

  const openAttachmentSpotlight = async (event: React.MouseEvent<HTMLButtonElement>, bug: Bug): Promise<void> => {
    event.stopPropagation();
    if (!bug.attachment_count) return;
    setSpotlight({ bugId: bug.id, bugTitle: bug.title, attachments: [], index: 0, previews: {}, lineage: [], lineagePreviews: {}, loading: true, error: '' });
    const details = await window.bugPocket.getBug(bug.id);
    if (!details?.attachments.length) {
      setSpotlight({ bugId: bug.id, bugTitle: bug.title, attachments: [], index: 0, previews: {}, lineage: [], lineagePreviews: {}, loading: false, error: 'No attachments found.' });
      return;
    }
    setSpotlight({ bugId: bug.id, bugTitle: bug.title, attachments: details.attachments, index: 0, previews: {}, lineage: [], lineagePreviews: {}, loading: true, error: '' });
    await loadSpotlightPreview(details.attachments[0]);
  };

  const showSpotlightIndex = (nextIndex: number): void => {
    if (!spotlight?.attachments.length) return;
    const boundedIndex = Math.max(0, Math.min(nextIndex, spotlight.attachments.length - 1));
    const attachment = spotlight.attachments[boundedIndex];
    setSpotlight((current) => (current ? { ...current, index: boundedIndex, loading: !current.previews[attachment.id], error: '' } : current));
    void loadSpotlightPreview(attachment);
  };

  const saveSpotlightAnnotation = async (dataUrl: string): Promise<void> => {
    if (developerReadOnly || !spotlight || !currentSpotlightAttachment) return;
    const created = (await window.bugPocket.saveAnnotatedAttachment(currentSpotlightAttachment.id, dataUrl)) as Attachment;
    const attachments = [created, ...spotlight.attachments.filter((attachment) => attachment.id !== currentSpotlightAttachment.id)];
    const lineageData = await loadAttachmentLineage(created.id);
    setSpotlight((current) => {
      if (!current) return current;
      return {
        ...current,
        attachments,
        index: 0,
        previews: { ...current.previews, [created.id]: dataUrl },
        lineage: lineageData.lineage,
        lineagePreviews: { ...current.lineagePreviews, ...lineageData.lineagePreviews, [created.id]: dataUrl },
        loading: false,
        error: ''
      };
    });
  };

  const selectSpotlightVersion = async (attachment: Attachment): Promise<void> => {
    if (!spotlight) return;
    const nextIndex = spotlight.attachments.findIndex((item) => item.id === attachment.id);
    if (nextIndex >= 0) { showSpotlightIndex(nextIndex); return; }
    setSpotlight((current) => current ? {
      ...current,
      attachments: [attachment as Attachment, ...current.attachments],
      index: 0,
      previews: { ...current.previews, ...current.lineagePreviews },
      loading: !current.lineagePreviews[attachment.id],
      error: ''
    } : current);
    if (!spotlight.lineagePreviews[attachment.id]) await loadSpotlightPreview(attachment);
  };

  useEffect(() => {
    if (!spotlight) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSpotlight(null);
      if (event.key === 'ArrowLeft') showSpotlightIndex(spotlight.index - 1);
      if (event.key === 'ArrowRight') showSpotlightIndex(spotlight.index + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [spotlight]);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Captured Entries</h1>
          <p>Capture bugs without breaking your flow.</p>
        </div>
        <div className="dashboard-screenshot-actions">
          <div className="dashboard-action">
            <button className="primary dashboard-screenshot-button" disabled={developerReadOnly} title={developerReadOnly ? 'Your workspace role is read-only' : 'Start global screenshot snip'} aria-label="Start global screenshot snip" onClick={() => void window.bugPocket.startScreenshotCapture()}>
              <Camera size={17} strokeWidth={2.6} /> Global Screenshot
            </button>
            <span className="dashboard-action-shortcut">{globalScreenshotShortcut}</span>
          </div>
          <div className="dashboard-action">
            <button className="primary dashboard-screenshot-button" disabled={developerReadOnly} title={developerReadOnly ? 'Your workspace role is read-only' : 'Open Quick Capture panel'} aria-label="Open Quick Capture panel" onClick={() => void window.bugPocket.openQuickCapture()}>
              <Plus size={17} strokeWidth={3} /> Quick Panel
            </button>
            <span className="dashboard-action-shortcut">{quickPanelShortcut}</span>
          </div>
        </div>
      </header>
      <div className="dashboard-controls">
        <nav className="capture-state-filters" aria-label="Capture state filters">
          {[
            { label: 'Total Captures', value: 'all', count: statusCounts.total },
            { label: 'Drafts', value: 'Draft', count: statusCounts.draft },
            { label: 'Reported', value: 'Reported', count: statusCounts.reported },
            { label: 'Discarded', value: 'Discarded', count: statusCounts.discarded }
          ].map((tab) => (
            <button
              className={(filters.status ?? 'all') === tab.value ? 'state-tab active' : 'state-tab'}
              key={tab.value}
              type="button"
              onClick={() => setFilters({ ...filters, status: tab.value })}
            >
              {tab.label}
              <span className="state-tab-count" aria-label={`${tab.count} ${tab.label.toLowerCase()}`}>{tab.count}</span>
            </button>
          ))}
        </nav>
        <div className="filter-commandbar">
          <label className="search-field">
            <Search size={16} />
            <input placeholder="Search note, title, or tags" value={filters.search ?? ''} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </label>
          <button className="filter-toggle" aria-expanded={filtersOpen} aria-controls="dashboard-filters" onClick={() => setFiltersOpen((open) => !open)}>
            <Filter size={16} /> Filters {activeFilterChips.length ? <span>{activeFilterChips.length}</span> : null}
          </button>
          {activeFilterChips.length > 0 && <button className="text-button clear-filters" onClick={clearFilters}>Clear filters</button>}
        </div>
        {activeFilterChips.length > 0 && (
          <div className="active-filter-row" aria-label="Active filters">
            {activeFilterChips.map((chip) => <span className="chip filter-chip" key={`${chip.label}-${chip.value}`}>{chip.label}: {chip.value}</span>)}
          </div>
        )}
        <div className={filtersOpen ? 'filter-panel-shell open' : 'filter-panel-shell'} aria-hidden={!filtersOpen}>
          <div className="filter-panel-frame">
            <div className="filter-panel" id="dashboard-filters">
              <Select disabled={!filtersOpen} label="Entry Type" value={filters.entryType ?? 'all'} onChange={(value) => setFilters({ ...filters, entryType: value, status: 'all' })}>
                <option value="all">All types</option>
                {settings.entryTypes.map((type) => <option key={type.id} value={type.value}>{type.value}</option>)}
              </Select>
              <Select
                disabled={!filtersOpen}
                label="Application"
                value={filters.applicationId ?? 'all'}
                onChange={(value) => {
                  const applicationId = value === 'all' ? 'all' : resolveTaxonomyId(value, settings.applications) ?? 'all';
                  const nextModules = getModulesForApplication(settings, applicationId === 'all' ? null : applicationId);
                  const currentModuleStillVisible = nextModules.some((module) => module.id === filters.moduleId);
                  setFilters({ ...filters, applicationId, moduleId: currentModuleStillVisible ? filters.moduleId : 'all' });
                }}
              >
                <option value="all">All apps</option>
                {settings.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}
              </Select>
              <Select disabled={!filtersOpen} label="Module" value={filters.moduleId ?? 'all'} onChange={(value) => setFilters({ ...filters, moduleId: value === 'all' ? 'all' : resolveTaxonomyId(value, moduleFilterOptions) ?? 'all' })}>
                <option value="all">All modules</option>
                {moduleFilterOptions.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
              </Select>
              <Select disabled={!filtersOpen} label="Environment" value={filters.environmentId ?? 'all'} onChange={(value) => setFilters({ ...filters, environmentId: value === 'all' ? 'all' : resolveTaxonomyId(value, settings.environments) ?? 'all' })}>
                <option value="all">All envs</option>
                {settings.environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.value}</option>)}
              </Select>
              <Select disabled={!filtersOpen} label="Severity" value={filters.severity ?? 'all'} onChange={(value) => setFilters({ ...filters, severity: value })}>
                <option value="all">All severities</option>
                {settings.severities.map((severity) => <option key={severity.id} value={severity.value}>{severity.value}</option>)}
              </Select>
            </div>
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Context</th>
              <th>State</th>
              <th>Created</th>
              <th>Attachments</th>
            </tr>
          </thead>
          <tbody>
            {bugs.map((bug) => {
              const entryDisplay = getEntryDisplay(bug);
              const visibleSyncStatus = effectiveSyncStatus(bug.sync_status, cloudSyncActive);
              return (
                <tr key={bug.id} onClick={() => onSelect(bug.id)}>
                  <td className="entry-cell">
                    <div className="entry-heading">
                      <strong>{entryDisplay.title}</strong>
                      <Badge>{bug.entry_type || 'Bug'}</Badge>
                    </div>
                    {entryDisplay.preview && <p className="table-note">{entryDisplay.preview}</p>}
                  </td>
                  <td className="context-cell">
                    <strong>{bug.application_name || '-'}</strong>
                    <span>{bug.module_name || '-'}</span>
                    <span>{bug.environment || 'No environment'}</span>
                  </td>
                  <td>
                    <div className="state-stack">
                      <span className={`state-pill ${statusPillClass(bug.status)}`}>{bug.status}</span>
                      <span className={`state-icon-pill severity-pill severity-${severityClass(bug.severity)}`} title={`Severity: ${bug.severity}`} data-tooltip={`Severity: ${bug.severity}`} aria-label={`Severity: ${bug.severity}`} tabIndex={0}>
                        <Gauge size={14} />
                      </span>
                      <span className={`state-icon-pill sync-pill sync-${syncClass(visibleSyncStatus)}`} title={`Sync: ${visibleSyncStatus}`} data-tooltip={`Sync: ${visibleSyncStatus}`} aria-label={`Sync: ${visibleSyncStatus}`} tabIndex={0}>
                        <RefreshCw size={14} />
                      </span>
                    </div>
                  </td>
                  <td>
                    <time className="table-tooltip" data-tooltip={`Created: ${formatDate(bug.created_at)}`} tabIndex={0} dateTime={bug.created_at}>
                      {formatTableDate(bug.created_at)}
                    </time>
                  </td>
                  <td className="attachment-cell">
                    {bug.attachment_count ? (
                      <button className="attachment-count attachment-button" aria-label={`Preview ${bug.attachment_count} attachment${bug.attachment_count === 1 ? '' : 's'}`} onClick={(event) => void openAttachmentSpotlight(event, bug)}>
                        <Camera size={15} /> {bug.attachment_count}
                      </button>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!bugs.length && (
              <tr><td colSpan={5} className="empty"><Filter size={18} /> No entries match this view.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {spotlight && (
        <div className="spotlight-backdrop" role="dialog" aria-modal="true" aria-label="Screenshot preview" onClick={() => setSpotlight(null)}>
          <div className="spotlight-panel" onClick={(event) => event.stopPropagation()}>
            <header className="spotlight-header">
              <div>
                <h2>{spotlight.bugTitle}</h2>
                <p>{currentSpotlightAttachment ? `${currentSpotlightAttachment.file_name} (${spotlight.index + 1} of ${spotlight.attachments.length})` : 'Attachment preview'}</p>
              </div>
              <button className="icon-button" aria-label="Close preview" onClick={() => setSpotlight(null)}><X size={18} /></button>
            </header>
            <div className="spotlight-stage">
              {spotlight.loading && <div className="spotlight-message">Loading preview...</div>}
              {!spotlight.loading && spotlight.error && <div className="spotlight-message">{spotlight.error}</div>}
              {!spotlight.loading && currentSpotlightPreview && currentSpotlightAttachment && (developerReadOnly ? (
                <img className="spotlight-readonly-image" src={currentSpotlightPreview} alt={currentSpotlightAttachment.file_name} />
              ) : (
                <ScreenshotAnnotator
                  activeAttachmentId={currentSpotlightAttachment.id}
                  imageDataUrl={currentSpotlightPreview}
                  fileName={currentSpotlightAttachment.file_name}
                  versionHistory={spotlight.lineage}
                  versionPreviews={spotlight.lineagePreviews}
                  onSelectVersion={(attachment) => void selectSpotlightVersion(attachment)}
                  onSave={saveSpotlightAnnotation}
                />
              ))}
            </div>
            {spotlight.attachments.length > 1 && (
              <div className="spotlight-controls">
                <button disabled={spotlight.index === 0} onClick={() => showSpotlightIndex(spotlight.index - 1)}><ChevronLeft size={16} /> Previous</button>
                <button disabled={spotlight.index === spotlight.attachments.length - 1} onClick={() => showSpotlightIndex(spotlight.index + 1)}>Next <ChevronRight size={16} /></button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
