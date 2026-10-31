import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import compiler from 'typescript';
import { normalizeOllamaModelName } from '../../../../shared/ollamaModel';

// Execute the exact production handler with injected bridge/state setters. This
// is AST isolation under host Node, not a mounted React or real IPC acceptance test.
const filename = resolve(__dirname, 'AiSettings.tsx');
const source = readFileSync(filename, 'utf8');
const parsed = compiler.createSourceFile(filename, source, compiler.ScriptTarget.ES2022, true, compiler.ScriptKind.TSX);
const component = parsed.statements.find(statement => compiler.isFunctionDeclaration(statement) && statement.name?.text === 'NativeOllamaSettings');
assert.ok(component && compiler.isFunctionDeclaration(component) && component.body);
const declaration = component.body.statements.find(statement => compiler.isVariableStatement(statement)
  && statement.declarationList.declarations.some(item => compiler.isIdentifier(item.name) && item.name.text === 'saveNativeSettings'));
assert.ok(declaration, 'select the production native Save handler');
const compiled = compiler.transpileModule(declaration.getText(parsed), {
  fileName: filename,
  compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS }
}).outputText;

const nativeEffect = component.body.statements.find(statement => compiler.isExpressionStatement(statement)
  && compiler.isCallExpression(statement.expression) && compiler.isIdentifier(statement.expression.expression)
  && statement.expression.expression.text === 'useEffect');
assert.ok(nativeEffect && compiler.isExpressionStatement(nativeEffect) && compiler.isCallExpression(nativeEffect.expression));
const effectCallback = nativeEffect.expression.arguments[0];
assert.ok(effectCallback && compiler.isArrowFunction(effectCallback));
const compiledEffect = compiler.transpileModule(`const nativeSettingsEffect = ${effectCallback.getText(parsed)};`, {
  fileName: filename,
  compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS }
}).outputText;

