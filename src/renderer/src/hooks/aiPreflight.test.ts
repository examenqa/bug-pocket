import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import compiler from 'typescript';
import { abortable, type AiRequestResult } from '../../../shared/aiRequest';
import { AiPublicError, getAiErrorMessage, serializeAiError } from '../../../shared/aiError';
import type { BugDetails, SettingsData } from '../../../shared/types';
import { AiReadinessMonitor, aiConfigurationReady } from '../utils/aiReadiness';
import { LatestAiRequest, aiPatch, mergeAiPatch } from '../utils/aiDraft';
import { parseErrorForUI } from '../utils/errors';
import { getEntryDisplay } from '../utils/display';
import type { useAiTriage } from './useAiTriage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

// Exact production function selected by the TypeScript AST. State, refs, effects
// and bridge methods are inert adapters. This is neither a React mount nor IPC;
// actual pure readiness, request ownership, abort and merge modules execute.
function hookFactory(dependencies: Record<string, unknown>): typeof useAiTriage {
  const filename = resolve(__dirname, 'useAiTriage.ts');
  const source = readFileSync(filename, 'utf8');
  const parsed = compiler.createSourceFile(filename, source, compiler.ScriptTarget.ES2022, true);
  const matches = parsed.statements.filter(statement => compiler.isFunctionDeclaration(statement) && statement.name?.text === 'useAiTriage');
  assert.equal(matches.length, 1, 'select the unique production hook declaration');
  const selected = source.slice(matches[0].pos, matches[0].end);
  const compiled = compiler.transpileModule(selected, {
    compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS }, fileName: filename
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, { exports, Error, AbortController, console, ...dependencies }, { filename, timeout: 2_000 });
  return exports.useAiTriage as typeof useAiTriage;
}

function harness(options: { readOnly?: boolean; busy?: boolean } = {}) {
  const state: unknown[] = [], stateWrites: Array<{ slot: number; value: unknown }> = [];
  const effects: Array<() => void | (() => void)> = [], cleanups: Array<() => void> = [];
  const notifications = new Set<() => void>();
  let key: unknown = true, native: unknown = false;
  let configReads = 0, settingsReads = 0, dirty = 0, merges = 0;
  let readConfig: () => Promise<unknown> = async () => ({ hasApiKey: key });
  let readSettings: () => Promise<unknown> = async () => ({ aiTriageEnabled: native });
  let dispatch: () => Promise<AiRequestResult<string>> = async () => ({ status: 'completed', value: JSON.stringify({ title: 'AI title' }) });
  const calls: Array<{ payload: unknown; requestId: string }> = [], cancelled: string[] = [], toasts: string[] = [];
  let current = { id: 1, title: 'original', note: 'tester note', steps_to_reproduce: 'old steps', expected_result: 'expected', actual_result: 'actual', attachments: [] } as unknown as BugDetails;
  const bugRef = { current: current as BugDetails | null };
  const settings = { applications: [], modules: [], currentWorkspaceId: 'A', aiTriageEnabled: false, ollamaModelName: 'qwen3-vl:8b' } as unknown as SettingsData;
  const bridge = {
    getAiConfig: () => { configReads++; return readConfig(); },
    getSettings: () => { settingsReads++; return readSettings(); },
    onSettingsChanged: (callback: () => void) => { notifications.add(callback); return () => { notifications.delete(callback); }; },
    onAppShutdownStarted: () => () => {},
    onDetailsFlushRequest: () => () => {},
    cancelAiRequest: async (id: string) => { cancelled.push(id); },
    triageBug: async (payload: unknown, requestId: string) => { calls.push({ payload, requestId }); return dispatch(); }
  };
  const useHook = hookFactory({
    useState: (initial: unknown) => {
      const slot = state.length;
      state.push(slot === 0 && options.busy ? 'loading'
        : slot === 1 && (options.busy || options.readOnly) ? { status: 'known', hasByokKey: true, nativeEnabled: false }
        : initial);
      return [state[slot], (value: unknown) => {
        state[slot] = typeof value === 'function' ? (value as (old: unknown) => unknown)(state[slot]) : value;
        stateWrites.push({ slot, value: state[slot] });
      }];
    },
    useRef: (value: unknown) => ({ current: value }),
    useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
    window: { bugPocket: bridge },
    AiReadinessMonitor, aiConfigurationReady, abortable, LatestAiRequest, aiPatch, mergeAiPatch, parseErrorForUI, getEntryDisplay
  });
  const api = useHook({
    bug: current, bugRef, settings, developerReadOnly: options.readOnly ?? false,
    setBug: update => { merges++; current = (typeof update === 'function' ? update(current) : update)!; },
    markDirty: () => { dirty++; }, showToast: message => { toasts.push(message); }
  });
  for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  return {
    api, state, stateWrites, calls, cancelled, toasts, bugRef,
    counts: () => ({ configReads, settingsReads, dirty, merges }),
    setConfiguration: (hasKey: unknown, enabled: unknown) => { key = hasKey; native = enabled; },
    setReaders: (config: () => Promise<unknown>, settingsReader: () => Promise<unknown>) => { readConfig = config; readSettings = settingsReader; },
    setDispatch: (value: () => Promise<AiRequestResult<string>>) => { dispatch = value; },
    edit: (patch: Partial<BugDetails>) => { current = { ...current, ...patch }; bugRef.current = current; },
    notify: () => { for (const notification of notifications) notification(); },
    unmount: () => { for (const cleanup of cleanups) cleanup(); },
    notificationCount: () => notifications.size
  };
}

