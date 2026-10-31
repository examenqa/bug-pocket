import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';
import compiler from 'typescript';
import { AiPublicError, getAiErrorMessage, parseAiErrorCode, serializeAiError, type AiErrorCode } from '../../shared/aiError';
import { AiCancelledError, AiTimeoutError, withAiDeadline } from '../../shared/aiRequest';
import type { AiIssueProcessPayload, AiIssueProcessResult, AiProvider, AiTriageBugPayload, AiTriageResponse } from '../../shared/types';
import { parseErrorForUI } from '../../renderer/src/utils/errors';
import { AiRequestRegistry } from './aiRequestRegistry';
import { normalizeOllamaModelName } from '../../shared/ollamaModel';
import { buildRendererByokAiConfig, decryptStoredApiKey } from './byokConfigResponse';
import { normalizeByokBaseUrl } from './byokEndpoint';
import { callOpenAiCompatibleChatWithFallback, GEMINI_MODEL_CASCADE } from './openAiCompatibleChat';

// Only the Electron-dependent source is isolated. The compiler selects exact AST
// spans from the production files; no provider, wrapper, routing or parser logic
// is copied into this fixture. All imports above execute actual pure modules.
function sourceExports(relativePath: string, dependencies: Record<string, unknown>, names?: string[]): Record<string, unknown> {
  const filename = resolve(__dirname, relativePath);
  const source = readFileSync(filename, 'utf8');
  const parsed = compiler.createSourceFile(filename, source, compiler.ScriptTarget.ES2022, true);
  const statements = parsed.statements.filter(statement => {
    if (compiler.isImportDeclaration(statement) || compiler.isImportEqualsDeclaration(statement) || compiler.isExportDeclaration(statement)) return false;
    if (!names) return true;
    return compiler.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? '');
  });
  if (names) assert.equal(statements.length, names.length, 'each requested production declaration must exist exactly once');
  const selected = statements.map(statement => source.slice(statement.pos, statement.end)).join('\n');
  const exports: Record<string, unknown> = {};
  const compiled = compiler.transpileModule(selected, {
    compilerOptions: { target: compiler.ScriptTarget.ES2022, module: compiler.ModuleKind.CommonJS },
    fileName: filename
  }).outputText;
  const expose = names?.map(name => `exports.${name} = ${name};`).join('\n') ?? '';
  runInNewContext(`${compiled}\n${expose}`, {
    exports, Buffer, AbortController, AbortSignal, Error, TypeError, JSON, Set, Map,
    setTimeout, clearTimeout, console, ...dependencies
  }, { filename, timeout: 2_000 });
  return exports;
}

const markers = {
  key: 'SYNTHETIC_KEY_CONTAINMENT_4a19',
  note: 'SYNTHETIC_BUG_NOTE_CONTAINMENT_7b20',
  path: 'SYNTHETIC_LOCAL_PATH_CONTAINMENT_8c31',
  cause: 'SYNTHETIC_CAUSE_CONTAINMENT_9d42',
  sentImage: Buffer.from('SYNTHETIC_IMAGE_BYTES_ACTUALLY_SENT_0e53').toString('base64'),
  responseOnlyImage: 'data:image/jpeg;base64,SYNTHETIC_ARBITRARY_RESPONSE_IMAGE_NOT_SENT_1f64'
};
const markerEcho = Object.values(markers).join(' | ');
const syntheticPath = `C:/synthetic/${markers.path}.jpg`;
const syntheticPayload: AiTriageBugPayload = { note: markers.note, title: 'Synthetic failure', attachment_id: '17' };

function assertNoMarkers(value: unknown): void {
  const rendered = inspect(value, { depth: 12, breakLength: Infinity });
  for (const marker of Object.values(markers)) assert.equal(rendered.includes(marker), false, 'public errors/logs must exclude every synthetic marker');
  assert.equal(rendered.includes('rawDetails'), false, 'raw upstream diagnostics must not cross the boundary');
}

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
function response(status: number, body: string | object, statusText = markerEcho, reads = { text: 0, json: 0 }): FakeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status, statusText,
    text: async () => { reads.text += 1; return text; },
    json: async () => { reads.json += 1; return JSON.parse(text) as unknown; }
  };
}

