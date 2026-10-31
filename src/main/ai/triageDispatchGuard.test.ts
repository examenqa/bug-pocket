import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import compiler from 'typescript';
import { createTriageDispatchGuard, type AiDispatchGuard } from './triageDispatchGuard';
import { callOpenAiCompatibleChatWithFallback, GEMINI_MODEL_CASCADE } from './openAiCompatibleChat';
import { AiRequestRegistry } from './aiRequestRegistry';
import { OperationBarrier } from '../OperationBarrier';
import { AiPublicError, parseAiErrorCode, serializeAiError, getAiErrorMessage } from '../../shared/aiError';
import { AiCancelledError, AiTimeoutError, withAiDeadline } from '../../shared/aiRequest';
import { normalizeOllamaModelName } from '../../shared/ollamaModel';
import { normalizeByokBaseUrl } from './byokEndpoint';
import { parseErrorForUI } from '../../renderer/src/utils/errors';

const privateWorkspace = 'SYNTHETIC_WORKSPACE_NOT_PUBLIC';
const deniedWire = '{"code":"AI_TRIAGE_BLOCKED"}';
const input = { apiKey: 'synthetic-key', baseUrl: 'https://synthetic.invalid/v1', modelId: 'primary', provider: 'Gemini' as const, systemPrompt: '', userPrompt: '' };
function state(workspace: string | null = privateWorkspace, write = true) {
  const current = { workspace, write, shutdown: false, maintenance: false };
  let permissionReads = 0;
  const guard = createTriageDispatchGuard({
    getCurrentWorkspaceId: () => current.workspace,
    canWrite: id => { assert.equal(id, privateWorkspace); permissionReads++; return current.write; },
    isShuttingDown: () => current.shutdown,
    isInMaintenance: () => current.maintenance
  });
  return { current, guard, permissionReads: () => permissionReads };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(ready => { resolve = ready; });
  return { promise, resolve };
}
function blocked(error: unknown): boolean {
  assert.equal(serializeAiError(error), deniedWire);
  assert.equal(parseErrorForUI(new Error(serializeAiError(error))), getAiErrorMessage('AI_TRIAGE_BLOCKED'));
  assert.doesNotMatch(serializeAiError(error), /SYNTHETIC|cause|stack|workspaceId/);
  return true;
}

// Direct production guard/transport tests use only synthetic mutable state/fetch.
// Native and Electron-bound wrappers execute exact production AST declarations
// with injected dependencies; no copied dispatch or retry implementation.
function production(relative: string, names: string[], dependencies: Record<string, unknown>): Record<string, any> {
  const filename = resolve(__dirname, relative), source = readFileSync(filename, 'utf8');
  const ast = compiler.createSourceFile(filename, source, compiler.ScriptTarget.ES2022, true);
  const nodes = ast.statements.filter(n => compiler.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ''));
  assert.equal(nodes.length, names.length);
  const output = compiler.transpileModule(nodes.map(n => source.slice(n.pos, n.end)).join('\n'), {
    compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS }
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(output + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n'), {
    exports, JSON, Error, Buffer, ...dependencies
  }, { filename, timeout: 2_000 });
  return exports;
}
function native(preparation: Promise<string>, fetcher: typeof fetch) {
  return production('./ollamaTriage.ts', ['triageBugWithOllama'], {
    withAiDeadline, AiPublicError, serializeAiError, normalizeOllamaModelName,
    readImageAsBase64: () => preparation, buildBugTriagePrompt: () => 'synthetic note',
    parseTriageJson: () => ({}), fallbackTriage: () => ({}),
    ollamaChatUrl: 'http://localhost:11434/api/chat', systemPrompt: 'synthetic', fetch: fetcher
  }).triageBugWithOllama;
}
function byok() {
  return production('./byokIssueProcessor.ts', ['triageBugWithByokAi'], {
    getByokAiConfig: () => ({ provider: 'Gemini', baseUrl: input.baseUrl, modelId: input.modelId, customSystemPrompt: '' }),
    decryptStoredApiKey: () => 'synthetic-key', safeStorage: {}, AiPublicError,
    normalizeByokBaseUrl, GEMINI_MODEL_CASCADE,
    normalizeSystemPrompt: () => '', buildTriagePrompt: () => 'synthetic note', readBugImageDataUrl: () => undefined,
    callOpenAiCompatibleChatWithFallback, extractJsonObjectString: (value: string) => value
  }).triageBugWithByokAi;
}
async function hosted(fetcher: typeof fetch, work: () => Promise<void>) {
  const previous = globalThis.fetch, previousInfo = console.info;
  globalThis.fetch = fetcher; console.info = () => {};
  try { await work(); } finally { globalThis.fetch = previous; console.info = previousInfo; }
}

