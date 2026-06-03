import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, Clipboard, Download, Gauge, Save, Trash2, X } from 'lucide-react';
import type { AiByokConfig, AiIssueProcessResult, Attachment, AttachmentDownloadResult, BugDetails, CaptureStatus, SettingsData } from '../../../shared/types';
import { Badge, SyncBadge } from '../components/shared/Badge';
import { PillDropdown } from '../components/shared/PillDropdown';
import { useToast } from '../components/shared/ToastContext';
import { OptionSelect, ReferenceSelect } from '../components/shared/OptionSelect';
import { ScreenshotAnnotator } from '../components/ScreenshotAnnotator';
import { formatDate, generateReport, buildIssueDeepLink, IssuePlatformLink } from '../services/reports';
import {
  getEntryDisplay,
  severityPillClass,
  statusPillClass,
  statusOptionsForEntryType,
  getWorkflowStatusOptions
} from '../utils/display';
import { getModulesForApplication } from '../utils/filters';
import { formatStepsAsNumberedList } from '../utils/formatSteps';
import { buildBugUpdateInput, serializeBugUpdateInput, DetailsSaveState, AiTriageStatus } from '../utils/bugUpdate';
import { loadAttachmentLineage, SpotlightState } from '../utils/spotlight';
import { useDebounce } from '../hooks/useDebounce';


