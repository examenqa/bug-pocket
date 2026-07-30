import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bot, ChevronDown, Cloud, CloudOff, Database, ExternalLink, FileText, HelpCircle, Home, Keyboard, RefreshCw, Settings as SettingsIcon, SlidersHorizontal } from 'lucide-react';
import type { ScreenshotResult, SettingsData, SyncRuntimeStatus } from '../../shared/types';
import { QuickCaptureDraft, QuickCaptureForm } from './components/QuickCaptureForm';
import { useSettings } from './hooks/useSettings';
import { useHashRoute } from './hooks/useHashRoute';
import { Dashboard } from './pages/DashboardPage';
import { BugDetailsView } from './pages/BugDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { SnipOverlay } from './pages/SnipOverlay';
import { SupportModal, type SupportModalMode } from './components/shared/SupportModal';
import { ToastProvider } from './components/shared/ToastContext';
import { BrandMark } from './components/shared/BrandMark';
import { bugDetailsRoute, resolveMainShellRoute } from '../../shared/navigation';

function CaptureRoute({ settings, refresh }: { settings: SettingsData; refresh: () => Promise<void> }) {
  const [attachments, setAttachments] = useState<ScreenshotResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  useEffect(() => window.bugPocket.onOpenQuickCapture(() => setFocusToken((current) => current + 1)), []);
  useEffect(() => window.bugPocket.onScreenshotCaptured((result) => setAttachments((current) => [...current, result as ScreenshotResult])), []);

  const saveDraft = async (draft: QuickCaptureDraft): Promise<void> => {
    setSaving(true);
    try {
      await window.bugPocket.createQuickBug({
        entry_type: 'Bug',
        application_id: draft.applicationId,
        module_id: draft.moduleId,
        environment_id: draft.environmentId,
        user_role_id: draft.userRoleId,
        note: draft.note,
        attachment_ids: attachments.map((attachment) => attachment.id)
      });
      setAttachments([]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <QuickCaptureForm
      settings={settings}
      attachments={attachments}
      saving={saving}
      focusToken={focusToken}
      onConfigurePresets={() => window.bugPocket.openSettings('presets')}
      onTakeScreenshot={() => window.bugPocket.startScreenshotCapture()}
      onClearAttachments={() => setAttachments([])}
      onSave={saveDraft}
      onCancel={() => window.bugPocket.hideQuickCapture()}
      onCreateApplication={async (name) => {
        const application = await window.bugPocket.addApplication(name, '');
        await refresh();
        return application.id;
      }}
      onCreateModule={async (name, applicationId) => {
        const createdModule = await window.bugPocket.addModule(name, applicationId);
        await refresh();
        return createdModule.id;
      }}
      onCreateEnvironment={async (value) => {
        const option = await window.bugPocket.addEnvironment(value);
        await refresh();
        return option.id;
      }}
      onCreateUserRole={async (value) => {
        const option = await window.bugPocket.addUserRole(value);
        await refresh();
        return option.id;
      }}
    />
  );
}

const settingsNavItems = [
  { route: '/settings/workspace', label: 'Workspace & Hotkeys', icon: Keyboard },
  { route: '/settings/presets', label: 'Capture Presets', icon: SlidersHorizontal },
  { route: '/settings/ai', label: 'AI Processing', icon: Bot },
  { route: '/settings/output', label: 'Output & Templates', icon: FileText },
  { route: '/settings/storage', label: 'Storage & Backups', icon: Database },
  { route: '/settings/sync', label: 'Cloud Sync', icon: Cloud }
];

const howToGuideUrl = 'https://bugpocket.app/help';

function SupportPopover({ anchorRect, open, onClose, onSelectMode }: { anchorRect: DOMRect | null; open: boolean; onClose: () => void; onSelectMode: (mode: SupportModalMode) => void }) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open || !anchorRect) return null;

  const top = Math.max(12, anchorRect.top - 154);
  const left = Math.max(12, anchorRect.left);
  const width = Math.max(220, anchorRect.width);

  return createPortal(
    <div className="support-popover-layer" role="presentation" onMouseDown={onClose}>
      <div className="support-popover" role="menu" aria-label="Help and support options" style={{ left, top, width }} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => onSelectMode('bug')}>Report a Bug</button>
        <button type="button" role="menuitem" onClick={() => onSelectMode('feature')}>Request a Feature</button>
        <a href={howToGuideUrl} target="_blank" rel="noreferrer" role="menuitem" onClick={(event) => { event.preventDefault(); onClose(); void window.bugPocket.openExternalUrl(howToGuideUrl); }}>How-To Guide</a>
      </div>
    </div>,
    document.body
  );
}

