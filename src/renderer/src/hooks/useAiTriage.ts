import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef, useState } from 'react';
import type { BugDetails, SettingsData } from '../../../shared/types';
import { abortable } from '../../../shared/aiRequest';
import { LatestAiRequest, aiPatch, mergeAiPatch, type AiField, type AiFieldVersions } from '../utils/aiDraft';
import { parseErrorForUI } from '../utils/errors';
import { getEntryDisplay } from '../utils/display';
import type { AiTriageStatus } from '../utils/bugUpdate';
import { AiReadinessMonitor, aiConfigurationReady, type AiReadiness } from '../utils/aiReadiness';

interface UseAiTriageOptions {
  bug: BugDetails | null;
  bugRef: MutableRefObject<BugDetails | null>;
  settings: SettingsData;
  developerReadOnly: boolean;
  setBug: Dispatch<SetStateAction<BugDetails | null>>;
  markDirty(): void;
  showToast(message: string, variant?: 'success' | 'info' | 'error'): void;
}

export function useAiTriage({
  bug,
  bugRef,
  settings,
  developerReadOnly,
  setBug,
  markDirty,
  showToast
}: UseAiTriageOptions) {
  const [aiStatus, setAiStatus] = useState<AiTriageStatus>('idle');
  const [aiReadiness, setAiReadiness] = useState<AiReadiness>({ status: 'unknown' });
  const readinessMonitor = useRef<AiReadinessMonitor | null>(null);
  const [showAiRefinement, setShowAiRefinement] = useState(false);
  const [aiRefinementNote, setAiRefinementNote] = useState('');
  const requestBusy = useRef(false);
  const requests = useRef(new LatestAiRequest(id => { void window.bugPocket.cancelAiRequest(id).catch(() => {}); }));
  const fieldVersions = useRef<AiFieldVersions>({});
  const cancelAi = (): void => { requests.current.cancel(); requestBusy.current = false; setAiStatus('idle'); };
  const noteUserEdit = (field: keyof BugDetails): void => {
    fieldVersions.current[field as AiField] = (fieldVersions.current[field as AiField] ?? 0) + 1;
  };
  useEffect(() => {
    requestBusy.current = false;
    setAiStatus('idle');
    return () => { requests.current.cancel(); requestBusy.current = false; };
  }, [bug?.id, settings.currentWorkspaceId]);
  useEffect(() => {
    const cancel = () => { requests.current.cancel(); requestBusy.current = false; setAiStatus('idle'); };
    const stopShutdown = window.bugPocket.onAppShutdownStarted(cancel);
    const stopDeparture = window.bugPocket.onDetailsFlushRequest(cancel);
    return () => { stopShutdown(); stopDeparture(); };
  }, []);
  const triaging = aiStatus === 'loading';
  const aiTriageDisabled = developerReadOnly || triaging || !aiConfigurationReady(aiReadiness);

  useEffect(() => {
    const monitor = new AiReadinessMonitor(
      () => window.bugPocket.getAiConfig(),
      () => window.bugPocket.getSettings(),
      setAiReadiness
    );
    readinessMonitor.current = monitor;
    const unsubscribe = window.bugPocket.onSettingsChanged(() => { void monitor.refresh(); });
    void monitor.refresh();
    return () => {
      unsubscribe();
      monitor.dispose();
      if (readinessMonitor.current === monitor) readinessMonitor.current = null;
    };
  }, [settings.aiTriageEnabled, settings.ollamaModelName, settings.currentWorkspaceId]);

  const triageWithLocalAi = async (refinementNote = ''): Promise<void> => {
    if (developerReadOnly || triaging || requestBusy.current) return;
    const currentBug = bugRef.current ?? bug;
    if (!currentBug) return;
    requestBusy.current = true;
    const request = requests.current.start();
    const signal = request.controller.signal;
    const versionsAtStart = { ...fieldVersions.current };
    setAiStatus('loading');
    const currentEntryDisplay = getEntryDisplay(currentBug);
    const currentApplication = settings.applications.find((application) => application.id === currentBug.application_id);
    const currentModule = settings.modules.find((module) => module.id === currentBug.module_id);
    try {
      const monitor = readinessMonitor.current;
      if (!monitor) throw new Error('Could not read AI configuration. Please retry.');
      const configuration = await abortable(monitor.refresh(), signal);
      if (!requests.current.isCurrent(request)) return;
      if (!monitor.isCurrent(configuration)) throw new Error('Could not read current AI configuration. Please retry.');
      if (!aiConfigurationReady(configuration)) {
        setAiStatus('idle');
        showToast('Configure an AI API key or enable native Ollama in Settings.', 'error');
        return;
      }
      const result = await abortable(window.bugPocket.triageBug({
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
        attachment_id: currentBug.attachments[0] ? String(currentBug.attachments[0].id) : undefined,
        refinement_note: refinementNote.trim() || undefined
      }, request.id), signal);
      if (!requests.current.isCurrent(request)) return;
      if (result.status === 'cancelled') { setAiStatus('idle'); return; }
      if (result.status === 'timed_out') { setAiStatus('idle'); showToast(result.message, 'error'); return; }
      if (result.status !== 'completed') throw new Error(result.message);
      const triageText = result.value.trim();
      if (!triageText) throw new Error('AI triage returned an empty response.');
      const patch = aiPatch(triageText, currentBug);
      setBug(current => {
        if (!current || !requests.current.isCurrent(request)) return current;
        const merged = mergeAiPatch(currentBug, current, patch, versionsAtStart, fieldVersions.current);
        bugRef.current = merged.bug;
        if (merged.changed) markDirty();
        return merged.bug;
      });
      setAiStatus('completed');
      setShowAiRefinement(false);
      setAiRefinementNote('');
      showToast('AI suggestions merged. Fields you edited during generation were kept. Review before saving.');
    } catch (caught) {
      if (!requests.current.isCurrent(request)) return;
      setAiStatus('idle');
      showToast(parseErrorForUI(caught), 'error');
    } finally {
      if (requests.current.isCurrent(request)) requestBusy.current = false;
    }
  };

  return {
    cancelAi,
    noteUserEdit,
    aiStatus,
    aiRefinementNote,
    aiTriageDisabled,
    setAiRefinementNote,
    setShowAiRefinement,
    showAiRefinement,
    triageWithLocalAi,
    triaging
  };
}
