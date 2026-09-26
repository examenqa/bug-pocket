import React, { useCallback, useEffect, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, Clipboard, Download, Gauge, Save, Trash2, X } from 'lucide-react';
import type { AiByokConfig, AiIssueProcessResult, AttachmentDownloadResult, BugDetails, CaptureStatus, SettingsData, TaxonomyId } from '../../../shared/types';
import { Badge, SyncBadge } from '../components/shared/Badge';
import { PillDropdown } from '../components/shared/PillDropdown';
import { useToast } from '../components/shared/ToastContext';
import { OptionSelect, ReferenceSelect } from '../components/shared/OptionSelect';
import { ScreenshotAnnotator } from '../components/ScreenshotAnnotator';
import { formatDate, generateReport, buildIssueDeepLink, IssuePlatformLink } from '../services/reports';
import {
  getEntryDisplay,
  isCloudSyncActive,
  severityPillClass,
  statusPillClass,
  statusOptionsForEntryType,
  getWorkflowStatusOptions
} from '../utils/display';
import { getModulesForApplication } from '../utils/filters';
import { resolveTaxonomyId } from '../utils/taxonomyIds';
import { formatStepsAsNumberedList } from '../utils/formatSteps';
import { buildBugUpdateInput } from '../utils/bugUpdate';
import { useAutoSave } from '../hooks/useAutoSave';
import { useAiTriage } from '../hooks/useAiTriage';
import { useAttachmentSpotlight } from '../hooks/useAttachmentSpotlight';


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
  const [copied, setCopied] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastEditedField, setLastEditedField] = useState<keyof BugDetails | null>(null);
  const showDetailsToast = useToast();
  const saveBugCallback = useCallback((bugToSave: BugDetails) => window.bugPocket.updateBug(bugToSave.id, buildBugUpdateInput(bugToSave)) as Promise<BugDetails>, []);
  const {
    flushSync,
    bugRef,
    saveState,
    setSaveState,
    markDirty,
    resetSavedBaseline
  } = useAutoSave({ bug, setBug, saveCallback: saveBugCallback, showToast: showDetailsToast });

  const developerReadOnly = !settings.currentWorkspaceCanWrite;
  const {
    attachmentPreviews,
    closeSpotlight,
    currentSpotlightAttachment,
    currentSpotlightPreview,
    openAttachmentSpotlight,
    saveSpotlightAnnotation,
    selectSpotlightVersion,
    showSpotlightIndex,
    spotlight
  } = useAttachmentSpotlight({ bugId, bug, setBug });
  const {
    aiStatus,
    aiRefinementNote,
    aiTriageDisabled,
    setAiRefinementNote,
    setShowAiRefinement,
    showAiRefinement,
    triageWithLocalAi,
    triaging
  } = useAiTriage({
    bug,
    bugRef,
    settings,
    developerReadOnly,
    setBug,
    markDirty,
    showToast: showDetailsToast
  });

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
        if (!loadedBug) return;
        setBug(current => {
          if (!current || current.id !== loadedBug.id) return current;
          const merged = { ...current, attachments: loadedBug.attachments };
          bugRef.current = merged;
          return merged;
        });
      });
    });
    window.bugPocket.getBug(bugId).then((loadedBug) => {
      if (cancelled) return;
      setBug(loadedBug);
      bugRef.current = loadedBug;
      resetSavedBaseline(loadedBug);
    });
    return () => {
      cancelled = true;
      unsubscribeScreenshot();
    };
  }, [bugId, resetSavedBaseline]);

  const updateField = (key: keyof BugDetails, value: string | number | boolean | null, options: { trackStatus?: boolean; autoSave?: boolean } = {}): void => {
    if (developerReadOnly) return;
    setBug((current) => {
      if (!current || current[key] === value) return current;
      const nextBug = { ...current, [key]: value };
      bugRef.current = nextBug;
      if (options.autoSave === false) {
        setSaveState('dirty');
        if (options.trackStatus !== false) setLastEditedField(key);
      } else {
        markDirty();
        if (options.trackStatus !== false) setLastEditedField(key);
      }
      return nextBug;
    });
  };

  if (!bug) return <section className="details-route-view page">Loading...</section>;

  const entryDisplay = getEntryDisplay(bug);
  const detailTitleValue = entryDisplay.isDerived ? entryDisplay.title : bug.title;
  const reportBug = { ...bug, title: entryDisplay.title };

  const save = async (): Promise<void> => {
    if (developerReadOnly) return;
    try { await flushSync(); showDetailsToast('Details saved successfully.'); } catch { /* Save owner reports the failure. */ }
  };
  const backToDashboard = (): void => { onBack(); };
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
  const addScreenshot = async (): Promise<void> => {
    if (developerReadOnly) return;
    await window.bugPocket.startScreenshotCapture(bug.id);
  };
  const removeAttachment = async (attachmentId: number): Promise<void> => {
    if (developerReadOnly) return;
    await window.bugPocket.deleteAttachment(attachmentId);
    const updated = await window.bugPocket.getBug(bug.id);
    if (updated) {
      setBug(current => {
        if (!current || current.id !== updated.id) return current;
        const merged = { ...current, attachments: updated.attachments };
        bugRef.current = merged;
        return merged;
      });
    }
    closeSpotlight();
  };
  const downloadAttachment = async (attachmentId: number): Promise<void> => { await window.bugPocket.downloadAttachment(attachmentId) as AttachmentDownloadResult; };
  const deleteReport = async (): Promise<void> => {
    if (developerReadOnly) return;
    setDeleting(true);
    try { await flushSync(); await window.bugPocket.deleteBug(bug.id); resetSavedBaseline(null); onBack(); }
    catch (error) { showDetailsToast(String(error), 'error'); }
    finally { setDeleting(false); }
  };
  const convertScenarioToBug = async (): Promise<void> => {
    if (developerReadOnly) return;
    const convertedBug: BugDetails = { ...bug, entry_type: 'Bug', title: detailTitleValue, status: 'Draft', severity: bug.severity || 'Medium' };
    const updated = await window.bugPocket.updateBug(bug.id, buildBugUpdateInput(convertedBug));
    setBug(updated);
    bugRef.current = updated;
    resetSavedBaseline(updated);
  };

  const cloudSyncActive = isCloudSyncActive(settings);
  const statusOptions = statusOptionsForEntryType(bug.entry_type, settings);
  const workflowStatusOptions = getWorkflowStatusOptions(statusOptions, bug.status);
  const updateStatus = (status: string): void => {
    updateField('status', status as CaptureStatus);
    updateField('reported', status === 'Reported' ? 1 : 0, { trackStatus: false });
  };
  const detailModuleOptions = getModulesForApplication(settings, bug.application_id, bug.module_id);
  const changeApplication = (applicationId: TaxonomyId | null): void => {
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
          <p>{bug.entry_type || 'Bug'} / {bug.environment || 'No environment'} / {bug.user_role || 'No role'} / {bug.device || 'No device'} / {bug.browser || 'No browser'} / <SyncBadge status={bug.sync_status} cloudSyncActive={cloudSyncActive} /> / Created {formatDate(bug.created_at)} / Updated {formatDate(bug.updated_at)}</p>
        </div>
        <div className="header-actions">
          {developerReadOnly && <span className="read-only-access-badge">Read-only workspace access</span>}
          {!developerReadOnly && bug.entry_type === 'Scenario' && <button onClick={convertScenarioToBug}>Convert to Bug</button>}
          {!developerReadOnly && (confirmingDelete ? (
            <div className="delete-confirm-actions">
              <span>Delete this report?</span>
              <button className="danger" disabled={deleting} onClick={() => void deleteReport()}><Trash2 size={16} /> Yes</button>
              <button disabled={deleting} onClick={() => setConfirmingDelete(false)}>No</button>
            </div>
          ) : (
            <button className="danger delete-report-button" onClick={() => setConfirmingDelete(true)}><Trash2 size={16} strokeWidth={2.5} /> Delete Report</button>
          ))}
          {!developerReadOnly && <button className="primary save-detail-button" onClick={save}><Save size={17} strokeWidth={2.5} /> Save Details</button>}
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
              disabled={developerReadOnly}
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
                disabled={developerReadOnly}
              >
                {status.value}
              </button>
            ))}
          </div>
        </div>
        <div className="workflow-pill-controls"><div className="field-with-status pill-field-status">
            <PillDropdown label="Severity" value={bug.severity} options={settings.severities.map((severity) => ({ value: severity.value, label: severity.value }))} colorClass={severityPillClass(bug.severity)} disabled={developerReadOnly} onChange={(value) => updateField('severity', value)} />
            {fieldSaveStatus('severity')}
          </div>
          <div className="field-with-status pill-field-status">
            <PillDropdown label="Status" value={bug.status} options={statusOptions.map((status) => ({ value: status.value, label: status.value }))} colorClass={statusPillClass(bug.status)} disabled={developerReadOnly} onChange={updateStatus} />
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
        <fieldset className="panel form-panel detail-narrative-panel read-only-fieldset" disabled={developerReadOnly} aria-label="Bug details">
          <label className="field-with-status">Title<input value={detailTitleValue} onChange={(event) => updateField('title', event.target.value)} placeholder={entryDisplay.title} />{fieldSaveStatus('title')}</label>
          <div className="detail-config-grid">
            <div className="field-with-status">
              <OptionSelect label="Entry Type" value={bug.entry_type || 'Bug'} options={settings.entryTypes} onChange={(value) => { updateField('entry_type', value); updateField('status', 'Draft', { trackStatus: false }); }} />
              {fieldSaveStatus('entry_type')}
            </div>
            <label className="field-with-status">Application<select value={bug.application_id ?? ''} onChange={(event) => changeApplication(resolveTaxonomyId(event.target.value, settings.applications))}>{settings.applications.map((application) => <option key={application.id} value={application.id}>{application.name}</option>)}</select>{fieldSaveStatus('application_id')}</label>
            <label className="field-with-status">Module<select value={bug.module_id ?? ''} onChange={(event) => updateField('module_id', resolveTaxonomyId(event.target.value, detailModuleOptions))}><option value="">No module</option>{detailModuleOptions.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select>{fieldSaveStatus('module_id')}</label>
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
        </fieldset>
        <aside className="panel detail-routing-panel">
          <div className="detail-sidebar-section attachments-section">
            <div className="panel-heading">
              <h2>Attachments</h2>
              {!developerReadOnly && <button onClick={addScreenshot}><Camera size={16} /> Add Screenshot</button>}
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
                    <SyncBadge status={attachment.sync_status} cloudSyncActive={cloudSyncActive} />
                    <span className="attachment-actions">
                      <button className="icon-button" title="Download screenshot" onClick={() => void downloadAttachment(attachment.id)}><Download size={15} /></button>
                      {!developerReadOnly && <button className="icon-button danger" title="Remove attachment" onClick={() => removeAttachment(attachment.id)}><Trash2 size={15} /></button>}
                    </span>
                  </figcaption>
                </figure>
              ))}
              {!bug.attachments.length && <p className="muted">No screenshots attached.</p>}
            </div>
          </div>
          <fieldset className="detail-sidebar-section external-tracking read-only-fieldset" disabled={developerReadOnly} aria-label="External tracking">
            <h2>External Tracking</h2>
            <div className="field-with-status"><OptionSelect label="Issue Platform" value={bug.issue_platform} options={settings.issuePlatforms} onChange={(value) => updateField('issue_platform', value)} />{fieldSaveStatus('issue_platform')}</div>
            <div className="two-col tracking-id-url">
              <label className="field-with-status">Issue ID<input value={bug.issue_id} onChange={(event) => updateField('issue_id', event.target.value)} />{fieldSaveStatus('issue_id')}</label>
              <label className="field-with-status">Issue URL<input value={bug.issue_url} onChange={(event) => updateField('issue_url', event.target.value)} />{fieldSaveStatus('issue_url')}</label>
            </div>
            <label className="field-with-status">Tags<input value={bug.tags} onChange={(event) => updateField('tags', event.target.value)} placeholder="login, regression, visual" />{fieldSaveStatus('tags')}</label>
          </fieldset>
          <div className="detail-sidebar-section report-actions-section">
            <h2>Generated report preview</h2>
            <textarea className="report-preview" readOnly value={generateReport(reportBug, settings.reportTemplates.find((template) => template.name === 'Full Bug Report'))} />
            <div className="copy-grid">
              {!developerReadOnly && (
                <div className="ai-triage-panel">
                  {aiStatus !== 'completed' ? (
                    <button className="ai-triage-button" disabled={aiTriageDisabled} onClick={() => void triageWithLocalAi()}>
                      <Gauge size={16} /> {triaging ? 'Triaging...' : 'AI Triage'}
                    </button>
                  ) : (
                    <>
                      <button className="ai-triage-button secondary" disabled={aiTriageDisabled} onClick={() => setShowAiRefinement((visible) => !visible)}>
                        <Gauge size={16} /> {triaging ? 'Refining...' : 'Refine AI Draft'}
                      </button>
                      {showAiRefinement && (
                        <div className="ai-refinement-box">
                          <textarea value={aiRefinementNote} onChange={(event) => setAiRefinementNote(event.target.value)} placeholder="E.g., Make the title more concise, or add step 4..." />
                          <button disabled={aiTriageDisabled || !aiRefinementNote.trim()} onClick={() => void triageWithLocalAi(aiRefinementNote)}>Submit Correction</button>
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
        <div className="spotlight-backdrop" role="dialog" aria-modal="true" aria-label="Screenshot preview" onClick={() => closeSpotlight()}>
          <div className="spotlight-panel" onClick={(event) => event.stopPropagation()}>
            <header className="spotlight-header">
              <div>
                <h2>{spotlight.bugTitle}</h2>
                <p>{currentSpotlightAttachment ? `${currentSpotlightAttachment.file_name} (${spotlight.index + 1} of ${spotlight.attachments.length})` : 'Attachment preview'}</p>
              </div>
              <button className="icon-button" aria-label="Close preview" onClick={() => closeSpotlight()}><X size={18} /></button>
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