test('fresh preflight rereads both safe sources and admits keyless explicitly enabled native', async () => {
  const h = harness(); await settle();
  h.setConfiguration(false, true);
  await h.api.triageWithLocalAi(' refinement ');
  assert.equal(h.calls.length, 1);
  assert.equal(h.counts().configReads, 2);
  assert.equal(h.counts().settingsReads, 2);
  assert.equal((h.calls[0].payload as { refinement_note: string }).refinement_note, 'refinement');
  assert.equal(h.bugRef.current?.title, 'AI title');
  assert.equal(h.counts().dirty, 1);
  h.unmount();
});

test('fresh key-clear/native-disable preflight denies stale mounted readiness without dispatch', async () => {
  const h = harness(); await settle();
  h.setConfiguration(false, false);
  await h.api.triageWithLocalAi();
  assert.equal(h.calls.length, 0);
  assert.equal(h.state[0], 'idle');
  assert.match(h.toasts[0], /API key or enable native Ollama/);
  assert.equal(h.counts().merges, 0);
  h.unmount();
});

test('fresh provider key presence remains eligible when native is disabled', async () => {
  const h = harness(); await settle();
  h.setConfiguration(true, false);
  await h.api.triageWithLocalAi();
  assert.equal(h.calls.length, 1, 'the renderer delegates authoritative BYOK-first routing to main');
  h.unmount();
});

for (const source of ['config rejection', 'settings rejection', 'malformed key', 'malformed native'] as const) {
  test(`preflight fails closed on ${source} without a result merge`, async () => {
    const h = harness(); await settle();
    h.setReaders(
      async () => { if (source === 'config rejection') throw new Error('synthetic failure'); return source === 'malformed key' ? {} : { hasApiKey: false }; },
      async () => { if (source === 'settings rejection') throw new Error('synthetic failure'); return source === 'malformed native' ? { aiTriageEnabled: 'true' } : { aiTriageEnabled: true }; }
    );
    await h.api.triageWithLocalAi();
    assert.equal(h.calls.length, 0);
    assert.equal(h.counts().merges, 0);
    assert.equal(h.state[0], 'idle');
    assert.equal(h.toasts.length, 1);
    h.unmount();
  });
}

test('settings notification overlapping preflight invalidates its older configuration', async () => {
  const h = harness(); await settle();
  const older = deferred<unknown>(); let reads = 0;
  h.setReaders(() => ++reads === 1 ? older.promise : Promise.resolve({ hasApiKey: false }), async () => ({ aiTriageEnabled: true }));
  const pending = h.api.triageWithLocalAi();
  h.notify(); await settle();
  older.resolve({ hasApiKey: true });
  await pending;
  assert.equal(h.calls.length, 0, 'a newer eligible configuration still cannot authorize an older preflight');
  assert.equal(h.counts().merges, 0);
  assert.equal(h.state[0], 'idle');
  h.unmount();
});

test('cancellation during preflight is not revived by settings refresh or its late read', async () => {
  const h = harness(); await settle();
  const pendingConfig = deferred<unknown>();
  h.setReaders(() => pendingConfig.promise, async () => ({ aiTriageEnabled: true }));
  const pending = h.api.triageWithLocalAi();
  h.api.cancelAi();
  h.setReaders(async () => ({ hasApiKey: false }), async () => ({ aiTriageEnabled: true }));
  h.notify(); await settle();
  pendingConfig.resolve({ hasApiKey: true }); await pending;
  assert.equal(h.calls.length, 0);
  assert.equal(h.state[0], 'idle');
  assert.equal(h.toasts.length, 0);
  assert.equal(h.cancelled.length, 1);
  h.unmount();
});

test('unmount cancels preflight, unsubscribes notifications and ignores late publication', async () => {
  const h = harness(); await settle();
  const pendingConfig = deferred<unknown>();
  h.setReaders(() => pendingConfig.promise, async () => ({ aiTriageEnabled: true }));
  const pending = h.api.triageWithLocalAi();
  h.unmount();
  const writes = h.stateWrites.length;
  pendingConfig.resolve({ hasApiKey: true }); await pending; await settle();
  assert.equal(h.calls.length, 0);
  assert.equal(h.stateWrites.length, writes);
  assert.equal(h.notificationCount(), 0);
  assert.equal(h.toasts.length, 0);
});

