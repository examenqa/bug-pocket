import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Cloud, ExternalLink, HelpCircle, LogOut, Pencil, Plus, RefreshCw, Trash2, UserCircle2, X } from 'lucide-react';
import type { SettingsData, SyncAccountMode, SyncAccountSetup, SyncAuthResult, SyncConnectionResult, SyncDiagnosticsRow, SyncRolePermission, SyncSessionStatus, SyncWorkspaceOption, TeamInvitePayload } from '../../../../shared/types';

interface SyncSettingsProps {
  settings: SettingsData;
  mutationReady: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string, variant?: 'success' | 'info' | 'error') => void;
}

type AuthMode = 'login' | 'signup';

const defaultTeamRoles: SyncRolePermission[] = [
  { role: 'QA', canRead: true, canWrite: true },
  { role: 'Developer', canRead: true, canWrite: false }
];

export function SyncSettings({ settings, mutationReady, refresh, showToast }: SyncSettingsProps) {
  const developerReadOnly = !settings.currentWorkspaceCanWrite;
  const boundInviteEmail = settings.supabaseInviteEmail?.trim().toLowerCase() ?? '';
  const [projectUrl, setProjectUrl] = useState(settings.supabaseProjectUrl ?? '');
  const [anonKey, setAnonKey] = useState(settings.supabaseAnonKey ?? '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [accountMode, setAccountMode] = useState<SyncAccountMode>('single');
  const [rolePermissions, setRolePermissions] = useState<SyncRolePermission[]>(defaultTeamRoles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<SyncSessionStatus>({ authenticated: false });
  const [workspaceOptions, setWorkspaceOptions] = useState<SyncWorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(settings.currentWorkspaceId ?? '');
  const [testResult, setTestResult] = useState<SyncConnectionResult | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SyncDiagnosticsRow[]>([]);
  const [retryingSync, setRetryingSync] = useState(false);
  const [showCredentialHelp, setShowCredentialHelp] = useState(false);
  const [adminSetupOpen, setAdminSetupOpen] = useState(false);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [savingWorkspaceName, setSavingWorkspaceName] = useState(false);
  const [invitePassphrase, setInvitePassphrase] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [generatedInviteCode, setGeneratedInviteCode] = useState('');
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinPassphrase, setJoinPassphrase] = useState('');
  const [pendingInvite, setPendingInvite] = useState<TeamInvitePayload | null>(null);

  useEffect(() => {
    setProjectUrl(settings.supabaseProjectUrl ?? '');
    setAnonKey(settings.supabaseAnonKey ?? '');
  }, [settings.supabaseProjectUrl, settings.supabaseAnonKey]);

  useEffect(() => {
    let cancelled = false;
    window.bugPocket.getSyncSessionStatus()
      .then(async (status) => {
        if (cancelled) return;
        const nextStatus = status as SyncSessionStatus;
        setSession(nextStatus);
        setSelectedWorkspaceId(nextStatus.workspaceSelectionRequired ? '' : nextStatus.workspaceId ?? settings.currentWorkspaceId ?? '');
        if (nextStatus.authenticated) {
          const options = (await window.bugPocket.listWorkspaces()) as SyncWorkspaceOption[];
          if (!cancelled) setWorkspaceOptions(options);
          if (!cancelled) {
            const rows = (await window.bugPocket.getSyncDiagnostics()) as SyncDiagnosticsRow[];
            if (!cancelled) setDiagnostics(rows);
          }
        } else {
          setWorkspaceOptions([]);
          setDiagnostics([]);
        }
      })
      .catch(() => {
        if (!cancelled) setSession({ authenticated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [settings.supabaseProjectUrl, settings.supabaseAnonKey, settings.currentWorkspaceId]);

  const saveCredentials = async (): Promise<boolean> => {
    if (!mutationReady) return false;
    const nextUrl = projectUrl.trim();
    const nextKey = anonKey.trim();
    if (!nextUrl || !nextKey) {
      showToast('Enter both the Supabase Project URL and Publishable API Key.', 'error');
      return false;
    }
    if (nextUrl === (settings.supabaseProjectUrl ?? '') && nextKey === (settings.supabaseAnonKey ?? '')) return true;
    setSaving(true);
    try {
      await window.bugPocket.updateSupabaseSettings(nextUrl, nextKey);
      await refresh();
      showToast('Supabase credentials saved locally.');
      return true;
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not save Supabase credentials.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const loadSession = async (): Promise<void> => {
    const status = (await window.bugPocket.getSyncSessionStatus()) as SyncSessionStatus;
    setSession(status);
    setSelectedWorkspaceId(status.workspaceSelectionRequired ? '' : status.workspaceId ?? settings.currentWorkspaceId ?? '');
    if (status.authenticated) {
      const options = (await window.bugPocket.listWorkspaces()) as SyncWorkspaceOption[];
      setWorkspaceOptions(options);
      await loadDiagnostics();
    } else {
      setWorkspaceOptions([]);
      setDiagnostics([]);
    }
  };

  const loadDiagnostics = async (): Promise<void> => {
    const rows = (await window.bugPocket.getSyncDiagnostics()) as SyncDiagnosticsRow[];
    setDiagnostics(rows);
  };

  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      if (!(await saveCredentials())) return;
      const result = (await window.bugPocket.testSupabaseConnection()) as SyncConnectionResult;
      setTestResult(result);
      showToast(result.message, result.success ? 'success' : 'error');
    } catch (caught) {
      const result = {
        success: false,
        configured: Boolean(projectUrl.trim() && anonKey.trim()),
        message: caught instanceof Error ? caught.message : 'Supabase connection test failed.'
      } satisfies SyncConnectionResult;
      setTestResult(result);
      showToast(result.message, result.success ? 'success' : 'error');
    } finally {
      setTesting(false);
    }
  };

  const submitAuth = async (): Promise<void> => {
    const cleanedEmail = email.trim();
    if (!cleanedEmail || !password) {
      showToast('Enter an email and password first.', 'error');
      return;
    }
    if (boundInviteEmail && cleanedEmail.toLowerCase() !== boundInviteEmail) {
      showToast('This invite token is bound to a different email address.', 'error');
      return;
    }

    const setup: SyncAccountSetup = {
      accountMode,
      rolePermissions: accountMode === 'team'
        ? rolePermissions.map((permission) => ({
            role: permission.role.trim(),
            canRead: permission.canRead,
            canWrite: permission.canWrite
          }))
        : []
    };
    if (authMode === 'signup' && setup.accountMode === 'team') {
      if (!setup.rolePermissions.length || setup.rolePermissions.some((permission) => !permission.role)) {
        showToast('Give every team role a name before creating the account.', 'error');
        return;
      }
      if (setup.rolePermissions.some((permission) => permission.canWrite && !permission.canRead)) {
        showToast('A role with write access must also have read access.', 'error');
        return;
      }
    }

    setAuthBusy(true);
    try {
      if (!(await saveCredentials())) return;
      const result = (authMode === 'login'
        ? await window.bugPocket.authSignIn(cleanedEmail, password)
        : await window.bugPocket.authSignUp(cleanedEmail, password, setup)) as SyncAuthResult;
      showToast(result.message, result.success ? 'success' : 'error');
      await refresh();
      await loadSession();
      if (result.success) setPassword('');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Supabase authentication failed.', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setAuthBusy(true);
    try {
      const result = (await window.bugPocket.authSignOut()) as SyncAuthResult;
      showToast(result.message, result.success ? 'success' : 'error');
      await refresh();
      await loadSession();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not sign out.', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const switchWorkspace = async (): Promise<void> => {
    const workspaceId = selectedWorkspaceId.trim();
    if (!workspaceId || workspaceId === (session.workspaceId ?? settings.currentWorkspaceId ?? '')) return;

    setSwitchingWorkspace(true);
    try {
      const result = (await window.bugPocket.switchWorkspace(workspaceId)) as SyncAuthResult;
      showToast(result.message, result.success ? 'success' : 'error');
      await refresh();
      await loadSession();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not switch workspace.', 'error');
    } finally {
      setSwitchingWorkspace(false);
    }
  };

  const startWorkspaceNameEdit = (): void => {
    setWorkspaceNameDraft(activeWorkspaceName === 'Active Workspace' ? '' : activeWorkspaceName);
    setEditingWorkspaceName(true);
  };

  const saveWorkspaceName = async (): Promise<void> => {
    if (developerReadOnly) return;
    const workspaceId = activeWorkspaceId.trim();
    const nextName = workspaceNameDraft.trim();
    if (!workspaceId || !nextName) {
      showToast('Enter a workspace name before saving.', 'error');
      return;
    }

    setSavingWorkspaceName(true);
    try {
      const result = (await window.bugPocket.updateWorkspaceName(workspaceId, nextName)) as SyncAuthResult;
      showToast(result.message, result.success ? 'success' : 'error');
      if (result.success) {
        setEditingWorkspaceName(false);
        await refresh();
        await loadSession();
      }
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not update workspace name.', 'error');
    } finally {
      setSavingWorkspaceName(false);
    }
  };

  const forceRetry = async (): Promise<void> => {
    setRetryingSync(true);
    try {
      const rows = (await window.bugPocket.forceRetrySyncQueue()) as SyncDiagnosticsRow[];
      setDiagnostics(rows);
      showToast('Sync retry triggered.');
      await refresh();
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not retry sync queue.', 'error');
    } finally {
      setRetryingSync(false);
    }
  };

  const generateInvite = async (): Promise<void> => {
    if (invitePassphrase.trim().length < 12) {
      showToast('Use an invite passphrase with at least 12 characters.', 'error');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.trim())) {
      showToast('Enter the team member email before generating an invite.', 'error');
      return;
    }
    if (!inviteRole.trim()) {
      showToast('Enter the workspace role for this team member.', 'error');
      return;
    }
    setGeneratingInvite(true);
    try {
      const code = await window.bugPocket.generateInvite(invitePassphrase, inviteEmail.trim(), inviteRole.trim());
      setGeneratedInviteCode(code);
      setInvitePassphrase('');
      setInviteEmail('');
      showToast('Member pre-authorized and team invite code generated. Share the code and passphrase separately.');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not generate an invite code.', 'error');
    } finally {
      setGeneratingInvite(false);
    }
  };

  const joinTeam = async (): Promise<void> => {
    if (!inviteCode.trim() || !joinPassphrase) {
      showToast('Paste the invite code and enter its passphrase.', 'error');
      return;
    }
    setAuthBusy(true);
    try {
      const imported = await window.bugPocket.decodeInvite(inviteCode, joinPassphrase) as TeamInvitePayload;
      setInviteCode('');
      setJoinPassphrase('');
      setPendingInvite(imported);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not import the team invite.', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const confirmTeamConnection = async (): Promise<void> => {
    if (!pendingInvite) return;
    setAuthBusy(true);
    try {
      await window.bugPocket.updateSupabaseSettings(pendingInvite.url, pendingInvite.anonKey, pendingInvite.targetEmail);
      setProjectUrl(pendingInvite.url);
      setAnonKey(pendingInvite.anonKey);
      setPendingInvite(null);
      setAuthMode('login');
      await refresh();
      showToast('Team connection imported. Log in with your invited Supabase account to continue.');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not save the team connection.', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const connectAdminWorkspace = async (): Promise<void> => {
    if (await saveCredentials()) {
      setAdminSetupOpen(false);
      setAuthMode('signup');
    }
  };

  const disconnectCloudProject = async (): Promise<void> => {
    setAuthBusy(true);
    try {
      // The settings handler drains sync work and disconnects the workspace before
      // persisting the cleared connection, so no previous project remains mounted.
      await window.bugPocket.updateSupabaseSettings('', '');
      setProjectUrl('');
      setAnonKey('');
      setEmail('');
      setPassword('');
      setSession({ authenticated: false });
      setWorkspaceOptions([]);
      setDiagnostics([]);
      await refresh();
      showToast('Cloud workspace disconnected from this device.');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not disconnect the cloud workspace.', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const copyInviteCode = async (): Promise<void> => {
    try {
      await window.bugPocket.copyText(generatedInviteCode);
      showToast('Invite code copied.');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not copy the invite code.', 'error');
    }
  };

  const updateRolePermission = (index: number, patch: Partial<SyncRolePermission>): void => {
    setRolePermissions((current) => current.map((permission, currentIndex) => (
      currentIndex === index ? { ...permission, ...patch } : permission
    )));
  };

  const addRolePermission = (): void => {
    setRolePermissions((current) => [...current, { role: '', canRead: true, canWrite: false }]);
  };

  const removeRolePermission = (index: number): void => {
    setRolePermissions((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const renderAccountSetup = (disabled: boolean): React.ReactNode => (
    <section className="sync-account-setup" aria-labelledby="account-mode-heading">
      <div className="sync-account-setup-heading">
        <div>
          <strong id="account-mode-heading">Workspace type</strong>
          <p>Single creates a personal workspace. Team lets the workspace admin define roles and permissions.</p>
        </div>
        <div className="sync-account-mode-toggle" role="radiogroup" aria-label="Workspace type">
          <button type="button" role="radio" aria-checked={accountMode === 'single'} className={accountMode === 'single' ? 'active' : ''} disabled={disabled} onClick={() => setAccountMode('single')}>Single</button>
          <button type="button" role="radio" aria-checked={accountMode === 'team'} className={accountMode === 'team' ? 'active' : ''} disabled={disabled} onClick={() => setAccountMode('team')}>Team</button>
        </div>
      </div>
      {accountMode === 'team' && (
        <div className="sync-role-matrix">
          <div className="sync-role-matrix-header" aria-hidden="true">
            <span>Role</span><span>Read</span><span>Write</span><span />
          </div>
          {rolePermissions.map((permission, index) => (
            <div className="sync-role-matrix-row" key={`${permission.role}-${index}`}>
              <input
                type="text"
                value={permission.role}
                maxLength={80}
                aria-label={`Role ${index + 1}`}
                placeholder="Role name"
                disabled={disabled}
                onChange={(event) => updateRolePermission(index, { role: event.target.value })}
              />
              <label className="sync-role-permission-toggle">
                <input
                  type="checkbox"
                  checked={permission.canRead}
                  disabled={disabled}
                  onChange={(event) => updateRolePermission(index, {
                    canRead: event.target.checked,
                    canWrite: event.target.checked ? permission.canWrite : false
                  })}
                />
                <span className="sr-only">Allow {permission.role || 'role'} to read</span>
              </label>
              <label className="sync-role-permission-toggle">
                <input
                  type="checkbox"
                  checked={permission.canWrite}
                  disabled={disabled}
                  onChange={(event) => updateRolePermission(index, {
                    canWrite: event.target.checked,
                    canRead: event.target.checked ? true : permission.canRead
                  })}
                />
                <span className="sr-only">Allow {permission.role || 'role'} to write</span>
              </label>
              <button type="button" className="icon-button danger-soft" aria-label={`Remove ${permission.role || 'role'}`} disabled={disabled || rolePermissions.length === 1} onClick={() => removeRolePermission(index)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button type="button" className="secondary compact sync-add-role-button" disabled={disabled || rolePermissions.length >= 20} onClick={addRolePermission}>
            <Plus size={15} /> Add role
          </button>
        </div>
      )}
    </section>
  );

  const configured = Boolean(settings.supabaseProjectUrl?.trim() && settings.supabaseAnonKey?.trim());
  const connectedWorkspaceLabel = (() => {
    const workspaceId = settings.currentWorkspaceId?.trim();
    if (workspaceId) return `Workspace ${workspaceId.slice(0, 8)}...${workspaceId.slice(-4)}`;
    try {
      return new URL(settings.supabaseProjectUrl ?? '').host;
    } catch {
      return 'Configured Supabase project';
    }
  })();
  const activeWorkspaceId = session.workspaceId || settings.currentWorkspaceId || '';
  const workspaceSelectionRequired = session.workspaceSelectionRequired === true || (!activeWorkspaceId && workspaceOptions.length > 1);
  const activeWorkspaceName = workspaceOptions.find((workspace) => workspace.workspaceId === activeWorkspaceId)?.name
    || (workspaceSelectionRequired ? 'Choose a Workspace' : 'Active Workspace');
  const shortWorkspaceId = activeWorkspaceId ? `${activeWorkspaceId.slice(0, 8)}...${activeWorkspaceId.slice(-4)}` : 'Not assigned';
  const canSwitchWorkspace = Boolean(selectedWorkspaceId.trim() && selectedWorkspaceId.trim() !== activeWorkspaceId);
  const failedDiagnostics = diagnostics.filter((row) => row.last_error || row.retry_count >= 5);
  const missingBinaryDiagnostics = diagnostics.filter((row) => row.missing_binary);
  const canGenerateInvite = settings.currentWorkspaceRole === 'owner' || settings.currentWorkspaceRole === 'admin';

  return (
    <div className="settings-tab-stack">
      <div className="panel sync-placeholder-panel sync-config-panel">
        <div className="panel-heading">
          <div>
            <h2>Cloud Sync</h2>
            <p className="settings-helper">Connect Bug Pocket to Supabase. Local capture remains offline-first; sync workers are still staged for a later phase.</p>
          </div>
          <button type="button" className="secondary sync-setup-guide-button" onClick={() => setShowCredentialHelp(true)}>
            <HelpCircle size={15} /> Supabase Setup Guide
          </button>
        </div>

        {!configured && (
          <div className="sync-onboarding-card">
            <section className="sync-onboarding-path sync-join-path" aria-labelledby="sync-join-title">
              <div>
                <h3 id="sync-join-title">Join a Team Workspace</h3>
                <p>Import the encrypted connection code shared by your workspace administrator.</p>
              </div>
              <div className="sync-join-fields">
                <label>
                  <span>Encrypted Team Invite Code</span>
                  <textarea
                    value={inviteCode}
                    disabled={authBusy}
                    placeholder="Paste the invite code from your workspace admin"
                    rows={3}
                    onChange={(event) => setInviteCode(event.target.value)}
                  />
                </label>
                <label>
                  <span>Invite Passphrase</span>
                  <input
                    type="password"
                    value={joinPassphrase}
                    disabled={authBusy}
                    placeholder="Passphrase shared separately"
                    onChange={(event) => setJoinPassphrase(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void joinTeam(); }}
                  />
                </label>
              </div>
              <div className="sync-onboarding-action-row">
                <button type="button" className="primary" disabled={authBusy || !inviteCode.trim() || !joinPassphrase} onClick={() => void joinTeam()}>
                  {authBusy ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
                  {authBusy ? 'Importing...' : 'Import Team Invite'}
                </button>
              </div>
              <p className="settings-helper">Invite codes are encrypted locally and are never sent through a Bug Pocket service.</p>
            </section>

            <section className="sync-onboarding-path sync-admin-path" aria-labelledby="sync-admin-title">
              <div className="sync-admin-path-heading">
                <div>
                  <h3 id="sync-admin-title">Create a New Workspace (Admin)</h3>
                  <p>Connect a Supabase project you manage, then create the first account for it.</p>
                </div>
                <button type="button" className="secondary" aria-expanded={adminSetupOpen} onClick={() => setAdminSetupOpen((open) => !open)}>
                  {adminSetupOpen ? 'Hide Admin Setup' : 'Create a New Workspace (Admin)'}
                </button>
              </div>
              {adminSetupOpen && (
                <div className="sync-admin-setup-fields">
                  <div className="sync-credential-grid">
                    <label>
                      <span>Supabase Project URL</span>
                      <input
                        type="url"
                        value={projectUrl}
                        disabled={!mutationReady || saving || testing || authBusy}
                        placeholder="https://your-project.supabase.co"
                        onChange={(event) => setProjectUrl(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Publishable API Key</span>
                      <input
                        type="password"
                        value={anonKey}
                        disabled={!mutationReady || saving || testing || authBusy}
                        placeholder="Paste publishable API key"
                        onChange={(event) => setAnonKey(event.target.value)}
                      />
                    </label>
                  </div>
                  {renderAccountSetup(saving || testing || authBusy)}
                  <div className="sync-action-row">
                    <button type="button" className="secondary" disabled={!mutationReady || saving || testing || authBusy} onClick={() => void testConnection()}>
                      {testing ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
                      {testing ? 'Testing...' : 'Test Connection'}
                    </button>
                    <button type="button" className="primary" disabled={!mutationReady || saving || testing || authBusy} onClick={() => void connectAdminWorkspace()}>
                      <Cloud size={16} /> Save and Create Account
                    </button>
                    {saving && <span className="settings-helper">Saving credentials locally...</span>}
                    {testResult && (
                      <span className={testResult.success ? 'sync-test-result success' : 'sync-test-result warning'}>
                        <CheckCircle2 size={15} /> {testResult.message}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {session.authenticated ? (
          <div className="sync-profile-card">
            <div className="sync-profile-identity-row">
              <div className="sync-profile-main">
                <UserCircle2 size={34} />
                <div className="sync-profile-copy">
                  <h3 title={session.email || 'Signed in'}>{session.email || 'Signed in'}</h3>
                  <p title={activeWorkspaceId || 'Not assigned'}>Workspace ID: <strong>{shortWorkspaceId}</strong></p>
                </div>
              </div>

              <div className="sync-workspace-name-panel">
                <span className="sync-field-label">Workspace Name</span>
                {editingWorkspaceName ? (
                  <div className="sync-workspace-edit-row">
                    <input
                      type="text"
                      value={workspaceNameDraft}
                      disabled={savingWorkspaceName}
                      onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveWorkspaceName();
                        if (event.key === 'Escape') setEditingWorkspaceName(false);
                      }}
                      autoFocus
                    />
                    <button type="button" className="primary compact" disabled={savingWorkspaceName || !workspaceNameDraft.trim()} onClick={() => void saveWorkspaceName()}>
                      {savingWorkspaceName ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" className="secondary compact" disabled={savingWorkspaceName} onClick={() => setEditingWorkspaceName(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="sync-workspace-name-row">
                    <strong title={activeWorkspaceName}>{activeWorkspaceName}</strong>
                    <button type="button" className="icon-button" aria-label="Edit workspace name" disabled={developerReadOnly || !activeWorkspaceId || savingWorkspaceName} onClick={startWorkspaceNameEdit}>
                      <Pencil size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="sync-workspace-switch-section">
              {workspaceSelectionRequired && (
                <div className="sync-test-result warning" role="alert">
                  Choose which workspace to open. Bug Pocket will not mount team data until you make an explicit selection.
                </div>
              )}
              <div className="sync-workspace-switch-row">
                <label>
                  <span>Active Workspace</span>
                  <select
                    value={selectedWorkspaceId}
                    disabled={authBusy || switchingWorkspace || !workspaceOptions.length}
                    onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                  >
                    {workspaceSelectionRequired && <option value="" disabled>Select a workspace...</option>}
                    {!workspaceOptions.length && <option value={activeWorkspaceId}>{activeWorkspaceId || 'No workspaces found'}</option>}
                    {workspaceOptions.map((workspace) => (
                      <option key={workspace.workspaceId} value={workspace.workspaceId}>
                        {workspace.name || 'Untitled Workspace'}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="secondary danger-soft" disabled={!canSwitchWorkspace || switchingWorkspace} onClick={() => void switchWorkspace()}>
                  {switchingWorkspace ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
                  {switchingWorkspace ? 'Switching...' : 'Switch Workspace'}
                </button>
              </div>
              <p className="settings-helper">Switching workspaces opens a separate local workspace database so team data stays isolated without deleting existing local files.</p>
            </div>

            <div className="sync-profile-actions">
              <span className={workspaceSelectionRequired ? 'sync-test-result warning' : 'sync-test-result success'}>
                <CheckCircle2 size={15} /> Sync Status: {workspaceSelectionRequired ? 'Workspace selection required' : 'Connected'}
              </span>
              <button type="button" className="secondary danger-soft" disabled={authBusy} onClick={() => void signOut()}>
                <LogOut size={16} /> Log Out
              </button>
            </div>
            {canGenerateInvite && (
              <section className="sync-invite-panel" aria-labelledby="sync-invite-heading">
                <div>
                  <strong id="sync-invite-heading">Invite Team Member</strong>
                  <p>Pre-authorize a Supabase account, then generate an encrypted offline code for this workspace. Share the code and passphrase separately.</p>
                </div>
                <div className="sync-invite-member-fields">
                  <label>
                    <span>Team Member Email</span>
                    <input
                      type="email"
                      value={inviteEmail}
                      maxLength={320}
                      autoComplete="email"
                      placeholder="teammate@example.com"
                      disabled={generatingInvite}
                      onChange={(event) => setInviteEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Workspace Role</span>
                    <input
                      type="text"
                      value={inviteRole}
                      maxLength={80}
                      placeholder="member"
                      disabled={generatingInvite}
                      onChange={(event) => setInviteRole(event.target.value)}
                    />
                  </label>
                </div>
                <div className="sync-invite-controls">
                  <input
                    type="password"
                    value={invitePassphrase}
                    minLength={12}
                    maxLength={512}
                    autoComplete="new-password"
                    placeholder="Invite passphrase (12+ characters)"
                    disabled={generatingInvite}
                    onChange={(event) => setInvitePassphrase(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void generateInvite(); }}
                  />
                  <button type="button" className="secondary" disabled={generatingInvite || invitePassphrase.trim().length < 12 || !inviteEmail.trim() || !inviteRole.trim()} onClick={() => void generateInvite()}>
                    {generatingInvite ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
                    {generatingInvite ? 'Generating...' : 'Generate Invite'}
                  </button>
                </div>
                {generatedInviteCode && (
                  <div className="sync-invite-code">
                    <textarea aria-label="Generated encrypted team invite code" value={generatedInviteCode} readOnly rows={3} />
                    <button type="button" className="secondary compact" onClick={() => void copyInviteCode()}>
                      Copy Code
                    </button>
                  </div>
                )}
              </section>
            )}
            <div className={diagnosticsOpen ? 'panel settings-option-panel open' : 'panel settings-option-panel'}>
              <button
                type="button"
                className="settings-option-header"
                aria-expanded={diagnosticsOpen}
                onClick={() => {
                  const nextOpen = !diagnosticsOpen;
                  setDiagnosticsOpen(nextOpen);
                  if (nextOpen) void loadDiagnostics();
                }}
              >
                <span>
                  <strong>Sync Diagnostics</strong>
                  <em>{diagnostics.length} pending item{diagnostics.length === 1 ? '' : 's'} · {missingBinaryDiagnostics.length} missing binaries · {failedDiagnostics.length} failed</em>
                </span>
                {diagnosticsOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </button>
              {diagnosticsOpen && (
                <div className="settings-option-body">
                  <div className="sync-action-row">
                    <button type="button" className="secondary" disabled={retryingSync || !diagnostics.length} onClick={() => void forceRetry()}>
                      <RefreshCw className={retryingSync ? 'spin' : undefined} size={16} />
                      {retryingSync ? 'Retrying...' : 'Force Retry'}
                    </button>
                    <button type="button" className="secondary" disabled={retryingSync} onClick={() => void loadDiagnostics()}>
                      <RefreshCw size={16} /> Refresh
                    </button>
                  </div>
                  <div className="option-list">
                    {diagnostics.map((row) => (
                      <div className="option-row sync-diagnostics-row" key={`${row.queue_type}-${row.id}`}>
                        <span className="option-name">
                          <span className="sync-diagnostics-title-line">
                            <span>{row.label}</span>
                            <span className="sync-diagnostics-separator">•</span>
                            <em>{row.queue_type === 'download' ? 'binary download' : `${row.entity_type} · ${row.operation}`} · retries {row.retry_count}</em>
                          </span>
                          {row.missing_binary && !row.last_error && (
                            <small className="sync-diagnostics-missing">Binary is missing locally and queued for download.</small>
                          )}
                          {row.last_error && <small className="settings-error">{row.last_error}</small>}
                        </span>
                      </div>
                    ))}
                    {!diagnostics.length && <p className="muted">No pending sync payloads.</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : configured ? (
          <div className="sync-auth-card">
            <div className="sync-connected-header">
              <div>
                <span className="sync-connected-eyebrow">Cloud connection ready</span>
                <strong title={connectedWorkspaceLabel}>Connected to Workspace: {connectedWorkspaceLabel}</strong>
              </div>
              <button type="button" className="secondary danger-soft" disabled={authBusy} onClick={() => void disconnectCloudProject()}>
                <Cloud size={16} /> Disconnect
              </button>
            </div>
            <div className="sync-auth-tabs" role="tablist" aria-label="Cloud sync authentication mode">
              <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Log In</button>
              <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Create Account</button>
            </div>
            <div className="sync-auth-fields">
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  disabled={authBusy}
                  placeholder="tester@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  disabled={authBusy}
                  placeholder="Password"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitAuth();
                  }}
                />
              </label>
            </div>
            {authMode === 'signup' && renderAccountSetup(authBusy)}
            <div className="sync-auth-submit-row">
              <button type="button" className="primary" disabled={authBusy} onClick={() => void submitAuth()}>
                {authBusy ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
                {authBusy ? 'Working...' : authMode === 'login' ? 'Log In' : 'Create Account'}
              </button>
            </div>
            <p className="settings-helper">After authentication, Bug Pocket captures the first workspace assigned to this account for future sync routing.</p>
          </div>
        ) : null}
      </div>
      {showCredentialHelp && (
        <div className="sync-help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCredentialHelp(false); }}>
          <section className="sync-help-modal" role="dialog" aria-modal="true" aria-labelledby="sync-help-title">
            <header>
              <div>
                <h2 id="sync-help-title">Supabase Quick Start</h2>
                <p>Bring your own Supabase project for Bug Pocket cloud sync.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close Supabase setup help" onClick={() => setShowCredentialHelp(false)}><X size={18} /></button>
            </header>
            <ol>
              <li>
                <strong>Create a Project</strong>
                <span>Log in to Supabase and click <b>New Project</b>. Select your organization, set a database password, and wait for the provisioning process to finish.</span>
                <button
                  type="button"
                  className="secondary sync-schema-link"
                  onClick={() => void window.bugPocket.openExternalUrl('https://database.new')}
                >
                  <ExternalLink size={15} /> Open Supabase
                </button>
              </li>
              <li>
                <strong>Project URL</strong>
                <span>In Supabase, go to Dashboard -&gt; Organization Dashboard -&gt; Project Dashboard. Copy the Project URL for the project you want Bug Pocket to use.</span>
              </li>
              <li>
                <strong>Publishable API Key</strong>
                <span>From the Project Dashboard, open API Keys -&gt; Publishable and secret API keys. Copy only the Publishable key. Never use the secret service_role key in Bug Pocket.</span>
              </li>
              <li>
                <strong>Schema Setup</strong>
                <span>Open Bug Pocket’s installation schema and run it in the Supabase SQL Editor to build the required tables.</span>
                <button
                  type="button"
                  className="secondary sync-schema-link"
                  onClick={() => void window.bugPocket.openExternalUrl('https://github.com/examenqa/bug-pocket/blob/main/supabase/schema-install.sql')}
                >
                  <ExternalLink size={15} /> Open schema-install.sql
                </button>
              </li>
            </ol>
          </section>
        </div>
      )}
      {pendingInvite && (
        <div className="sync-help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !authBusy) setPendingInvite(null); }}>
          <section className="sync-help-modal sync-invite-confirmation" role="dialog" aria-modal="true" aria-labelledby="sync-invite-confirmation-title">
            <header>
              <div>
                <h2 id="sync-invite-confirmation-title">Confirm Team Connection</h2>
                <p>Verify the destination before Bug Pocket stores this team connection locally.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Cancel team invite import" disabled={authBusy} onClick={() => setPendingInvite(null)}><X size={18} /></button>
            </header>
            <dl className="sync-invite-details">
              <div><dt>Project URL</dt><dd>{pendingInvite.url}</dd></div>
              <div><dt>Workspace ID</dt><dd>{pendingInvite.teamId}</dd></div>
              <div><dt>Invitee Email</dt><dd>{pendingInvite.targetEmail}</dd></div>
              <div><dt>Expires</dt><dd>{new Date(pendingInvite.expiresAt).toLocaleString()}</dd></div>
            </dl>
            <p className="settings-helper">Only continue when this project and workspace match the details provided by your team administrator.</p>
            <div className="sync-confirm-actions">
              <button type="button" className="secondary" disabled={authBusy} onClick={() => setPendingInvite(null)}>Cancel</button>
              <button type="button" className="primary" disabled={authBusy} onClick={() => void confirmTeamConnection()}>
                {authBusy ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
                {authBusy ? 'Connecting...' : 'Confirm & Connect'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}


