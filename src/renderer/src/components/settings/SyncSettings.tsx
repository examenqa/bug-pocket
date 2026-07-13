import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Cloud, ExternalLink, HelpCircle, LogOut, Pencil, RefreshCw, UserCircle2, X } from 'lucide-react';
import type { SettingsData, SyncAuthResult, SyncConnectionResult, SyncDiagnosticsRow, SyncSessionStatus, SyncWorkspaceOption } from '../../../../shared/types';

interface SyncSettingsProps {
  settings: SettingsData;
  mutationReady: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string, variant?: 'success' | 'info' | 'error') => void;
}

type AuthMode = 'login' | 'signup';

export function SyncSettings({ settings, mutationReady, refresh, showToast }: SyncSettingsProps) {
  const developerReadOnly = settings.currentWorkspaceRole === 'developer';
  const [projectUrl, setProjectUrl] = useState(settings.supabaseProjectUrl ?? '');
  const [anonKey, setAnonKey] = useState(settings.supabaseAnonKey ?? '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
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
  const [editingWorkspaceName, setEditingWorkspaceName] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [savingWorkspaceName, setSavingWorkspaceName] = useState(false);

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
        setSelectedWorkspaceId(nextStatus.workspaceId ?? settings.currentWorkspaceId ?? '');
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

  const saveCredentials = async (): Promise<void> => {
    if (!mutationReady) return;
    const nextUrl = projectUrl.trim();
    const nextKey = anonKey.trim();
    if (nextUrl === (settings.supabaseProjectUrl ?? '') && nextKey === (settings.supabaseAnonKey ?? '')) return;
    setSaving(true);
    try {
      await window.bugPocket.updateSupabaseSettings(nextUrl, nextKey);
      await refresh();
      showToast('Supabase credentials saved locally.');
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Could not save Supabase credentials.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const loadSession = async (): Promise<void> => {
    const status = (await window.bugPocket.getSyncSessionStatus()) as SyncSessionStatus;
    setSession(status);
    setSelectedWorkspaceId(status.workspaceId ?? settings.currentWorkspaceId ?? '');
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
      await saveCredentials();
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

    setAuthBusy(true);
    try {
      await saveCredentials();
      const result = (authMode === 'login'
        ? await window.bugPocket.authSignIn(cleanedEmail, password)
        : await window.bugPocket.authSignUp(cleanedEmail, password)) as SyncAuthResult;
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

  const configured = Boolean(projectUrl.trim() && anonKey.trim());
  const activeWorkspaceId = session.workspaceId || settings.currentWorkspaceId || '';
  const activeWorkspaceName = workspaceOptions.find((workspace) => workspace.workspaceId === activeWorkspaceId)?.name || 'Active Workspace';
  const shortWorkspaceId = activeWorkspaceId ? `${activeWorkspaceId.slice(0, 8)}...${activeWorkspaceId.slice(-4)}` : 'Not assigned';
  const canSwitchWorkspace = Boolean(selectedWorkspaceId.trim() && selectedWorkspaceId.trim() !== activeWorkspaceId);
  const failedDiagnostics = diagnostics.filter((row) => row.last_error || row.retry_count >= 5);

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

        <div className="sync-credential-grid">
          <label>
            <span>Supabase Project URL</span>
            <input
              type="url"
              value={projectUrl}
              disabled={!mutationReady || saving || testing || authBusy}
              placeholder="https://your-project.supabase.co"
              onChange={(event) => setProjectUrl(event.target.value)}
              onBlur={() => void saveCredentials()}
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
              onBlur={() => void saveCredentials()}
            />
          </label>
        </div>

        <div className="sync-action-row">
          <button type="button" className="secondary" disabled={!mutationReady || saving || testing || authBusy} onClick={() => void testConnection()}>
            {testing ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          {saving && <span className="settings-helper">Saving credentials locally...</span>}
          {testResult && (
            <span className={testResult.success ? 'sync-test-result success' : 'sync-test-result warning'}>
              <CheckCircle2 size={15} /> {testResult.message}
            </span>
          )}
        </div>

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
              <div className="sync-workspace-switch-row">
                <label>
                  <span>Active Workspace</span>
                  <select
                    value={selectedWorkspaceId}
                    disabled={authBusy || switchingWorkspace || !workspaceOptions.length}
                    onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                  >
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
              <span className="sync-test-result success"><CheckCircle2 size={15} /> Sync Status: Connected</span>
              <button type="button" className="secondary danger-soft" disabled={authBusy} onClick={() => void signOut()}>
                <LogOut size={16} /> Log Out
              </button>
            </div>
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
                  <em>{diagnostics.length} pending item{diagnostics.length === 1 ? '' : 's'} · {failedDiagnostics.length} failed</em>
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
                      <div className="option-row sync-diagnostics-row" key={row.id}>
                        <span className="option-name">
                          <span className="sync-diagnostics-title-line">
                            <span>{row.label}</span>
                            <span className="sync-diagnostics-separator">•</span>
                            <em>{row.entity_type} · {row.operation} · retries {row.retry_count}</em>
                          </span>
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
        ) : (
          <div className="sync-auth-card">
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
                  disabled={!configured || authBusy}
                  placeholder="tester@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  disabled={!configured || authBusy}
                  placeholder="Password"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitAuth();
                  }}
                />
              </label>
              <button type="button" className="primary" disabled={!configured || authBusy} onClick={() => void submitAuth()}>
                {authBusy ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
                {authBusy ? 'Working...' : authMode === 'login' ? 'Log In' : 'Create Account'}
              </button>
            </div>
            <p className="settings-helper">
              {configured
                ? 'After authentication, Bug Pocket captures the first workspace assigned to this account for future sync routing.'
                : 'Add and save Supabase credentials before logging in.'}
            </p>
          </div>
        )}
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
    </div>
  );
}


