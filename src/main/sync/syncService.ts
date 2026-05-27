import type { BugDetails } from '../../shared/types';

export interface SyncStatus {
  enabled: boolean;
  lastSyncAt: string | null;
  message: string;
}

export class SyncService {
  private readonly supabaseUrl = process.env['BUG_POCKET_SUPABASE_URL'] ?? '';
  private readonly supabaseAnonKey = process.env['BUG_POCKET_SUPABASE_ANON_KEY'] ?? '';

  getStatus(): SyncStatus {
    return {
      enabled: Boolean(this.supabaseUrl && this.supabaseAnonKey),
      lastSyncAt: null,
      message: 'Local-first mode. Captures and attachments are saved locally immediately; cloud sync is intentionally not enabled in the MVP.'
    };
  }

  async pushBug(_bug: BugDetails): Promise<void> {
    // TODO: Add auth, workspace/team sharing, RLS-aware writes, screenshot upload
    // to Supabase Storage, generic attachment source handling, sync_status updates,
    // last_sync_at tracking, and updated_at based conflict handling.
  }

  async pullChanges(): Promise<void> {
    // TODO: Pull workspace changes into the local SQLite cache after login.
  }
}
