import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import compiler from 'typescript';
import { AiPublicError, parseAiErrorCode, serializeAiError } from '../../shared/aiError';
import { DEFAULT_OLLAMA_MODEL_NAME, normalizeOllamaModelName } from '../../shared/ollamaModel';
import { assertWorkspaceWriteAccess } from '../ipc/workspaceWriteAccess';
import { createTriageDispatchGuard } from './triageDispatchGuard';
import { createIpcArgumentValidators } from '../ipc/secureIpc';
import { buildRendererByokAiConfig, decryptStoredApiKey } from './byokConfigResponse';

// These fixtures execute exact production AST spans with explicit fake native
// dependencies. They do not mount IPC, SQLite, safeStorage, React or Electron.
function parsed(relative: string) {
  const filename = resolve(__dirname, relative);
  const source = readFileSync(filename, 'utf8');
  return { source, filename, ast: compiler.createSourceFile(filename, source, compiler.ScriptTarget.ES2022, true) };
}

function evaluate(source: string, dependencies: Record<string, unknown>): Record<string, any> {
  const exports: Record<string, any> = {};
  const compiled = compiler.transpileModule(source, {
    compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS }
  }).outputText;
  runInNewContext(compiled, { exports, Error, JSON, ...dependencies }, { timeout: 2_000 });
  return exports;
}

function productionFunctions(names: string[], dependencies: Record<string, unknown>) {
  const { source, ast } = parsed('../index.ts');
  const nodes = ast.statements.filter(statement => compiler.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? ''));
  assert.equal(nodes.length, names.length);
  return evaluate(nodes.map(node => source.slice(node.pos, node.end)).join('\n') + '\n' + names.map(name => `exports.${name} = ${name};`).join('\n'), dependencies);
}

function settingsFixture(retained = 'retained:7b') {
  const { source, ast } = parsed('../database.ts');
  const database = ast.statements.find(statement => compiler.isClassDeclaration(statement) && statement.name?.text === 'BugPocketDatabase');
  assert.ok(database && compiler.isClassDeclaration(database));
  const method = database.members.find(member => compiler.isMethodDeclaration(member) && member.name.getText(ast) === 'updateAiTriageOptions');
  assert.ok(method);
  const { SettingsFixture } = evaluate(`class SettingsFixture { ${source.slice(method.pos, method.end)} }\nexports.SettingsFixture = SettingsFixture;`, { normalizeOllamaModelName });
  const state: Record<string, string> = {
    ai_triage_enabled: 'true', ollama_model_name: retained,
    byok_ai_provider: 'OpenRouter', byok_ai_base_url: 'https://synthetic.invalid/v1',
    byok_ai_model_id: 'byok:unchanged', byok_ai_custom_system_prompt: 'Retain prompt',
    byok_ai_api_keys_encrypted: '{"OpenRouter":"synthetic-ciphertext","OpenAI":"other-ciphertext"}'
  };
  let writes = 0;
  const instance = new SettingsFixture();
  Object.assign(instance, {
    localDb: { transaction: (work: () => void) => work },
    db: { transaction: () => { throw new Error('Settings must transact in local storage'); } },
    getOllamaModelName: () => state.ollama_model_name.trim() || DEFAULT_OLLAMA_MODEL_NAME,
    setSetting: (key: string, value: string) => { writes++; state[key] = value; }
  });
  return { state, update: (enabled: boolean, model: string) => instance.updateAiTriageOptions(enabled, model), writes: () => writes };
}

test('shared native model validation preserves execution grammar, trimming and blank default', () => {
  for (const model of ['qwen3-vl:8b', 'ALPHA_2.1:Q4-K_M', 'a', ':', '.', '-']) assert.equal(normalizeOllamaModelName(` ${model} `), model);
  for (const model of ['', '   ', '\t']) assert.equal(normalizeOllamaModelName(model), DEFAULT_OLLAMA_MODEL_NAME);
  for (const model of ['name with space', 'namespace/model', 'http://model', 'model\nname', 'model?', 'mødel']) {
    assert.throws(() => normalizeOllamaModelName(model), error => parseAiErrorCode(serializeAiError(error)) === 'AI_NATIVE_MODEL_INVALID');
  }
});

