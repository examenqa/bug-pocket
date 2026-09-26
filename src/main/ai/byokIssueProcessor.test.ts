export {};

const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const {
  callOpenAiCompatibleChatWithFallback,
  extractJsonObjectString
}: typeof import('./byokIssueProcessor') = require('./byokIssueProcessor.ts');

test('steps through the active Gemini model cascade after retryable failures', async () => {
  const originalFetch = globalThis.fetch;
  const requestedModels: string[] = [];

  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      requestedModels.push(String(body.model));

      if (requestedModels.length < 3) {
        const status = requestedModels.length === 1 ? 429 : 503;
        return new Response(JSON.stringify({ error: { message: 'Model temporarily unavailable' } }), {
          status,
          statusText: status === 429 ? 'Too Many Requests' : 'Service Unavailable',
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"title":"Fallback succeeded"}' } }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    const result = await callOpenAiCompatibleChatWithFallback({
      apiKey: 'test-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      modelId: 'gemini-3.5-flash',
      provider: 'Gemini',
      systemPrompt: 'Return JSON.',
      userPrompt: 'Format this issue.'
    });

    assert.equal(result, '{"title":"Fallback succeeded"}');
    assert.deepEqual(requestedModels, [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not hide a non-retryable Gemini model error behind a fallback', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  try {
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ error: { message: 'Model not found' } }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    await assert.rejects(
      callOpenAiCompatibleChatWithFallback({
        apiKey: 'test-key',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        modelId: 'gemini-does-not-exist',
        provider: 'Gemini',
        systemPrompt: 'Return JSON.',
        userPrompt: 'Format this issue.'
      }),
      (error: unknown) => {
        assert.equal(requestCount, 1);
        assert.ok(error instanceof Error);
        assert.match(error.message, /Model not found/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('extracts the first balanced triage object when the model adds trailing noise', () => {
  const malformedResponse = `Here is the result:
{
  "title": "Ad draft fails to display",
  "bugNote": "The panel shows {no draft} even though the agent says one exists.",
  "stepsToReproduce": ["Open the panel", "Request a draft"],
  "expectedResult": "The draft appears.",
  "actualResult": "The empty state remains."
}
}`;

  const extracted = extractJsonObjectString(malformedResponse);
  const parsed = JSON.parse(extracted) as { title: string; stepsToReproduce: string[] };
  assert.equal(parsed.title, 'Ad draft fails to display');
  assert.deepEqual(parsed.stepsToReproduce, ['Open the panel', 'Request a draft']);
});

for (const modelId of ['gemini-custom-one','gemini-custom-two','']) {
  test(`Gemini sends configured primary model ${modelId || '(default)'}`,async()=>{
    const original=globalThis.fetch;const models:string[]=[];
    try {
      globalThis.fetch=(async(_input,init)=>{models.push(JSON.parse(String(init?.body)).model);return new Response(JSON.stringify({choices:[{message:{content:'result'}}]}));}) as typeof fetch;
      await callOpenAiCompatibleChatWithFallback({apiKey:'test',baseUrl:'https://example.test',modelId,provider:'Gemini',systemPrompt:'test',userPrompt:'test'});
      assert.deepEqual(models,[modelId || 'gemini-3.5-flash']);
    }finally{globalThis.fetch=original;}
  });
}
test('OpenAI-compatible requests preserve their model and propagate cancellation without fallback',async()=>{
  const original=globalThis.fetch,controller=new AbortController();let requests=0;let signal:AbortSignal|undefined;
  try{
    globalThis.fetch=(async(_input,init)=>{requests++;signal=init?.signal as AbortSignal;assert.equal(JSON.parse(String(init?.body)).model,'configured-openai');return new Promise<Response>(()=>{});}) as typeof fetch;
    const pending=callOpenAiCompatibleChatWithFallback({apiKey:'test',baseUrl:'https://example.test',modelId:'configured-openai',provider:'OpenAI',systemPrompt:'test',userPrompt:'test',signal:controller.signal});
    controller.abort(new Error('intentional cancel'));
    await assert.rejects(pending,/intentional cancel/);assert.equal(signal?.aborted,true);assert.equal(requests,1);
  }finally{globalThis.fetch=original;}
});
test('Ollama preserves its model and aborts when its owning request is cancelled',async()=>{
  const {triageBugWithOllama}=require('./ollamaTriage.ts') as typeof import('./ollamaTriage');
  const original=globalThis.fetch,controller=new AbortController();let signal:AbortSignal|undefined;
  try {
    globalThis.fetch=(async(_input,init)=>{signal=init?.signal as AbortSignal;assert.equal(JSON.parse(String(init?.body)).model,'qwen3-vl:8b');return new Promise<Response>(()=>{});}) as typeof fetch;
    const pending=triageBugWithOllama({note:'example'},'qwen3-vl:8b',undefined,controller.signal);
    controller.abort(new Error('cancel Ollama'));await assert.rejects(pending,/cancel Ollama/);assert.equal(signal?.aborted,true);
  } finally {globalThis.fetch=original;}
});