test('guard captures origin, rejects revoked cached permission and emits only fixed owned guidance', () => {
  const fixture = state(); const signal = new AbortController().signal;
  assert.equal(fixture.guard(signal), undefined);
  fixture.current.write = false;
  assert.throws(() => fixture.guard(signal), blocked);
});

for (const [origin, changed] of [[privateWorkspace, 'different'], [privateWorkspace, null], [null, privateWorkspace]] as const) {
  test(`guard rejects changed workspace identity (${origin === null ? 'local' : 'workspace'} to ${changed === null ? 'local' : 'workspace'})`, () => {
    const fixture = state(origin); fixture.current.workspace = changed;
    assert.throws(() => fixture.guard(new AbortController().signal), blocked);
    assert.equal(fixture.permissionReads(), 0, 'changed identity must not query a different workspace permission');
  });
}

test('writable and unchanged local/no-workspace access remain allowed', () => {
  const workspace = state(); workspace.guard(new AbortController().signal);
  const local = state(null, false); local.guard(new AbortController().signal);
  assert.equal(workspace.permissionReads(), 1); assert.equal(local.permissionReads(), 0);
});

test('ordinary concurrent operations do not mean maintenance', async () => {
  const barrier = new OperationBarrier(), work = deferred<void>();
  const active = barrier.acquire(() => work.promise);
  const guard = createTriageDispatchGuard({ getCurrentWorkspaceId: () => null, canWrite: () => false,
    isShuttingDown: () => false, isInMaintenance: () => barrier.isInMaintenance });
  assert.equal(barrier.activeCount, 1); guard(new AbortController().signal);
  barrier.enterMaintenance(); assert.throws(() => guard(new AbortController().signal), blocked);
  barrier.exitMaintenance(); work.resolve(); await active;
});

test('unexpected state-reader failures fail closed without publishing details', () => {
  assert.throws(() => createTriageDispatchGuard({ getCurrentWorkspaceId: () => { throw new Error(privateWorkspace); },
    canWrite: () => true, isShuttingDown: () => false, isInMaintenance: () => false }), blocked);
  for (const failing of ['workspace', 'permission', 'shutdown', 'maintenance']) {
    let captured = false;
    const read = (field: string, value: any) => { if (captured && field === failing) throw new Error(privateWorkspace); return value; };
    const guard = createTriageDispatchGuard({ getCurrentWorkspaceId: () => read('workspace', privateWorkspace),
      canWrite: () => read('permission', true), isShuttingDown: () => read('shutdown', false), isInMaintenance: () => read('maintenance', false) });
    captured = true; assert.throws(() => guard(new AbortController().signal), blocked);
  }
});

test('effective cancellation and timeout reasons survive before any state read', () => {
  for (const reason of [new AiCancelledError(), new AiTimeoutError()]) {
    const fixture = state(), controller = new AbortController(); controller.abort(reason);
    assert.throws(() => fixture.guard(controller.signal), error => error === reason);
    assert.equal(fixture.permissionReads(), 0);
  }
});

for (const status of [429, 503]) {
  for (const mutation of ['permission', 'workspace', 'maintenance', 'shutdown'] as const) {
    test(`actual BYOK wrapper rejects ${mutation} change after ${status} without a fallback send`, { concurrency: false }, async () => {
      const fixture = state(), reply = deferred<Response>(); let sends = 0;
      const processor = byok();
      await hosted((async () => { sends++; return reply.promise; }) as typeof fetch, async () => {
        const result = new AiRequestRegistry().run(1, 'synthetic', signal => processor({ getEncryptedByokAiApiKey: () => '' }, {}, signal, fixture.guard));
        assert.equal(sends, 1);
        if (mutation === 'permission') fixture.current.write = false;
        if (mutation === 'workspace') fixture.current.workspace = 'different';
        if (mutation === 'maintenance') fixture.current.maintenance = true;
        if (mutation === 'shutdown') fixture.current.shutdown = true;
        reply.resolve({ ok: false, status, get statusText() { throw new Error(privateWorkspace); }, text: () => { throw new Error(privateWorkspace); } } as unknown as Response);
        assert.deepEqual(await result, { status: 'failed', message: deniedWire });
        assert.equal(sends, 1);
      });
    });
  }
}

test('initially denied hosted dispatch makes zero sends and is not a connection error', async () => {
  const fixture = state(privateWorkspace, false); let sends = 0;
  await hosted((async () => { sends++; throw new Error('must not send'); }) as typeof fetch, async () => {
    await assert.rejects(callOpenAiCompatibleChatWithFallback({ ...input, dispatchGuard: fixture.guard }), blocked);
    assert.equal(sends, 0);
  });
});

