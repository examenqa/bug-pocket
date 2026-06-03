import React, { useEffect, useState } from 'react';
import { Bot, ChevronDown, Cloud, Database, FileText, HelpCircle, Home, Keyboard, Settings as SettingsIcon, SlidersHorizontal } from 'lucide-react';
import type { ScreenshotResult, SettingsData } from '../../shared/types';
import { QuickCaptureDraft, QuickCaptureForm } from './components/QuickCaptureForm';
import { useSettings } from './hooks/useSettings';
import { useHashRoute } from './hooks/useHashRoute';
import { createQuickBugRecord } from './services/bugRecords';
import { Dashboard } from './pages/DashboardPage';
import { BugDetailsView } from './pages/BugDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { SnipOverlay } from './pages/SnipOverlay';
import { SupportModal } from './components/shared/SupportModal';
import { ToastProvider } from './components/shared/ToastContext';
import iconUrl from './assets/bug-pocket-icon.png';
import titleUrl from './assets/bug-pocket-title.png';

function CaptureRoute({ settings, refresh }: { settings: SettingsData; refresh: () => Promise<void> }) {
  const [attachments, setAttachments] = useState<ScreenshotResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  useEffect(() => window.bugPocket.onOpenQuickCapture(() => setFocusToken((current) => current + 1)), []);
  useEffect(() => window.bugPocket.onScreenshotCaptured((result) => setAttachments((current) => [...current, result as ScreenshotResult])), []);

  const saveDraft = async (draft: QuickCaptureDraft): Promise<void> => {
    setSaving(true);
    try {
      await createQuickBugRecord({
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
      onSave={saveDraft}
      onCancel={() => window.bugPocket.hideQuickCapture()}
      onCreateApplication={async (name) => {
        const application = await window.bugPocket.addApplication(name);
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

function MainShell({ route, navigate, settings, refresh }: { route: string; navigate: (route: string) => void; settings: SettingsData; refresh: () => Promise<void> }) {
  const bugMatch = route.match(/^\/bugs\/(\d+)$/);
  const bugId = bugMatch ? Number(bugMatch[1]) : null;
  const [selectedBugId, setSelectedBugId] = useState<number | null>(bugId);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(route.startsWith('/settings'));
  const showingDetails = selectedBugId != null && !route.startsWith('/settings');
  const activeView = route.startsWith('/settings') ? 'settings' : 'dashboard';

  useEffect(() => {
    if (bugId) setSelectedBugId(bugId);
  }, [bugId]);

  useEffect(() => {
    if (route.startsWith('/settings')) setIsSettingsExpanded(true);
  }, [route]);

  const closeBugDetails = (): void => {
    setSelectedBugId(null);
    if (route.startsWith('/bugs/')) navigate('/dashboard');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={iconUrl} alt="" />
          <img className="brand-title-logo" src={titleUrl} alt="Bug Pocket" />
        </div>
        <button
          className={activeView === 'dashboard' ? 'nav active' : 'nav'}
          onClick={() => {
            setSelectedBugId(null);
            navigate('/dashboard');
          }}
        >
          <Home size={17} /> Dashboard
        </button>
        <div className="settings-nav-group">
          <button
            className={activeView === 'settings' ? 'nav settings-parent active' : 'nav settings-parent'}
            aria-expanded={isSettingsExpanded}
            onClick={() => {
              setSelectedBugId(null);
              setIsSettingsExpanded((expanded) => !expanded);
              if (!route.startsWith('/settings')) navigate('/settings/workspace');
            }}
          >
            <SettingsIcon size={17} /> Settings <ChevronDown className={isSettingsExpanded ? 'settings-chevron expanded' : 'settings-chevron'} size={15} />
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
                    onClick={() => {
                      setSelectedBugId(null);
                      navigate(item.route);
                    }}
                  >
                    <Icon size={14} /> {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="sidebar-support-area">
          <button className="nav support-nav" type="button" onClick={() => setIsSupportModalOpen(true)}>
            <HelpCircle size={17} /> Help & Support
          </button>
        </div>
      </aside>
      <SupportModal open={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
      <main className="content">
        {route.startsWith('/settings') ? (
          <SettingsPage settings={settings} refresh={refresh} route={route} />
        ) : (
          <>
            <div className={showingDetails ? 'dashboard-view hidden' : 'dashboard-view'}>
              <Dashboard settings={settings} onSelect={setSelectedBugId} />
            </div>
            {showingDetails && <BugDetailsView bugId={selectedBugId} settings={settings} onBack={closeBugDetails} />}
          </>
        )}
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