export function BugDetailsView({
  bugId,
  settings,
  onBack
}: {
  bugId: number;
  settings: SettingsData;
  onBack: () => void;
}) {
  const [bug, setBug] = useState<BugDetails | null>(null);
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<DetailsSaveState>('idle');
  const [aiStatus, setAiStatus] = useState<AiTriageStatus>('idle');
  const [byokAiReady, setByokAiReady] = useState(false);
  const [showAiRefinement, setShowAiRefinement] = useState(false);
  const [aiRefinementNote, setAiRefinementNote] = useState('');
  const [lastEditedField, setLastEditedField] = useState<keyof BugDetails | null>(null);
  const bugRef = useRef<BugDetails | null>(null);
  const isDirtyRef = useRef(false);
  const lastSavedPayloadRef = useRef('');
  const saveStateTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<BugDetails | null> | null>(null);
  const showDetailsToast = useToast();

  const currentSpotlightAttachment = spotlight?.attachments[spotlight.index] ?? null;
  const currentSpotlightPreview = currentSpotlightAttachment ? spotlight?.previews[currentSpotlightAttachment.id] ?? '' : '';
  const triaging = aiStatus === 'loading';

  useEffect(() => {
    let cancelled = false;
    const checkAiStatus = async (): Promise<void> => {
      try {
        const config = (await window.bugPocket.getAiConfig()) as AiByokConfig;
        if (!cancelled) setByokAiReady(Boolean(config?.hasApiKey || config?.apiKey));
      } catch {
        if (!cancelled) setByokAiReady(false);
      }
    };
    void checkAiStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('.spotlight-backdrop')) onBack();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

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

  useEffect(() => { bugRef.current = bug; }, [bug]);
  useEffect(() => { isDirtyRef.current = isDirty; void window.bugPocket.setDetailsDirty(isDirty); }, [isDirty]);
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
        showDetailsToast('Details already saved.');
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
        showDetailsToast('Details saved successfully.');
      }
      return updated;
    } catch (caught) {
      setSaveState('error');
      const message = caught instanceof Error ? caught.message : 'Unable to save details.';
      showDetailsToast(message, 'error');
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
    if (!bug) { setAttachmentPreviews({}); return; }
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
    return () => { cancelled = true; };
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
    setSpotlight({ bugId: bug.id, bugTitle: getEntryDisplay(bug).title, attachments: bug.attachments, index: boundedIndex, previews, lineage: [], lineagePreviews: {}, loading: !previews[attachment.id], error: '' });
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
    if (updatedBug) setBug(updatedBug);
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
    if (nextIndex >= 0) { showSpotlightIndex(nextIndex); return; }
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
      if (event.key === 'Escape') { event.preventDefault(); setSpotlight(null); }
      if (event.key === 'ArrowLeft') showSpotlightIndex(spotlight.index - 1);
      if (event.key === 'ArrowRight') showSpotlightIndex(spotlight.index + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [spotlight]);

  const updateField = (key: keyof BugDetails, value: string | number | boolean | null, options: { trackStatus?: boolean; autoSave?: boolean } = {}): void => {
    setBug((current) => {
      if (!current || current[key] === value) return current;
      const nextBug = { ...current, [key]: value };
      bugRef.current = nextBug;
      if (options.autoSave === false) {
        setSaveState('dirty');
        if (options.trackStatus !== false) setLastEditedField(key);
      } else {
        isDirtyRef.current = true;
        setIsDirty(true);
        setSaveState('dirty');
        if (options.trackStatus !== false) setLastEditedField(key);
        void window.bugPocket.setDetailsDirty(true);
      }
      return nextBug;
    });
  };

  if (!bug) return <section className="details-route-view page">Loading...</section>;

  const entryDisplay = getEntryDisplay(bug);
  const detailTitleValue = entryDisplay.isDerived ? entryDisplay.title : bug.title;
  const reportBug = { ...bug, title: entryDisplay.title };

  const save = async (): Promise<void> => { await saveCurrentBug({ showToast: true }); };
  const backToDashboard = async (): Promise<void> => { if (isDirtyRef.current) await saveCurrentBug(); onBack(); };
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
    let issueBody = report(templateName);
    const aiConfig = (await window.bugPocket.getAiConfig()) as AiByokConfig;
    if (aiConfig.hasApiKey) {
      showDetailsToast(`Formatting ${platform} issue with ${aiConfig.provider}...`, 'info');
      const aiResult = (await window.bugPocket.processIssueWithByokAi({
        rawInput: issueBody,
        taxonomy: {
          application: reportBug.application_name ?? undefined,
          module: reportBug.module_name ?? undefined,
          environment: reportBug.environment || undefined,
          user_role: reportBug.user_role || undefined,
          device: reportBug.device || undefined,
          browser: reportBug.browser || undefined,
          entry_type: reportBug.entry_type || undefined,
          severity: reportBug.severity || undefined
        }
      })) as AiIssueProcessResult;
      if (aiResult.success && aiResult.output?.trim()) {
        issueBody = aiResult.output.trim();
      } else if (aiResult.error) {
        showDetailsToast(`AI formatting skipped: ${aiResult.error}`, 'error');
      }
    }
    const url = buildIssueDeepLink(platform, reportBug, issueBody, { jiraWorkspaceUrl: settings.jiraWorkspaceUrl });
    if (!url) {
      showDetailsToast('Configure your Jira workspace URL in Settings before opening Jira.', 'error');
      return;
    }
    await window.bugPocket.openExternalUrl(url);
    if (aiConfig.hasApiKey) {
      showDetailsToast(`${platform} issue opened with AI-formatted content.`);
    }
  };
  const openTicketUrl = async (): Promise<void> => {
    const url = bug.issue_url.trim();
    if (!url) return;
    await window.bugPocket.openExternalUrl(url);
  };
  const triageWithLocalAi = async (refinementNote = ''): Promise<void> => {
    if (triaging) return;
    const currentBug = bugRef.current ?? bug;
    if (!currentBug) return;
    const currentEntryDisplay = getEntryDisplay(currentBug);
    const currentApplication = settings.applications.find((application) => application.id === currentBug.application_id);
    const currentModule = settings.modules.find((module) => module.id === currentBug.module_id);
    setAiStatus('loading');
    try {
      const imagePath = currentBug.attachments[0] ? String((await window.bugPocket.resolveAttachmentPath(currentBug.attachments[0].id)) || '') : '';
      const triageText = String(await window.bugPocket.triageBug({
        id: currentBug.id,
        title: currentEntryDisplay.title,
        note: currentBug.note,
        other_details: currentBug.other_details,
        steps_to_reproduce: currentBug.steps_to_reproduce,
        expected_result: currentBug.expected_result,
        actual_result: currentBug.actual_result,
        application: currentBug.application_name || '',
        application_context: currentApplication?.context_description ?? '',
        module: currentBug.module_name || '',
        module_context: currentModule?.context_description ?? '',
        environment: currentBug.environment,
        device: currentBug.device,
        browser: currentBug.browser,
        user_role: currentBug.user_role,
        entry_type: currentBug.entry_type,
        severity: currentBug.severity,
        status: currentBug.status,
        image_file_path: imagePath || undefined,
        refinement_note: refinementNote.trim() || undefined
      })).trim();
      if (!triageText) throw new Error('AI triage returned an empty response.');
      const cleanJsonString = triageText.match(/\{[\s\S]*\}/)?.[0] || triageText;
      let aiAppliedBug: BugDetails = currentBug;
      try {
        const triageData = JSON.parse(cleanJsonString) as Partial<Record<'title' | 'bugNote' | 'stepsToReproduce' | 'expectedResult' | 'actualResult', unknown>>;
        const title = typeof triageData.title === 'string' ? triageData.title.trim() : '';
        const bugNote = typeof triageData.bugNote === 'string' ? triageData.bugNote.trim() : '';
        const stepsToReproduce = typeof triageData.stepsToReproduce === 'string' ? triageData.stepsToReproduce.trim() : '';
        const expectedResult = typeof triageData.expectedResult === 'string' ? triageData.expectedResult.trim() : '';
        const actualResult = typeof triageData.actualResult === 'string' ? triageData.actualResult.trim() : '';
        aiAppliedBug = {
          ...currentBug,
          ...(title ? { title } : {}),
          ...(bugNote ? { note: bugNote } : {}),
          ...(stepsToReproduce ? { steps_to_reproduce: formatStepsAsNumberedList(stepsToReproduce) } : {}),
          ...(expectedResult ? { expected_result: expectedResult } : {}),
          ...(actualResult ? { actual_result: actualResult } : {})
        };
      } catch (error) {
        console.error('AI returned malformed JSON', error);
        aiAppliedBug = { ...currentBug, note: cleanJsonString };
      }

      if (saveInFlightRef.current) await saveInFlightRef.current;
      setBug(aiAppliedBug);
      bugRef.current = aiAppliedBug;
      setSaveState('saving');
      const savePromise = window.bugPocket.updateBug(aiAppliedBug.id, buildBugUpdateInput(aiAppliedBug)) as Promise<BugDetails>;
      saveInFlightRef.current = savePromise;
      let updated: BugDetails;
      try {
        updated = await savePromise;
      } finally {
        saveInFlightRef.current = null;
      }
      setBug(updated);
      bugRef.current = updated;
      lastSavedPayloadRef.current = serializeBugUpdateInput(buildBugUpdateInput(updated));
      setIsDirty(false);
      isDirtyRef.current = false;
      void window.bugPocket.setDetailsDirty(false);
      markSavedSoon();
      setAiStatus('completed');
      setShowAiRefinement(false);
      setAiRefinementNote('');
      showDetailsToast('AI Triage applied and saved.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'AI triage failed.';
      setAiStatus('idle');
      showDetailsToast(message, 'error');
    }
  };
  const addScreenshot = async (): Promise<void> => { await window.bugPocket.startScreenshotCapture(bug.id); };
  const removeAttachment = async (attachmentId: number): Promise<void> => {
    await window.bugPocket.deleteAttachment(attachmentId);
    const updated = await window.bugPocket.getBug(bug.id);
    if (updated) {
      setBug(updated);
      bugRef.current = updated;
    }
    setSpotlight(null);
  };
  const downloadAttachment = async (attachmentId: number): Promise<void> => { await window.bugPocket.downloadAttachment(attachmentId) as AttachmentDownloadResult; };
  const deleteReport = async (): Promise<void> => {
    setDeleting(true);
    try { await window.bugPocket.deleteBug(bug.id); onBack(); }
    finally { setDeleting(false); }
  };
  const convertScenarioToBug = async (): Promise<void> => {
    const convertedBug: BugDetails = { ...bug, entry_type: 'Bug', title: detailTitleValue, status: 'Draft', severity: bug.severity || 'Medium' };
    const updated = await window.bugPocket.updateBug(bug.id, buildBugUpdateInput(convertedBug));
    setBug(updated);
    bugRef.current = updated;
    lastSavedPayloadRef.current = serializeBugUpdateInput(buildBugUpdateInput(updated));
    setIsDirty(false);
    isDirtyRef.current = false;
    void window.bugPocket.setDetailsDirty(false);
  };

  const statusOptions = statusOptionsForEntryType(bug.entry_type, settings);
  const workflowStatusOptions = getWorkflowStatusOptions(statusOptions, bug.status);
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
    <section className="details-route-view page details">
      <header className="page-header">
        <div>
          <button className="text-button" onClick={() => void backToDashboard()}>Back to dashboard</button>
          <h1>{entryDisplay.title}</h1>
          {entryDisplay.preview && <p className="detail-title-preview">{entryDisplay.preview}</p>}
          <p>{bug.entry_type || 'Bug'} / {bug.environment || 'No environment'} / {bug.user_role || 'No role'} / {bug.device || 'No device'} / {bug.browser || 'No browser'} / <SyncBadge status={bug.sync_status} /> / Created {formatDate(bug.created_at)} / Updated {formatDate(bug.updated_at)}</p>
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
        <div className="workflow-steps workflow-steps-branch">
          {workflowStatusOptions.filter((status) => status.value === 'Draft').map((status) => (
            <button
              className={['workflow-step', 'workflow-step-button', bug.status !== 'Draft' ? 'complete' : '', status.value === bug.status ? 'active' : ''].filter(Boolean).join(' ')}
              key={`${status.type}-${status.value}`}
              onClick={() => updateStatus(status.value)}
              type="button"
            >
              {status.value}
            </button>
          ))}
          <div className="workflow-branch-endpoints" aria-label="Workflow endpoints">
            {workflowStatusOptions.filter((status) => status.value === 'Reported' || status.value === 'Discarded').map((status) => (
              <button
                className={['workflow-step', 'workflow-step-button', 'workflow-endpoint', status.value === bug.status ? 'active' : ''].filter(Boolean).join(' ')}
                key={`${status.type}-${status.value}`}
                onClick={() => updateStatus(status.value)}
                type="button"
              >
                {status.value}
              </button>
            ))}
          </div>
        </div>
        <div className="workflow-pill-controls"><div className="field-with-status pill-field-status">
            <PillDropdown label="Severity" value={bug.severity} options={settings.severities.map((severity) => ({ value: severity.value, label: severity.value }))} colorClass={severityPillClass(bug.severity)} onChange={(value) => updateField('severity', value)} />
            {fieldSaveStatus('severity')}
          </div>
          <div className="field-with-status pill-field-status">
            <PillDropdown label="Status" value={bug.status} options={statusOptions.map((status) => ({ value: status.value, label: status.value }))} colorClass={statusPillClass(bug.status)} onChange={updateStatus} />
            {fieldSaveStatus('status')}
          </div>
          <div className="issue-ticket-control">
            <span>Issue</span>
            <button className="open-ticket-button" disabled={!bug.issue_url.trim()} onClick={() => void openTicketUrl()} title={bug.issue_url.trim() ? `Open ${bug.issue_url}` : 'Add an Issue URL to enable this ticket link'} type="button">
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
              <OptionSelect label="Entry Type" value={bug.entry_type || 'Bug'} options={settings.entryTypes} onChange={(value) => { updateField('entry_type', value); updateField('status', 'Draft', { trackStatus: false }); }} />
              {fieldSaveStatus('entry_type')}
            </div>
            <label className="field-with-status">Application<select value={bug.application_id ?? ''} onChange={(event) => changeApplication(Number(event.target.value) || null)}>{settings.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}</select>{fieldSaveStatus('application_id')}</label>
            <label className="field-with-status">Module<select value={bug.module_id ?? ''} onChange={(event) => updateField('module_id', Number(event.target.value) || null)}><option value="">No module</option>{detailModuleOptions.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select>{fieldSaveStatus('module_id')}</label>
            <div className="field-with-status"><ReferenceSelect label="Environment" value={bug.environment_id} options={settings.environments} onChange={(value) => updateField('environment_id', value)} />{fieldSaveStatus('environment_id')}</div>
            <div className="field-with-status"><ReferenceSelect label="Device" value={bug.device_id} options={settings.devices} onChange={(value) => updateField('device_id', value)} />{fieldSaveStatus('device_id')}</div>
            <div className="field-with-status"><ReferenceSelect label="Browser" value={bug.browser_id} options={settings.browsers} onChange={(value) => updateField('browser_id', value)} />{fieldSaveStatus('browser_id')}</div>
            <div className="field-with-status"><ReferenceSelect label="User Role" value={bug.user_role_id} options={settings.userRoles} onChange={(value) => updateField('user_role_id', value)} />{fieldSaveStatus('user_role_id')}</div>
          </div>
          <label className="field-with-status">Bug Note<textarea value={bug.note} onChange={(event) => updateField('note', event.target.value)} />{fieldSaveStatus('note')}</label>
          <label className="field-with-status">Steps to Reproduce<textarea value={bug.steps_to_reproduce} onChange={(event) => updateField('steps_to_reproduce', event.target.value)} onBlur={(event) => { const formatted = formatStepsAsNumberedList(event.target.value); if (formatted && formatted !== event.target.value) updateField('steps_to_reproduce', formatted); }} placeholder="Add steps to reproduce." />{fieldSaveStatus('steps_to_reproduce')}</label>
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
            <textarea className="report-preview" readOnly value={generateReport(reportBug, settings.reportTemplates.find((template) => template.name === 'Full Bug Report'))} />
            <div className="copy-grid">
              {(byokAiReady || settings.aiTriageEnabled) && (
                <div className="ai-triage-panel">
                  {aiStatus !== 'completed' ? (
                    <button className="ai-triage-button" disabled={triaging} onClick={() => void triageWithLocalAi()}>
                      <Gauge size={16} /> {triaging ? 'Triaging...' : 'AI Triage'}
                    </button>
                  ) : (
                    <>
                      <button className="ai-triage-button secondary" disabled={triaging} onClick={() => setShowAiRefinement((visible) => !visible)}>
                        <Gauge size={16} /> {triaging ? 'Refining...' : 'Refine AI Draft'}
                      </button>
                      {showAiRefinement && (
                        <div className="ai-refinement-box">
                          <textarea value={aiRefinementNote} onChange={(event) => setAiRefinementNote(event.target.value)} placeholder="E.g., Make the title more concise, or add step 4..." />
                          <button disabled={triaging || !aiRefinementNote.trim()} onClick={() => void triageWithLocalAi(aiRefinementNote)}>Submit Correction</button>
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
    </section>
  );
}