async function isolated<T>(fetcher: () => FakeResponse | Promise<FakeResponse>, work: (capture: { logs: unknown[][]; requests: Array<{ url: string; init: RequestInit }> }) => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch;
  const methods = ['error', 'warn', 'info', 'debug', 'log'] as const;
  const original = methods.map(method => console[method]);
  const capture = { logs: [] as unknown[][], requests: [] as Array<{ url: string; init: RequestInit }> };
  methods.forEach(method => { console[method] = (...values: unknown[]) => { capture.logs.push(values); }; });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capture.requests.push({ url: String(input), init: init ?? {} });
    return await fetcher() as Response;
  }) as typeof fetch;
  try {
    return await work(capture);
  } finally {
    globalThis.fetch = previousFetch;
    methods.forEach((method, index) => { console[method] = original[index]; });
  }
}

function database(hasKey = true) {
  return {
    getByokAiProvider: (): AiProvider => 'OpenAI',
    getEncryptedByokAiApiKeys: () => ({ OpenAI: hasKey ? 'synthetic-ciphertext' : '' }),
    getEncryptedByokAiApiKey: () => hasKey ? 'synthetic-ciphertext' : '',
    getByokAiBaseUrl: () => 'https://synthetic.invalid/v1',
    getByokAiModelId: () => 'synthetic-model',
    getByokAiCustomSystemPrompt: () => 'Return JSON.',
    getAiTriageEnabled: () => true,
    getOllamaModelName: () => 'qwen3-vl:8b'
  };
}
type SyntheticDatabase = ReturnType<typeof database>;
interface ProcessorExports {
  processIssueWithByokAi(db: SyntheticDatabase, payload: AiIssueProcessPayload, signal?: AbortSignal): Promise<AiIssueProcessResult>;
  triageBugWithByokAi(db: SyntheticDatabase, payload: AiTriageBugPayload, signal?: AbortSignal): Promise<string>;
}
function processor(transport = callOpenAiCompatibleChatWithFallback): { api: ProcessorExports; conversions: number[] } {
  const conversions: number[] = [];
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 1_536, height: 864 }),
    resize: () => image,
    toJPEG: (quality: number) => { conversions.push(quality); return Buffer.from(markers.sentImage, 'base64'); }
  };
  const api = sourceExports('./byokIssueProcessor.ts', {
    withAiDeadline, AiCancelledError, AiTimeoutError, AiPublicError, serializeAiError, normalizeByokBaseUrl,
    buildRendererByokAiConfig, decryptStoredApiKey,
    callOpenAiCompatibleChatWithFallback: transport, GEMINI_MODEL_CASCADE,
    safeStorage: { isEncryptionAvailable: () => true, decryptString: () => markers.key },
    nativeImage: { createFromPath: () => image },
    resolveVerifiedTriageAttachmentPath: () => syntheticPath,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args)
  }) as unknown as ProcessorExports;
  return { api, conversions };
}

