import { useEffect } from 'react';
import { flushDrafts, pauseDraftInput } from '../utils/draftLifecycle';

export function useDraftLifecycleBridge(): void {
  useEffect(() => {
    let resume: (() => void) | null = null;
    const unsubscribe = window.bugPocket.onDetailsFlushRequest((requestId) => {
      resume ??= pauseDraftInput();
      void flushDrafts().then(
        () => window.bugPocket.detailsFlushComplete(requestId, true),
        () => window.bugPocket.detailsFlushComplete(requestId, false)
      );
    });
    const unsubscribeResume = window.bugPocket.onDetailsResume(() => { resume?.(); resume = null; });
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      // Ordinary routes never unload. Reload/OS close must go through the main flush handshake.
      if (document.body.dataset.detailsDirty === 'true') { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { unsubscribe(); unsubscribeResume(); resume?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
}