function MainShell({ route, navigate, settings, refresh }: { route: string; navigate: (route: string) => void; settings: SettingsData; refresh: () => Promise<void> }) {
  const shellRoute = resolveMainShellRoute(route);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [supportModalMode, setSupportModalMode] = useState<SupportModalMode>('bug');
  const [isSupportPopoverOpen, setIsSupportPopoverOpen] = useState(false);
  const [supportAnchorRect, setSupportAnchorRect] = useState<DOMRect | null>(null);
  const supportButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(() => route.startsWith('/settings'));
  const [syncRuntimeStatus, setSyncRuntimeStatus] = useState<SyncRuntimeStatus | null>(null);
  const [retryingSync, setRetryingSync] = useState(false);
  const activeView = shellRoute.view === 'settings' ? 'settings' : 'dashboard';
  const activeWorkspaceId = settings.currentWorkspaceId?.trim() ?? '';
  const cloudWorkspaceActive = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(activeWorkspaceId);
  const cloudProjectPaused = syncRuntimeStatus?.code === 'PROJECT_PAUSED';


  useEffect(() => {
    if (route.startsWith('/settings')) setIsSettingsExpanded(true);
  }, [route]);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.bugPocket.onSyncStatus((status) => {
      if (mounted) setSyncRuntimeStatus(status);
    });
    void window.bugPocket.getSyncRuntimeStatus()
      .then((status) => {
        if (mounted) setSyncRuntimeStatus(status);
      })
      .catch((error) => console.error('Unable to read the cloud sync status.', error));

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const retryPausedSync = async (): Promise<void> => {
    setRetryingSync(true);
    try {
      setSyncRuntimeStatus(await window.bugPocket.syncNow());
    } catch (error) {
      console.error('Unable to retry cloud sync.', error);
    } finally {
      setRetryingSync(false);
    }
  };

  const closeBugDetails = (): void => {
    navigate('/dashboard');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark className="brand-logo" />
          <span className="brand-title-logo" aria-hidden="true">Bug Pocket</span>
        </div>
        <button
          className={activeView === 'dashboard' ? 'nav active' : 'nav'}
          onClick={() => navigate('/dashboard')}
        >
          <Home size={17} /> Dashboard
        </button>
        <div className="settings-nav-group">
          <button
            className={activeView === 'settings' ? 'nav settings-parent active' : 'nav settings-parent'}
            aria-expanded={isSettingsExpanded}
            onClick={() => {
              setIsSettingsExpanded((expanded) => !expanded);
              if (!route.startsWith('/settings')) navigate('/settings/workspace');
            }}
          >
            <SettingsIcon size={17} />
            <span className="nav-label-with-indicator">Settings</span>
            <ChevronDown className={isSettingsExpanded ? 'settings-chevron expanded' : 'settings-chevron'} size={15} />
          </button>
          {isSettingsExpanded && (
            <div className="settings-subnav" aria-label="Settings sections">
              {settingsNavItems.map((item) => {
                const Icon = item.icon;
                const active = route.split('?')[0] === item.route || (item.route === '/settings/workspace' && route === '/settings');
                return (
                  <button
                    key={item.route}
                    className={active ? 'settings-subnav-link active' : 'settings-subnav-link'}
                    type="button"
                    onClick={() => navigate(item.route)}
                  >
                    <Icon size={14} /> {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="sidebar-support-area">
          <div className={cloudProjectPaused ? 'workspace-status-badge paused' : cloudWorkspaceActive ? 'workspace-status-badge synced' : 'workspace-status-badge local'} title={cloudProjectPaused ? 'Supabase project is paused' : cloudWorkspaceActive ? `Workspace ${activeWorkspaceId}` : 'Local-only workspace'}>
            {cloudWorkspaceActive && !cloudProjectPaused ? <Cloud size={15} /> : <CloudOff size={15} />}
            <span>{cloudProjectPaused ? 'Cloud Paused' : cloudWorkspaceActive ? 'Cloud Synced' : 'Local Mode'}</span>
          </div>
          <button
            ref={supportButtonRef}
            className={isSupportPopoverOpen ? 'nav support-nav active' : 'nav support-nav'}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isSupportPopoverOpen}
            onClick={() => {
              setSupportAnchorRect(supportButtonRef.current?.getBoundingClientRect() ?? null);
              setIsSupportPopoverOpen((open) => !open);
            }}
          >
            <HelpCircle size={17} /> Help & Support
          </button>
        </div>
      </aside>
      <SupportPopover
        anchorRect={supportAnchorRect}
        open={isSupportPopoverOpen}
        onClose={() => setIsSupportPopoverOpen(false)}
        onSelectMode={(mode) => {
          setSupportModalMode(mode);
          setIsSupportPopoverOpen(false);
          setIsSupportModalOpen(true);
        }}
      />
      <SupportModal mode={supportModalMode} open={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
      <main className="content">
        {cloudProjectPaused && (
          <div className="sync-paused-banner" role="alert" aria-live="assertive">
            <AlertTriangle size={20} aria-hidden="true" />
            <div className="sync-paused-copy">
              <strong>Cloud database paused</strong>
              <span>Your cloud database has been paused due to inactivity. Please log in to your Supabase dashboard to restore it.</span>
            </div>
            <div className="sync-paused-actions">
              <button type="button" onClick={() => void window.bugPocket.openExternalUrl('https://supabase.com/dashboard')}>
                Open Supabase Dashboard <ExternalLink size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => void retryPausedSync()} disabled={retryingSync}>
                <RefreshCw size={15} aria-hidden="true" /> {retryingSync ? 'Checking...' : 'Sync Now'}
              </button>
            </div>
          </div>
        )}
        {shellRoute.view === 'settings' ? (
          <SettingsPage settings={settings} refresh={refresh} route={route} />
        ) : shellRoute.view === 'dashboard' ? (
          <div className="dashboard-view">
            <Dashboard settings={settings} onSelect={(id) => navigate(bugDetailsRoute(id))} />
          </div>
        ) : shellRoute.view === 'bug' ? (
          <BugDetailsView bugId={shellRoute.bugId} settings={settings} onBack={closeBugDetails} />
        ) : null}
      </main>
    </div>
  );
}

export function App() {
  const { route, navigate } = useHashRoute();
  const { settings, refresh } = useSettings();

  let content: React.ReactNode;
  if (route.startsWith('/capture')) content = <CaptureRoute settings={settings} refresh={refresh} />;
  else if (route.startsWith('/snip')) content = <SnipOverlay />;
  else content = <MainShell route={route} navigate={navigate} settings={settings} refresh={refresh} />;

  return (
    <ToastProvider suppressToast={route.startsWith('/snip')}>
      {content}
    </ToastProvider>
  );
}