const errorCases: Array<{ name: string; code: AiErrorCode; fetcher(): FakeResponse | never }> = [
  { name: 'JSON error.message / 401', code: 'AI_AUTH', fetcher: () => response(401, { error: { message: markerEcho } }) },
  { name: 'JSON error string / 402', code: 'AI_CREDITS', fetcher: () => response(402, { error: markerEcho }) },
  { name: 'JSON message / 403', code: 'AI_FORBIDDEN', fetcher: () => response(403, { message: markerEcho }) },
  { name: 'JSON detail / 404', code: 'AI_MODEL_UNAVAILABLE', fetcher: () => response(404, { detail: markerEcho }) },
  { name: 'plaintext / 429', code: 'AI_RATE_LIMIT', fetcher: () => response(429, markerEcho) },
  { name: 'validation-looking provider body / 500', code: 'AI_SERVER', fetcher: () => response(500, { message: `Validation Error: Invalid IPC payload ${markerEcho}` }) },
  { name: 'TypeError-looking provider body / 400', code: 'AI_FAILED', fetcher: () => response(400, `TypeError: ${markerEcho}`) },
  { name: 'untrusted statusText with empty body', code: 'AI_FAILED', fetcher: () => response(418, '', markerEcho) },
  { name: 'rejected fetch Error message/stack', code: 'AI_CONNECTION', fetcher: () => { throw new Error(markerEcho); } },
  { name: 'rejected fetch TypeError and cause', code: 'AI_CONNECTION', fetcher: () => { throw Object.assign(new TypeError(markers.key), { cause: new Error(markerEcho), statusText: markers.note }); } },
  { name: 'malformed 200 plaintext', code: 'AI_EMPTY_RESPONSE', fetcher: () => response(200, markerEcho) },
  { name: '200 body.error without completion', code: 'AI_EMPTY_RESPONSE', fetcher: () => response(200, { error: { message: markerEcho } }) }
];

for (const fixture of errorCases) {
  test(`actual processor envelopes and renderer contain ${fixture.name}`, { concurrency: false }, async () => {
    await isolated(fixture.fetcher, async capture => {
      const { api, conversions } = processor();
      const registry = new AiRequestRegistry();
      const format = await registry.run(1, 'format', signal => api.processIssueWithByokAi(database(), { rawInput: markers.note, taxonomy: {} }, signal));
      assert.equal(format.status, 'completed', 'formatting preserves its existing nested result contract');
      if (format.status !== 'completed') assert.fail('expected formatting result');
      assert.equal(format.value.success, false);
      assert.equal(parseAiErrorCode(format.value.error), fixture.code);
      assert.equal(parseErrorForUI(new Error(format.value.error)), getAiErrorMessage(fixture.code));
      const formatBody = String(capture.requests[0]?.init.body ?? '');
      assert.ok(formatBody.includes(markers.note));
      assert.equal(formatBody.includes(markers.sentImage), false, 'formatting has no image input; the response image marker is arbitrary upstream text');
      assert.equal(formatBody.includes(markers.responseOnlyImage), false);

      const triage = await registry.run(2, 'triage', signal => api.triageBugWithByokAi(database(), syntheticPayload, signal));
      assert.equal(triage.status, 'failed', 'triage preserves its existing registry failure contract');
      if (triage.status !== 'failed') assert.fail('expected triage error');
      assert.equal(parseAiErrorCode(triage.message), fixture.code);
      assert.equal(parseErrorForUI(new Error(triage.message)), getAiErrorMessage(fixture.code));
      assert.ok(String(capture.requests[1]?.init.body).includes(markers.sentImage), 'triage fixture actually sends the injected JPEG bytes');
      assert.deepEqual(conversions, [80]);
      assertNoMarkers({ format, triage, logs: capture.logs });
    });
  });
}

test('unknown wrapper failures cannot forge an owned category in either result shape', { concurrency: false }, async () => {
  await isolated(() => { assert.fail('injected transport never performs a request'); }, async capture => {
    const { api } = processor(async () => {
      throw Object.assign(new Error(markerEcho, { cause: new Error(markers.cause) }), {
        code: 'AI_AUTH', name: 'AiPublicError', type: 'validation'
      });
    });
    const registry = new AiRequestRegistry();
    const format = await registry.run(1, 'format', signal => api.processIssueWithByokAi(database(), { rawInput: markers.note, taxonomy: {} }, signal));
    assert.equal(format.status, 'completed');
    if (format.status !== 'completed') assert.fail('expected nested formatting failure');
    assert.equal(parseAiErrorCode(format.value.error), 'AI_FAILED');
    const triage = await registry.run(2, 'triage', signal => api.triageBugWithByokAi(database(), syntheticPayload, signal));
    assert.equal(triage.status, 'failed');
    if (triage.status !== 'failed') assert.fail('expected triage failure');
    assert.equal(parseAiErrorCode(triage.message), 'AI_FAILED');
    assertNoMarkers({ format, triage, logs: capture.logs });
    assert.deepEqual(capture.requests, []);
  });
});

