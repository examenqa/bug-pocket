import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createClient, type SupabaseClient, type SupportedStorage, type WebSocketLikeConstructor } from '@supabase/supabase-js';
import WebSocket from 'ws';
import type { BugDetails, SyncAccountSetup, SyncAuthResult, SyncConnectionResult, SyncQueueEvent, SyncRolePermission, SyncRuntimeStatus, SyncSessionStatus, SyncWorkspaceOption, WorkspaceRole } from '../../shared/types';
import type { BugPocketDatabase } from '../database';
import { operationBarrier } from '../OperationBarrier';
import {
  buildAttachmentDownloadTarget,
  normalizeAttachmentExtension,
  validateAttachmentMetadata
} from './attachmentPaths';
import { pullWithCompositeCursors, type RemotePullClient, type RemotePullRow } from './compositeCursorPull';
import { SafeStorageAdapter } from './SafeStorageAdapter';
import { httpStatusFromError, throwIfSupabaseError } from './supabaseErrors';

export interface SyncStatus {
  enabled: boolean;
  configured: boolean;
  lastSyncAt: string | null;
  message: string;
}

type WorkspaceMembershipRow = {
  workspace_id: string;
  role?: WorkspaceRole | string | null;
};

type WorkspacePermissionRow = {
  can_read: boolean;
  can_write: boolean;
};

type WorkspaceAccess = {
  workspaceId: string | null;
  role: WorkspaceRole;
  canRead: boolean;
  canWrite: boolean;
};

type WorkspaceRow = {
  id: string;
  name: string | null;
};

type SyncPayload = Record<string, unknown>;
type RemoteSyncRow = RemotePullRow;

const syncIntervalMs = 30_000;
const maxSyncAttempts = 5;
const syncBatchSize = 20;
const uuidNamespace = 'bug-pocket-local-sync-v1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeAccountSetup(setup?: SyncAccountSetup): SyncAccountSetup {
  if (!setup || setup.accountMode !== 'team') {
    return { accountMode: 'single', rolePermissions: [] };
  }

  const roles = new Map<string, SyncRolePermission>();
  for (const permission of setup.rolePermissions ?? []) {
    const role = permission.role.trim().replace(/\s+/g, ' ');
    if (!role || role.length > 80) throw new Error('Each team role must be between 1 and 80 characters.');
    const normalizedRole = role.toLocaleLowerCase();
    if (normalizedRole === 'owner' || normalizedRole === 'admin') {
      throw new Error('Owner and Admin are built-in workspace roles and cannot be reconfigured during signup.');
    }
    roles.set(normalizedRole, {
      role,
      canRead: Boolean(permission.canRead),
      canWrite: Boolean(permission.canWrite)
    });
  }

  if (roles.size > 20) throw new Error('A team can define up to 20 roles during setup.');
  if ([...roles.values()].some((permission) => permission.canWrite && !permission.canRead)) {
    throw new Error('A role with write access must also have read access.');
  }

  return { accountMode: 'team', rolePermissions: [...roles.values()] };
}

function variantNibble(value: string | undefined): string {
  const nibble = Number.parseInt(value ?? '8', 16);
  return ((nibble & 0x3) | 0x8).toString(16);
}

