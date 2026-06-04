import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BugDetails } from '../../../shared/types';
import { buildBugUpdateInput, DetailsSaveState, serializeBugUpdateInput } from '../utils/bugUpdate';
import { useDebounce } from './useDebounce';

interface UseAutoSaveOptions {
  bug: BugDetails | null;
  setBug: Dispatch<SetStateAction<BugDetails | null>>;
  saveCallback: (bug: BugDetails) => Promise<BugDetails>;
  showToast?: (message: string, variant?: 'success' | 'info' | 'error') => void;
}

interface TriggerSaveOptions {
  showToast?: boolean;
  bugOverride?: BugDetails | null;
}

export function useAutoSave({ bug, setBug, saveCallback, showToast }: UseAutoSaveOptions) {
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<DetailsSaveState>('idle');
  const bugRef = useRef<BugDetails | null>(bug);
  const isDirtyRef = useRef(false);
  const lastSavedPayloadRef = useRef('');
  const saveStateTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<BugDetails | null> | null>(null);

  useEffect(() => { bugRef.current = bug; }, [bug]);

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

  const markSavedSoon = useCallback((): void => {
    setSaveState('saved');
    if (saveStateTimerRef.current) window.clearTimeout(saveStateTimerRef.current);
    saveStateTimerRef.current = window.setTimeout(() => setSaveState('idle'), 1600);
  }, []);

  const markDirty = useCallback((): void => {
    isDirtyRef.current = true;
    setIsDirty(true);
    setSaveState('dirty');
    void window.bugPocket.setDetailsDirty(true);
  }, []);

  const resetSavedBaseline = useCallback((nextBug: BugDetails | null, state: DetailsSaveState = 'idle'): void => {
    bugRef.current = nextBug;
    lastSavedPayloadRef.current = nextBug ? serializeBugUpdateInput(buildBugUpdateInput(nextBug)) : '';
    isDirtyRef.current = false;
    setIsDirty(false);
    setSaveState(state);
    void window.bugPocket.setDetailsDirty(false);
  }, []);

  const triggerSave = useCallback(async ({ showToast: showSuccessToast = false, bugOverride = null }: TriggerSaveOptions = {}): Promise<BugDetails | null> => {
    if (saveInFlightRef.current) await saveInFlightRef.current;
    const currentBug = bugOverride ?? bugRef.current;
    if (!currentBug) return null;
    if (bugOverride) bugRef.current = bugOverride;

    const payload = buildBugUpdateInput(currentBug);
    const payloadKey = serializeBugUpdateInput(payload);
    if (payloadKey === lastSavedPayloadRef.current) {
      isDirtyRef.current = false;
      setIsDirty(false);
      void window.bugPocket.setDetailsDirty(false);
      if (showSuccessToast) showToast?.('Details already saved.');
      return currentBug;
    }

    setSaveState('saving');
    const savePromise = saveCallback(currentBug) as Promise<BugDetails>;
    saveInFlightRef.current = savePromise;
    try {
      const updated = await savePromise;
      const latestBug = bugRef.current;
      const latestPayloadKey = latestBug ? serializeBugUpdateInput(buildBugUpdateInput(latestBug)) : payloadKey;
      lastSavedPayloadRef.current = serializeBugUpdateInput(buildBugUpdateInput(updated));

      if (latestPayloadKey !== payloadKey) {
        isDirtyRef.current = true;
        setIsDirty(true);
        setSaveState('dirty');
        void window.bugPocket.setDetailsDirty(true);
        return latestBug;
      }

      setBug(updated);
      bugRef.current = updated;
      isDirtyRef.current = false;
      setIsDirty(false);
      void window.bugPocket.setDetailsDirty(false);
      markSavedSoon();
      if (showSuccessToast) showToast?.('Details saved successfully.');
      return updated;
    } catch (caught) {
      setSaveState('error');
      const message = caught instanceof Error ? caught.message : 'Unable to save details.';
      showToast?.(message, 'error');
      throw caught;
    } finally {
      saveInFlightRef.current = null;
    }
  }, [markSavedSoon, saveCallback, setBug, showToast]);

  const flushSync = useCallback(async (): Promise<BugDetails | null> => {
    if (!isDirtyRef.current) return bugRef.current;
    return triggerSave();
  }, [triggerSave]);

  useEffect(() => {
    if (!bugRef.current || !isDirtyRef.current || !debouncedFormPayloadKey) return;
    if (debouncedFormPayloadKey !== formPayloadKey) return;
    if (debouncedFormPayloadKey === lastSavedPayloadRef.current) {
      isDirtyRef.current = false;
      setIsDirty(false);
      void window.bugPocket.setDetailsDirty(false);
      return;
    }
    void triggerSave();
  }, [debouncedFormPayloadKey, formPayloadKey, triggerSave]);

  useEffect(() => {
    return window.bugPocket.onDetailsFlushRequest(() => {
      void (async () => {
        try {
          await flushSync();
        } finally {
          await window.bugPocket.detailsFlushComplete();
        }
      })();
    });
  }, [flushSync]);

  return {
    triggerSave,
    flushSync,
    isSaving: saveState === 'saving',
    isDirty,
    isDirtyRef,
    bugRef,
    saveState,
    setSaveState,
    markDirty,
    markSavedSoon,
    resetSavedBaseline
  };
}