test('actual formatting wrapper retains cancellation and short-deadline classifications', { concurrency: false }, async () => {
  await isolated(() => new Promise<FakeResponse>(() => {}), async () => {
    const { api } = processor();
    const registry = new AiRequestRegistry();
    const cancelled = registry.run(1, 'format-cancel', signal => api.processIssueWithByokAi(database(), { rawInput: markers.note, taxonomy: {} }, signal));
    registry.cancel(1, 'format-cancel');
    assert.equal((await cancelled).status, 'cancelled');
    const timeout = await registry.run(2, 'format-timeout', signal => withAiDeadline(
      child => api.processIssueWithByokAi(database(), { rawInput: markers.note, taxonomy: {} }, child), signal, 5));
    assert.equal(timeout.status, 'timed_out');
    assertNoMarkers(timeout);
  });
});

interface NativeExports {
  triageBugWithOllama(payload: AiTriageBugPayload, model: string, verifiedImagePath?: string, signal?: AbortSignal): Promise<AiTriageResponse>;
}
function native(overrides: Record<string, unknown> = {}): NativeExports {
  return sourceExports('./ollamaTriage.ts', {
    withAiDeadline, AiPublicError, serializeAiError, normalizeOllamaModelName,
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    readFile: async () => Buffer.from(markers.sentImage, 'base64'),
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    ...overrides
  }) as unknown as NativeExports;
}
function dispatcher(nativeApi: NativeExports, model = 'qwen3-vl:8b') {
  const api = sourceExports('../index.ts', {
    AiPublicError, parseAiErrorCode, serializeAiError,
    db: { ...database(false), getOllamaModelName: () => model },
    getByokAiConfig: () => ({ hasApiKey: false }),
    triageBugWithByokAi: () => { throw new Error('fixture must select native Ollama'); },
    triageBugWithOllama: nativeApi.triageBugWithOllama,
    resolveVerifiedTriageAttachmentPath: () => syntheticPath
  }, ['triageBugWithConfiguredAi', 'normalizeOllamaTriageResult']);
  return api.triageBugWithConfiguredAi as (payload: AiTriageBugPayload, signal: AbortSignal) => Promise<string>;
}

async function assertNativeFailure(fetcher: () => FakeResponse | Promise<FakeResponse>, code: AiErrorCode, model = 'qwen3-vl:8b', nativeOverrides: Record<string, unknown> = {}): Promise<void> {
  await isolated(fetcher, async capture => {
    const api = native(nativeOverrides);
    const result = await api.triageBugWithOllama(syntheticPayload, model, syntheticPath);
    assert.equal(result.success, false);
    assert.equal(parseAiErrorCode(result.error), code);
    assert.equal(parseErrorForUI(new Error(result.error)), getAiErrorMessage(code));
    // The internal fallback intentionally contains tester text. It is not an
    // error DTO, and the actual dispatcher below must not deliver it as success.
    assert.ok(result.result.refined_summary.includes(markers.note));
    assertNoMarkers({ success: result.success, model: result.model, error: result.error, logs: capture.logs });
    const run = dispatcher(api, model);
    const registryResult = await new AiRequestRegistry().run(3, 'native', signal => run(syntheticPayload, signal));
    assert.equal(registryResult.status, 'failed');
    if (registryResult.status !== 'failed') assert.fail('native fallback is never a completed report');
    assert.equal(parseAiErrorCode(registryResult.message), code, 'actual main dispatcher must reconstruct the owned safe category before registry serialization');
    assert.equal(parseErrorForUI(new Error(registryResult.message)), getAiErrorMessage(code));
    assertNoMarkers({ registryResult, logs: capture.logs });
  });
}

