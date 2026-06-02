import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, LogOut, RefreshCw, UserCircle2 } from 'lucide-react';
import type { SettingsData, SyncAuthResult, SyncConnectionResult, SyncSessionStatus } from '../../../../shared/types';

interface SyncSettingsProps {
  settings: SettingsData;
  mutationReady: boolean;
  refresh: () => Promise<void>;
  showToast: (message: string, variant?: 'success' | 'info' | 'error') => void;
}

type AuthMode = 'login' | 'signup';

export function SyncSettings({ settings, mutationReady, refresh, showToast }: SyncSettingsProps) {
  const [projectUrl, setProjectUrl] = useState(settings.supabaseProjectUrl ?? '');
  const [anonKey, setAnonKey] = useState(settings.supabaseAnonKey ?? '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<SyncSessionStatus>({ authenticated: false });
  const [testResult, setTestResult] = useState<SyncConnectionResult | null>(null);

  useEffect(() => {
    setProjectUrl(settings.supabaseProjectUrl ?? '');
    setAnonKey(settings.supabaseAnonKey ?? '');
  }, [settings.supabaseProjectUrl, settings.supabaseAnonKey]);

  useEffect(() => {
    let cancelled = false;
    window.bugPocket.getSyncSessionStatus()
      .then((status) => {
        if (!cancelled) setSession(status as SyncSessionStatus);
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

  const configured = Boolean(projectUrl.trim() && anonKey.trim());

  return (
    <div className="settings-tab-stack">
      <div className="panel sync-placeholder-panel sync-config-panel">
        <div className="panel-heading">
          <div>
            <h2>Cloud Sync</h2>
            <p className="settings-helper">Connect Bug Pocket to Supabase. Local capture remains offline-first; sync workers are still staged for a later phase.</p>
          </div>
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
            <span>Supabase Anon Key</span>
            <input
              type="password"
              value={anonKey}
              disabled={!mutationReady || saving || testing || authBusy}
              placeholder="Paste anon public key"
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
            <div className="sync-profile-main">
              <UserCircle2 size={34} />
              <div>
                <h3>{session.email || 'Signed in'}</h3>
                <p>Workspace ID: <strong>{session.workspaceId || settings.currentWorkspaceId || 'Not assigned'}</strong></p>
              </div>
            </div>
            <div className="sync-profile-actions">
              <span className="sync-test-result success"><CheckCircle2 size={15} /> Sync Status: Connected</span>
              <button type="button" className="secondary danger-soft" disabled={authBusy} onClick={() => void signOut()}>
                <LogOut size={16} /> Log Out
              </button>
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
    </div>
  );
}