async function flushReads(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function readFixture() {
  const state: Record<string, unknown> = { loaded: false, enabled: false, modelName: '', error: '' };
  const reads: Array<{ resolve(value: unknown): void; reject(reason: Error): void }> = [];
  const refs = { mounted: { current: false }, savingRef: { current: false }, readGeneration: { current: 0 }, draftDirty: { current: false }, reloadNativeSettings: { current: null as (() => Promise<void>) | null } };
  let listener: (() => void) | undefined;
  let unsubscriptions = 0;
  const exports: { effect?: () => () => void } = {};
  runInNewContext(`${compiledEffect}\nexports.effect = nativeSettingsEffect;`, {
    exports, Error, ...refs,
    window: { bugPocket: {
      getSettings: () => new Promise((resolveRead, rejectRead) => { reads.push({ resolve: resolveRead, reject: rejectRead }); }),
      onSettingsChanged: (callback: () => void) => { listener = callback; return () => { unsubscriptions++; listener = undefined; }; }
    } },
    setEnabled: (value: boolean) => { state.enabled = value; },
    setModelName: (value: string) => { state.modelName = value; },
    setLoaded: (value: boolean) => { state.loaded = value; },
    setError: (value: string) => { state.error = value; }
  }, { filename, timeout: 2_000 });
  assert.ok(exports.effect);
  const cleanup = exports.effect();
  return { state, reads, refs, cleanup, notify: () => { assert.ok(listener); listener(); }, unsubscriptions: () => unsubscriptions };
}

function fixture(overrides: Record<string, unknown> = {}, update?: (enabled: boolean, replacement: string) => Promise<{ enabled: boolean; modelName: string }>) {
  const calls: Array<[boolean, string]> = [];
  const state: Record<string, unknown> = {};
  const byokDrafts = { provider: 'Gemini', baseUrl: 'https://draft.invalid', modelId: 'draft-model', apiKey: 'synthetic-unsaved-key', prompt: 'unsaved prompt', editingPrompt: true, cancelPrompt: 'before edit' };
  const keys = { Gemini: 'synthetic-ciphertext', OpenAI: 'other-ciphertext' };
  const before = JSON.stringify({ byokDrafts, keys });
  let refreshes = 0;
  const refs = { mounted: { current: true }, savingRef: { current: false }, readGeneration: { current: 0 }, draftDirty: { current: true }, modelEdited: { current: false }, reloadNativeSettings: { current: null as (() => Promise<void>) | null } };
  const bridge = new Proxy({
    updateAiTriageOptions: async (enabled: boolean, replacement: string) => {
      calls.push([enabled, replacement]);
      return update ? await update(enabled, replacement) : { enabled, modelName: replacement || 'retained-model:8b' };
    }
  }, { get(target, key) { assert.equal(key, 'updateAiTriageOptions', 'native Save cannot call BYOK, credential, daemon or inference operations'); return target[key as keyof typeof target]; } });
  const exports: { run?: () => Promise<void> } = {};
  runInNewContext(`${compiled}\nexports.run = saveNativeSettings;`, {
    exports, Error, normalizeOllamaModelName, window: { bugPocket: bridge },
    enabled: true, modelName: 'unchanged-legacy model', mutationReady: true, loaded: true,
    ...refs, byokDrafts, keys,
    setEnabled: (value: boolean) => { state.enabled = value; },
    setModelName: (value: string) => { state.modelName = value; },
    setSaving: (value: boolean) => { state.saving = value; },
    setStatus: (value: string) => { state.status = value; },
    setError: (value: string) => { state.error = value; },
    refresh: async () => { refreshes++; }, ...overrides
  }, { filename, timeout: 2_000 });
  assert.ok(exports.run);
  return { run: exports.run, calls, state, refs, refreshes: () => refreshes, assertByokPreserved: () => assert.equal(JSON.stringify({ byokDrafts, keys }), before) };
}

test('native Save only updates native options, preserving all BYOK drafts and provider keys', async () => {
  const saved = fixture();
  await saved.run();
  assert.deepEqual(saved.calls, [[true, '']]);
  assert.equal(saved.state.modelName, 'retained-model:8b');
  assert.equal(saved.refreshes(), 1);
  assert.equal(saved.refs.modelEdited.current, false);
  assert.equal(saved.refs.draftDirty.current, false);
  assert.equal(saved.state.saving, false);
  saved.assertByokPreserved();
});

test('native Save normalizes an explicit replacement without touching BYOK', async () => {
  const saved = fixture({ modelName: '  qwen3-vl:8b  ', modelEdited: { current: true } });
  await saved.run();
  assert.deepEqual(saved.calls, [[true, 'qwen3-vl:8b']]);
  saved.assertByokPreserved();
});

test('native disable retains an unchanged invalid legacy model', async () => {
  const saved = fixture({ enabled: false });
  await saved.run();
  assert.deepEqual(saved.calls, [[false, '']]);
  saved.assertByokPreserved();
});

test('native Save rejects edited empty or invalid replacements, including while disabling', async () => {
  for (const modelName of ['', '   ', 'invalid model', 'namespace/model']) {
    const saved = fixture({ enabled: false, modelName, modelEdited: { current: true } });
    await saved.run();
    assert.deepEqual(saved.calls, []);
    assert.equal(saved.refreshes(), 0);
    assert.equal(typeof saved.state.error, 'string');
    saved.assertByokPreserved();
  }
});

test('native Save fails closed before initial settings load and respects mutation/busy guards', async () => {
  for (const guards of [{ loaded: false }, { mutationReady: false }, { savingRef: { current: true } }]) {
    const saved = fixture(guards);
    await saved.run();
    assert.deepEqual(saved.calls, []);
    assert.equal(saved.refreshes(), 0);
    saved.assertByokPreserved();
  }
});

test('native Save failures preserve drafts and release busy state without raw error text', async () => {
  const saved = fixture({}, async () => { throw new Error('synthetic-private-upstream-details'); });
  await saved.run();
  assert.equal(saved.state.saving, false);
  assert.equal(saved.refreshes(), 0);
  assert.equal(saved.refs.draftDirty.current, true);
  assert.equal(String(saved.state.error).includes('synthetic-private-upstream-details'), false);
  saved.assertByokPreserved();
});

test('native Save result after unmount does not apply state or refresh', async () => {
  let finish: ((value: { enabled: boolean; modelName: string }) => void) | undefined;
  const saved = fixture({}, () => new Promise(resolveResult => { finish = resolveResult; }));
  const pending = saved.run();
  saved.refs.mounted.current = false;
  finish!({ enabled: true, modelName: 'late-model' });
  await pending;
  assert.equal(saved.state.modelName, undefined);
  assert.equal(saved.refreshes(), 0);
  assert.equal(saved.refs.draftDirty.current, true);
  saved.assertByokPreserved();
});

test('actual native settings effect fails closed on initial failure and recovers on notification', async () => {
  const loaded = readFixture();
  loaded.reads[0].reject(new Error('synthetic-private-configuration-details'));
  await flushReads();
  assert.equal(loaded.state.loaded, false);
  assert.equal(loaded.state.modelName, '');
  assert.equal(String(loaded.state.error).includes('synthetic-private-configuration-details'), false);
  loaded.notify();
  loaded.reads[1].resolve({ aiTriageEnabled: true, ollamaModelName: 'qwen3-vl:8b' });
  await flushReads();
  assert.equal(loaded.state.loaded, true);
  assert.equal(loaded.state.enabled, true);
  assert.equal(loaded.state.modelName, 'qwen3-vl:8b');
  assert.equal(loaded.state.error, '');
  loaded.cleanup();
});

test('actual native settings effect rejects malformed configuration rather than assuming defaults', async () => {
  for (const settings of [null, {}, { aiTriageEnabled: 'true', ollamaModelName: 'qwen3-vl:8b' }, { aiTriageEnabled: false }, { aiTriageEnabled: true, ollamaModelName: 17 }]) {
    const loaded = readFixture();
    loaded.reads[0].resolve(settings);
    await flushReads();
    assert.equal(loaded.state.loaded, false);
    assert.equal(loaded.state.modelName, '');
    assert.ok(loaded.state.error);
    loaded.cleanup();
  }
});

test('actual native settings effect applies only the newest notification read', async () => {
  const loaded = readFixture();
  loaded.notify();
  loaded.reads[1].resolve({ aiTriageEnabled: true, ollamaModelName: 'newest:8b' });
  await flushReads();
  loaded.reads[0].resolve({ aiTriageEnabled: false, ollamaModelName: 'stale:8b' });
  await flushReads();
  assert.equal(loaded.state.enabled, true);
  assert.equal(loaded.state.modelName, 'newest:8b');
  loaded.notify();
  loaded.notify();
  loaded.reads[3].resolve({ aiTriageEnabled: false, ollamaModelName: 'latest:8b' });
  await flushReads();
  loaded.reads[2].reject(new Error('obsolete-failure'));
  await flushReads();
  assert.equal(loaded.state.loaded, true);
  assert.equal(loaded.state.enabled, false);
  assert.equal(loaded.state.modelName, 'latest:8b');
  assert.equal(loaded.state.error, '');
  loaded.cleanup();
});

test('actual native settings effect preserves dirty drafts and in-flight Save state on notifications', async () => {
  for (const guard of ['draftDirty', 'savingRef'] as const) {
    const loaded = readFixture();
    loaded.reads[0].resolve({ aiTriageEnabled: false, ollamaModelName: 'original:8b' });
    await flushReads();
    loaded.state.enabled = true;
    loaded.state.modelName = 'unsaved-native-model:8b';
    loaded.refs[guard].current = true;
    loaded.notify();
    loaded.reads[1].resolve({ aiTriageEnabled: false, ollamaModelName: 'external-change:8b' });
    await flushReads();
    assert.equal(loaded.state.enabled, true);
    assert.equal(loaded.state.modelName, 'unsaved-native-model:8b');
    loaded.cleanup();
  }
});

test('actual native settings effect unsubscribes and ignores success or failure after unmount', async () => {
  for (const fail of [false, true]) {
    const loaded = readFixture();
    loaded.cleanup();
    assert.equal(loaded.unsubscriptions(), 1);
    if (fail) loaded.reads[0].reject(new Error('late-failure'));
    else loaded.reads[0].resolve({ aiTriageEnabled: true, ollamaModelName: 'late:8b' });
    await flushReads();
    assert.equal(loaded.state.loaded, false);
    assert.equal(loaded.state.enabled, false);
    assert.equal(loaded.state.modelName, '');
    assert.equal(loaded.state.error, '');
  }
});

test('actual native Save reconciles a cross-window update received during its refresh', async () => {
  const reads: Array<(value: unknown) => void> = [];
  const nativeSaves: Array<[boolean, string]> = [];
  const refs = {
    mounted: { current: false }, savingRef: { current: false }, readGeneration: { current: 0 },
    draftDirty: { current: false }, modelEdited: { current: false }, reloadNativeSettings: { current: null as (() => Promise<void>) | null }
  };
  let notify: (() => void) | undefined;
  let finishRefresh: (() => void) | undefined;
  const exports: { effect?: () => () => void; run?: () => Promise<void> } = {};
  const context: Record<string, unknown> = {
    exports, Error, normalizeOllamaModelName, ...refs,
    enabled: false, modelName: '', loaded: false, mutationReady: true,
    window: { bugPocket: new Proxy({
      getSettings: () => new Promise(resolveRead => { reads.push(resolveRead); }),
      onSettingsChanged: (callback: () => void) => { notify = callback; return () => { notify = undefined; }; },
      updateAiTriageOptions: async (enabled: boolean, replacement: string) => {
        nativeSaves.push([enabled, replacement]);
        return { enabled, modelName: 'own-save:8b' };
      }
    }, { get(target, key) { assert.ok(['getSettings', 'onSettingsChanged', 'updateAiTriageOptions'].includes(String(key)), 'native reconciliation may only use safe native settings APIs'); return target[key as keyof typeof target]; } }) },
    refresh: () => new Promise<void>(resolveRefresh => { finishRefresh = resolveRefresh; })
  };
  for (const field of ['enabled', 'modelName', 'loaded', 'saving', 'status', 'error']) {
    context[`set${field[0].toUpperCase()}${field.slice(1)}`] = (value: unknown) => { context[field] = value; };
  }
  runInNewContext(`${compiled}\n${compiledEffect}\nexports.run = saveNativeSettings; exports.effect = nativeSettingsEffect;`, context, { filename, timeout: 2_000 });
  assert.ok(exports.effect && exports.run);
  const cleanup = exports.effect();
  reads[0]({ aiTriageEnabled: false, ollamaModelName: 'original:8b' });
  await flushReads();
  context.enabled = true;
  refs.draftDirty.current = true;
  const pending = exports.run();
  await flushReads();
  assert.equal(refs.savingRef.current, true);
  assert.equal(context.modelName, 'own-save:8b');
  assert.ok(notify);
  notify();
  reads[1]({ aiTriageEnabled: false, ollamaModelName: 'external-update:8b' });
  await flushReads();
  assert.equal(context.modelName, 'own-save:8b', 'in-flight Save still protects drafts');
  assert.ok(finishRefresh);
  finishRefresh();
  await pending;
  assert.equal(refs.savingRef.current, false);
  assert.equal(reads.length, 3, 'Save must reread after releasing its draft guard');
  reads[2]({ aiTriageEnabled: false, ollamaModelName: 'external-update:8b' });
  await flushReads();
  assert.equal(context.enabled, false);
  assert.equal(context.modelName, 'external-update:8b');
  assert.deepEqual(nativeSaves, [[true, '']]);
  cleanup();
});