test('invalid native replacements reject before any setting mutation, including disable', () => {
  for (const enabled of [false, true]) {
    const fixture = settingsFixture();
    const before = { ...fixture.state };
    assert.throws(() => fixture.update(enabled, 'invalid/model'), error => parseAiErrorCode(serializeAiError(error)) === 'AI_NATIVE_MODEL_INVALID');
    assert.deepEqual(fixture.state, before);
    assert.equal(fixture.writes(), 0);
  }
});

test('native enablement retains the model unless replaced and leaves all BYOK settings and keys intact', () => {
  const fixture = settingsFixture();
  const byokBefore = Object.fromEntries(Object.entries(fixture.state).filter(([key]) => key.startsWith('byok_')));
  fixture.update(false, '');
  assert.equal(fixture.state.ollama_model_name, 'retained:7b');
  fixture.update(true, ' chosen:9b ');
  assert.equal(fixture.state.ollama_model_name, 'chosen:9b');
  fixture.update(false, '');
  assert.equal(fixture.state.ollama_model_name, 'chosen:9b');
  assert.deepEqual(Object.fromEntries(Object.entries(fixture.state).filter(([key]) => key.startsWith('byok_'))), byokBefore);
});

test('invalid legacy model can be disabled unchanged but cannot be enabled until validly replaced', () => {
  const fixture = settingsFixture('legacy invalid/model');
  const disabled = fixture.update(false, '');
  assert.equal(disabled.modelName, 'legacy invalid/model');
  assert.equal(fixture.state.ai_triage_enabled, 'false');
  assert.equal(fixture.state.ollama_model_name, 'legacy invalid/model');
  const before = { ...fixture.state };
  assert.throws(() => fixture.update(true, ''), error => parseAiErrorCode(serializeAiError(error)) === 'AI_NATIVE_MODEL_INVALID');
  assert.deepEqual(fixture.state, before);
  fixture.update(true, 'qwen3-vl:8b');
  assert.equal(fixture.state.ai_triage_enabled, 'true');
  assert.equal(fixture.state.ollama_model_name, 'qwen3-vl:8b');
});

test('native IPC arguments allow unchanged model sentinel and retain type/length boundaries', () => {
  const validate = createIpcArgumentValidators()['settings:updateAiTriageOptions'];
  validate([false, '']);
  validate([true, 'qwen3-vl:8b']);
  for (const args of [[true], [false, null], ['true', 'model'], [true, 'x'.repeat(501)], [false, '', 'extra']]) assert.throws(() => validate(args));
});

function dispatchFixture(hasKey: boolean, nativeEnabled: boolean, byokError?: Error) {
  const calls = { byok: 0, native: 0 };
  const api = productionFunctions(['triageBugWithConfiguredAi', 'normalizeOllamaTriageResult'], {
    AiPublicError, parseAiErrorCode,
    db: { getAiTriageEnabled: () => nativeEnabled, getOllamaModelName: () => 'retained:7b' },
    getByokAiConfig: () => ({ hasApiKey: hasKey }),
    triageBugWithByokAi: async () => { calls.byok++; if (byokError) throw byokError; return 'BYOK'; },
    resolveVerifiedTriageAttachmentPath: () => undefined,
    triageBugWithOllama: async () => { calls.native++; return { success: true, result: { bug_title: 'Native', refined_summary: 'Local' } }; }
  });
  return { calls, dispatch: () => api.triageBugWithConfiguredAi({ note: 'synthetic' }, new AbortController().signal) };
}

test('main routing remains BYOK-first across the diagnosed key/native state table', async () => {
  for (const [key, native] of [[true, true], [true, false], [false, true], [false, false]] as const) {
    const fixture = dispatchFixture(key, native);
    if (!key && !native) await assert.rejects(fixture.dispatch(), error => parseAiErrorCode(serializeAiError(error)) === 'AI_NOT_CONFIGURED');
    else await fixture.dispatch();
    assert.deepEqual(fixture.calls, { byok: key ? 1 : 0, native: !key && native ? 1 : 0 });
  }
});

