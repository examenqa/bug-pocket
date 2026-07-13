import type { AiByokConfig, AiProvider } from '../../shared/types';
import type { BugPocketDatabase } from '../database';

export interface SafeStorageDecryptor {
  isEncryptionAvailable(): boolean;
  decryptString(encryptedValue: Buffer): string;
}

type ByokConfigDatabase = Pick<
  BugPocketDatabase,
  | 'getByokAiProvider'
  | 'getEncryptedByokAiApiKeys'
  | 'getByokAiBaseUrl'
  | 'getByokAiModelId'
  | 'getByokAiCustomSystemPrompt'
>;

export function decryptStoredApiKey(
  encryptedValue: string,
  secureStorage: SafeStorageDecryptor
): string {
  if (!encryptedValue || !secureStorage.isEncryptionAvailable()) return '';
  try {
    return secureStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
  } catch {
    return '';
  }
}

export function buildRendererByokAiConfig(
  database: ByokConfigDatabase
): AiByokConfig {
  const provider = database.getByokAiProvider();
  const encryptedKeys = database.getEncryptedByokAiApiKeys();
  const providers: AiProvider[] = ['OpenAI', 'Grok', 'OpenRouter', 'Gemini', 'Custom/Local'];
  const configuredProviders = Object.fromEntries(
    providers.map((name) => [name, Boolean(encryptedKeys[name])])
  ) as Record<AiProvider, boolean>;

  return {
    provider,
    baseUrl: database.getByokAiBaseUrl(),
    modelId: database.getByokAiModelId(),
    hasApiKey: Boolean(encryptedKeys[provider]),
    configuredProviders,
    customSystemPrompt: database.getByokAiCustomSystemPrompt()
  };
}