test('superseding request owns dispatch while older preflight resolves late', async () => {
  const h = harness(); await settle();
  const older = deferred<unknown>(); let reads = 0;
  h.setReaders(() => ++reads === 1 ? older.promise : Promise.resolve({ hasApiKey: false }), async () => ({ aiTriageEnabled: true }));
  const first = h.api.triageWithLocalAi();
  h.api.cancelAi();
  await h.api.triageWithLocalAi();
  older.resolve({ hasApiKey: true }); await first;
  assert.equal(h.calls.length, 1);
  assert.equal(h.counts().merges, 1);
  assert.equal(h.cancelled.length, 1);
  h.unmount();
});

test('rapid duplicate calls cannot dispatch or supersede an in-flight preflight', async () => {
  const h = harness(); await settle();
  const pendingConfig = deferred<unknown>();
  h.setReaders(() => pendingConfig.promise, async () => ({ aiTriageEnabled: true }));
  const first = h.api.triageWithLocalAi();
  const before = h.counts();
  await h.api.triageWithLocalAi();
  assert.deepEqual(h.counts(), before);
  assert.equal(h.cancelled.length, 0);
  assert.equal(h.calls.length, 0);
  pendingConfig.resolve({ hasApiKey: false }); await first;
  assert.equal(h.calls.length, 1);
  h.unmount();
});

test('cancelled older preflight cannot release the newer inference busy guard', async () => {
  const h = harness(); await settle();
  const older = deferred<unknown>(), inference = deferred<AiRequestResult<string>>();
  h.setReaders(() => older.promise, async () => ({ aiTriageEnabled: true }));
  const first = h.api.triageWithLocalAi();
  h.api.cancelAi();
  h.setReaders(async () => ({ hasApiKey: false }), async () => ({ aiTriageEnabled: true }));
  h.setDispatch(() => inference.promise);
  const second = h.api.triageWithLocalAi(); await settle();
  assert.equal(h.calls.length, 1);
  older.resolve({ hasApiKey: true }); await first;
  const before = h.counts();
  await h.api.triageWithLocalAi();
  assert.deepEqual(h.counts(), before);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state[0], 'loading');
  inference.resolve({ status: 'completed', value: '{"title":"new request"}' }); await second;
  await h.api.triageWithLocalAi();
  assert.equal(h.calls.length, 2, 'the owning request releases its guard after completion');
  h.unmount();
});

for (const guard of ['read-only', 'busy'] as const) {
  test(`${guard} guard prevents reads and dispatch at click`, async () => {
    const h = harness({ readOnly: guard === 'read-only', busy: guard === 'busy' }); await settle();
    const before = h.counts();
    await h.api.triageWithLocalAi();
    assert.equal(h.api.aiTriageDisabled, true);
    assert.deepEqual(h.counts(), before);
    assert.equal(h.calls.length, 0);
    h.unmount();
  });
}

test('readiness notifications update only configuration while inference stays loading', async () => {
  const h = harness(); await settle();
  const inference = deferred<AiRequestResult<string>>();
  h.setDispatch(() => inference.promise);
  const pending = h.api.triageWithLocalAi(); await settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.state[0], 'loading');
  const statusWrites = h.stateWrites.filter(write => write.slot === 0).length;
  for (const configuration of [[false, false], [false, true], [true, true]]) {
    h.setConfiguration(...configuration as [boolean, boolean]); h.notify(); await settle();
    assert.equal(h.state[0], 'loading');
  }
  assert.equal(h.stateWrites.filter(write => write.slot === 0).length, statusWrites);
  h.api.cancelAi(); await pending;
  inference.resolve({ status: 'completed', value: '{"title":"late"}' }); await settle();
  assert.equal(h.state[0], 'idle');
  assert.equal(h.counts().merges, 0);
  h.unmount();
});

test('native unavailable result remains a failure with no field merge', async () => {
  const h = harness(); await settle();
  h.setConfiguration(false, true);
  h.setDispatch(async () => ({ status: 'failed', message: serializeAiError(new AiPublicError('AI_NATIVE_CONNECTION')) }));
  await h.api.triageWithLocalAi();
  assert.equal(h.calls.length, 1);
  assert.equal(h.state[0], 'idle');
  assert.equal(h.counts().merges, 0);
  assert.equal(h.counts().dirty, 0);
  assert.equal(h.bugRef.current?.title, 'original');
  assert.deepEqual(h.toasts, [getAiErrorMessage('AI_NATIVE_CONNECTION')]);
  h.unmount();
});

test('deferred inference retains manual target and unrelated field edits through actual merge logic', async () => {
  const h = harness(); await settle();
  const inference = deferred<AiRequestResult<string>>();
  h.setDispatch(() => inference.promise);
  const pending = h.api.triageWithLocalAi(); await settle();
  h.edit({ title: 'manual title', device: 'manual device' });
  h.api.noteUserEdit('title');
  inference.resolve({ status: 'completed', value: JSON.stringify({ title: 'AI replacement', bugNote: 'AI note' }) });
  await pending;
  assert.equal(h.bugRef.current?.title, 'manual title');
  assert.equal(h.bugRef.current?.device, 'manual device');
  assert.equal(h.bugRef.current?.note, 'AI note');
  assert.equal(h.counts().merges, 1);
  assert.equal(h.counts().dirty, 1);
  h.unmount();
});