test('stored revoked or undecryptable BYOK failures never switch to native', async () => {
  const config = buildRendererByokAiConfig({
    getByokAiProvider: () => 'OpenAI', getEncryptedByokAiApiKeys: () => ({ OpenAI: 'synthetic-ciphertext' }),
    getByokAiBaseUrl: () => 'https://synthetic.invalid/v1', getByokAiModelId: () => 'synthetic', getByokAiCustomSystemPrompt: () => ''
  });
  assert.equal(config.hasApiKey, true);
  assert.equal(decryptStoredApiKey('synthetic-ciphertext', { isEncryptionAvailable: () => true, decryptString: () => { throw new Error('synthetic decrypt failure'); } }), '');
  for (const code of ['AI_AUTH', 'AI_KEY_NOT_CONFIGURED'] as const) {
    const fixture = dispatchFixture(config.hasApiKey, true, new AiPublicError(code));
    await assert.rejects(fixture.dispatch(), error => parseAiErrorCode(serializeAiError(error)) === code);
    assert.deepEqual(fixture.calls, { byok: 1, native: 0 });
  }
});

function authorizedHandler(workspace: string | null, canWrite: boolean, hasKey: boolean) {
  const calls = { lifecycle: 0, permission: 0, barrier: 0, registry: 0, byok: 0, native: 0 };
  const routing = dispatchFixture(hasKey, true);
  const access = productionFunctions(['assertCurrentWorkspaceWriteAccess'], {
    db: { getCurrentWorkspaceId: () => workspace, getWorkspacePermissions: () => { calls.permission++; return { canWrite }; } },
    assertWorkspaceWriteAccess
  });
  const { source, ast } = parsed('../index.ts');
  const handlers: string[] = [];
  function visit(node: compiler.Node): void {
    if (compiler.isCallExpression(node) && compiler.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(ast) === 'secureIpc' && node.expression.name.text === 'handle'
      && compiler.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'ai:triageBug') {
      handlers.push(source.slice(node.arguments[1].pos, node.arguments[1].end));
    }
    compiler.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(handlers.length, 1);
  const { handler } = evaluate(`exports.handler = ${handlers[0]};`, {
    assertAppAcceptingMutations: () => { calls.lifecycle++; },
    assertCurrentWorkspaceWriteAccess: access.assertCurrentWorkspaceWriteAccess,
    createTriageDispatchGuard, shutdownInProgress: false,
    db: { getCurrentWorkspaceId: () => workspace, getWorkspacePermissions: () => ({ canWrite }) },
    operationBarrier: { isInMaintenance: false, acquire: (work: () => unknown) => { calls.barrier++; return work(); } },
    aiRequests: { run: (_sender: number, _request: string, work: (signal: AbortSignal) => unknown) => { calls.registry++; return work(new AbortController().signal); } },
    triageBugWithConfiguredAi: routing.dispatch
  });
  return { calls, routeCalls: routing.calls, invoke: () => Promise.resolve().then(() => handler({ sender: { id: 1 } }, { note: 'synthetic' }, 'synthetic-request')) };
}

test('main triage denial makes zero registry, barrier, BYOK or native dispatches regardless of provider route', async () => {
  for (const hasKey of [false, true]) {
    const fixture = authorizedHandler('synthetic-workspace', false, hasKey);
    await assert.rejects(fixture.invoke(), /Unauthorized: Read-only access/);
    assert.deepEqual(fixture.calls, { lifecycle: 1, permission: 1, barrier: 0, registry: 0, byok: 0, native: 0 });
    assert.deepEqual(fixture.routeCalls, { byok: 0, native: 0 });
  }
});

test('main triage preserves writable custom-role and local/no-workspace behavior', async () => {
  for (const [workspace, canWrite] of [['synthetic-workspace', true], [null, false]] as const) {
    for (const hasKey of [false, true]) {
      const fixture = authorizedHandler(workspace, canWrite, hasKey);
      await fixture.invoke();
      assert.equal(fixture.calls.lifecycle, 1);
      assert.equal(fixture.calls.permission, workspace ? 1 : 0);
      assert.equal(fixture.calls.registry, 1);
      assert.equal(fixture.calls.barrier, 1);
      assert.deepEqual(fixture.routeCalls, { byok: hasKey ? 1 : 0, native: hasKey ? 0 : 1 });
    }
  }
});
