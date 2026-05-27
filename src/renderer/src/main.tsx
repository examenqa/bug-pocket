import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { AiTriageResponse, Application, Attachment, AttachmentDownloadResult, AttachmentLineage, BackupExportResult, BackupImportResult, Bug, BugDetails, BugFilters, BugUpdateInput, CapturePreset, CapturePresetInput, CaptureStatus, ConfigOption, Module, ReferenceOption, ReportTemplate, ScreenshotResult, SettingsData, ShortcutAction, ShortcutSetting, SyncStatus } from '../../shared/types';
import { AlertTriangle, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clipboard, Download, Filter, Gauge, Home, Keyboard, Pencil, Plus, RefreshCw, Save, Search, Settings as SettingsIcon, Trash2, Upload, X } from 'lucide-react';
import { QuickCaptureDraft, QuickCaptureForm } from './components/QuickCaptureForm';
import { ScreenshotAnnotator } from './components/ScreenshotAnnotator';
import { useSettings } from './hooks/useSettings';
import { createQuickBugRecord } from './services/bugRecords';
import { buildIssueDeepLink, formatDate, generateReport, IssuePlatformLink } from './services/reports';
import iconUrl from './assets/bug-pocket-icon.png';
import titleUrl from './assets/bug-pocket-title.png';
import './styles.css';

