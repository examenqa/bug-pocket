const byokTest: typeof import('node:test') = require('node:test');
const byokAssert: typeof import('node:assert/strict') = require('node:assert/strict');
const {
  buildRendererByokAiConfig
}: typeof import('../ai/byokConfigResponse') = require('../ai/byokConfigResponse.ts');
const {
  getByokAiConfigChannel,
  registerGetByokAiConfigIpc
}: typeof import('./byokAiConfigIpc') = require('./byokAiConfigIpc.ts');

byokTest('does not expose plaintext API keys through get-ai-config IPC', async () => {
  const plaintextApiKey = 'test-gemini-plaintext-secret';
  const encryptedApiKey = Buffer.from('mock-safe-storage-ciphertext').toString('base64');
  const database = {
    getByokAiProvider: () => 'Gemini' as const,
    getEncryptedByokAiApiKeys: () => ({ Gemini: encryptedApiKey }),
    getByokAiBaseUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai',
    getByokAiModelId: () => 'gemini-3.5-flash',
    getByokAiCustomSystemPrompt: () => 'Return structured JSON.'
  };

  let registeredChannel = '';
  let registeredHandler: ((event: unknown) => unknown) | undefined;
  const ipc = {
    handle: (channel: string, handler: (event: unknown) => unknown) => {
      registeredChannel = channel;
      registeredHandler = handler;
    }
  } as Parameters<typeof registerGetByokAiConfigIpc>[0];

  registerGetByokAiConfigIpc(ipc, () => buildRendererByokAiConfig(database));

  byokAssert.equal(registeredChannel, getByokAiConfigChannel);
  byokAssert.ok(registeredHandler, 'Expected get-ai-config to register an IPC handler.');
  const response = await registeredHandler({}) as import('../../shared/types').AiByokConfig;

  byokAssert.equal(Object.hasOwn(response, 'apiKey'), false);
  byokAssert.equal(Object.hasOwn(response, 'apiKeys'), false);
  byokAssert.equal(response.hasApiKey, true);
  byokAssert.equal(response.configuredProviders.Gemini, true);
  byokAssert.equal(response.configuredProviders.OpenAI, false);
  const serializedResponse = JSON.stringify(response);
  byokAssert.equal(serializedResponse.includes(plaintextApiKey), false);
  byokAssert.equal(serializedResponse.includes(encryptedApiKey), false);
});
