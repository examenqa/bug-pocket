import { safeStorage } from 'electron';
import type { SupportedStorage } from '@supabase/supabase-js';
import type { BugPocketDatabase } from '../database';

export interface SafeStorageCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Supabase auth storage whose serialized values never leave the Electron main
 * process unencrypted. Supabase owns JSON serialization; this adapter must
 * return the exact decrypted string required by the SupportedStorage contract.
 */
export class SafeStorageAdapter implements SupportedStorage {
  readonly isServer = false;

  constructor(
    private readonly database: BugPocketDatabase,
    private readonly crypto: SafeStorageCrypto = safeStorage
  ) {}

  getItem(key: string): string | null {
    const encrypted = this.database.getEncryptedSupabaseAuthItem(key);
    if (!encrypted) return null;
    this.assertEncryptionAvailable();

    try {
      return this.crypto.decryptString(encrypted);
    } catch {
      // safeStorage ciphertext is bound to the OS account. A backup restored on
      // another device must expire the session rather than block database boot.
      this.database.removeEncryptedSupabaseAuthItem(key);
      return null;
    }
  }

  setItem(key: string, value: string): void {
    this.assertEncryptionAvailable();
    const encrypted = this.crypto.encryptString(value);
    this.database.setEncryptedSupabaseAuthItem(key, encrypted);
  }

  removeItem(key: string): void {
    this.database.removeEncryptedSupabaseAuthItem(key);
  }

  private assertEncryptionAvailable(): void {
    if (!this.crypto?.isEncryptionAvailable()) {
      throw new Error('Secure session storage is unavailable. Supabase authentication was not initialized.');
    }
  }
}
