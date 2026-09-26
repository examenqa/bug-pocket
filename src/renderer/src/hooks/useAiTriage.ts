import { Dispatch, MutableRefObject, SetStateAction, useEffect, useState } from 'react';
import type { AiByokConfig, BugDetails, SettingsData } from '../../../shared/types';
import { formatStepsAsNumberedList } from '../utils/formatSteps';
import { parseErrorForUI } from '../utils/errors';
import { getEntryDisplay } from '../utils/display';
import type { AiTriageStatus } from '../utils/bugUpdate';

function aiTextField(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

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
  const [byokAiReady, setByokAiReady] = useState(false);
  const [showAiRefinement, setShowAiRefinement] = useState(false);
  const [aiRefinementNote, setAiRefinementNote] = useState('');
  const triaging = aiStatus === 'loading';
  const aiTriageDisabled = developerReadOnly || triaging || !byokAiReady;

  useEffect(() => {
    let cancelled = false;
    const checkAiStatus = async (): Promise<void> => {
      try {
        const config = (await window.bugPocket.getAiConfig()) as AiByokConfig;
        if (!cancelled) setByokAiReady(Boolean(config?.hasApiKey));
      } catch {
        if (!cancelled) setByokAiReady(false);
      }
    };
    void checkAiStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const triageWithLocalAi = async (refinementNote = ''): Promise<void> => {
    if (developerReadOnly || triaging) return;
    const currentBug = bugRef.current ?? bug;
    if (!currentBug) return;
    const currentEntryDisplay = getEntryDisplay(currentBug);
    const currentApplication = settings.applications.find((application) => application.id === currentBug.application_id);
    const currentModule = settings.modules.find((module) => module.id === currentBug.module_id);
    let aiConfig: AiByokConfig;
    try {
      aiConfig = await window.bugPocket.getAiConfig() as AiByokConfig;
    } catch (caught) {
      showToast(parseErrorForUI(caught), 'error');
      return;
    }
    const apiKeyReady = Boolean(aiConfig?.hasApiKey);
    setByokAiReady(apiKeyReady);
    if (!apiKeyReady) {
      setAiStatus('idle');
      showToast('Please configure your AI API key in Settings.', 'error');
      return;
    }
    setAiStatus('loading');
    try {
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
        attachment_id: currentBug.attachments[0] ? String(currentBug.attachments[0].id) : undefined,
        refinement_note: refinementNote.trim() || undefined
      })).trim();
      if (!triageText) throw new Error('AI triage returned an empty response.');
      const cleanJsonString = triageText.match(/\{[\s\S]*\}/)?.[0] || triageText;
      let aiAppliedBug: BugDetails = currentBug;
      try {
        const triageData = JSON.parse(cleanJsonString) as Partial<Record<'title' | 'bugNote' | 'stepsToReproduce' | 'expectedResult' | 'actualResult', unknown>>;
        const title = aiTextField(triageData.title);
        const bugNote = aiTextField(triageData.bugNote);
        const stepsToReproduce = aiTextField(triageData.stepsToReproduce);
        const expectedResult = aiTextField(triageData.expectedResult);
        const actualResult = aiTextField(triageData.actualResult);
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
        const fallbackNote = [currentBug.note.trim(), cleanJsonString].filter(Boolean).join('\n\n');
        aiAppliedBug = { ...currentBug, note: fallbackNote };
      }

      setBug(aiAppliedBug);
      bugRef.current = aiAppliedBug;
      markDirty();
      setAiStatus('completed');
      setShowAiRefinement(false);
      setAiRefinementNote('');
      showToast('AI Triage applied. Review the generated fields before saving.');
    } catch (caught) {
      setAiStatus('idle');
      showToast(parseErrorForUI(caught), 'error');
    }
  };

  return {
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