function readRoute(): string {
  return window.location.hash.replace(/^#/, '') || '/dashboard';
}

function useHashRoute() {
  const [route, setRoute] = useState(readRoute);

  const navigate = (nextRoute: string): void => {
    if (readRoute() === nextRoute) {
      setRoute(nextRoute);
      return;
    }
    window.location.hash = nextRoute;
  };

  useEffect(() => {
    const syncRoute = (): void => setRoute(readRoute());
    const unsubscribeNavigation = window.bugPocket.onNavigate((nextRoute) => navigate(nextRoute));
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      unsubscribeNavigation();
    };
  }, []);

  return { route, navigate };
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

function App() {
  const { route, navigate } = useHashRoute();
  const [toast, setToast] = useState('');

  useEffect(() => {
    let timer: number | undefined;
    return window.bugPocket.onToast((message) => {
      if (timer) window.clearTimeout(timer);
      setToast(message);
      timer = window.setTimeout(() => setToast(''), 2400);
    });
  }, []);

  let content: React.ReactNode;
  if (route.startsWith('/capture')) content = <CaptureRoute />;
  else if (route.startsWith('/snip')) content = <SnipOverlay />;
  else content = <MainShell route={route} navigate={navigate} />;

  return (
    <>
      {content}
      {toast && !route.startsWith('/snip') && <div className="toast">{toast}</div>}
    </>
  );
}

function CaptureRoute() {
  const { settings, refresh } = useSettings();
  const [attachments, setAttachments] = useState<ScreenshotResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  useEffect(() => window.bugPocket.onOpenQuickCapture(() => setFocusToken((current) => current + 1)), []);
  useEffect(() => window.bugPocket.onScreenshotCaptured((result) => setAttachments((current) => [...current, result as ScreenshotResult])), []);

  const saveDraft = async (draft: QuickCaptureDraft): Promise<void> => {
    setSaving(true);
    try {
      await createQuickBugRecord({
        entry_type: draft.entryType,
        application_id: draft.applicationId,
        module_id: draft.moduleId,
        environment_id: draft.environmentId,
        note: draft.note,
        attachment_ids: attachments.map((attachment) => attachment.id)
      });
      setAttachments([]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <QuickCaptureForm
      settings={settings}
      attachments={attachments}
      saving={saving}
      focusToken={focusToken}
      onConfigurePresets={() => window.bugPocket.openSettings('presets')}
      onTakeScreenshot={() => window.bugPocket.startScreenshotCapture()}
      onSave={saveDraft}
      onCancel={() => window.bugPocket.hideQuickCapture()}
      onCreateEntryType={async (value) => {
        const option = await window.bugPocket.addConfigOption('entry_type', value);
        await refresh();
        return option.value;
      }}
      onCreateApplication={async (name) => {
        const application = await window.bugPocket.addApplication(name);
        await refresh();
        return application.id;
      }}
      onCreateModule={async (name, applicationId) => {
        const createdModule = await window.bugPocket.addModule(name, applicationId);
        await refresh();
        return createdModule.id;
      }}
      onCreateEnvironment={async (value) => {
        const option = await window.bugPocket.addEnvironment(value);
        await refresh();
        return option.id;
      }}
    />
  );
}

function MainShell({ route, navigate }: { route: string; navigate: (route: string) => void }) {
  const { settings, refresh } = useSettings();
  const bugMatch = route.match(/^\/bugs\/(\d+)$/);
  const bugId = bugMatch ? Number(bugMatch[1]) : null;
  const [selectedBugId, setSelectedBugId] = useState<number | null>(bugId);
  const showingDetails = selectedBugId != null && !route.startsWith('/settings');
  const activeView = route.startsWith('/settings') ? 'settings' : 'dashboard';

  useEffect(() => {
    if (bugId) setSelectedBugId(bugId);
  }, [bugId]);

  const closeBugDetails = (): void => {
    setSelectedBugId(null);
    if (route.startsWith('/bugs/')) navigate('/dashboard');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={iconUrl} alt="" />
          <img className="brand-title-logo" src={titleUrl} alt="Bug Pocket" />
        </div>
        <button className={activeView === 'dashboard' ? 'nav active' : 'nav'} onClick={() => navigate('/dashboard')}>
          <Home size={17} /> Dashboard
        </button>
        <button className={activeView === 'settings' ? 'nav active' : 'nav'} onClick={() => navigate('/settings')}>
          <SettingsIcon size={17} /> Settings
        </button>
      </aside>
      <main className="content">
        {route.startsWith('/settings') ? (
          <SettingsPage settings={settings} refresh={refresh} route={route} />
        ) : (
          <>
            <div className={showingDetails ? 'dashboard-view hidden' : 'dashboard-view'}>
              <Dashboard settings={settings} onSelect={setSelectedBugId} />
            </div>
            {showingDetails && <BugDetailsHost bugId={selectedBugId} settings={settings} onClose={closeBugDetails} />}
          </>
        )}
      </main>
    </div>
  );
}

function BugDetailsHost({ bugId, settings, onClose }: { bugId: number; settings: SettingsData; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('.spotlight-backdrop')) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <section className="details-route-view" aria-label="Entry details">
      <BugDetailsView bugId={bugId} settings={settings} onBack={onClose} />
    </section>
  );
}

function Dashboard({ settings, onSelect }: { settings: SettingsData; onSelect: (id: number) => void }) {
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [filters, setFilters] = useState<BugFilters>({ reported: 'all' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);

  const refresh = async (): Promise<void> => {
    setBugs(await window.bugPocket.listBugs(filters));
  };

  useEffect(() => {
    refresh();
    return window.bugPocket.onBugsChanged(() => {
      refresh();
    });
  }, [filters.search, filters.entryType, filters.applicationId, filters.moduleId, filters.environmentId, filters.status, filters.severity, filters.syncStatus, filters.reported]);

  const statusFilterOptions = captureStatusOptions;
  const moduleFilterOptions = getModulesForApplication(settings, filters.applicationId === 'all' ? null : filters.applicationId ?? null);
  const activeFilterChips = getActiveFilterChips(filters, settings);
  const quickCaptureShortcut = shortcutDisplay(settings.shortcuts.find((shortcut) => shortcut.action === 'quick_capture'), 'Ctrl+Alt+P');
  const clearFilters = (): void => setFilters({ reported: 'all', search: filters.search ?? '' });
  const currentSpotlightAttachment = spotlight?.attachments[spotlight.index] ?? null;
  const currentSpotlightPreview = currentSpotlightAttachment ? spotlight?.previews[currentSpotlightAttachment.id] ?? '' : '';

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
    if (!spotlight || !currentSpotlightAttachment) return;
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
    if (nextIndex >= 0) {
      showSpotlightIndex(nextIndex);
      return;
    }
    setSpotlight((current) => current ? {
      ...current,
      attachments: [attachment, ...current.attachments],
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
        <div className="capture-action">
          <button className="primary capture-button" onClick={() => window.bugPocket.openQuickCapture()}>
            <Plus size={17} strokeWidth={3} /> Quick Capture
          </button>
          <span className="capture-shortcut">{quickCaptureShortcut}</span>
        </div>
      </header>
      <div className="dashboard-controls">
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
                const applicationId = value === 'all' ? 'all' : Number(value);
                const nextModules = getModulesForApplication(settings, applicationId === 'all' ? null : applicationId);
                const currentModuleStillVisible = nextModules.some((module) => module.id === filters.moduleId);
                setFilters({ ...filters, applicationId, moduleId: currentModuleStillVisible ? filters.moduleId : 'all' });
              }}
            >
              <option value="all">All apps</option>
              {settings.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}
            </Select>
            <Select disabled={!filtersOpen} label="Module" value={filters.moduleId ?? 'all'} onChange={(value) => setFilters({ ...filters, moduleId: value === 'all' ? 'all' : Number(value) })}>
              <option value="all">All modules</option>
              {moduleFilterOptions.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
            </Select>
            <Select disabled={!filtersOpen} label="Environment" value={filters.environmentId ?? 'all'} onChange={(value) => setFilters({ ...filters, environmentId: value === 'all' ? 'all' : Number(value) })}>
              <option value="all">All envs</option>
              {settings.environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.value}</option>)}
            </Select>
            <Select disabled={!filtersOpen} label="Status" value={filters.status ?? 'all'} onChange={(value) => setFilters({ ...filters, status: value })}>
              <option value="all">All statuses</option>
              {statusFilterOptions.map((status) => <option key={`${status.type}-${status.value}`} value={status.value}>{status.value}</option>)}
            </Select>
            <Select disabled={!filtersOpen} label="Severity" value={filters.severity ?? 'all'} onChange={(value) => setFilters({ ...filters, severity: value })}>
              <option value="all">All severities</option>
              {settings.severities.map((severity) => <option key={severity.id} value={severity.value}>{severity.value}</option>)}
            </Select>
            <Select disabled={!filtersOpen} label="Sync" value={filters.syncStatus ?? 'all'} onChange={(value) => setFilters({ ...filters, syncStatus: value as BugFilters['syncStatus'] })}>
              <option value="all">All sync</option>
              {syncStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </Select>
            <Select disabled={!filtersOpen} label="Reported" value={filters.reported ?? 'all'} onChange={(value) => setFilters({ ...filters, reported: value as BugFilters['reported'] })}>
              <option value="all">All</option>
              <option value="reported">Reported</option>
              <option value="unreported">Not reported</option>
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
                      <Badge>{bug.status}</Badge>
                      <span
                        className={`state-icon-pill severity-pill severity-${severityClass(bug.severity)}`}
                        title={`Severity: ${bug.severity}`}
                        data-tooltip={`Severity: ${bug.severity}`}
                        aria-label={`Severity: ${bug.severity}`}
                        tabIndex={0}
                      >
                        <Gauge size={14} />
                      </span>
                      <span
                        className={`state-icon-pill sync-pill sync-${syncClass(bug.sync_status)}`}
                        title={`Sync: ${bug.sync_status || 'Local Only'}`}
                        data-tooltip={`Sync: ${bug.sync_status || 'Local Only'}`}
                        aria-label={`Sync: ${bug.sync_status || 'Local Only'}`}
                        tabIndex={0}
                      >
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
              {!spotlight.loading && currentSpotlightPreview && currentSpotlightAttachment && (
                <ScreenshotAnnotator
                  activeAttachmentId={currentSpotlightAttachment.id}
                  imageDataUrl={currentSpotlightPreview}
                  fileName={currentSpotlightAttachment.file_name}
                  versionHistory={spotlight.lineage}
                  versionPreviews={spotlight.lineagePreviews}
                  onSelectVersion={(attachment) => void selectSpotlightVersion(attachment)}
                  onSave={saveSpotlightAnnotation}
                />
              )}
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

interface SpotlightState {
  bugId: number;
  bugTitle: string;
  attachments: Attachment[];
  index: number;
  previews: Record<number, string>;
  lineage: Attachment[];
  lineagePreviews: Record<number, string>;
  loading: boolean;
  error: string;
}

async function loadAttachmentLineage(attachmentId: number): Promise<{ lineage: Attachment[]; lineagePreviews: Record<number, string> }> {
  const lineage = (await window.bugPocket.getAttachmentLineage(attachmentId)) as AttachmentLineage['versions'];
  const entries = await Promise.all(
    lineage.map(async (attachment) => {
      const dataUrl = (await window.bugPocket.getAttachmentPreview(attachment.id)) as string;
      return [attachment.id, dataUrl] as const;
    })
  );
  return {
    lineage,
    lineagePreviews: Object.fromEntries(entries.filter(([, dataUrl]) => dataUrl))
  };
}

type DetailsSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
type AiTriageStatus = 'idle' | 'loading' | 'completed';

function buildBugUpdateInput(bug: BugDetails): BugUpdateInput {
  const entryDisplay = getEntryDisplay(bug);
  const title = entryDisplay.isDerived ? entryDisplay.title : bug.title;
  return {
    entry_type: bug.entry_type || 'Bug',
    application_id: bug.application_id,
    module_id: bug.module_id,
    environment_id: bug.environment_id,
    device_id: bug.device_id,
    browser_id: bug.browser_id,
    title,
    note: bug.note,
    other_details: bug.other_details,
    steps_to_reproduce: bug.steps_to_reproduce,
    expected_result: bug.expected_result,
    actual_result: bug.actual_result,
    status: bug.status,
    severity: bug.severity,
    reported: !!bug.reported,
    issue_platform: bug.issue_platform,
    issue_id: bug.issue_id,
    issue_url: bug.issue_url,
    tags: bug.tags
  };
}

function serializeBugUpdateInput(input: BugUpdateInput): string {
  return JSON.stringify(input);
}

function BugDetailsView({ bugId, settings, onBack }: { bugId: number; settings: SettingsData; onBack: () => void }) {
  const [bug, setBug] = useState<BugDetails | null>(null);
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState('');
  const [detailsToast, setDetailsToast] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<DetailsSaveState>('idle');
  const [aiStatus, setAiStatus] = useState<AiTriageStatus>('idle');
  const [showAiRefinement, setShowAiRefinement] = useState(false);
  const [aiRefinementNote, setAiRefinementNote] = useState('');
  const [lastEditedField, setLastEditedField] = useState<keyof BugDetails | null>(null);
  const bugRef = useRef<BugDetails | null>(null);
  const isDirtyRef = useRef(false);
  const lastSavedPayloadRef = useRef('');
  const saveStateTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<BugDetails | null> | null>(null);

  const currentSpotlightAttachment = spotlight?.attachments[spotlight.index] ?? null;
  const currentSpotlightPreview = currentSpotlightAttachment ? spotlight?.previews[currentSpotlightAttachment.id] ?? '' : '';
  const triaging = aiStatus === 'loading';

  useEffect(() => {
    let cancelled = false;
    const unsubscribeScreenshot = window.bugPocket.onScreenshotCaptured(() => {
      window.bugPocket.getBug(bugId).then((loadedBug) => {
        if (cancelled) return;
        setBug(loadedBug);
        bugRef.current = loadedBug;
      });
    });
    window.bugPocket.getBug(bugId).then((loadedBug) => {
      if (cancelled) return;
      setBug(loadedBug);
      bugRef.current = loadedBug;
      if (loadedBug) lastSavedPayloadRef.current = serializeBugUpdateInput(buildBugUpdateInput(loadedBug));
      setIsDirty(false);
      isDirtyRef.current = false;
      setSaveState('idle');
      void window.bugPocket.setDetailsDirty(false);
    });
    return () => {
      cancelled = true;
      unsubscribeScreenshot();
    };
  }, [bugId]);

  useEffect(() => {
    bugRef.current = bug;
  }, [bug]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
    void window.bugPocket.setDetailsDirty(isDirty);
  }, [isDirty]);

  useEffect(() => {
    return () => {
      if (saveStateTimerRef.current) window.clearTimeout(saveStateTimerRef.current);
      void window.bugPocket.setDetailsDirty(false);
    };
  }, []);

  const formPayloadKey = useMemo(() => (bug ? serializeBugUpdateInput(buildBugUpdateInput(bug)) : ''), [bug]);
  const debouncedFormPayloadKey = useDebounce(formPayloadKey, 1500);

  const markSavedSoon = (): void => {
    setSaveState('saved');
    if (saveStateTimerRef.current) window.clearTimeout(saveStateTimerRef.current);
    saveStateTimerRef.current = window.setTimeout(() => setSaveState('idle'), 1600);
  };

  const saveCurrentBug = useCallback(async ({ showToast = false }: { showToast?: boolean } = {}): Promise<BugDetails | null> => {
    if (saveInFlightRef.current) await saveInFlightRef.current;
    const currentBug = bugRef.current;
    if (!currentBug) return null;
    const payload = buildBugUpdateInput(currentBug);
    const payloadKey = serializeBugUpdateInput(payload);
    if (payloadKey === lastSavedPayloadRef.current) {
      setIsDirty(false);
      isDirtyRef.current = false;
      void window.bugPocket.setDetailsDirty(false);
      if (showToast) {
        setDetailsToast('Details already saved.');
        window.setTimeout(() => setDetailsToast(''), 1400);
      }
      return currentBug;
    }

    setSaveState('saving');
    const savePromise = window.bugPocket.updateBug(currentBug.id, payload) as Promise<BugDetails>;
    saveInFlightRef.current = savePromise;
    try {
      const updated = await savePromise;
      const latestBug = bugRef.current;
      const latestPayloadKey = latestBug ? serializeBugUpdateInput(buildBugUpdateInput(latestBug)) : payloadKey;
      lastSavedPayloadRef.current = serializeBugUpdateInput(buildBugUpdateInput(updated));
      if (latestPayloadKey !== payloadKey) {
        setIsDirty(true);
        isDirtyRef.current = true;
        setSaveState('dirty');
        void window.bugPocket.setDetailsDirty(true);
        return latestBug;
      }
      setBug(updated);
      bugRef.current = updated;
      setIsDirty(false);
      isDirtyRef.current = false;
      void window.bugPocket.setDetailsDirty(false);
      markSavedSoon();
      if (showToast) {
        setDetailsToast('Details saved successfully.');
        window.setTimeout(() => setDetailsToast(''), 1800);
      }
      return updated;
    } catch (caught) {
      setSaveState('error');
      const message = caught instanceof Error ? caught.message : 'Unable to save details.';
      setDetailsToast(message);
      window.setTimeout(() => setDetailsToast(''), 2600);
      throw caught;
    } finally {
      saveInFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!bugRef.current || !isDirtyRef.current || !debouncedFormPayloadKey) return;
    if (debouncedFormPayloadKey !== formPayloadKey) return;
    if (debouncedFormPayloadKey === lastSavedPayloadRef.current) {
      setIsDirty(false);
      isDirtyRef.current = false;
      void window.bugPocket.setDetailsDirty(false);
      return;
    }
    void saveCurrentBug();
  }, [debouncedFormPayloadKey, formPayloadKey, saveCurrentBug]);

  useEffect(() => {
    return window.bugPocket.onDetailsFlushRequest(() => {
      void (async () => {
        try {
          if (isDirtyRef.current) await saveCurrentBug();
        } finally {
          await window.bugPocket.detailsFlushComplete();
        }
      })();
    });
  }, [saveCurrentBug]);

  const attachmentKey = bug?.attachments.map((attachment) => attachment.id).join(',') ?? '';
  useEffect(() => {
    if (!bug) {
      setAttachmentPreviews({});
      return;
    }

    let cancelled = false;
    Promise.all(
      bug.attachments.map(async (attachment) => {
        const dataUrl = (await window.bugPocket.getAttachmentPreview(attachment.id)) as string;
        return [attachment.id, dataUrl] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setAttachmentPreviews(Object.fromEntries(entries.filter(([, dataUrl]) => dataUrl)));
    });

    return () => {
      cancelled = true;
    };
  }, [bugId, attachmentKey]);

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

  const openAttachmentSpotlight = async (index: number): Promise<void> => {
    if (!bug?.attachments.length) return;
    const boundedIndex = Math.max(0, Math.min(index, bug.attachments.length - 1));
    const previews = { ...attachmentPreviews };
    const attachment = bug.attachments[boundedIndex];
    setSpotlight({
      bugId: bug.id,
      bugTitle: getEntryDisplay(bug).title,
      attachments: bug.attachments,
      index: boundedIndex,
      previews,
      lineage: [],
      lineagePreviews: {},
      loading: !previews[attachment.id],
      error: ''
    });
    await loadSpotlightPreview(attachment);
  };

  const showSpotlightIndex = (nextIndex: number): void => {
    if (!spotlight?.attachments.length) return;
    const boundedIndex = Math.max(0, Math.min(nextIndex, spotlight.attachments.length - 1));
    const attachment = spotlight.attachments[boundedIndex];
    setSpotlight((current) => (current ? { ...current, index: boundedIndex, loading: !current.previews[attachment.id], error: '' } : current));
    void loadSpotlightPreview(attachment);
  };

  const saveSpotlightAnnotation = async (dataUrl: string): Promise<void> => {
    if (!bug || !spotlight || !currentSpotlightAttachment) return;
    const created = (await window.bugPocket.saveAnnotatedAttachment(currentSpotlightAttachment.id, dataUrl)) as Attachment;
    const updatedBug = await window.bugPocket.getBug(bug.id);
    const lineageData = await loadAttachmentLineage(created.id);
    setBug(updatedBug);
    setAttachmentPreviews((current) => ({ ...current, [created.id]: dataUrl }));
    setSpotlight((current) => {
      if (!current) return current;
      return {
        ...current,
        attachments: [created, ...current.attachments.filter((attachment) => attachment.id !== currentSpotlightAttachment.id)],
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
    if (nextIndex >= 0) {
      showSpotlightIndex(nextIndex);
      return;
    }
    setSpotlight((current) => current ? {
      ...current,
      attachments: [attachment, ...current.attachments],
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
      if (event.key === 'Escape') {
        event.preventDefault();
        setSpotlight(null);
      }
      if (event.key === 'ArrowLeft') showSpotlightIndex(spotlight.index - 1);
      if (event.key === 'ArrowRight') showSpotlightIndex(spotlight.index + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [spotlight]);

  const updateField = (key: keyof BugDetails, value: string | number | boolean | null, options: { trackStatus?: boolean } = {}): void => {
    setBug((current) => {
      if (!current || current[key] === value) return current;
      const nextBug = { ...current, [key]: value };
      bugRef.current = nextBug;
      isDirtyRef.current = true;
      setIsDirty(true);
      setSaveState('dirty');
      if (options.trackStatus !== false) setLastEditedField(key);
      void window.bugPocket.setDetailsDirty(true);
      return nextBug;
    });
  };

  if (!bug) return <section className="page">Loading...</section>;

  const entryDisplay = getEntryDisplay(bug);
  const detailTitleValue = entryDisplay.isDerived ? entryDisplay.title : bug.title;
  const reportBug = { ...bug, title: entryDisplay.title };

  const save = async (): Promise<void> => {
    await saveCurrentBug({ showToast: true });
  };
  const backToDashboard = async (): Promise<void> => {
    if (isDirtyRef.current) await saveCurrentBug();
    onBack();
  };
  const fieldSaveStatus = (key: keyof BugDetails): React.ReactNode => {
    if (lastEditedField !== key || (saveState !== 'saving' && saveState !== 'saved')) return null;
    return (
      <span className={`field-save-status ${saveState}`} aria-live="polite">
        {saveState === 'saving' ? 'Saving...' : 'Saved'}
      </span>
    );
  };

  const report = (templateName: string): string => generateReport(reportBug, settings.reportTemplates.find((template) => template.name === templateName));
  const copy = async (name: string): Promise<void> => {
    await window.bugPocket.copyText(report(name));
    setCopied(name);
    setTimeout(() => setCopied(''), 1200);
  };
  const openIssuePlatform = async (platform: IssuePlatformLink): Promise<void> => {
    const templateName = `${platform} Format`;
    const url = buildIssueDeepLink(platform, reportBug, report(templateName), { jiraWorkspaceUrl: settings.jiraWorkspaceUrl });
    if (!url) {
      setDetailsToast('Configure your Jira workspace URL in Settings before opening Jira.');
      window.setTimeout(() => setDetailsToast(''), 2600);
      return;
    }
    await window.bugPocket.openExternalUrl(url);
  };
  const openTicketUrl = async (): Promise<void> => {
    const url = bug.issue_url.trim();
    if (!url) return;
    await window.bugPocket.openExternalUrl(url);
  };
  const triageWithLocalAi = async (refinementNote = ''): Promise<void> => {
    if (!settings.aiTriageEnabled || triaging) return;
    const currentBug = bugRef.current ?? bug;
    if (!currentBug) return;
    const currentEntryDisplay = getEntryDisplay(currentBug);
    const currentTitle = currentEntryDisplay.isDerived ? currentEntryDisplay.title : currentBug.title;
    setAiStatus('loading');
    try {
      const imagePath = currentBug.attachments[0] ? String((await window.bugPocket.resolveAttachmentPath(currentBug.attachments[0].id)) || '') : '';
      const currentApplication = settings.applications.find((application) => application.id === currentBug.application_id);
      const currentModule = settings.modules.find((module) => module.id === currentBug.module_id);
      const response = (await window.bugPocket.triageWithOllama({
        id: currentBug.id,
        title: currentTitle,
        note: currentBug.note,
        application: currentBug.application_name || '',
        application_context: currentApplication?.context_description ?? '',
        module: currentBug.module_name || '',
        module_context: currentModule?.context_description ?? '',
        environment: currentBug.environment,
        device: currentBug.device,
        browser: currentBug.browser,
        entry_type: currentBug.entry_type,
        severity: currentBug.severity,
        status: currentBug.status,
        steps_to_reproduce: currentBug.steps_to_reproduce,
        expected_result: currentBug.expected_result,
        actual_result: currentBug.actual_result,
        other_details: currentBug.other_details,
        image_file_path: imagePath || undefined,
        refinement_note: refinementNote.trim() || undefined
      })) as AiTriageResponse;

      const nextSeverity = settings.severities.find((severity) => severity.value.toLowerCase() === response.result.severity_level.toLowerCase())?.value;
      if (response.result.bug_title.trim()) updateField('title', response.result.bug_title);
      if (response.result.refined_summary.trim()) updateField('note', response.result.refined_summary, { trackStatus: false });
      if (nextSeverity) updateField('severity', nextSeverity, { trackStatus: false });
      if (response.result.steps_to_reproduce.trim()) updateField('steps_to_reproduce', response.result.steps_to_reproduce, { trackStatus: false });
      if (response.result.expected_result.trim()) updateField('expected_result', response.result.expected_result, { trackStatus: false });
      if (response.result.actual_result.trim()) updateField('actual_result', response.result.actual_result, { trackStatus: false });
      if (response.success) {
        setAiStatus('completed');
        setShowAiRefinement(false);
        setAiRefinementNote('');
      } else {
        setAiStatus('idle');
      }
      setDetailsToast(response.success ? `Local AI triage applied with ${response.model}.` : `Local AI fallback used: ${response.error || 'Ollama unavailable.'}`);
      window.setTimeout(() => setDetailsToast(''), 3200);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Local AI triage failed.';
      setAiStatus('idle');
      setDetailsToast(message);
      window.setTimeout(() => setDetailsToast(''), 3200);
    }
  };
  const addScreenshot = async (): Promise<void> => {
    await window.bugPocket.startScreenshotCapture(bug.id);
  };
  const removeAttachment = async (attachmentId: number): Promise<void> => {
    await window.bugPocket.deleteAttachment(attachmentId);
    setBug(await window.bugPocket.getBug(bug.id));
    setSpotlight(null);
  };
  const downloadAttachment = async (attachmentId: number): Promise<void> => {
    await window.bugPocket.downloadAttachment(attachmentId) as AttachmentDownloadResult;
  };
  const deleteReport = async (): Promise<void> => {
    setDeleting(true);
    try {
      await window.bugPocket.deleteBug(bug.id);
      onBack();
    } finally {
      setDeleting(false);
    }
  };
  const convertScenarioToBug = async (): Promise<void> => {
    const updated = await window.bugPocket.updateBug(bug.id, {
      entry_type: 'Bug',
      application_id: bug.application_id,
      module_id: bug.module_id,
      environment_id: bug.environment_id,
      device_id: bug.device_id,
      browser_id: bug.browser_id,
      title: detailTitleValue,
      note: bug.note,
      other_details: bug.other_details,
      steps_to_reproduce: bug.steps_to_reproduce,
      expected_result: bug.expected_result,
      actual_result: bug.actual_result,
      status: 'Draft',
      severity: bug.severity || 'Medium',
      reported: !!bug.reported,
      issue_platform: bug.issue_platform,
      issue_id: bug.issue_id,
      issue_url: bug.issue_url,
      tags: bug.tags
    });
    setBug(updated);
    bugRef.current = updated;
    lastSavedPayloadRef.current = serializeBugUpdateInput(buildBugUpdateInput(updated));
    setIsDirty(false);
    isDirtyRef.current = false;
    void window.bugPocket.setDetailsDirty(false);
  };
  const statusOptions = statusOptionsForEntryType(bug.entry_type, settings);
  const workflowStatusOptions = getWorkflowStatusOptions(statusOptions, bug.status);
  const currentStatusIndex = Math.max(0, workflowStatusOptions.findIndex((status) => status.value === bug.status));
  const updateStatus = (status: string): void => {
    updateField('status', status as CaptureStatus);
    updateField('reported', status === 'Reported' ? 1 : 0, { trackStatus: false });
  };
  const detailModuleOptions = getModulesForApplication(settings, bug.application_id, bug.module_id);
  const changeApplication = (applicationId: number | null): void => {
    const modules = getModulesForApplication(settings, applicationId, bug.module_id);
    const currentModuleStillVisible = modules.some((module) => module.id === bug.module_id);
    updateField('application_id', applicationId);
    if (!currentModuleStillVisible) updateField('module_id', modules[0]?.id ?? null, { trackStatus: false });
  };

  return (
    <section className="page details">
      <header className="page-header">
        <div>
          <button className="text-button" onClick={() => void backToDashboard()}>Back to dashboard</button>
          <h1>{entryDisplay.title}</h1>
          {entryDisplay.preview && <p className="detail-title-preview">{entryDisplay.preview}</p>}
          <p>{bug.entry_type || 'Bug'} / {bug.environment || 'No environment'} / {bug.device || 'No device'} / {bug.browser || 'No browser'} / <SyncBadge status={bug.sync_status} /> / Created {formatDate(bug.created_at)} / Updated {formatDate(bug.updated_at)}</p>
        </div>
        <div className="header-actions">
          {bug.entry_type === 'Scenario' && <button onClick={convertScenarioToBug}>Convert to Bug</button>}
          {confirmingDelete ? (
            <div className="delete-confirm-actions">
              <span>Delete this report?</span>
              <button className="danger" disabled={deleting} onClick={() => void deleteReport()}><Trash2 size={16} /> Yes</button>
              <button disabled={deleting} onClick={() => setConfirmingDelete(false)}>No</button>
            </div>
          ) : (
            <button className="danger delete-report-button" onClick={() => setConfirmingDelete(true)}><Trash2 size={16} strokeWidth={2.5} /> Delete Report</button>
          )}
          <button className="primary save-detail-button" onClick={save}><Save size={17} strokeWidth={2.5} /> Save Details</button>
        </div>
      </header>
      <div className="detail-workflow" aria-label="Report workflow">
        <div className="workflow-steps">
          {workflowStatusOptions.map((status, index) => (
            <button
              className={[
                'workflow-step',
                'workflow-step-button',
                index < currentStatusIndex ? 'complete' : '',
                status.value === bug.status ? 'active' : ''
              ].filter(Boolean).join(' ')}
              key={`${status.type}-${status.value}`}
              onClick={() => updateStatus(status.value)}
              type="button"
            >
              {status.value}
            </button>
          ))}
        </div>
        <div className="workflow-pill-controls">
          <div className="field-with-status pill-field-status">
            <PillDropdown
              label="Severity"
              value={bug.severity}
              options={settings.severities.map((severity) => ({ value: severity.value, label: severity.value }))}
              colorClass={severityPillClass(bug.severity)}
              onChange={(value) => updateField('severity', value)}
            />
            {fieldSaveStatus('severity')}
          </div>
          <div className="field-with-status pill-field-status">
            <PillDropdown
              label="Status"
              value={bug.status}
              options={statusOptions.map((status) => ({ value: status.value, label: status.value }))}
              colorClass={statusPillClass(bug.status)}
              onChange={updateStatus}
            />
            {fieldSaveStatus('status')}
          </div>
          <div className="issue-ticket-control">
            <span>Issue</span>
            <button
              className="open-ticket-button"
              disabled={!bug.issue_url.trim()}
              onClick={() => void openTicketUrl()}
              title={bug.issue_url.trim() ? `Open ${bug.issue_url}` : 'Add an Issue URL to enable this ticket link'}
              type="button"
            >
              {bug.issue_id.trim() || 'Open Ticket'}
            </button>
          </div>
        </div>
      </div>
      <div className="detail-grid">
        <div className="panel form-panel detail-narrative-panel">
          <label className="field-with-status">Title<input value={detailTitleValue} onChange={(event) => updateField('title', event.target.value)} placeholder={entryDisplay.title} />{fieldSaveStatus('title')}</label>
          <div className="detail-config-grid">
            <div className="field-with-status">
              <OptionSelect
                label="Entry Type"
                value={bug.entry_type || 'Bug'}
                options={settings.entryTypes}
                onChange={(value) => {
                  updateField('entry_type', value);
                  updateField('status', 'Draft', { trackStatus: false });
                }}
              />
              {fieldSaveStatus('entry_type')}
            </div>
            <label className="field-with-status">Application<select value={bug.application_id ?? ''} onChange={(event) => changeApplication(Number(event.target.value) || null)}>{settings.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}</select>{fieldSaveStatus('application_id')}</label>
            <label className="field-with-status">Module<select value={bug.module_id ?? ''} onChange={(event) => updateField('module_id', Number(event.target.value) || null)}><option value="">No module</option>{detailModuleOptions.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select>{fieldSaveStatus('module_id')}</label>
            <div className="field-with-status"><ReferenceSelect label="Environment" value={bug.environment_id} options={settings.environments} onChange={(value) => updateField('environment_id', value)} />{fieldSaveStatus('environment_id')}</div>
            <div className="field-with-status"><ReferenceSelect label="Device" value={bug.device_id} options={settings.devices} onChange={(value) => updateField('device_id', value)} />{fieldSaveStatus('device_id')}</div>
            <div className="field-with-status"><ReferenceSelect label="Browser" value={bug.browser_id} options={settings.browsers} onChange={(value) => updateField('browser_id', value)} />{fieldSaveStatus('browser_id')}</div>
          </div>
          <label className="field-with-status">Bug Note<textarea value={bug.note} onChange={(event) => updateField('note', event.target.value)} />{fieldSaveStatus('note')}</label>
          <label className="field-with-status">Steps to Reproduce<textarea value={bug.steps_to_reproduce} onChange={(event) => updateField('steps_to_reproduce', event.target.value)} placeholder="Add steps to reproduce." />{fieldSaveStatus('steps_to_reproduce')}</label>
          <label className="field-with-status">Expected Result<textarea value={bug.expected_result} onChange={(event) => updateField('expected_result', event.target.value)} placeholder="Add the expected behavior." />{fieldSaveStatus('expected_result')}</label>
          <label className="field-with-status">Actual Result<textarea value={bug.actual_result} onChange={(event) => updateField('actual_result', event.target.value)} placeholder="Defaults to the bug note if blank." />{fieldSaveStatus('actual_result')}</label>
          <label className="field-with-status">Other Details<textarea value={bug.other_details} onChange={(event) => updateField('other_details', event.target.value)} />{fieldSaveStatus('other_details')}</label>
        </div>
        <aside className="panel detail-routing-panel">
          <div className="detail-sidebar-section attachments-section">
            <div className="panel-heading">
              <h2>Attachments</h2>
              <button onClick={addScreenshot}><Camera size={16} /> Add Screenshot</button>
            </div>
            <div className="screenshots">
              {bug.attachments.map((attachment, index) => (
                <figure key={attachment.id}>
                  {attachmentPreviews[attachment.id] ? (
                    <button className="screenshot-preview-button" type="button" onClick={() => void openAttachmentSpotlight(index)} aria-label={`Open ${attachment.file_name ?? 'attachment'} preview`}>
                      <img src={attachmentPreviews[attachment.id]} alt={attachment.file_name} />
                    </button>
                  ) : (
                    <div className="screenshot-placeholder">Preview loading...</div>
                  )}
                  <figcaption>
                    <span>{attachment.file_name} / {attachment.source_type}</span>
                    <SyncBadge status={attachment.sync_status} />
                    <span className="attachment-actions">
                      <button className="icon-button" title="Download screenshot" onClick={() => void downloadAttachment(attachment.id)}><Download size={15} /></button>
                      <button className="icon-button danger" title="Remove attachment" onClick={() => removeAttachment(attachment.id)}><Trash2 size={15} /></button>
                    </span>
                  </figcaption>
                </figure>
              ))}
              {!bug.attachments.length && <p className="muted">No screenshots attached.</p>}
            </div>
          </div>

          <div className="detail-sidebar-section external-tracking">
            <h2>External Tracking</h2>
            <div className="field-with-status"><OptionSelect label="Issue Platform" value={bug.issue_platform} options={settings.issuePlatforms} onChange={(value) => updateField('issue_platform', value)} />{fieldSaveStatus('issue_platform')}</div>
            <div className="two-col tracking-id-url">
              <label className="field-with-status">Issue ID<input value={bug.issue_id} onChange={(event) => updateField('issue_id', event.target.value)} />{fieldSaveStatus('issue_id')}</label>
              <label className="field-with-status">Issue URL<input value={bug.issue_url} onChange={(event) => updateField('issue_url', event.target.value)} />{fieldSaveStatus('issue_url')}</label>
            </div>
            <label className="field-with-status">Tags<input value={bug.tags} onChange={(event) => updateField('tags', event.target.value)} placeholder="login, regression, visual" />{fieldSaveStatus('tags')}</label>
          </div>

          <div className="detail-sidebar-section report-actions-section">
            <h2>Generated report preview</h2>
            <textarea
              className="report-preview"
              readOnly
              value={generateReport(reportBug, settings.reportTemplates.find((template) => template.name === 'Full Bug Report'))}
            />
            <div className="copy-grid">
              {settings.aiTriageEnabled && (
                <div className="ai-triage-panel">
                  {aiStatus !== 'completed' ? (
                    <button className="ai-triage-button" disabled={triaging} onClick={() => void triageWithLocalAi()}>
                      <Gauge size={16} /> {triaging ? 'Triaging...' : 'Triage with Local AI'}
                    </button>
                  ) : (
                    <>
                      <button className="ai-triage-button secondary" disabled={triaging} onClick={() => setShowAiRefinement((visible) => !visible)}>
                        <Gauge size={16} /> {triaging ? 'Refining...' : 'Refine AI Draft'}
                      </button>
                      {showAiRefinement && (
                        <div className="ai-refinement-box">
                          <textarea
                            value={aiRefinementNote}
                            onChange={(event) => setAiRefinementNote(event.target.value)}
                            placeholder="E.g., Make the title more concise, or add step 4..."
                          />
                          <button disabled={triaging || !aiRefinementNote.trim()} onClick={() => void triageWithLocalAi(aiRefinementNote)}>
                            Submit Correction
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {['Quick Report', 'Full Bug Report', 'Linear Format', 'Jira Format'].map((name) => (
                <button key={name} onClick={() => copy(name)}>{copied === name ? <Check size={16} /> : <Clipboard size={16} />} Copy {name}</button>
              ))}
              <button onClick={() => openIssuePlatform('Linear')}><ChevronRight size={16} /> Open Linear</button>
              <button onClick={() => openIssuePlatform('Jira')}><ChevronRight size={16} /> Open Jira</button>
            </div>
          </div>
        </aside>
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
              {!spotlight.loading && currentSpotlightPreview && currentSpotlightAttachment && (
                <ScreenshotAnnotator
                  activeAttachmentId={currentSpotlightAttachment.id}
                  imageDataUrl={currentSpotlightPreview}
                  fileName={currentSpotlightAttachment.file_name}
                  versionHistory={spotlight.lineage}
                  versionPreviews={spotlight.lineagePreviews}
                  onSelectVersion={(attachment) => void selectSpotlightVersion(attachment)}
                  onSave={saveSpotlightAnnotation}
                />
              )}
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
      {detailsToast && <div className="toast">{detailsToast}</div>}
    </section>
  );
}

type SettingsSegment = 'preferences' | 'taxonomy' | 'outbound';

const settingsSegments: Array<{ id: SettingsSegment; label: string; description: string }> = [
  { id: 'preferences', label: 'Preferences', description: 'Capture behavior, shortcuts, and presets' },
  { id: 'taxonomy', label: 'Taxonomy', description: 'Applications, modules, statuses, and field values' },
  { id: 'outbound', label: 'Outbound', description: 'Issue platforms, Jira, and report templates' }
];

const restorePendingKey = 'bugPocket.restorePending';
const restoreSuccessKey = 'bugPocket.restoreSuccess';
const restoreSettingsSegmentKey = 'bugPocket.restoreSettingsSegment';

function SettingsPage({ settings, refresh, route }: { settings: SettingsData; refresh: () => Promise<void>; route: string }) {
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
    if (requestedCard === 'presets') {
      setActiveSegment('preferences');
      setOpenSettingsCard('presets');
      return;
    }
    if (['entry-types', 'applications', 'modules', 'environments', 'devices', 'browsers', 'severity-values'].includes(requestedCard)) {
      setActiveSegment('taxonomy');
      setOpenSettingsCard(requestedCard);
      return;
    }
    if (['issue-platforms', 'templates', 'jira-workspace', 'ai-options'].includes(requestedCard)) {
      setActiveSegment('outbound');
      setOpenSettingsCard(requestedCard);
    }
  }, [requestedCard]);
  const toggleSettingsCard = (cardId: string): void => {
    setOpenSettingsCard((current) => (current === cardId ? null : cardId));
  };
  const showSettingsToast = (message: string): void => {
    setSettingsToast(message);
    window.setTimeout(() => setSettingsToast(''), 2600);
  };
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
            <CapturePreferencesPanel
              screenshotReviewEnabled={settings.quickCaptureAnnotateScreenshots}
              runOnSystemStartup={settings.runOnSystemStartup}
              refresh={refresh}
            />
            <PresetManager
              settings={settings}
              mutationReady={settingsMutationBridgeReady}
              refresh={refresh}
              showToast={showSettingsToast}
              open={openSettingsCard === 'presets'}
              onToggle={() => toggleSettingsCard('presets')}
            />
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
            <ModuleManager
              open={openSettingsCard === 'modules'}
              onToggle={() => toggleSettingsCard('modules')}
              applications={settings.applications}
              modules={settings.modules}
              mutationReady={settingsMutationBridgeReady}
              refresh={refresh}
              showToast={showSettingsToast}
            />
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
            <AiOptionsPanel
              enabled={settings.aiTriageEnabled}
              modelName={settings.ollamaModelName}
              mutationReady={settingsMutationBridgeReady}
              refresh={refresh}
            />
            <TemplateManager templates={settings.reportTemplates} refresh={refresh} />
          </div>
        )}
      </div>
      {settingsToast && <div className="toast">{settingsToast}</div>}
    </section>
  );
}

function CapturePreferencesPanel({
  screenshotReviewEnabled,
  runOnSystemStartup,
  refresh
}: {
  screenshotReviewEnabled: boolean;
  runOnSystemStartup: boolean;
  refresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const updatePreference = async (nextEnabled: boolean): Promise<void> => {
    setSaving(true);
    try {
      await window.bugPocket.updateQuickCaptureAnnotationReview(nextEnabled);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const updateStartupPreference = async (nextEnabled: boolean): Promise<void> => {
    setSaving(true);
    try {
      await window.bugPocket.toggleStartup(nextEnabled);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel capture-preferences-panel">
      <div className="panel-heading">
        <div>
          <h2>Capture Preferences</h2>
          <p className="settings-helper">Controls the extra screenshot review step in Quick Capture.</p>
        </div>
      </div>
      <label className="capture-preference-toggle">
        <input
          type="checkbox"
          checked={screenshotReviewEnabled}
          disabled={saving}
          onChange={(event) => void updatePreference(event.target.checked)}
        />
        <span>
          <strong>Review screenshots before attaching in Quick Capture</strong>
          <small>When enabled, snips open in the annotation editor before they are attached.</small>
        </span>
      </label>
      <label className="capture-preference-toggle">
        <input
          type="checkbox"
          checked={runOnSystemStartup}
          disabled={saving}
          onChange={(event) => void updateStartupPreference(event.target.checked)}
        />
        <span>
          <strong>Run on System Startup</strong>
          <small>Starts Bug Pocket with Windows and opens it hidden in the background.</small>
        </span>
      </label>
    </div>
  );
}

function JiraWorkspacePanel({ value, mutationReady, refresh }: { value: string | null; mutationReady: boolean; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState(value ?? '');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const save = async (): Promise<void> => {
    setStatus('');
    await window.bugPocket.updateJiraWorkspaceUrl(draft);
    await refresh();
    setStatus(draft.trim() ? 'Jira workspace saved.' : 'Jira workspace cleared.');
    window.setTimeout(() => setStatus(''), 1800);
  };

  return (
    <div className="panel jira-workspace-panel">
      <div className="panel-heading">
        <div>
          <h2>Jira Workspace</h2>
          <p className="settings-helper">Used by Open Jira when an entry does not already have an Issue URL.</p>
        </div>
      </div>
      <div className="jira-workspace-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          placeholder="https://your-team.atlassian.net"
          disabled={!mutationReady}
        />
        <button onClick={() => void save()} disabled={!mutationReady}>Save</button>
      </div>
      {status && <p className="settings-save-note">{status}</p>}
    </div>
  );
}

function AiOptionsPanel({
  enabled,
  modelName,
  mutationReady,
  refresh
}: {
  enabled: boolean;
  modelName: string;
  mutationReady: boolean;
  refresh: () => Promise<void>;
}) {
  const [draftModel, setDraftModel] = useState(modelName || 'qwen3-vl:8b');
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [status, setStatus] = useState('');
  const debouncedModel = useDebounce(draftModel, 700);

  useEffect(() => {
    setDraftModel(modelName || 'qwen3-vl:8b');
  }, [modelName]);

  useEffect(() => {
    setLocalEnabled(enabled);
  }, [enabled]);

  const saveOptions = async (nextEnabled: boolean, nextModel: string): Promise<void> => {
    if (!mutationReady) return;
    const cleanedModel = nextModel.trim() || 'qwen3-vl:8b';
    await window.bugPocket.updateAiTriageOptions(nextEnabled, cleanedModel);
    await refresh();
    setStatus('AI options saved.');
    window.setTimeout(() => setStatus(''), 1400);
  };

  useEffect(() => {
    if (!mutationReady) return;
    const cleanedDraft = debouncedModel.trim() || 'qwen3-vl:8b';
    if (cleanedDraft === (modelName || 'qwen3-vl:8b')) return;
    void saveOptions(localEnabled, cleanedDraft);
  }, [debouncedModel]);

  const toggleEnabled = async (nextEnabled: boolean): Promise<void> => {
    setLocalEnabled(nextEnabled);
    await saveOptions(nextEnabled, draftModel);
  };

  return (
    <div className="panel ai-options-panel">
      <div className="panel-heading">
        <div>
          <h2>Local AI Triage</h2>
          <p className="settings-helper">Optional Ollama-powered triage. Nothing is sent unless you click the AI action in an entry.</p>
        </div>
      </div>
      <label className="capture-preference-toggle">
        <input
          type="checkbox"
          checked={localEnabled}
          disabled={!mutationReady}
          onChange={(event) => void toggleEnabled(event.target.checked)}
        />
        <span>
          <strong>Enable Triage with Local AI</strong>
          <small>Shows the local AI action in Bug Details and routes requests to Ollama on this machine.</small>
        </span>
      </label>
      <label className="ai-model-field">
        <span>Ollama model name</span>
        <input
          value={draftModel}
          disabled={!mutationReady}
          onChange={(event) => setDraftModel(event.target.value)}
          onBlur={() => void saveOptions(localEnabled, draftModel)}
          placeholder="qwen3-vl:8b"
        />
      </label>
      {status && <p className="settings-save-note">{status}</p>}
    </div>
  );
}

function DataManagementPanel({ settings, refresh, showToast }: { settings: SettingsData; refresh: () => Promise<void>; showToast: (message: string) => void }) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);

  const exportWorkspaceBackup = async (): Promise<void> => {
    setExporting(true);
    try {
      const result = (await window.bugPocket.exportBackup()) as BackupExportResult;
      if (result.canceled) return;
      if (result.success) {
        showToast('Workspace backup exported.');
        return;
      }
      showToast(result.error || 'Backup export failed.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Backup export failed.';
      showToast(message);
    } finally {
      setExporting(false);
    }
  };

  const importWorkspaceBackup = async (): Promise<void> => {
    const confirmed = window.confirm('Warning: This will overwrite your current database and attachments. The application will restart. Proceed?');
    if (!confirmed) return;
    let keepRestoreHandoff = false;
    window.sessionStorage.setItem(restorePendingKey, '1');
    window.sessionStorage.setItem(restoreSettingsSegmentKey, 'outbound');
    setImporting(true);
    try {
      const result = (await window.bugPocket.importBackup()) as BackupImportResult;
      if (result.canceled) return;
      if (result.success) {
        keepRestoreHandoff = true;
        window.sessionStorage.setItem(restoreSuccessKey, '1');
        showToast('Workspace backup restored. Reloading...');
        return;
      }
      showToast(result.error || 'Backup import failed.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Backup import failed.';
      showToast(message);
    } finally {
      if (!keepRestoreHandoff) {
        window.sessionStorage.removeItem(restorePendingKey);
        window.sessionStorage.removeItem(restoreSuccessKey);
        window.sessionStorage.removeItem(restoreSettingsSegmentKey);
      }
      setImporting(false);
    }
  };

  const chooseAutomatedBackupLocation = async (): Promise<void> => {
    setSavingLocation(true);
    try {
      const path = (await window.bugPocket.chooseBackupDirectory()) as string | null;
      if (!path) return;
      await window.bugPocket.updateAutoBackupDirectoryPath(path);
      await refresh();
      showToast('Automated backup location saved.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not save automated backup location.';
      showToast(message);
    } finally {
      setSavingLocation(false);
    }
  };

  const clearAutomatedBackupLocation = async (): Promise<void> => {
    setSavingLocation(true);
    try {
      await window.bugPocket.updateAutoBackupDirectoryPath('');
      await refresh();
      showToast('Automated backups disabled.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not clear automated backup location.';
      showToast(message);
    } finally {
      setSavingLocation(false);
    }
  };

  return (
    <>
    <div className="panel data-management-panel">
      <div className="panel-heading">
        <div>
          <h2>Data Management</h2>
          <p className="settings-helper">Export your local database and content-addressed attachments, or keep silent rolling backups in a second location.</p>
        </div>
      </div>
      <div className="data-management-stack">
        <div className="data-management-row">
          <div className="data-management-copy">
            <strong>Manual backup</strong>
            <p className="settings-helper">Choose a one-time destination for a complete `.bugpocket` backup.</p>
          </div>
          <div className="backup-transfer-actions">
            <button className="primary backup-export-button" disabled={exporting || importing} onClick={() => void exportWorkspaceBackup()}>
              <Download size={16} />
              {exporting ? 'Zipping...' : 'Export Workspace Backup'}
            </button>
            <button className="backup-import-button" disabled={exporting || importing} onClick={() => void importWorkspaceBackup()}>
              <Upload size={16} />
              {importing ? 'Restoring...' : 'Import Workspace Backup'}
            </button>
          </div>
        </div>
        <div className="data-management-row">
          <div className="data-management-copy">
            <strong>Automated Backup Location</strong>
            <p className="settings-helper">On startup, Bug Pocket writes a silent rolling backup here and keeps the latest 3 files.</p>
            <div className="backup-location-row">
              <div className="backup-location-copy">
                <span className="backup-location-title">Location Path</span>
                <p className={settings.autoBackupDirectoryPath ? 'backup-location configured' : 'backup-location'}>
                  {settings.autoBackupDirectoryPath || 'Not Configured - Auto Backups Disabled'}
                </p>
              </div>
              <div className="backup-location-actions">
                <button disabled={savingLocation} onClick={() => void chooseAutomatedBackupLocation()}>
                  {savingLocation ? 'Saving...' : 'Choose Folder'}
                </button>
                <button disabled={savingLocation || !settings.autoBackupDirectoryPath} onClick={() => void clearAutomatedBackupLocation()}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    {importing && createPortal(
      <div className="backup-restore-backdrop" role="alertdialog" aria-modal="true" aria-label="Restoring workspace backup">
        <div className="backup-restore-dialog">
          <RefreshCw className="backup-restore-spinner" size={28} />
          <div>
            <h2>Restoring workspace backup</h2>
            <p>Bug Pocket is replacing the local database and attachments. The app will reload automatically when it is done.</p>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

function SnipOverlay() {
  const [source, setSource] = useState('');
  const [drag, setDrag] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pointerDownRef = useRef(false);

  useEffect(() => {
    window.bugPocket.getScreenshotSource().then((value) => value && setSource(value));
    return window.bugPocket.onScreenshotSource(setSource);
  }, []);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  const rect = drag ? normalizeRect(drag.startX, drag.startY, drag.endX, drag.endY) : null;
  const finishFullScreen = async (): Promise<void> => {
    if (!source || isFinishing) return;
    setIsFinishing(true);
    await window.bugPocket.completeScreenshotCapture(source);
  };

  const finish = async (selection = drag): Promise<void> => {
    const finalRect = selection ? normalizeRect(selection.startX, selection.startY, selection.endX, selection.endY) : null;
    if (!source || !finalRect || finalRect.width < 8 || finalRect.height < 8 || isFinishing) return;
    setIsFinishing(true);
    const image = new Image();
    image.onload = async () => {
      const scaleX = image.naturalWidth / window.innerWidth;
      const scaleY = image.naturalHeight / window.innerHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(finalRect.width * scaleX);
      canvas.height = Math.round(finalRect.height * scaleY);
      const context = canvas.getContext('2d');
      context?.drawImage(
        image,
        finalRect.left * scaleX,
        finalRect.top * scaleY,
        finalRect.width * scaleX,
        finalRect.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );
      await window.bugPocket.completeScreenshotCapture(canvas.toDataURL('image/png'));
    };
    image.src = source;
  };

  const updateDragEnd = (clientX: number, clientY: number): void => {
    setDrag((current) => (current ? { ...current, endX: clientX, endY: clientY } : current));
  };

  return (
    <div
      ref={overlayRef}
      className="snip-overlay"
      onPointerDown={(event) => {
        if (isFinishing) return;
        overlayRef.current?.focus();
        pointerDownRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ startX: event.clientX, startY: event.clientY, endX: event.clientX, endY: event.clientY });
      }}
      onPointerMove={(event) => {
        if (pointerDownRef.current && drag && !isFinishing) updateDragEnd(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        const selection = drag ? { ...drag, endX: event.clientX, endY: event.clientY } : null;
        pointerDownRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (selection) setDrag(selection);
        void finish(selection);
      }}
      onPointerCancel={(event) => {
        pointerDownRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          void window.bugPocket.cancelScreenshotCapture();
          return;
        }
        if (event.altKey && event.key.toLowerCase() === 'c') {
          event.preventDefault();
          void finishFullScreen();
        }
      }}
      tabIndex={0}
    >
      {source && <img src={source} />}
      <div className="snip-dim" />
      {rect && <div className="snip-selection" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />}
      <div className="snip-hint">
        Drag to capture area.
        <span><kbd>Alt+C</kbd> captures full screen.</span>
        <span><kbd>Esc</kbd> cancels.</span>
      </div>
    </div>
  );
}

function ShortcutSettingsPanel({ shortcuts, refresh }: { shortcuts: ShortcutSetting[]; refresh: () => Promise<void> }) {
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState('');
  const defaultShortcuts: Record<ShortcutAction, string> = {
    quick_capture: 'CommandOrControl+Alt+P',
    main_panel: 'CommandOrControl+Alt+M'
  };

  const updateShortcut = async (shortcut: ShortcutSetting, accelerator: string, enabled = true): Promise<void> => {
    setError('');
    await window.bugPocket.updateShortcut(shortcut.action, accelerator, enabled);
    await refresh();
  };

  const resetShortcuts = async (): Promise<void> => {
    setRecordingAction(null);
    setError('');
    await window.bugPocket.updateShortcut('quick_capture', defaultShortcuts.quick_capture, true);
    await window.bugPocket.updateShortcut('main_panel', defaultShortcuts.main_panel, true);
    await refresh();
  };

  useEffect(() => {
    if (!recordingAction) return;
    void window.bugPocket.suspendShortcuts();
    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (isModifierOnlyKey(event.key)) return;
      if (event.key === 'Escape') {
        setRecordingAction(null);
        setError('');
        return;
      }
      const accelerator = eventToAccelerator(event);
      if (!accelerator) {
        setError('Use at least one modifier key plus a letter, number, or function key.');
        return;
      }
      const shortcut = shortcuts.find((item) => item.action === recordingAction);
      if (!shortcut) return;
      setRecordingAction(null);
      void updateShortcut(shortcut, accelerator, true);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      void window.bugPocket.resumeShortcuts();
    };
  }, [recordingAction, shortcuts]);

  return (
    <div className="panel shortcuts-panel">
      <div className="panel-heading">
        <h2><Keyboard size={16} /> Global Shortcuts</h2>
      </div>
      <div className="shortcut-helper-row">
        <p className="settings-helper">Recommended defaults: Ctrl+Alt+P for Quick Capture and Ctrl+Alt+M for the Main App Panel.</p>
        <button className="shortcut-reset-button" onClick={() => void resetShortcuts()}>
          <RefreshCw size={14} />
          Reset Shortcuts
        </button>
      </div>
      <div className="shortcut-list">
        {shortcuts.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.action}>
            <div className="shortcut-copy">
              <strong>{shortcut.label}</strong>
              <span>{shortcut.action === 'main_panel' ? 'Opens the Main App Panel' : 'Opens the Quick Capture Panel'}</span>
              {shortcut.registration_error && (
                <em className="shortcut-warning"><AlertTriangle size={14} /> {shortcut.registration_error}</em>
              )}
            </div>
            <kbd className={shortcut.is_enabled ? 'shortcut-kbd' : 'shortcut-kbd disabled'}>{shortcut.is_enabled ? shortcutDisplay(shortcut, 'Not set') : 'Disabled'}</kbd>
            <button onClick={() => setRecordingAction(shortcut.action)}>
              {recordingAction === shortcut.action ? 'Press keys...' : 'Record'}
            </button>
            <label className="shortcut-toggle">
              <input
                type="checkbox"
                checked={!!shortcut.is_enabled}
                onChange={(event) => void updateShortcut(shortcut, shortcut.accelerator, event.target.checked)}
              />
              Enabled
            </label>
          </div>
        ))}
      </div>
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}

interface SettingsOptionItem {
  id: number;
  label: string;
  contextDescription?: string;
  applicationId?: number | null;
  isSynced?: boolean;
}

const emptyPresetDraft: CapturePresetInput = {
  name: '',
  application_id: null,
  module_id: null,
  environment_id: null,
  entry_type_id: null
};

function PresetManager({
  settings,
  mutationReady,
  refresh,
  showToast,
  open,
  onToggle
}: {
  settings: SettingsData;
  mutationReady: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [draft, setDraft] = useState<CapturePresetInput>(emptyPresetDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const presetLimitReached = settings.presets.length >= 3 && editingId == null;
  const moduleChoices = getModulesForApplication(settings, draft.application_id, draft.module_id);

  const updateDraft = <K extends keyof CapturePresetInput>(key: K, value: CapturePresetInput[K]): void => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'application_id' && !getModulesForApplication(settings, value as number | null, next.module_id).some((module) => module.id === next.module_id)) {
        next.module_id = null;
      }
      return next;
    });
  };

  const startEdit = (preset: CapturePreset): void => {
    setEditingId(preset.id);
    setDraft({
      name: preset.name,
      application_id: preset.application_id,
      module_id: preset.module_id,
      environment_id: preset.environment_id,
      entry_type_id: preset.entry_type_id
    });
    setError('');
  };

  const reset = (): void => {
    setEditingId(null);
    setDraft(emptyPresetDraft);
    setError('');
  };

  const save = async (): Promise<void> => {
    setError('');
    try {
      if (editingId) await window.bugPocket.updatePreset(editingId, draft);
      else await window.bugPocket.createPreset(draft);
      await refresh();
      reset();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not save preset.';
      setError(message);
      if (message.includes('3 Quick Capture presets')) showToast(message);
    }
  };

  const remove = async (id: number): Promise<void> => {
    setError('');
    await window.bugPocket.deletePreset(id);
    await refresh();
    if (editingId === id) reset();
  };

  return (
    <div className={open ? 'panel settings-option-panel preset-panel open' : 'panel settings-option-panel preset-panel'}>
      <button className="settings-option-header" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>Quick Capture Presets</strong>
          <em>{settings.presets.length}/3 preset{settings.presets.length === 1 ? '' : 's'} configured</em>
        </span>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {!open && (
        <div className="settings-option-preview">
          {settings.presets.map((preset) => <span className="chip settings-preview-chip" key={preset.id}>{preset.name}</span>)}
          {!settings.presets.length && <span className="muted">No presets yet.</span>}
        </div>
      )}
      {open && (
        <div className="settings-option-body">
          <p className="settings-helper">Up to 3 presets. Quick Panel shortcuts are Alt+1, Alt+2, and Alt+3.</p>
          <div className="preset-list">
            {settings.presets.map((preset, index) => (
              <div className="preset-row" key={preset.id}>
                <div>
                  <strong>{preset.name}</strong>
                  <span>{presetSummary(preset, settings)} [{`Alt+${index + 1}`}]</span>
                </div>
                <button className="icon-button" disabled={!mutationReady} title="Edit preset" onClick={() => startEdit(preset)}><Pencil size={15} /></button>
                <button className="icon-button danger" disabled={!mutationReady} title="Delete preset" onClick={() => void remove(preset.id)}><Trash2 size={15} /></button>
              </div>
            ))}
            {!settings.presets.length && <p className="muted">No presets yet.</p>}
          </div>
          <div className="preset-form">
            <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="Preset name" disabled={!mutationReady || presetLimitReached} />
            <select value={draft.entry_type_id ?? ''} onChange={(event) => updateDraft('entry_type_id', Number(event.target.value) || null)} disabled={!mutationReady || presetLimitReached}>
              <option value="">Entry type</option>
              {settings.entryTypes.map((entryType) => <option key={entryType.id} value={entryType.id}>{entryType.value}</option>)}
            </select>
            <select value={draft.application_id ?? ''} onChange={(event) => updateDraft('application_id', Number(event.target.value) || null)} disabled={!mutationReady || presetLimitReached}>
              <option value="">Application</option>
              {settings.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}
            </select>
            <select value={draft.module_id ?? ''} onChange={(event) => updateDraft('module_id', Number(event.target.value) || null)} disabled={!mutationReady || presetLimitReached}>
              <option value="">Module</option>
              {moduleChoices.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
            </select>
            <select value={draft.environment_id ?? ''} onChange={(event) => updateDraft('environment_id', Number(event.target.value) || null)} disabled={!mutationReady || presetLimitReached}>
              <option value="">Environment</option>
              {settings.environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.value}</option>)}
            </select>
            <button disabled={!mutationReady || presetLimitReached || !draft.name.trim()} onClick={() => void save()}>{editingId ? 'Save Preset' : 'Create Preset'}</button>
            {editingId && <button onClick={reset}>Cancel</button>}
          </div>
          {presetLimitReached && <p className="settings-helper">Preset limit reached. Edit or delete a preset to create another.</p>}
          {error && <p className="settings-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ModuleManager({
  open,
  onToggle,
  applications,
  modules,
  mutationReady,
  refresh,
  showToast
}: {
  open: boolean;
  onToggle: () => void;
  applications: Application[];
  modules: Module[];
  mutationReady: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string) => void;
}) {
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(applications[0]?.id ?? null);
  const [value, setValue] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editContext, setEditContext] = useState('');
  const editContextRef = useRef('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (selectedApplicationId == null && applications[0]) setSelectedApplicationId(applications[0].id);
    if (selectedApplicationId != null && !applications.some((application) => application.id === selectedApplicationId)) {
      setSelectedApplicationId(applications[0]?.id ?? null);
    }
  }, [applications, selectedApplicationId]);

  const selectedApplication = applications.find((application) => application.id === selectedApplicationId) ?? null;
  const groupedModules = applications.map((application) => ({
    application,
    modules: modules.filter((module) => module.application_id === application.id)
  }));
  const unassignedModules = modules.filter((module) => module.application_id == null);
  const previewItems = getSettingsPreviewItems(modules, (module) => module.name);
  const hiddenCount = Math.max(0, modules.length - previewItems.length);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('');
    try {
      await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not update modules.';
      if (message.includes('active preset')) showToast('Cannot delete because it is currently used by an active preset. Please update or delete the preset first.');
      setError(message);
    }
  };

  const addModule = async (): Promise<void> => {
    if (!mutationReady) {
      setError('Restart Bug Pocket to enable editing and removing settings.');
      return;
    }
    if (!selectedApplicationId) {
      setError('Choose an application before adding a module.');
      return;
    }
    if (!value.trim()) return;
    await window.bugPocket.addModule(value, selectedApplicationId);
    setValue('');
    await refresh();
  };

  const saveModule = async (module: Module, applicationId = module.application_id): Promise<void> => {
    await window.bugPocket.updateModule(module.id, editValue, applicationId ?? null, editContextRef.current);
    setEditingId(null);
    await refresh();
  };

  const startEdit = (module: Module): void => {
    if (!mutationReady) {
      setError('Restart Bug Pocket to enable editing and removing settings.');
      return;
    }
    setEditingId(module.id);
    setEditValue(module.name);
    editContextRef.current = module.context_description ?? '';
    setEditContext(editContextRef.current);
    setError('');
  };

  const updateEditContext = (nextContext: string): void => {
    editContextRef.current = nextContext;
    setEditContext(nextContext);
  };

  return (
    <div className={open ? 'panel settings-option-panel module-settings-panel open' : 'panel settings-option-panel module-settings-panel'}>
      <button className="settings-option-header" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>Modules</strong>
          <em>{modules.length} option{modules.length === 1 ? '' : 's'} nested under applications</em>
        </span>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {!open && (
        <div className="settings-option-preview">
          {previewItems.map((module) => <span className="chip settings-preview-chip" key={module.id}>{module.name}</span>)}
          {hiddenCount > 0 && <span className="chip settings-preview-chip muted-chip">+{hiddenCount} more</span>}
          {!modules.length && <span className="muted">No modules configured.</span>}
        </div>
      )}
      {open && (
        <div className="settings-option-body">
          <div className="module-add-row">
            <select value={selectedApplicationId ?? ''} onChange={(event) => setSelectedApplicationId(Number(event.target.value) || null)}>
              {applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}
            </select>
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={selectedApplication ? `Add module for ${selectedApplication.name}` : 'Choose an application'} />
            <button title="Add module" onClick={() => run(addModule)}><Plus size={16} /></button>
          </div>
          <div className="module-group-list">
            {groupedModules.map(({ application, modules: applicationModules }) => (
              <section className="module-group" key={application.id}>
                <h3>{application.name}</h3>
                <div className="option-list">
                  {applicationModules.map((module) => (
                    <div className="option-row module-option-row" key={module.id}>
                      {editingId === module.id ? (
                        <div className="option-edit-stack">
                          <div className="option-edit-row">
                            <input
                              className="option-edit-input"
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void run(async () => saveModule(module, application.id));
                                if (event.key === 'Escape') setEditingId(null);
                              }}
                            />
                            <button className="icon-button" title="Save module" onClick={() => run(async () => saveModule(module, application.id))}><Check size={15} /></button>
                            <button className="icon-button" title="Cancel edit" onClick={() => setEditingId(null)}><X size={15} /></button>
                          </div>
                          <label className="context-description-field">
                            <span>Context / Business Logic</span>
                            <textarea value={editContext} onChange={(event) => updateEditContext(event.target.value)} />
                            <button className="context-save-button" type="button" onClick={() => run(async () => {
                              await window.bugPocket.updateModuleContext(module.id, editContextRef.current);
                              setEditingId(null);
                              await refresh();
                            })}>Save Context</button>
                          </label>
                        </div>
                      ) : (
                        <>
                          <span className="option-name">{module.name}</span>
                          <button className="icon-button" disabled={!mutationReady} title="Edit module" onClick={() => startEdit(module)}><Pencil size={15} /></button>
                          <button className="icon-button danger" disabled={!mutationReady} title="Remove module" onClick={() => run(async () => { await window.bugPocket.deleteModule(module.id); await refresh(); })}><Trash2 size={15} /></button>
                        </>
                      )}
                    </div>
                  ))}
                  {!applicationModules.length && <p className="muted">No modules for this application yet.</p>}
                </div>
              </section>
            ))}
            {unassignedModules.length > 0 && (
              <section className="module-group">
                <h3>Unassigned modules</h3>
                <p className="muted module-group-note">Older modules without an application. Edit one to keep it here, or recreate it under an application.</p>
                <div className="option-list">
                  {unassignedModules.map((module) => (
                    <div className="option-row module-option-row" key={module.id}>
                      {editingId === module.id ? (
                        <div className="option-edit-stack">
                          <div className="option-edit-row">
                            <input
                              className="option-edit-input"
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void run(async () => saveModule(module));
                                if (event.key === 'Escape') setEditingId(null);
                              }}
                            />
                            <button className="icon-button" title="Save module" onClick={() => run(async () => saveModule(module))}><Check size={15} /></button>
                            <button className="icon-button" title="Cancel edit" onClick={() => setEditingId(null)}><X size={15} /></button>
                          </div>
                          <label className="context-description-field">
                            <span>Context / Business Logic</span>
                            <textarea value={editContext} onChange={(event) => updateEditContext(event.target.value)} />
                            <button className="context-save-button" type="button" onClick={() => run(async () => {
                              await window.bugPocket.updateModuleContext(module.id, editContextRef.current);
                              setEditingId(null);
                              await refresh();
                            })}>Save Context</button>
                          </label>
                        </div>
                      ) : (
                        <>
                          <span className="option-name">{module.name}</span>
                          <button className="icon-button" disabled={!mutationReady} title="Edit module" onClick={() => startEdit(module)}><Pencil size={15} /></button>
                          <button className="icon-button danger" disabled={!mutationReady} title="Remove module" onClick={() => run(async () => { await window.bugPocket.deleteModule(module.id); await refresh(); })}><Trash2 size={15} /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}

function OptionManager({
  title,
  open,
  onToggle,
  mutationReady,
  items,
  onAdd,
  onUpdate,
  onUpdateContext,
  onDelete,
  onMerge,
  onToggleSync
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  mutationReady: boolean;
  items: SettingsOptionItem[];
  onAdd: (value: string) => Promise<void>;
  onUpdate: (id: number, value: string, item: SettingsOptionItem) => Promise<void>;
  onUpdateContext?: (id: number, contextDescription: string, item: SettingsOptionItem) => Promise<void>;
  onDelete: (id: number, item: SettingsOptionItem) => Promise<void>;
  onMerge?: (sourceId: number, targetId: number, sourceItem: SettingsOptionItem, targetItem: SettingsOptionItem) => Promise<void>;
  onToggleSync?: (id: number, isSynced: boolean, item: SettingsOptionItem) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editContext, setEditContext] = useState('');
  const editContextRef = useRef('');
  const [mergingId, setMergingId] = useState<number | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const previewItems = getSettingsPreviewItems(items, (item) => item.label);
  const hiddenCount = Math.max(0, items.length - previewItems.length);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update setting.');
    }
  };

  const startEdit = (item: SettingsOptionItem): void => {
    if (!mutationReady) {
      setError('Restart Bug Pocket to enable editing and removing settings.');
      return;
    }
    setEditingId(item.id);
    setMergingId(null);
    setEditValue(item.label);
    editContextRef.current = item.contextDescription ?? '';
    setEditContext(editContextRef.current);
    setError('');
  };

  const updateEditContext = (nextContext: string): void => {
    editContextRef.current = nextContext;
    setEditContext(nextContext);
  };

  const saveEditedItem = async (item: SettingsOptionItem): Promise<void> => {
    await onUpdate(item.id, editValue, { ...item, contextDescription: editContextRef.current });
    setEditingId(null);
  };

  const saveContextOnly = async (item: SettingsOptionItem): Promise<void> => {
    if (onUpdateContext) {
      await onUpdateContext(item.id, editContextRef.current, item);
    } else {
      await saveEditedItem(item);
    }
    setEditingId(null);
  };

  const startMerge = (item: SettingsOptionItem): void => {
    if (!mutationReady || !onMerge) {
      setError('Restart Bug Pocket to enable merging settings.');
      return;
    }
    const firstTarget = items.find((option) => option.id !== item.id);
    if (!firstTarget) {
      setError('Add another option before merging.');
      return;
    }
    setEditingId(null);
    setMergingId(item.id);
    setMergeTargetId(firstTarget.id);
    setError('');
  };

  return (
    <div className={open ? 'panel settings-option-panel open' : 'panel settings-option-panel'}>
      <button className="settings-option-header" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>{title}</strong>
          <em>{items.length} option{items.length === 1 ? '' : 's'}</em>
        </span>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {!open && (
        <div className="settings-option-preview">
          {previewItems.map((item) => <span className="chip settings-preview-chip" key={item.id}>{item.label}</span>)}
          {hiddenCount > 0 && <span className="chip settings-preview-chip muted-chip">+{hiddenCount} more</span>}
          {!items.length && <span className="muted">No options configured.</span>}
        </div>
      )}
      {open && (
        <div className="settings-option-body">
          <div className="add-row">
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={`Add ${title.toLowerCase()}`} />
            <button title={`Add ${title}`} onClick={() => run(async () => { if (value.trim()) { await onAdd(value); setValue(''); } })}><Plus size={16} /></button>
          </div>
          <div className="option-list">
            {items.map((item) => (
              <div className={[onMerge ? 'has-merge' : '', onToggleSync ? 'has-sync-toggle' : '', 'option-row'].filter(Boolean).join(' ')} key={item.id}>
                {editingId === item.id ? (
                  <div className="option-edit-stack">
                    <div className="option-edit-row">
                      <input
                        className="option-edit-input"
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            void run(async () => {
                              await saveEditedItem(item);
                            });
                          }
                          if (event.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <button className="icon-button" title="Save option" onClick={() => run(async () => saveEditedItem(item))}><Check size={15} /></button>
                      <button className="icon-button" title="Cancel edit" onClick={() => setEditingId(null)}><X size={15} /></button>
                    </div>
                    {item.contextDescription !== undefined && (
                      <label className="context-description-field">
                        <span>Context / Business Logic</span>
                        <textarea value={editContext} onChange={(event) => updateEditContext(event.target.value)} />
                        <button className="context-save-button" type="button" onClick={() => run(async () => saveContextOnly(item))}>Save Context</button>
                      </label>
                    )}
                  </div>
                ) : mergingId === item.id ? (
                  <>
                    <span className="option-name">Merge "{item.label}" into</span>
                    <select
                      className="option-merge-select"
                      value={mergeTargetId ?? ''}
                      onChange={(event) => setMergeTargetId(Number(event.target.value) || null)}
                    >
                      {items.filter((target) => target.id !== item.id).map((target) => (
                        <option key={target.id} value={target.id}>{target.label}</option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      title="Confirm merge"
                      onClick={() => run(async () => {
                        const target = items.find((candidate) => candidate.id === mergeTargetId);
                        if (!target || !onMerge) throw new Error('Choose a target option.');
                        await onMerge(item.id, target.id, item, target);
                        setMergingId(null);
                      })}
                    >
                      <Check size={15} />
                    </button>
                    <button className="icon-button" title="Cancel merge" onClick={() => setMergingId(null)}><X size={15} /></button>
                  </>
                ) : (
                  <>
                    <span className="option-name">{item.label}</span>
                    {onToggleSync && (
                      <label className="option-sync-toggle" title="Allow this application's records to enter the future sync queue">
                        <input
                          type="checkbox"
                          checked={item.isSynced ?? true}
                          disabled={!mutationReady}
                          onChange={(event) => run(async () => onToggleSync(item.id, event.target.checked, item))}
                        />
                        Sync
                      </label>
                    )}
                    <button className="icon-button" disabled={!mutationReady} title="Edit option" onClick={() => startEdit(item)}><Pencil size={15} /></button>
                    {onMerge && <button className="icon-button" disabled={!mutationReady || items.length < 2} title="Merge option" onClick={() => startMerge(item)}><RefreshCw size={15} /></button>}
                    <button className="icon-button danger" disabled={!mutationReady} title="Remove option" onClick={() => run(async () => onDelete(item.id, item))}><Trash2 size={15} /></button>
                  </>
                )}
              </div>
            ))}
            {!items.length && <p className="muted">No options configured.</p>}
          </div>
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}

function hasSettingsMutationBridge(): boolean {
  const api = window.bugPocket as typeof window.bugPocket & Record<string, unknown>;
  return (
    typeof api.updateApplication === 'function' &&
    typeof api.updateApplicationContext === 'function' &&
    typeof api.updateApplicationSync === 'function' &&
    typeof api.deleteApplication === 'function' &&
    typeof api.updateModule === 'function' &&
    typeof api.updateModuleContext === 'function' &&
    typeof api.deleteModule === 'function' &&
    typeof api.updateEnvironment === 'function' &&
    typeof api.deleteEnvironment === 'function' &&
    typeof api.mergeReference === 'function' &&
    typeof api.updateDevice === 'function' &&
    typeof api.deleteDevice === 'function' &&
    typeof api.updateBrowser === 'function' &&
    typeof api.deleteBrowser === 'function' &&
    typeof api.updateConfigOption === 'function' &&
    typeof api.deleteConfigOption === 'function' &&
    typeof api.createPreset === 'function' &&
    typeof api.updatePreset === 'function' &&
    typeof api.deletePreset === 'function'
  );
}

function TemplateManager({ templates, refresh }: { templates: ReportTemplate[]; refresh: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<number | null>(templates[0]?.id ?? null);
  const selected = useMemo(() => templates.find((template) => template.id === selectedId) ?? templates[0], [templates, selectedId]);
  const [name, setName] = useState(selected?.name ?? '');
  const [templateText, setTemplateText] = useState(selected?.template_text ?? '');

  useEffect(() => {
    setName(selected?.name ?? '');
    setTemplateText(selected?.template_text ?? '');
  }, [selected?.id]);

  return (
    <div className="panel template-panel">
      <h2>Report Templates</h2>
      <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(Number(event.target.value))}>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <textarea value={templateText} onChange={(event) => setTemplateText(event.target.value)} />
      <button className="primary" onClick={async () => { await window.bugPocket.saveTemplate(selected?.id ?? null, name, templateText); await refresh(); }}><Save size={16} /> Save Template</button>
    </div>
  );
}

function Select({ label, value, onChange, children, disabled = false }: { label: string; value: string | number; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return <label className="compact-select">{label}<select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

interface PillDropdownOption {
  value: string;
  label: string;
}

function PillDropdown({
  label,
  value,
  options,
  colorClass,
  onChange
}: {
  label: string;
  value: string;
  options: PillDropdownOption[];
  colorClass: string;
  onChange: (value: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const visibleOptions = options.length ? options : [{ value, label: value || 'Unset' }];
  const selectedLabel = visibleOptions.find((option) => option.value === value)?.label ?? value ?? 'Unset';
  const longestLabelLength = Math.max(...visibleOptions.map((option) => option.label.length), selectedLabel.length, label.length);
  const pillWidth = `calc(${longestLabelLength}ch + 46px)`;

  useEffect(() => {
    if (!open) return;
    const updatePosition = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: rect.left,
        minWidth: rect.width
      });
    };
    const closeOnOutside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    updatePosition();
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className="pill-dropdown">
      <span>{label}</span>
      <button
        ref={buttonRef}
        className={`state-pill ${colorClass}`}
        style={{ width: pillWidth }}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        {selectedLabel}
        <ChevronDown size={14} />
      </button>
      {open && createPortal(
        <div className="pill-dropdown-menu" role="listbox" ref={menuRef} style={menuStyle}>
          {visibleOptions.map((option) => (
            <button
              key={`${label}-${option.value}`}
              className={option.value === value ? 'active' : ''}
              role="option"
              aria-selected={option.value === value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function OptionSelect({ label, value, options, onChange }: { label: string; value: string; options: ConfigOption[]; onChange: (value: string) => void }) {
  const visibleOptions = options.length ? options : [fallbackOption(value || 'Bug')];
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{visibleOptions.map((option) => <option key={`${option.type}-${option.id}-${option.value}`} value={option.value}>{option.value}</option>)}</select></label>;
}

function ReferenceSelect({ label, value, options, onChange }: { label: string; value: number | null; options: ReferenceOption[]; onChange: (value: number | null) => void }) {
  return (
    <label>
      {label}
      <select value={value ?? ''} onChange={(event) => onChange(Number(event.target.value) || null)}>
        <option value="">No {label.toLowerCase()}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.value}</option>)}
      </select>
    </label>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

function SyncBadge({ status }: { status: SyncStatus }) {
  return <span className={`sync-badge ${syncClass(status)}`}>{status || 'Local Only'}</span>;
}

function formatTableDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit' }).format(new Date(value));
}

function getSettingsPreviewItems<T>(items: T[], labelFor: (item: T) => string): T[] {
  if (items.length <= 4) return items;
  const maxPreviewTextUnits = 34;
  const moreChipUnits = 8;
  const preview: T[] = [];
  let usedUnits = 0;

  for (const item of items) {
    const labelUnits = Math.min(labelFor(item).trim().length, 18);
    const separatorUnits = preview.length ? 2 : 0;
    if (preview.length && usedUnits + separatorUnits + labelUnits + moreChipUnits > maxPreviewTextUnits) break;
    preview.push(item);
    usedUnits += separatorUnits + labelUnits;
  }

  return preview.length ? preview : items.slice(0, 1);
}

function getModulesForApplication(settings: SettingsData, applicationId: number | null, currentModuleId?: number | null): Module[] {
  const modules = settings.modules.filter((module) => (applicationId ? module.application_id === applicationId : true));
  if (currentModuleId && !modules.some((module) => module.id === currentModuleId)) {
    const currentModule = settings.modules.find((module) => module.id === currentModuleId);
    if (currentModule) return [...modules, currentModule];
  }
  return modules;
}

function presetSummary(preset: CapturePreset, settings: SettingsData): string {
  const parts = [
    settings.entryTypes.find((entryType) => entryType.id === preset.entry_type_id)?.value,
    settings.applications.find((application) => application.id === preset.application_id)?.name,
    settings.modules.find((module) => module.id === preset.module_id)?.name,
    settings.environments.find((environment) => environment.id === preset.environment_id)?.value
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'No fields mapped';
}

function getEntryDisplay(bug: Bug): { title: string; preview: string; isDerived: boolean } {
  const note = normalizeEntryText(bug.note);
  const savedTitle = normalizeEntryText(bug.title);
  const oldGeneratedTitle = getLegacyGeneratedTitle(bug.note);
  const isDerived =
    !savedTitle ||
    savedTitle === 'Untitled bug' ||
    normalizedCompare(savedTitle) === normalizedCompare(note) ||
    normalizedCompare(savedTitle) === normalizedCompare(oldGeneratedTitle);
  const title = isDerived ? deriveEntryTitle(bug.note) : savedTitle;
  return { title, preview: deriveEntryPreview(bug.note, title), isDerived };
}

function deriveEntryTitle(note: string): string {
  const normalized = normalizeEntryText(note);
  if (!normalized) return 'Untitled entry';

  const colonIndex = normalized.indexOf(':');
  if (colonIndex > -1) {
    const beforeColon = normalized.slice(0, colonIndex).trim();
    if (beforeColon.length >= 6 && beforeColon.length <= 80) return beforeColon;
  }

  const sentence = normalized.match(/^(.{12,90}?[.!?])(?:\s|$)/)?.[1]?.trim();
  if (sentence) return sentence.replace(/[.!?]+$/, '');

  const words = normalized.split(/\s+/).slice(0, 8).join(' ');
  if (!words) return 'Untitled entry';
  return words.length > 70 ? `${words.slice(0, 67).trimEnd()}...` : words;
}

function deriveEntryPreview(note: string, title: string): string {
  const normalized = normalizeEntryText(note);
  const cleanedTitle = normalizeEntryText(title);
  if (!normalized || normalizedCompare(normalized) === normalizedCompare(cleanedTitle)) return '';

  const withoutPrefix = removeTitlePrefix(normalized, cleanedTitle);
  if (!withoutPrefix || normalizedCompare(withoutPrefix) === normalizedCompare(cleanedTitle)) return '';
  return withoutPrefix;
}

function removeTitlePrefix(note: string, title: string): string {
  const lowerNote = note.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (!lowerNote.startsWith(lowerTitle)) return note;
  return note
    .slice(title.length)
    .replace(/^\s*[:.!?-]\s*/, '')
    .trim();
}

function getLegacyGeneratedTitle(note: string): string {
  const firstLine = note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'Untitled bug';
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function normalizeEntryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedCompare(value: string): string {
  return normalizeEntryText(value).toLowerCase();
}

function shortcutDisplay(shortcut: ShortcutSetting | undefined, fallback = 'Not set'): string {
  if (!shortcut?.accelerator) return fallback;
  return shortcut.accelerator.replace(/CommandOrControl/g, 'Ctrl').replace(/\+/g, '+');
}

function eventToAccelerator(event: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const key = normalizeShortcutKey(event.key, event.code);
  if (!key || !modifiers.length) return '';
  return [...modifiers, key].join('+');
}

function isModifierOnlyKey(key: string): boolean {
  return ['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS'].includes(key);
}

function normalizeShortcutKey(key: string, code = ''): string {
  if (isModifierOnlyKey(key)) return '';
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  const letterCode = code.match(/^Key([A-Z])$/);
  if (letterCode) return letterCode[1];
  const digitCode = code.match(/^Digit([0-9])$/);
  if (digitCode) return digitCode[1];
  const numpadCode = code.match(/^Numpad([0-9])$/);
  if (numpadCode) return `num${numpadCode[1]}`;
  const aliases: Record<string, string> = {
    ' ': 'Space',
    Spacebar: 'Space',
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  };
  return aliases[key] ?? '';
}

function getActiveFilterChips(filters: BugFilters, settings: SettingsData): Array<{ label: string; value: string }> {
  const chips: Array<{ label: string; value: string }> = [];
  if (filters.entryType && filters.entryType !== 'all') chips.push({ label: 'Type', value: filters.entryType });
  if (filters.applicationId && filters.applicationId !== 'all') chips.push({ label: 'App', value: settings.applications.find((item) => item.id === filters.applicationId)?.name ?? String(filters.applicationId) });
  if (filters.moduleId && filters.moduleId !== 'all') chips.push({ label: 'Module', value: settings.modules.find((item) => item.id === filters.moduleId)?.name ?? String(filters.moduleId) });
  if (filters.environmentId && filters.environmentId !== 'all') chips.push({ label: 'Env', value: settings.environments.find((item) => item.id === filters.environmentId)?.value ?? String(filters.environmentId) });
  if (filters.status && filters.status !== 'all') chips.push({ label: 'Status', value: filters.status });
  if (filters.severity && filters.severity !== 'all') chips.push({ label: 'Severity', value: filters.severity });
  if (filters.syncStatus && filters.syncStatus !== 'all') chips.push({ label: 'Sync', value: filters.syncStatus });
  if (filters.reported && filters.reported !== 'all') chips.push({ label: 'Reported', value: filters.reported === 'reported' ? 'Yes' : 'No' });
  return chips;
}

function normalizeRect(startX: number, startY: number, endX: number, endY: number) {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  };
}

const syncStatuses: SyncStatus[] = ['Local Only', 'Sync Pending', 'Synced', 'Sync Failed'];
const captureStatusOptions: ConfigOption[] = (['Draft', 'Reported', 'Discarded'] as CaptureStatus[]).map((value, index) => ({
  id: index + 1,
  type: 'status',
  value,
  sort_order: index,
  is_active: 1
}));

function syncClass(status: SyncStatus): string {
  if (status === 'Synced') return 'synced';
  if (status === 'Sync Pending') return 'pending';
  if (status === 'Sync Failed') return 'failed';
  return 'local';
}

function severityClass(value: string): string {
  return (value || 'medium').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function severityPillClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'critical') return 'severity-critical';
  if (normalized === 'high') return 'severity-high';
  if (normalized === 'medium') return 'severity-medium';
  return 'severity-low';
}

function statusPillClass(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'reported') return 'status-reported';
  if (normalized === 'discarded') return 'status-muted';
  if (normalized === 'draft') return 'status-new';
  return 'status-new';
}

function fallbackOption(value: string): ConfigOption {
  return { id: 0, type: 'entry_type', value, sort_order: 0, is_active: 1 };
}

function uniqueOptions(options: ConfigOption[]): ConfigOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function statusOptionsForEntryType(_entryType: string, _settings: SettingsData): ConfigOption[] {
  return captureStatusOptions;
}

function getWorkflowStatusOptions(statusOptions: ConfigOption[], currentStatus: string): ConfigOption[] {
  const current = statusOptions.find((status) => status.value === currentStatus);
  return current ? statusOptions : captureStatusOptions;
}

createRoot(document.getElementById('root')!).render(<App />);