test('native non-OK status classification never consumes response text or JSON', { concurrency: false }, async () => {
  for (const [status, code] of [[401, 'AI_NATIVE_FAILED'], [404, 'AI_NATIVE_MODEL_UNAVAILABLE'], [429, 'AI_NATIVE_FAILED'], [500, 'AI_NATIVE_RESOURCE'], [503, 'AI_NATIVE_RESOURCE']] as const) {
    const reads = { text: 0, json: 0 };
    await assertNativeFailure(() => response(status, { error: markerEcho }, markerEcho, reads), code);
    assert.deepEqual(reads, { text: 0, json: 0 });
  }
});

test('native successful body.error, malformed body and rejected fetch retain only safe categories', { concurrency: false }, async () => {
  await assertNativeFailure(() => response(200, { error: markerEcho }), 'AI_NATIVE_FAILED');
  await assertNativeFailure(() => response(200, markerEcho), 'AI_NATIVE_RESPONSE_INVALID');
  await assertNativeFailure(() => response(200, { message: { content: `TypeError: ${markerEcho}` } }), 'AI_NATIVE_RESPONSE_INVALID');
  await assertNativeFailure(() => { throw new Error(markerEcho, { cause: new TypeError(markers.cause) }); }, 'AI_NATIVE_CONNECTION');
});

test('native unread error streams are cancelled without exposing cleanup errors', { concurrency: false }, async () => {
  for (const rejectCancel of [false, true]) {
    let cancellations = 0;
    await assertNativeFailure(() => Object.assign(response(404, markerEcho), {
      body: new ReadableStream({
        start(controller) { controller.enqueue(markerEcho); },
        cancel() { cancellations++; if (rejectCancel) throw new Error(markerEcho); }
      })
    }), 'AI_NATIVE_MODEL_UNAVAILABLE');
    assert.equal(cancellations, 2, 'direct native call and actual dispatcher each discard their unread stream');
    await Promise.resolve();
  }
});

test('native image reader exceptions cannot expose synthetic paths or causes', { concurrency: false }, async () => {
  await assertNativeFailure(() => { assert.fail('image failure must stop before fetch'); }, 'AI_IMAGE_ENCODING', 'qwen3-vl:8b', {
    readFile: async () => { throw new Error(markerEcho, { cause: new Error(syntheticPath) }); }
  });
});

test('native invalid model uses fixed diagnostics while preserving accepted model grammar', { concurrency: false }, async () => {
  await assertNativeFailure(() => { assert.fail('invalid model must fail before fetch'); }, 'AI_NATIVE_MODEL_INVALID', `invalid model ${markers.key}`);
  const source = readFileSync(resolve(__dirname, '../../shared/ollamaModel.ts'), 'utf8');
  const parsed = compiler.createSourceFile('ollamaModel.ts', source, compiler.ScriptTarget.ES2022, true);
  const declarations = parsed.statements.flatMap(statement => compiler.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []);
  const regex = declarations.find(declaration => compiler.isIdentifier(declaration.name) && declaration.name.text === 'modelNameRegex')?.initializer?.getText();
  assert.equal(regex, '/^[a-zA-Z0-9\\-:._]+$/', 'containment must not expand or restrict the native model-name grammar');
});

test('renderer rejects forged category/details and validation/typeerror echoes without logging raw errors', { concurrency: false }, async () => {
  await isolated(() => { assert.fail('renderer parsing never requests a provider'); }, async capture => {
    for (const value of [
      new Error(JSON.stringify({ code: 'AI_AUTH', rawDetails: markerEcho })),
      new Error(`Validation Error: ${markerEcho}`),
      new TypeError(markerEcho),
      new Error(`Invalid IPC payload at arguments[0].${markers.key}: expected string.`),
      new Error(`Invalid IPC payload at arguments[0].note: expected ${markers.note}.`)
    ]) {
      assertNoMarkers(parseErrorForUI(value));
    }
    assert.match(parseErrorForUI(new Error('Invalid IPC payload at arguments[0].note: expected string.')), /^Validation Error: Invalid IPC payload for bug note\./);
    assertNoMarkers(capture.logs);
    assert.deepEqual(capture.requests, []);
  });
});
