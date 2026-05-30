import React, { useEffect, useState } from 'react';
import { Home, Settings as SettingsIcon } from 'lucide-react';
import type { ScreenshotResult } from '../../shared/types';
import { QuickCaptureDraft, QuickCaptureForm } from './components/QuickCaptureForm';
import { useSettings } from './hooks/useSettings';
import { useHashRoute } from './hooks/useHashRoute';
import { createQuickBugRecord } from './services/bugRecords';
import { Dashboard } from './pages/DashboardPage';
import { BugDetailsHost } from './pages/BugDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { SnipOverlay } from './pages/SnipOverlay';
import iconUrl from './assets/bug-pocket-icon.png';
import titleUrl from './assets/bug-pocket-title.png';

function CaptureRoute() {
  const { settings, refresh } = useSettings();
  const [attachments, setAttachments] = useState<ScreenshotResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  useEffect(() => window.bugPocket.onOpenQuickCapture(() => setFocusToken((current) => current + 1)), []);
  useEffect(() => window.bugPocket.onScreenshotCaptured((result) => setAttachments((current) => [...current, result as ScreenshotResult])), []);

  const saveDraft = async (draft: QuickCaptureDraft): Promise<void> => {
    setSaving(true);
    try {
      await createQuickBugRecord({
        entry_type: draft.entryType,
        application_id: draft.applicationId,
        module_id: draft.moduleId,
        environment_id: draft.environmentId,
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
      onCreateEntryType={async (value) => {
        const option = await window.bugPocket.addConfigOption('entry_type', value);
        await refresh();
        return option.value;
      }}
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
    />
  );
}

function MainShell({ route, navigate }: { route: string; navigate: (route: string) => void }) {
  const { settings, refresh } = useSettings();
  const bugMatch = route.match(/^\/bugs\/(\d+)$/);
  const bugId = bugMatch ? Number(bugMatch[1]) : null;
  const [selectedBugId, setSelectedBugId] = useState<number | null>(bugId);
  const showingDetails = selectedBugId != null && !route.startsWith('/settings');
  const activeView = route.startsWith('/settings') ? 'settings' : 'dashboard';

  useEffect(() => {
    if (bugId) setSelectedBugId(bugId);
  }, [bugId]);

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
        <button
          className={activeView === 'settings' ? 'nav active' : 'nav'}
          onClick={() => {
            setSelectedBugId(null);
            navigate('/settings');
          }}
        >
          <SettingsIcon size={17} /> Settings
        </button>
      </aside>
      <main className="content">
        {route.startsWith('/settings') ? (
          <SettingsPage settings={settings} refresh={refresh} route={route} />
        ) : (
          <>
            <div className={showingDetails ? 'dashboard-view hidden' : 'dashboard-view'}>
              <Dashboard settings={settings} onSelect={setSelectedBugId} />
            </div>
            {showingDetails && <BugDetailsHost bugId={selectedBugId} settings={settings} onClose={closeBugDetails} />}
          </>
        )}
      </main>
    </div>
  );
}

export function App() {
  const { route, navigate } = useHashRoute();
  const [toast, setToast] = useState('');

  useEffect(() => {
    let timer: number | undefined;
    return window.bugPocket.onToast((message) => {
      if (timer) window.clearTimeout(timer);
      setToast(message);
      timer = window.setTimeout(() => setToast(''), 2400);
    });
  }, []);

  let content: React.ReactNode;
  if (route.startsWith('/capture')) content = <CaptureRoute />;
  else if (route.startsWith('/snip')) content = <SnipOverlay />;
  else content = <MainShell route={route} navigate={navigate} />;

  return (
    <>
      {content}
      {toast && !route.startsWith('/snip') && <div className="toast">{toast}</div>}
    </>
  );
}
