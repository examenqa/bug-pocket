import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, type SupabaseClient, type WebSocketLikeConstructor } from '@supabase/supabase-js';
import WebSocket from 'ws';
import type { BugDetails, FeedbackPayload, SyncAuthResult, SyncConnectionResult, SyncQueueEvent, SyncSessionStatus } from '../../shared/types';
import type { BugPocketDatabase } from '../database';

export interface SyncStatus {
  enabled: boolean;
  configured: boolean;
  lastSyncAt: string | null;
  message: string;
}

type WorkspaceMembershipRow = {
  workspace_id: string;
};

type SyncPayload = Record<string, unknown>;

const syncIntervalMs = 30_000;
const maxSyncAttempts = 3;
const syncBatchSize = 20;
const uuidNamespace = 'bug-pocket-local-sync-v1';

export class SyncEngine {
  private client: SupabaseClient | null = null;
  private projectUrl = '';
  private anonKey = '';
  private initializedProjectUrl = '';
  private initializedAnonKey = '';
  private syncTimer: NodeJS.Timeout | null = null;
  private syncInProgress = false;
  private retryCounts = new Map<string, number>();
  private retryDelayUntil = 0;

  constructor(private readonly database: BugPocketDatabase) {}

  initialize(): SyncStatus {
    this.projectUrl = this.database.getSupabaseProjectUrl() ?? '';
    this.anonKey = this.database.getSupabaseAnonKey() ?? '';

    if (!this.projectUrl || !this.anonKey) {
      this.database.setCloudSyncSessionActive(false);
      this.client = null;
      this.initializedProjectUrl = '';
      this.initializedAnonKey = '';
      this.stopBackgroundSync();
      return {
        enabled: false,
        configured: false,
        lastSyncAt: null,
        message: 'Not Configured. Add Supabase credentials to enable future cloud sync.'
      };
    }

    if (!this.client || this.initializedProjectUrl !== this.projectUrl || this.initializedAnonKey !== this.anonKey) {
      this.client = createClient(this.projectUrl, this.anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        realtime: {
          transport: WebSocket as unknown as WebSocketLikeConstructor
        }
      });
      this.initializedProjectUrl = this.projectUrl;
      this.initializedAnonKey = this.anonKey;
    }

