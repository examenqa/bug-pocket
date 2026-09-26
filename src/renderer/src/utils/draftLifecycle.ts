// A single renderer draft owner; routes and main-process transitions share this contract.
let flush: (() => Promise<unknown>) | null = null;
let paused = 0;
export function registerDraftFlush(handler: () => Promise<unknown>): () => void {
  flush = handler;
  return () => { if (flush === handler) flush = null; };
}
export function pauseDraftInput(): () => void {
  paused += 1;
  if (typeof document !== 'undefined') document.body.inert = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    paused -= 1;
    if (typeof document !== 'undefined') document.body.inert = paused > 0;
  };
}
export function flushDrafts(): Promise<unknown> { return flush ? flush() : Promise.resolve(); }
export async function withSavedDraft<T>(action: () => T | Promise<T>): Promise<T> {
  const resume = pauseDraftInput();
  try { await flushDrafts(); return await action(); } finally { resume(); }
}

// Drain until there are no edits left, including edits accepted during an earlier write.
export async function drainDraft(saving: () => Promise<unknown> | null, dirty: () => boolean, save: () => Promise<unknown>): Promise<void> {
  while (saving() || dirty()) {
    const active = saving();
    if (active) await active;
    else await save();
  }
}