export function deriveRemoteEntityId(workspaceId: string, entityType: string, localId: number | string): string {
  const stringValue = String(localId).trim();
  if (uuidPattern.test(stringValue)) return stringValue;
  const hash = createHash('sha256').update(`${uuidNamespace}:${workspaceId}:${entityType}:${stringValue}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variantNibble(hash[16])}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function resolveRemoteTaxonomyId(
  workspaceId: string,
  entityType: 'application' | 'module' | 'environment',
  value: unknown
): string | null {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  if (!stringValue) return null;
  return uuidPattern.test(stringValue) ? stringValue : deriveRemoteEntityId(workspaceId, entityType, stringValue);
}

export class SyncEngine {
  private client: SupabaseClient | null = null;
  private projectUrl = '';
  private anonKey = '';
  private initializedProjectUrl = '';
  private initializedAnonKey = '';
  private syncTimer: NodeJS.Timeout | null = null;
  private activeSyncRun: Promise<void> | null = null;
  private syncSuspended = false;
  private projectPaused = false;
  private runtimeStatus: SyncRuntimeStatus | null = null;
  private retryCounts = new Map<string, number>();
  private retryDelayUntil = 0;

  constructor(
    private readonly database: BugPocketDatabase,
    private readonly emitBugsChanged: () => void = () => {},
    private readonly authStorage: SupportedStorage = new SafeStorageAdapter(database),
    private readonly emitSyncStatus: (status: SyncRuntimeStatus | null) => void = () => {}
  ) {}

  initialize(): SyncStatus {
    const nextProjectUrl = this.database.getSupabaseProjectUrl() ?? '';
    const nextAnonKey = this.database.getSupabaseAnonKey() ?? '';
    const configurationChanged = nextProjectUrl !== this.initializedProjectUrl || nextAnonKey !== this.initializedAnonKey;
    this.projectUrl = nextProjectUrl;
    this.anonKey = nextAnonKey;

    if (!this.projectUrl || !this.anonKey) {
      this.clearProjectPausedState();
      this.database.setCloudSyncSessionActive(false);
      this.client?.auth.stopAutoRefresh();
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
      if (configurationChanged) this.clearProjectPausedState();
      this.client?.auth.stopAutoRefresh();
      this.client = createClient(this.projectUrl, this.anonKey, {
        auth: {
          storage: this.authStorage,
          persistSession: true,
          autoRefreshToken: true,
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

  getRuntimeStatus(): SyncRuntimeStatus | null {
    return this.runtimeStatus ? { ...this.runtimeStatus } : null;
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
      const claimedWorkspaceId = await this.claimPendingInvite(client);
      const membership = await this.captureCurrentWorkspaceMembership(client, claimedWorkspaceId);
      if (!membership.workspaceId) {
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
        workspaceId: membership.workspaceId,
        workspaceRole: membership.role,
        workspaceCanRead: membership.canRead,
        workspaceCanWrite: membership.canWrite,
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

  async authSignUp(email: string, password: string, setup?: SyncAccountSetup): Promise<SyncAuthResult> {
    const client = this.requireClient();
    const accountSetup = normalizeAccountSetup(setup);
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          bug_pocket_account_mode: accountSetup.accountMode,
          bug_pocket_role_permissions: accountSetup.rolePermissions.map((permission) => ({
            role: permission.role,
            can_read: permission.canRead,
            can_write: permission.canWrite
          }))
        }
      }
    });
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
      const claimedWorkspaceId = await this.claimPendingInvite(client);
      const membership = await this.captureCurrentWorkspaceMembership(client, claimedWorkspaceId);
      this.database.setCloudSyncSessionActive(Boolean(membership.workspaceId));
      if (membership.workspaceId) this.startBackgroundSync();
      else this.stopBackgroundSync();
      return {
        success: Boolean(membership.workspaceId),
        authenticated: true,
        email: data.user?.email ?? email.trim(),
        workspaceId: membership.workspaceId ?? undefined,
        workspaceRole: membership.role,
        workspaceCanRead: membership.canRead,
        workspaceCanWrite: membership.canWrite,
        message: membership.workspaceId
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
    await this.disconnectWorkspace();
    return {
      success: true,
      authenticated: false,
      message: 'Signed out. Cloud sync is disconnected.'
    };
  }

  /**
   * Drops every runtime handle tied to the currently configured cloud project.
   * This must complete before replacing project credentials so queued writes can
   * never cross from one workspace database into another Supabase project.
   */
  async disconnectWorkspace(): Promise<void> {
    this.syncSuspended = true;
    this.stopBackgroundSync();
    await this.waitForQueueIdle();

    const client = this.client;
    try {
      client?.auth.stopAutoRefresh();
      // A local sign-out removes the persisted GoTrue session without waiting on
      // the previous cloud project. The workspace database is closed either way.
      const { error } = await client?.auth.signOut({ scope: 'local' }) ?? { error: null };
      if (error) console.warn('[Bug Pocket Sync] Local Supabase sign-out failed during disconnect.', error.message);
    } catch (caught) {
      console.warn('[Bug Pocket Sync] Local Supabase sign-out threw during disconnect.', caught);
    } finally {
      client?.auth.stopAutoRefresh();
      this.client = null;
      this.projectUrl = '';
      this.anonKey = '';
      this.initializedProjectUrl = '';
      this.initializedAnonKey = '';
      this.retryCounts.clear();
      this.retryDelayUntil = 0;
      this.clearProjectPausedState();
      this.database.setCloudSyncSessionActive(false);
      this.database.disconnectWorkspace();
      this.database.updateCurrentWorkspaceId(null);
    }
  }

  async restorePersistedSession(): Promise<boolean> {
    const status = this.initialize();
    if (!status.configured || !this.client) return false;
    const client = this.client;

    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(`Could not restore the saved Supabase session: ${error.message}`);

    const authenticated = Boolean(data.session);
    const workspaceId = this.database.getCurrentWorkspaceId();
    let hasWorkspaceAccess = false;
    if (authenticated && workspaceId) {
      try {
        const access = await this.refreshWorkspaceAccessForUser(client, workspaceId, data.session?.user.id ?? '');
        hasWorkspaceAccess = Boolean(access);
      } catch (caught) {
        console.warn('[Bug Pocket Sync] Could not refresh workspace permissions while restoring the session.', caught);
        this.database.updateWorkspacePermissions(workspaceId, false, false);
      }
    }
    this.database.setCloudSyncSessionActive(authenticated && hasWorkspaceAccess);
    if (authenticated && hasWorkspaceAccess) this.startBackgroundSync();
    else this.stopBackgroundSync();
    return authenticated;
  }

  async resumeAfterFailedShutdown(): Promise<void> {
    const authenticated = await this.restorePersistedSession();
    if (authenticated) this.client?.auth.startAutoRefresh();
  }

  async switchWorkspace(newWorkspaceId: string): Promise<SyncAuthResult> {
    return operationBarrier.acquire(this.switchWorkspaceInternal(newWorkspaceId));
  }

  private async switchWorkspaceInternal(newWorkspaceId: string): Promise<SyncAuthResult> {
    const workspaceId = newWorkspaceId.trim();
    if (!workspaceId) {
      return {
        success: false,
        authenticated: false,
        message: 'Choose a workspace before switching.',
        error: 'Workspace ID is required.'
      };
    }

    const client = this.requireClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      this.database.setCloudSyncSessionActive(false);
      this.stopBackgroundSync();
      return {
        success: false,
        authenticated: false,
        message: 'Log in before switching workspaces.',
        error: error?.message
      };
    }

    const { data: membership, error: membershipError } = await client
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', data.user.id)
      .maybeSingle<WorkspaceMembershipRow>();

    if (membershipError) {
      return {
        success: false,
        authenticated: true,
        email: data.user.email ?? undefined,
        workspaceId: this.database.getCurrentWorkspaceId() ?? undefined,
        message: 'Could not verify workspace membership.',
        error: membershipError.message
      };
    }

    if (!membership?.workspace_id) {
      return {
        success: false,
        authenticated: true,
        email: data.user.email ?? undefined,
        workspaceId: this.database.getCurrentWorkspaceId() ?? undefined,
        message: 'This account is not a member of that workspace.',
        error: 'Workspace membership was not found.'
      };
    }

    const access = await this.cacheWorkspaceAccess(client, workspaceId, membership.role);
    this.syncSuspended = true;
    this.stopBackgroundSync();
    try {
      await this.waitForQueueIdle();
      this.retryCounts.clear();
      this.retryDelayUntil = 0;
      await this.database.connectToWorkspaceTracked(workspaceId);
      this.database.setCloudSyncSessionActive(true);
    } catch (caught) {
      this.syncSuspended = false;
      if (this.database.getCurrentWorkspaceId()) this.startBackgroundSync();
      return {
        success: false,
        authenticated: true,
        email: data.user.email ?? undefined,
        workspaceId: this.database.getCurrentWorkspaceId() ?? undefined,
        message: 'Could not switch workspaces safely.',
        error: caught instanceof Error ? caught.message : String(caught)
      };
    }
    this.syncSuspended = false;
    this.startBackgroundSync();

    return {
      success: true,
      authenticated: true,
      email: data.user.email ?? undefined,
      workspaceId,
      workspaceRole: access.role,
      workspaceCanRead: access.canRead,
      workspaceCanWrite: access.canWrite,
      message: 'Workspace switched. Bug Pocket is now using the selected workspace database.'
    };
  }

  async listWorkspaceMemberships(): Promise<SyncWorkspaceOption[]> {
    const client = this.requireClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) return [];

    const { data: memberships, error: membershipError } = await client
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', userData.user.id);

    if (membershipError) throw membershipError;

    const workspaceIds = Array.from(new Set((memberships ?? []).map((row) => String(row.workspace_id)).filter(Boolean)));
    if (!workspaceIds.length) return [];

    const { data: workspaces, error: workspacesError } = await client
      .from('workspaces')
      .select('id, name')
      .in('id', workspaceIds);

    if (workspacesError) throw workspacesError;

    const nameById = new Map((workspaces as WorkspaceRow[] | null ?? []).map((workspace) => [workspace.id, workspace.name ?? undefined]));
    return workspaceIds.map((workspaceId) => ({
      workspaceId,
      name: nameById.get(workspaceId)
    }));
  }

  async inviteUserToWorkspace(targetEmail: string, targetRole: string): Promise<string> {
    const workspaceId = this.database.getCurrentWorkspaceId();
    const email = targetEmail.trim().toLocaleLowerCase();
    const role = targetRole.trim().toLocaleLowerCase();
    if (!workspaceId) throw new Error('Connect to a workspace before inviting a team member.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
      throw new Error('Enter a valid team member email address.');
    }
    if (!role || role.length > 80) throw new Error('Choose a valid workspace role.');

    const client = this.requireClient();
    const { data, error } = await client.rpc('invite_user_to_workspace', {
      target_workspace_id: workspaceId,
      target_email: email,
      target_role: role
    });
    if (error) throw new Error(error.message);
    if (typeof data !== 'string' || !data) throw new Error('The workspace invitation was not created.');
    return data;
  }

  async updateWorkspaceName(workspaceId: string, name: string): Promise<SyncAuthResult> {
    const cleanedWorkspaceId = workspaceId.trim();
    const cleanedName = name.trim();
    if (!cleanedWorkspaceId || !cleanedName) {
      return {
        success: false,
        authenticated: false,
        workspaceId: this.database.getCurrentWorkspaceId() ?? undefined,
        message: 'Workspace name and workspace ID are required.',
        error: 'Missing workspace name or workspace ID.'
      };
    }

    const client = this.requireClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      this.database.setCloudSyncSessionActive(false);
      this.stopBackgroundSync();
      return {
        success: false,
        authenticated: false,
        workspaceId: this.database.getCurrentWorkspaceId() ?? undefined,
        message: 'Log in before editing a workspace name.',
        error: userError?.message
      };
    }

    const { error } = await client
      .from('workspaces')
      .update({ name: cleanedName })
      .eq('id', cleanedWorkspaceId);

    if (error) {
      return {
        success: false,
        authenticated: true,
        email: userData.user.email ?? undefined,
        workspaceId: this.database.getCurrentWorkspaceId() ?? undefined,
        workspaceRole: this.database.getWorkspaceRole(cleanedWorkspaceId),
        message: 'Could not update workspace name.',
        error: error.message
      };
    }

    return {
      success: true,
      authenticated: true,
      email: userData.user.email ?? undefined,
      workspaceId: cleanedWorkspaceId,
      workspaceRole: this.database.getWorkspaceRole(cleanedWorkspaceId),
      message: 'Workspace name updated.'
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

    const workspaceId = this.database.getCurrentWorkspaceId();
    let hasWorkspaceAccess = false;
    if (workspaceId) {
      try {
        hasWorkspaceAccess = Boolean(await this.refreshWorkspaceAccessForUser(this.client, workspaceId, data.user.id));
      } catch (caught) {
        console.warn('[Bug Pocket Sync] Could not refresh cached workspace permissions.', caught);
        this.database.updateWorkspacePermissions(workspaceId, false, false);
      }
    }
    this.database.setCloudSyncSessionActive(hasWorkspaceAccess);
    if (hasWorkspaceAccess) this.startBackgroundSync();
    else this.stopBackgroundSync();

    return {
      authenticated: true,
      email: data.user.email ?? undefined,
      workspaceId: workspaceId ?? undefined,
      workspaceRole: this.database.getWorkspaceRole(workspaceId),
      workspaceCanRead: this.database.getWorkspacePermissions(workspaceId).canRead,
      workspaceCanWrite: this.database.getWorkspacePermissions(workspaceId).canWrite
    };
  }

  startBackgroundSync(): void {
    if (this.syncTimer || this.projectPaused) return;
    this.syncSuspended = false;
    this.syncTimer = setInterval(() => {
      void this.processQueue();
    }, syncIntervalMs);
    void this.processQueue();
  }

  stopBackgroundSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  stop(): void {
    this.syncSuspended = true;
    this.stopBackgroundSync();
    this.client?.auth.stopAutoRefresh();
  }

  async pauseWorkspaceSync(): Promise<void> {
    this.syncSuspended = true;
    this.stopBackgroundSync();
    await this.waitForQueueIdle();
    this.retryCounts.clear();
    this.retryDelayUntil = 0;
  }

  async stopAndWait(): Promise<void> {
    await this.stopAndDrain();
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    const activeRun = this.activeSyncRun;
    if (activeRun) await activeRun;
  }

  async processQueue(): Promise<void> {
    if (this.activeSyncRun) return this.activeSyncRun;

    const syncRun = this.runSyncCycle();
    this.activeSyncRun = syncRun;
    try {
      await syncRun;
    } finally {
      if (this.activeSyncRun === syncRun) this.activeSyncRun = null;
    }
  }

  private async runSyncCycle(): Promise<void> {
    try {
      if (!this.database.isOpen()) return;
      const workspaceId = this.database.getCurrentWorkspaceId();
      if (!workspaceId) return;
      if (this.syncSuspended) return;
      if (this.projectPaused) return;

      const client = this.client;
      if (!client) return;

      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) return;

      await this.pullRemoteTaxonomyFor(client, workspaceId);
      await this.pullRemoteChangesFor(client, workspaceId);
      await this.drainAttachmentDownloadQueue(client, workspaceId);
      if (
        Date.now() >= this.retryDelayUntil
        && this.database.getWorkspacePermissions(workspaceId).canWrite
      ) {
        await this.drainSyncQueue(client, workspaceId);
      }
    } catch (caught) {
      if (this.markProjectPaused(caught)) return;
      const errorMessage = this.formatSyncError(caught);
      if (this.isMissingWorkspaceDatabaseError(caught)) {
        console.error('[Bug Pocket Sync] Workspace database is not ready. Sync cycle skipped.', errorMessage);
      } else {
        console.error('[Bug Pocket Sync] Background sync cycle failed. The worker will retry on the next interval.', errorMessage);
      }
    }
  }

  async pullRemoteChanges(): Promise<boolean> {
    const client = this.client;
    const workspaceId = this.database.getCurrentWorkspaceId();
    if (!client || !workspaceId) return false;
    await this.pullRemoteTaxonomyFor(client, workspaceId);
    const changed = await this.pullRemoteChangesFor(client, workspaceId);
    await this.drainAttachmentDownloadQueue(client, workspaceId);
    return changed;
  }

  async pullRemoteTaxonomy(): Promise<boolean> {
    const client = this.client;
    const workspaceId = this.database.getCurrentWorkspaceId();
    if (!client || !workspaceId) return false;
    return this.pullRemoteTaxonomyFor(client, workspaceId);
  }

  async retrySyncQueueNow(): Promise<void> {
    this.clearProjectPausedState();
    this.retryDelayUntil = 0;
    this.syncSuspended = false;
    this.startBackgroundSync();
    await this.processQueue();
  }

  private async drainSyncQueue(client: SupabaseClient, workspaceId: string): Promise<void> {
    const events = this.database.getPendingSyncQueue(syncBatchSize, maxSyncAttempts);
    for (const event of events) {
      try {
        await this.processEvent(client, workspaceId, event);
        this.retryCounts.delete(this.retryKey(event));
        this.database.markSyncEventSucceeded(event);
      } catch (caught) {
        if (this.markProjectPaused(caught)) break;
        const errorMessage = this.formatSyncError(caught);
        const attempts = this.database.recordSyncEventFailure(event, errorMessage, maxSyncAttempts);
        this.retryCounts.set(this.retryKey(event), attempts);
        if (attempts >= maxSyncAttempts) {
          this.retryCounts.delete(this.retryKey(event));
        } else {
          this.retryDelayUntil = Date.now() + Math.min(60_000, 1000 * 2 ** attempts);
        }
        break;
      }
    }
  }

  private async pullRemoteChangesFor(client: SupabaseClient, workspaceId: string): Promise<boolean> {
    return pullWithCompositeCursors({
      client: client as unknown as RemotePullClient,
      workspaceId,
      batchSize: syncBatchSize,
      getCursor: (entityType) => this.database.getRemoteSyncCursor(workspaceId, entityType),
      applyBugBatch: (rows) => this.database.applyRemoteBugBatch(rows),
      applyAttachmentBatch: (rows) => {
        const validatedRows = rows.map((row) => {
          if (String(row.deleted_at ?? '').trim()) return row;
          const attachmentMetadata = validateAttachmentMetadata(row.content_hash, row.file_extension);
          return {
            ...row,
            content_hash: attachmentMetadata.contentHash,
            file_extension: attachmentMetadata.extension
          };
        });
        return this.database.applyRemoteAttachmentBatch(validatedRows);
      },
      updateCursor: (entityType, cursor) => this.database.updateRemoteSyncCursor(workspaceId, entityType, cursor),
      emitChanged: this.emitBugsChanged
    });
  }

  private async pullRemoteTaxonomyFor(client: SupabaseClient, workspaceId: string): Promise<boolean> {
    let changed = false;

    const applicationsResult = await client
      .from('applications')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });
    throwIfSupabaseError(applicationsResult, 'Unable to pull applications');
    for (const row of (applicationsResult.data ?? []) as RemoteSyncRow[]) {
      if (this.database.upsertRemoteApplication(row)) changed = true;
    }

    const modulesResult = await client
      .from('modules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });
    throwIfSupabaseError(modulesResult, 'Unable to pull modules');
    for (const row of (modulesResult.data ?? []) as RemoteSyncRow[]) {
      if (this.database.upsertRemoteModule(row)) changed = true;
    }

    const environmentsResult = await client
      .from('environments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });
    throwIfSupabaseError(environmentsResult, 'Unable to pull environments');
    for (const row of (environmentsResult.data ?? []) as RemoteSyncRow[]) {
      if (this.database.upsertRemoteEnvironment(row)) changed = true;
    }

    return changed;
  }

  async pushBug(_bug: BugDetails): Promise<void> {
    // DEFERRED (v1.1): Ad-hoc synchronous push. Current architecture relies exclusively on background queue processing.
    await this.processQueue();
  }

  async pullChanges(): Promise<void> {
    // DEFERRED (v1.1): Manual pull trigger. Current architecture pulls through the background sync worker.
  }

  private async processEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent): Promise<void> {
    const payload = this.parsePayload(event.payload);
    if (event.entity_type === 'application') {
      await this.syncApplicationEvent(client, workspaceId, event, payload);
      return;
    }
    if (event.entity_type === 'module') {
      await this.syncModuleEvent(client, workspaceId, event, payload);
      return;
    }
    if (event.entity_type === 'environment') {
      await this.syncEnvironmentEvent(client, workspaceId, event, payload);
      return;
    }
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
      const stamp = new Date().toISOString();
      const result = await client
        .from('bugs')
        .update({
          deleted_at: stamp,
          updated_at: stamp,
          sync_status: 'Synced'
        })
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      throwIfSupabaseError(result, 'Unable to delete remote bug');
      return;
    }

    const record = this.serializeBugPayload(workspaceId, id, payload);
    const result = await client.from('bugs').upsert(record, { onConflict: 'id' });
    throwIfSupabaseError(result, 'Unable to sync bug');
    this.database.markRemoteId('bug', this.numericLocalId(event.entity_id), id);
  }

  private formatSyncError(caught: unknown): string {
    if (caught instanceof Error) {
      const details = this.extractObjectDetails(caught);
      return details ? `${caught.message} ${details}` : caught.message;
    }

    if (typeof caught === 'string') return caught;
    if (!caught || typeof caught !== 'object') return String(caught);

    return this.extractObjectDetails(caught) || JSON.stringify(caught);
  }

  private markProjectPaused(caught: unknown): boolean {
    if (httpStatusFromError(caught) !== 503) return false;
    if (!this.projectPaused) {
      this.projectPaused = true;
      this.runtimeStatus = {
        status: 'error',
        code: 'PROJECT_PAUSED',
        message: 'Supabase project is paused'
      };
      this.stopBackgroundSync();
      this.emitSyncStatus(this.getRuntimeStatus());
    }
    return true;
  }

  private clearProjectPausedState(): void {
    if (!this.projectPaused && !this.runtimeStatus) return;
    this.projectPaused = false;
    this.runtimeStatus = null;
    this.emitSyncStatus(null);
  }

  private extractObjectDetails(value: object): string {
    const record = value as Record<string, unknown>;
    const parts = ['message', 'details', 'hint', 'code', 'status', 'statusCode']
      .map((key) => [key, record[key]] as const)
      .filter(([, item]) => item !== undefined && item !== null && String(item).trim().length > 0)
      .map(([key, item]) => `${key}: ${String(item)}`);

    if (parts.length) return parts.join(' | ');

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private async syncApplicationEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const id = this.remoteEntityId(workspaceId, 'application', event.entity_id);
    const stamp = new Date().toISOString();
    const record = {
      id,
      workspace_id: workspaceId,
      name: String(payload.name ?? 'Application'),
      context_description: this.stringOrNull(payload.context_description),
      is_active: event.operation === 'DELETE' ? false : Number(payload.is_active ?? 1) !== 0,
      is_synced: Number(payload.is_synced ?? 1) !== 0,
      created_at: String(payload.created_at ?? stamp),
      updated_at: event.operation === 'DELETE' ? stamp : String(payload.updated_at ?? stamp)
    };

    const result = await client.from('applications').upsert(record, { onConflict: 'id' });
    throwIfSupabaseError(result, 'Unable to sync application');
  }

  private async syncModuleEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const id = this.remoteEntityId(workspaceId, 'module', event.entity_id);
    const stamp = new Date().toISOString();
    const record = {
      id,
      workspace_id: workspaceId,
      application_id: this.remoteTaxonomyId(workspaceId, 'application', payload.application_id),
      name: String(payload.name ?? 'Module'),
      context_description: this.stringOrNull(payload.context_description),
      is_active: event.operation === 'DELETE' ? false : Number(payload.is_active ?? 1) !== 0,
      created_at: String(payload.created_at ?? stamp),
      updated_at: event.operation === 'DELETE' ? stamp : String(payload.updated_at ?? stamp)
    };

    const result = await client.from('modules').upsert(record, { onConflict: 'id' });
    throwIfSupabaseError(result, 'Unable to sync module');
  }

  private async syncEnvironmentEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const id = this.remoteEntityId(workspaceId, 'environment', event.entity_id);
    const stamp = new Date().toISOString();
    const record = {
      id,
      workspace_id: workspaceId,
      name: String(payload.name ?? payload.value ?? 'Environment'),
      context_description: this.stringOrNull(payload.context_description),
      is_active: event.operation === 'DELETE' ? false : Number(payload.is_active ?? 1) !== 0,
      created_at: String(payload.created_at ?? stamp),
      updated_at: event.operation === 'DELETE' ? stamp : String(payload.updated_at ?? stamp)
    };

    const result = await client.from('environments').upsert(record, { onConflict: 'id' });
    throwIfSupabaseError(result, 'Unable to sync environment');
  }

  private async syncAttachmentEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const id = this.localUuid(workspaceId, 'attachment', event.entity_id);
    const contentHash = this.stringOrNull(payload.content_hash);
    const fileExtension = normalizeAttachmentExtension(this.stringOrNull(payload.file_extension) ?? '.png');
    const storageTarget = contentHash
      ? buildAttachmentDownloadTarget(this.database.screenshotsDir, workspaceId, contentHash, fileExtension)
      : null;
    const storageKey = storageTarget?.storageKey ?? null;

    if (event.operation === 'DELETE') {
      const stamp = new Date().toISOString();
      const result = await client
        .from('attachments')
        .update({
          deleted_at: stamp,
          updated_at: stamp,
          sync_status: 'Synced'
        })
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      throwIfSupabaseError(result, 'Unable to delete remote attachment');
      return;
    }

    if (contentHash && storageTarget) {
      const attachmentStorage = client.storage.from('attachments');
      const filePath = storageTarget.localPath;
      if (!existsSync(filePath)) {
        const remoteObject = await attachmentStorage.exists(storageTarget.storageKey);
        const remoteStatus = httpStatusFromError(remoteObject.error);
        if (remoteObject.error && remoteStatus !== 400 && remoteStatus !== 404) {
          throwIfSupabaseError(remoteObject, 'Unable to verify remote attachment');
        }
        if (!remoteObject.data) {
          throw new Error(
            `Attachment binary is missing locally and does not exist remotely: ${storageTarget.storageKey}. ` +
            'Remote metadata was not created.'
          );
        }
      } else {
        const fileBytes = await readFile(filePath);
        const uploadResult = await attachmentStorage.upload(storageTarget.storageKey, fileBytes, {
          contentType: String(payload.mime_type || 'image/png'),
          upsert: true
        });
        throwIfSupabaseError(uploadResult, 'Unable to upload attachment');
      }
    }

    const record = this.serializeAttachmentPayload(workspaceId, id, storageKey, payload);
    const result = await client.from('attachments').upsert(record, { onConflict: 'id' });
    throwIfSupabaseError(result, 'Unable to sync attachment metadata');
    this.database.markRemoteId('attachment', this.numericLocalId(event.entity_id), id);
  }

  private async syncReferenceEvent(client: SupabaseClient, workspaceId: string, event: SyncQueueEvent, payload: SyncPayload): Promise<void> {
    const result = await client.from('sync_events').insert({
      workspace_id: workspaceId,
      client_id: null,
      local_seq: event.local_seq,
      op_id: event.op_id || null,
      entity_type: event.entity_type,
      entity_id: this.localUuid(workspaceId, 'reference', event.entity_id),
      operation: event.operation,
      payload
    });
    throwIfSupabaseError(result, 'Unable to sync reference event');
  }

  private async drainAttachmentDownloadQueue(client: SupabaseClient, workspaceId: string): Promise<void> {
    const downloads = this.database.getPendingAttachmentDownloads(syncBatchSize, maxSyncAttempts);
    for (const download of downloads) {
      try {
        await this.downloadAttachmentBinary(
          client,
          workspaceId,
          download.content_hash,
          download.file_extension
        );
        this.database.markAttachmentDownloadSucceeded(download.attachment_id);
      } catch (caught) {
        if (this.markProjectPaused(caught)) break;
        this.database.recordAttachmentDownloadFailure(
          download.attachment_id,
          this.formatSyncError(caught)
        );
      }
    }
  }
  private async downloadAttachmentBinary(
    client: SupabaseClient,
    workspaceId: string,
    contentHash: string | null,
    fileExtension: string
  ): Promise<void> {
    if (!contentHash) return;
    const target = buildAttachmentDownloadTarget(
      this.database.screenshotsDir,
      workspaceId,
      contentHash,
      fileExtension || '.png'
    );
    if (this.database.attachmentFileExists(contentHash, target.extension)) return;

    const temporaryPath = join(dirname(target.localPath), `${contentHash}.tmp`);
    try {
      const result = await client.storage.from('attachments').download(target.storageKey);
      throwIfSupabaseError(result, `Attachment download failed for ${target.storageKey}`);
      if (!result.data) throw new Error(`Attachment download returned no data for ${target.storageKey}.`);

      const bytes = Buffer.from(await result.data.arrayBuffer());
      await writeFile(temporaryPath, bytes);

      const downloadedHash = createHash('sha256')
        .update(await readFile(temporaryPath))
        .digest('hex');
      if (downloadedHash.toLowerCase() !== contentHash.toLowerCase()) {
        throw new Error(
          `Attachment integrity check failed for ${target.storageKey}: SHA-256 mismatch ` +
          `(expected ${contentHash}, received ${downloadedHash}).`
        );
      }

      await rename(temporaryPath, target.localPath);
    } catch (caught) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw caught;
    }
  }

  private serializeBugPayload(workspaceId: string, id: string, payload: SyncPayload): SyncPayload {
    return {
      id,
      workspace_id: workspaceId,
      application_id: this.remoteTaxonomyId(workspaceId, 'application', payload.application_id),
      module_id: this.remoteTaxonomyId(workspaceId, 'module', payload.module_id),
      environment_id: this.remoteTaxonomyId(workspaceId, 'environment', payload.environment_id),
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
      deleted_at: null,
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
      file_extension: normalizeAttachmentExtension(this.stringOrNull(payload.file_extension) ?? '.png'),
      mime_type: String(payload.mime_type ?? 'image/png'),
      source_type: String(payload.source_type ?? 'other'),
      sync_status: 'Synced',
      storage_bucket: storageKey ? 'attachments' : null,
      storage_key: storageKey,
      deleted_at: null,
      created_at: String(payload.created_at ?? new Date().toISOString()),
      updated_at: String(payload.updated_at ?? new Date().toISOString())
    };
  }

  private async waitForQueueIdle(): Promise<void> {
    const activeSyncRun = this.activeSyncRun;
    if (activeSyncRun) await activeSyncRun;
  }

  private requireClient(): SupabaseClient {
    this.initialize();
    if (!this.client) throw new Error('Supabase is not configured. Add Project URL and anon key first.');
    return this.client;
  }

  private async claimPendingInvite(client: SupabaseClient): Promise<string | null> {
    const { data, error } = await client.rpc('claim_pending_invite');
    if (error) throw new Error(error.message);
    return typeof data === 'string' && data.trim() ? data.trim() : null;
  }

  private async captureCurrentWorkspaceMembership(client: SupabaseClient, preferredWorkspaceId: string | null = null): Promise<WorkspaceAccess> {
    let query = client
      .from('workspace_members')
      .select('workspace_id, role')
      .limit(1);
    if (preferredWorkspaceId) query = query.eq('workspace_id', preferredWorkspaceId);
    const { data, error } = await query.maybeSingle<WorkspaceMembershipRow>();

    if (error) throw error;
    const workspaceId = data?.workspace_id ?? null;
    this.database.updateCurrentWorkspaceId(workspaceId);
    if (!workspaceId) return { workspaceId: null, role: 'admin', canRead: false, canWrite: false };
    return this.cacheWorkspaceAccess(client, workspaceId, data?.role);
  }

  private async cacheWorkspaceAccess(client: SupabaseClient, workspaceId: string, rawRole: WorkspaceRole | string | null | undefined): Promise<WorkspaceAccess> {
    const role = this.database.updateWorkspaceRole(workspaceId, rawRole);
    if (role === 'owner' || role === 'admin') {
      const permissions = this.database.updateWorkspacePermissions(workspaceId, true, true);
      return { workspaceId, role, ...permissions };
    }

    const { data, error } = await client
      .from('roles_permissions')
      .select('can_read, can_write')
      .eq('workspace_id', workspaceId)
      .eq('role', role)
      .maybeSingle<WorkspacePermissionRow>();

    if (error) throw error;
    // Missing configuration is read-only by design. It is safer to deny an
    // unrecognized custom role locally than to let a queued mutation through.
    const permissions = this.database.updateWorkspacePermissions(
      workspaceId,
      data?.can_read === true,
      data?.can_write === true
    );
    return { workspaceId, role, ...permissions };
  }

  private async refreshWorkspaceAccessForUser(client: SupabaseClient, workspaceId: string, userId: string): Promise<WorkspaceAccess | null> {
    if (!userId) return null;
    const { data, error } = await client
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle<WorkspaceMembershipRow>();

    if (error) throw error;
    if (!data?.workspace_id) {
      this.database.updateWorkspacePermissions(workspaceId, false, false);
      return null;
    }
    return this.cacheWorkspaceAccess(client, workspaceId, data.role);
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

  private isMissingWorkspaceDatabaseError(caught: unknown): boolean {
    const message = caught instanceof Error ? caught.message : String(caught);
    return /workspace database|workspaceDb|workspace db|no workspace|database is not ready|not connected/i.test(message);
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

  private remoteTaxonomyId(workspaceId: string, entityType: 'application' | 'module' | 'environment', value: unknown): string | null {
    return resolveRemoteTaxonomyId(workspaceId, entityType, value);
  }

  private numericLocalId(value: number | string): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Expected numeric local sync id, received ${value}.`);
    return numeric;
  }

  private remoteEntityId(workspaceId: string, entityType: string, localId: number | string): string {
    return deriveRemoteEntityId(workspaceId, entityType, localId);
  }

  private localUuid(workspaceId: string, entityType: string, localId: number | string): string {
    return deriveRemoteEntityId(workspaceId, entityType, localId);
  }

  private stringOrNull(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

}