test('allowed retries keep ordering/deduplication and recheck the effective child signal for each send', async () => {
  for (const workspace of [privateWorkspace, null]) {
    const fixture = state(workspace, workspace !== null), parent = new AbortController();
    const models: string[] = [], guards: AbortSignal[] = [];
    const guard: AiDispatchGuard = signal => { guards.push(signal); return fixture.guard(signal); };
    await hosted((async (_url, options) => {
      const request = options!; assert.equal(guards.length, models.length + 1);
      assert.equal(request.signal, guards.at(-1)); assert.notEqual(request.signal, parent.signal);
      models.push(JSON.parse(String(request.body)).model);
      return models.length < 3 ? { ok: false, status: models.length === 1 ? 429 : 503 } as Response
        : { ok: true, text: async () => '{"choices":[{"message":{"content":"{}"}}]}' } as Response;
    }) as typeof fetch, async () => {
      assert.equal(await callOpenAiCompatibleChatWithFallback({ ...input, modelId: GEMINI_MODEL_CASCADE[0], signal: parent.signal, dispatchGuard: guard }), '{}');
      assert.deepEqual(models, [...GEMINI_MODEL_CASCADE]); assert.equal(guards.length, 3);
    });
  }
});

for (const mutation of ['permission', 'workspace', 'maintenance', 'shutdown'] as const) {
  test(`native ${mutation} change during deferred preparation makes zero sends`, async () => {
    const fixture = state(), preparation = deferred<string>(); let sends = 0;
    const invoke = native(preparation.promise, (async () => { sends++; throw new Error('must not send'); }) as typeof fetch);
    const result = invoke({ note: 'synthetic' }, 'test:1', 'synthetic-image', undefined, fixture.guard);
    if (mutation === 'permission') fixture.current.write = false;
    if (mutation === 'workspace') fixture.current.workspace = 'different';
    if (mutation === 'maintenance') fixture.current.maintenance = true;
    if (mutation === 'shutdown') fixture.current.shutdown = true;
    preparation.resolve('synthetic-base64');
    assert.equal((await result).error, deniedWire); assert.equal(sends, 0);
  });
}

test('late native preparation cannot send after effective cancellation even without an optional guard', async () => {
  const preparation = deferred<string>(), controller = new AbortController(); let sends = 0;
  const invoke = native(preparation.promise, (async () => { sends++; throw new Error('must not send'); }) as typeof fetch);
  const result = invoke({ note: 'synthetic' }, 'test:1', 'synthetic-image', controller.signal);
  const rejected = assert.rejects(result, AiCancelledError);
  controller.abort(new AiCancelledError()); preparation.resolve('synthetic-base64');
  await rejected; await Promise.resolve(); await Promise.resolve(); assert.equal(sends, 0);
});

test('allowed native uses the effective deadline signal after preparation', async () => {
  for (const workspace of [privateWorkspace, null]) {
    const fixture = state(workspace, workspace !== null), parent = new AbortController(); let checked: AbortSignal | undefined;
    const guard: AiDispatchGuard = signal => { checked = signal; return fixture.guard(signal); };
    let sends = 0;
    const invoke = native(Promise.resolve('synthetic-base64'), (async (_url, request) => {
      sends++; assert.equal(request?.signal, checked); assert.notEqual(checked, parent.signal);
      return { ok: true, json: async () => ({ message: { content: '{}' } }) } as Response;
    }) as typeof fetch);
    assert.equal((await invoke({ note: 'synthetic' }, 'test:1', 'synthetic-image', parent.signal, guard)).success, true);
    assert.equal(sends, 1);
  }
});

test('main configured routing forwards the same captured guard to each provider path without native fallback', async () => {
  for (const hasKey of [true, false]) {
    const fixture = state(), signal = new AbortController().signal; let byokCalls = 0, nativeCalls = 0;
    const api = production('../index.ts', ['triageBugWithConfiguredAi', 'normalizeOllamaTriageResult'], {
      db: { getAiTriageEnabled: () => true, getOllamaModelName: () => 'test:1' }, getByokAiConfig: () => ({ hasApiKey: hasKey }),
      AiPublicError, parseAiErrorCode, resolveVerifiedTriageAttachmentPath: () => undefined,
      triageBugWithByokAi: async (_db: unknown, _payload: unknown, s: AbortSignal, g: AiDispatchGuard) => { byokCalls++; assert.equal(s, signal); assert.equal(g, fixture.guard); throw new AiPublicError('AI_TRIAGE_BLOCKED'); },
      triageBugWithOllama: async (_payload: unknown, _model: unknown, _image: unknown, s: AbortSignal, g: AiDispatchGuard) => { nativeCalls++; assert.equal(s, signal); assert.equal(g, fixture.guard); return { success: false, error: deniedWire }; }
    });
    await assert.rejects(api.triageBugWithConfiguredAi({}, signal, fixture.guard), blocked);
    assert.equal(byokCalls, hasKey ? 1 : 0); assert.equal(nativeCalls, hasKey ? 0 : 1);
  }
});
