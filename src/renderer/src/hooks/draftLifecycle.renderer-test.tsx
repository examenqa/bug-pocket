import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAutoSave } from './useAutoSave';
import { useHashRoute } from './useHashRoute';
import { useDraftLifecycleBridge } from './useDraftLifecycleBridge';
import type { BugDetails } from '../../../shared/types';

declare global { interface Window { phase1Result?: { passed: string[]; error?: string }; } }
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const passed: string[] = [];
function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + ': ' + JSON.stringify({ actual, expected }));
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let flushRequest: ((id: string) => void) | undefined;
let resume: (() => void) | undefined;
let mainNavigate: ((route: string) => void) | undefined;
let acknowledgements: Array<[string, boolean]> = [];
window.bugPocket = {
  setDetailsDirty: async () => {},
  detailsFlushComplete: async (id: string, success: boolean) => { acknowledgements.push([id, success]); },
  onDetailsFlushRequest: (callback: (id: string) => void) => { flushRequest = callback; return () => { flushRequest = undefined; }; },
  onDetailsResume: (callback: () => void) => { resume = callback; return () => { resume = undefined; }; },
  onNavigate: (callback: (route: string) => void) => { mainNavigate = callback; return () => { mainNavigate = undefined; }; }
} as unknown as typeof window.bugPocket;
const initial = { id: 1, entry_type: 'Bug', note: 'original', title: 'report', attachments: [], status: 'Draft', severity: 'Medium', reported: 0 } as unknown as BugDetails;
let owner!: ReturnType<typeof useAutoSave>;
let router!: ReturnType<typeof useHashRoute>;
let setReport!: React.Dispatch<React.SetStateAction<BugDetails | null>>;
let save: (bug: BugDetails) => Promise<BugDetails>;
function Host() {
  const [bug, setBug] = useState<BugDetails | null>(initial);
  setReport = setBug;
  owner = useAutoSave({ bug, setBug, saveCallback: value => save(value), showToast: () => {} });
  router = useHashRoute();
  useDraftLifecycleBridge();
  return <textarea value={bug?.note ?? ''} readOnly />;
}
async function tick(): Promise<void> { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function run(): Promise<void> {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  save = async value => value;
  await act(async () => root.render(<Host />));
  async function reset(): Promise<void> {
    acknowledgements = [];
    await act(async () => { resume?.(); setReport(initial); owner.resetSavedBaseline(initial); });
    await act(async () => { router.navigate('/bugs/1'); });
    await tick();
  }
  async function edit(note: string): Promise<void> {
    await act(async () => {
      const next = { ...(owner.bugRef.current ?? initial), note };
      owner.bugRef.current = next; setReport(next); owner.markDirty();
    });
  }
  for (const [name, route] of [['Escape/dashboard', '/dashboard'], ['sidebar', '/settings/workspace'], ['another report', '/bugs/2']]) {
    await reset();
    const writes: string[] = [];
    const gate = deferred<BugDetails>();
    save = value => { writes.push(value.note); return gate.promise; };
    await edit(name);
    await act(async () => { router.navigate(route); });
    equal(router.route, '/bugs/1', name + ' cannot leave during a pending write');
    equal(writes, [name], name + ' flushes before the debounce');
    await act(async () => gate.resolve({ ...initial, note: name }));
    await tick();
    equal(router.route, route, name + ' navigates after success');
    equal(document.body.inert, false, 'input resumes');
    passed.push(name + ' flush');
  }
  await reset();
  save = async () => { throw new Error('disk full'); };
  await edit('retained on error');
  await act(async () => { router.navigate('/dashboard'); });
  await tick();
  equal(router.route, '/bugs/1', 'failed navigation stays on report');
  equal(owner.bugRef.current?.note, 'retained on error', 'draft remains');
  equal(owner.saveState, 'error', 'failure is surfaced');
  passed.push('failed navigation preserves draft');

  await reset();
  const first = deferred<BugDetails>();
  const writes: string[] = [];
  save = value => { writes.push(value.note); return writes.length === 1 ? first.promise : Promise.resolve(value); };
  await edit('first');
  let active!: Promise<BugDetails | null>;
  await act(async () => { active = owner.triggerSave(); });
  await edit('edited during save');
  await act(async () => { router.navigate('/dashboard'); });
  await act(async () => { first.resolve({ ...initial, note: 'first' }); await active; });
  await tick();
  equal(writes, ['first', 'edited during save'], 'flush drains the newer edit without duplicate writes');
  equal(router.route, '/dashboard', 'navigation follows final save');
  passed.push('edit during active save is drained');

  for (const reason of ['window close', 'application quit', 'workspace transition']) {
    await reset();
    save = async value => value;
    await edit(reason);
    await act(async () => { flushRequest?.(reason); });
    await tick();
    equal(acknowledgements, [[reason, true]], reason + ' acknowledges successful persistence');
    equal(document.body.inert, true, reason + ' remains paused until main completes');
    await act(async () => resume?.());
    equal(document.body.inert, false, reason + ' resumes input');
    passed.push(reason + ' handshake');
  }
  await reset();
  save = async () => { throw new Error('read-only disk'); };
  await edit('failed flush');
  await act(async () => flushRequest?.('failed'));
  await tick();
  equal(acknowledgements, [['failed', false]], 'failure must never acknowledge success');
  equal(owner.bugRef.current?.note, 'failed flush', 'failed flush retains text');
  await act(async () => resume?.());
  save = async value => value;
  await act(async () => flushRequest?.('retry'));
  await tick();
  equal(acknowledgements, [['failed', false], ['retry', true]], 'retry can save the retained draft');
  passed.push('failed flush and successful retry');

  await reset();
  await edit('reload draft');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  equal(unload.defaultPrevented, true, 'reload is blocked while a draft is dirty');
  save = async value => value;
  await act(async () => owner.flushSync());
  const cleanUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanUnload);
  equal(cleanUnload.defaultPrevented, false, 'clean reload remains available');
  passed.push('dirty reload protection');

  await reset();
  await edit('global navigation');
  await act(async () => mainNavigate?.('/dashboard'));
  await tick();
  equal(owner.isDirty, false, 'main-triggered route uses the same flush');
  equal(router.route, '/dashboard', 'global navigation completes');
  passed.push('main-triggered navigation');
  await act(async () => root.unmount());
  window.phase1Result = { passed };
}
void run().catch(error => { window.phase1Result = { passed, error: error.stack ?? String(error) }; });