    return {
      enabled: true,
      configured: true,
      lastSyncAt: null,
      message: 'Supabase client initialized. Background sync runs after login and workspace capture.'
    };
  }

  getStatus(): SyncStatus {
    return {
      enabled: Boolean(this.client),
      configured: Boolean(this.projectUrl && this.anonKey),
      lastSyncAt: null,
      message: this.client
        ? 'Supabase credentials are configured. Background sync starts after authentication.'
        : 'Local-first mode. Captures and attachments are saved locally immediately; cloud sync is not configured.'
    };
  }

  async testConnection(): Promise<SyncConnectionResult> {
    const status = this.initialize();
    if (!status.configured) {
      return {
        success: false,
        configured: false,
        message: 'Not Configured. Add your Supabase Project URL and anon key first.'
      };
    }

    try {
      const response = await fetch(`${this.projectUrl.replace(/\/+$/, '')}/auth/v1/health`, {
        method: 'GET',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`
        }
      });

      if (!response.ok) {
        return {
          success: false,
          configured: true,
          message: `Supabase health check failed with HTTP ${response.status}.`,
          error: await response.text().catch(() => '')
        };
      }

      return {
        success: true,
        configured: true,
        message: 'Supabase credentials responded successfully. Sync worker will run after login.'
      };
    } catch (caught) {
      return {
        success: false,
        configured: true,
        message: 'Could not reach Supabase. Check the Project URL, anon key, and network connection.',
        error: caught instanceof Error ? caught.message : String(caught)
      };
    }
  }

  async authSignIn(email: string, password: string): Promise<SyncAuthResult> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return this.authFailure(error.message);

    try {
      const workspaceId = await this.captureCurrentWorkspaceId(client);
      if (!workspaceId) {
        this.database.setCloudSyncSessionActive(false);
        this.stopBackgroundSync();
        return {
          success: false,
          authenticated: true,
          email: data.user?.email ?? email.trim(),
          message: 'Signed in, but no workspace membership was found for this user. Create or assign a workspace before syncing.'
        };
      }

      this.database.setCloudSyncSessionActive(true);
      this.startBackgroundSync();
      return {
        success: true,
        authenticated: true,
        email: data.user?.email ?? email.trim(),
        workspaceId,
        message: 'Signed in and workspace captured locally.'
      };
    } catch (caught) {
      this.database.setCloudSyncSessionActive(false);
      this.stopBackgroundSync();
      return {
        success: false,
        authenticated: true,
        email: data.user?.email ?? email.trim(),
        message: 'Signed in, but workspace lookup failed.',
        error: caught instanceof Error ? caught.message : String(caught)
      };
    }
  }

  async authSignUp(email: string, password: string): Promise<SyncAuthResult> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signUp({ email: email.trim(), password });
    if (error) return this.authFailure(error.message);

    if (!data.session) {
      this.database.setCloudSyncSessionActive(false);
      this.database.updateCurrentWorkspaceId(null);
      this.stopBackgroundSync();
      return {
        success: true,
        authenticated: false,
        email: data.user?.email ?? email.trim(),
        message: 'Account created. Confirm your email, then log in to capture the active workspace.'
      };
    }

    try {
      const workspaceId = await this.captureCurrentWorkspaceId(client);
      this.database.setCloudSyncSessionActive(Boolean(workspaceId));
      if (workspaceId) this.startBackgroundSync();
      else this.stopBackgroundSync();
      return {
        success: Boolean(workspaceId),
        authenticated: true,
        email: data.user?.email ?? email.trim(),
        workspaceId: workspaceId ?? undefined,
        message: workspaceId
          ? 'Account created and workspace captured locally.'
          : 'Account created, but no workspace membership was found yet.'
      };
    } catch (caught) {
      this.database.setCloudSyncSessionActive(false);
      this.stopBackgroundSync();
      return {
        success: false,
        authenticated: true,
        email: data.user?.email ?? email.trim(),
        message: 'Account created, but workspace lookup failed.',
        error: caught instanceof Error ? caught.message : String(caught)
      };
    }
  }

  async authSignOut(): Promise<SyncAuthResult> {
    const client = this.requireClient();
    const { error } = await client.auth.signOut();
    if (error) return this.authFailure(error.message);
    this.database.setCloudSyncSessionActive(false);
    this.stopBackgroundSync();
    this.database.updateCurrentWorkspaceId(null);
    return {
      success: true,
      authenticated: false,
      message: 'Signed out. Cloud sync is disconnected.'
    };
  }

  async getSyncSessionStatus(): Promise<SyncSessionStatus> {
    const status = this.initialize();
    if (!status.configured || !this.client) {
      return { authenticated: false };
    }

    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) {
      this.database.setCloudSyncSessionActive(false);
      this.stopBackgroundSync();
      return { authenticated: false, workspaceId: this.database.getCurrentWorkspaceId() ?? undefined };
    }

    this.database.setCloudSyncSessionActive(Boolean(this.database.getCurrentWorkspaceId()));
    if (this.database.getCurrentWorkspaceId()) this.startBackgroundSync();

    return {
      authenticated: true,
      email: data.user.email ?? undefined,
      workspaceId: this.database.getCurrentWorkspaceId() ?? undefined
    };
  }


  async sendFeedback(payload: FeedbackPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const client = this.requireClient();
    const message = payload.message.trim();
    if (!message) return { success: false, error: 'Please enter a message before sending.' };

    const publicImageUrl = payload.image_base64 ? await this.uploadTelemetryImage(client, payload.image_base64) : undefined;

    const feedbackBody = {
      type: payload.type === 'Feature' ? 'Feature' : 'Bug',
      message,
      user_email: payload.user_email?.trim() || undefined,
      image_url: publicImageUrl
    };

    // --- INJECT THIS EXACT BLOCK ---
    console.log("=== TELEMETRY DEBUG ===");
    console.log("1. Base64 provided by UI:", !!payload.image_base64);
    console.log("2. URL returned from Storage:", publicImageUrl);
    console.log("=======================");
    // -------------------------------

    const { error } = await client.functions.invoke('submit-feedback', { body: feedbackBody });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (caught) {
    return {
      success: false,
      error: caught instanceof Error ? caught.message : 'Unable to send feedback.'
    };
  }
}

  private async uploadTelemetryImage(client: SupabaseClient, dataUrlOrBase64: string): Promise<string> {
    const base64 = dataUrlOrBase64.replace(/^data:image\/(png|jpe?g);base64,/i, '').replace(/\s/g, '');
    if (!base64) throw new Error('Image payload was empty.');

    const bytes = Buffer.from(base64, 'base64');
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const fileExtension = isJpeg ? '.jpg' : '.png';
    const contentType = isJpeg ? 'image/jpeg' : 'image/png';
    const fileName = `${randomUUID()}${fileExtension}`;
    const { error } = await client.storage.from('telemetry-assets').upload(fileName, bytes, {
      contentType,
      upsert: false
    });
    if (error) throw new Error(`Image upload failed: ${error.message}`);

    const { data } = client.storage.from('telemetry-assets').getPublicUrl(fileName);
    if (!data.publicUrl) throw new Error('Image uploaded, but no public URL was returned.');
    return data.publicUrl;
  }
  startBackgroundSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      void this.processQueue();
    }, syncIntervalMs);
    void this.processQueue();
  }

  stopBackgroundSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.syncInProgress = false;
  }

  async processQueue(): Promise<void> {
    if (this.syncInProgress) return;
    if (Date.now() < this.retryDelayUntil) return;

    const client = this.client;
    const workspaceId = this.database.getCurrentWorkspaceId();
    if (!client || !workspaceId) return;

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return;

    this.syncInProgress = true;
    try {
      const events = this.database.getPendingSyncQueue(syncBatchSize);
      for (const event of events) {
        try {
          await this.processEvent(client, workspaceId, event);
          this.retryCounts.delete(this.retryKey(event));
          this.database.markSyncEventSucceeded(event);
        } catch (caught) {
          const attempts = (this.retryCounts.get(this.retryKey(event)) ?? 0) + 1;
          this.retryCounts.set(this.retryKey(event), attempts);
          if (attempts >= maxSyncAttempts) {
            this.database.markSyncEventFailed(event);
          } else {
            this.retryDelayUntil = Date.now() + Math.min(60_000, 1000 * 2 ** attempts);
          }
          console.warn('[Bug Pocket Sync] Sync event failed', {
            eventId: event.id,
            localSeq: event.local_seq,
            entityType: event.entity_type,
            operation: event.operation,
            attempts,
            error: caught instanceof Error ? caught.message : String(caught)
          });
          break;
        }
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  async pushBug(_bug: BugDetails): Promise<void> {
    // TODO: Push direct bug writes through sync_queue instead of ad hoc calls.
    await this.processQueue();
  }

  async pullChanges(): Promise<void> {
    // TODO: Pull workspace changes into the local SQLite cache after login.
  }

  private async processEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent): Promise<void> {
    const payload = this.parsePayload(event.payload);
    if (event.entity_type === 'bug') {
      await this.syncBugEvent(client, workspaceId, event, payload);
      return;
    }
    if (event.entity_type === 'attachment') {
      await this.syncAttachmentEvent(client, workspaceId, event, payload);
      return;
    }
    if (event.entity_type === 'reference') {
      await this.syncReferenceEvent(client, workspaceId, event, payload);
    }
  }

  private async syncBugEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const id = this.localUuid(workspaceId, 'bug', event.entity_id);
    if (event.operation === 'DELETE') {
      const { error } = await client.from('bugs').delete().eq('id', id).eq('workspace_id', workspaceId);
      if (error) throw error;
      return;
    }

    const record = this.serializeBugPayload(workspaceId, id, payload);
    const { error } = await client.from('bugs').upsert(record, { onConflict: 'id' });
    if (error) throw error;
  }

  private async syncAttachmentEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const id = this.localUuid(workspaceId, 'attachment', event.entity_id);
    const contentHash = this.stringOrNull(payload.content_hash);
    const fileExtension = this.normalizeExtension(this.stringOrNull(payload.file_extension) ?? '.png');
    const storageKey = contentHash ? `${workspaceId}/${contentHash}${fileExtension}` : null;

    if (event.operation === 'DELETE') {
      if (storageKey) await client.storage.from('attachments').remove([storageKey]);
      const { error } = await client.from('attachments').delete().eq('id', id).eq('workspace_id', workspaceId);
      if (error) throw error;
      return;
    }

    if (contentHash && storageKey) {
      const filePath = this.database.resolveAttachmentPath(contentHash, fileExtension);
      const fileBytes = await readFile(filePath);
      const { error: uploadError } = await client.storage
        .from('attachments')
        .upload(storageKey, fileBytes, {
          contentType: String(payload.mime_type || 'image/png'),
          upsert: true
        });
      if (uploadError) throw uploadError;
    }

    const record = this.serializeAttachmentPayload(workspaceId, id, storageKey, payload);
    const { error } = await client.from('attachments').upsert(record, { onConflict: 'id' });
    if (error) throw error;
  }

  private async syncReferenceEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const { error } = await client.from('sync_events').insert({
      workspace_id: workspaceId,
      client_id: null,
      local_seq: event.local_seq,
      op_id: event.op_id || null,
      entity_type: event.entity_type,
      entity_id: this.localUuid(workspaceId, 'reference', event.entity_id),
      operation: event.operation,
      payload
    });
    if (error) throw error;
  }

  private serializeBugPayload(workspaceId: string, id: string, payload: SyncPayload): SyncPayload {
    return {
      id,
      workspace_id: workspaceId,
      application_id: null,
      module_id: null,
      environment_id: null,
      device_id: null,
      browser_id: null,
      user_role_id: null,
      entry_type: String(payload.entry_type ?? 'Bug'),
      title: String(payload.title ?? ''),
      note: String(payload.note ?? ''),
      other_details: String(payload.other_details ?? ''),
      steps_to_reproduce: String(payload.steps_to_reproduce ?? ''),
      expected_result: String(payload.expected_result ?? ''),
      actual_result: String(payload.actual_result ?? ''),
      status: String(payload.status ?? 'Draft'),
      severity: String(payload.severity ?? 'Medium'),
      reported: Boolean(Number(payload.reported ?? 0)),
      issue_platform: String(payload.issue_platform ?? ''),
      issue_id: String(payload.issue_id ?? ''),
      issue_url: String(payload.issue_url ?? ''),
      tags: String(payload.tags ?? ''),
      sync_status: 'Synced',
      created_at: String(payload.created_at ?? new Date().toISOString()),
      updated_at: String(payload.updated_at ?? new Date().toISOString())
    };
  }

  private serializeAttachmentPayload(workspaceId: string, id: string, storageKey: string | null, payload: SyncPayload): SyncPayload {
    const bugId = typeof payload.bug_id === 'number' ? payload.bug_id : Number(payload.bug_id || 0);
    const parentId = typeof payload.parent_id === 'number' ? payload.parent_id : Number(payload.parent_id || 0);
    return {
      id,
      workspace_id: workspaceId,
      bug_id: bugId ? this.localUuid(workspaceId, 'bug', bugId) : null,
      parent_id: parentId ? this.localUuid(workspaceId, 'attachment', parentId) : null,
      content_hash: this.stringOrNull(payload.content_hash),
      file_extension: this.normalizeExtension(this.stringOrNull(payload.file_extension) ?? '.png'),
      mime_type: String(payload.mime_type ?? 'image/png'),
      source_type: String(payload.source_type ?? 'other'),
      sync_status: 'Synced',
      storage_bucket: storageKey ? 'attachments' : null,
      storage_key: storageKey,
      created_at: String(payload.created_at ?? new Date().toISOString())
    };
  }

  private requireClient(): SupabaseClient {
    this.initialize();
    if (!this.client) throw new Error('Supabase is not configured. Add Project URL and anon key first.');
    return this.client;
  }

  private async captureCurrentWorkspaceId(client: SupabaseClient): Promise<string | null> {
    const { data, error } = await client
      .from('workspace_members')
      .select('workspace_id')
      .limit(1)
      .maybeSingle<WorkspaceMembershipRow>();

    if (error) throw error;
    const workspaceId = data?.workspace_id ?? null;
    this.database.updateCurrentWorkspaceId(workspaceId);
    return workspaceId;
  }

  private authFailure(message: string): SyncAuthResult {
    this.database.setCloudSyncSessionActive(false);
    return {
      success: false,
      authenticated: false,
      message,
      error: message
    };
  }

  private parsePayload(payload: string): SyncPayload {
    try {
      const parsed = JSON.parse(payload || '{}') as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as SyncPayload) : {};
    } catch {
      return {};
    }
  }

  private retryKey(event: SyncQueueEvent): string {
    return event.op_id || String(event.id);
  }

  private localUuid(workspaceId: string, entityType: string, localId: number): string {
    const hash = createHash('sha256').update(`${uuidNamespace}:${workspaceId}:${entityType}:${localId}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${this.variantNibble(hash[16])}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }

  private variantNibble(value: string | undefined): string {
    const nibble = Number.parseInt(value ?? '8', 16);
    return ((nibble & 0x3) | 0x8).toString(16);
  }

  private stringOrNull(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  private normalizeExtension(value: string): string {
    return value.startsWith('.') ? value : `.${value}`;
  }
}
