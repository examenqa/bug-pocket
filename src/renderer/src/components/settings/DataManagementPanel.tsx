import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { BackupExportResult, BackupImportResult, SettingsData } from '../../../../shared/types';
import { restorePendingKey, restoreSuccessKey, restoreSettingsSegmentKey } from '../../utils/settingsKeys';

export function DataManagementPanel({
  settings,
  refresh,
  showToast
}: {
  settings: SettingsData;
  refresh: () => Promise<void>;
  showToast: (message: string, variant?: 'success' | 'info' | 'error') => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [destructiveAction, setDestructiveAction] = useState<'workspace' | 'factory' | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  const exportWorkspaceBackup = async (): Promise<void> => {
    setExporting(true);
    try {
      const result = (await window.bugPocket.exportBackup()) as BackupExportResult;
      if (result.canceled) return;
      if (result.success) {
        showToast('Workspace backup exported.');
        return;
      }
      showToast(result.error || 'Backup export failed.', 'error');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Backup export failed.';
      showToast(message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const importWorkspaceBackup = async (): Promise<void> => {
    const confirmed = window.confirm('Warning: This will overwrite your current database and attachments. The application will restart. Proceed?');
    if (!confirmed) return;
    let keepRestoreHandoff = false;
    window.sessionStorage.setItem(restorePendingKey, '1');
    window.sessionStorage.setItem(restoreSettingsSegmentKey, 'storage');
    setImporting(true);
    try {
      const result = (await window.bugPocket.importBackup()) as BackupImportResult;
      if (result.canceled) return;
      if (result.success) {
        keepRestoreHandoff = true;
        window.sessionStorage.setItem(restoreSuccessKey, '1');
        showToast('Workspace backup restored. Reloading...');
        return;
      }
      showToast(result.error || 'Backup import failed.', 'error');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Backup import failed.';
      showToast(message, 'error');
    } finally {
      if (!keepRestoreHandoff) {
        window.sessionStorage.removeItem(restorePendingKey);
        window.sessionStorage.removeItem(restoreSuccessKey);
        window.sessionStorage.removeItem(restoreSettingsSegmentKey);
      }
      setImporting(false);
    }
  };

  const chooseAutomatedBackupLocation = async (): Promise<void> => {
    setSavingLocation(true);
    try {
      const path = (await window.bugPocket.chooseBackupDirectory()) as string | null;
      if (!path) return;
      await window.bugPocket.updateAutoBackupDirectoryPath(path);
      await refresh();
      showToast('Automated backup location saved.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not save automated backup location.';
      showToast(message, 'error');
    } finally {
      setSavingLocation(false);
    }
  };

  const clearAutomatedBackupLocation = async (): Promise<void> => {
    setSavingLocation(true);
    try {
      await window.bugPocket.updateAutoBackupDirectoryPath('');
      await refresh();
      showToast('Automated backups disabled.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not clear automated backup location.';
      showToast(message, 'error');
    } finally {
      setSavingLocation(false);
    }
  };

  const factoryResetLocalData = async (): Promise<void> => {
    setResetting(true);
    try {
      await window.bugPocket.factoryReset();
      showToast('Local data cleared. Restarting Bug Pocket...', 'info');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not clear local data.';
      showToast(message, 'error');
      setResetting(false);
      setDestructiveAction(null);
      setResetConfirmText('');
    }
  };

  const clearCurrentWorkspace = async (): Promise<void> => {
    setResetting(true);
    try {
      await window.bugPocket.clearCurrentWorkspace();
      await refresh();
      showToast('Current workspace data cleared. Other workspaces were not changed.');
      setDestructiveAction(null);
      setResetConfirmText('');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not clear the current workspace.';
      showToast(message, 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
    <div className="panel data-management-panel">
      <div className="panel-heading">
        <div>
          <h2>Data Management</h2>
          <p className="settings-helper">Export your local database and content-addressed attachments, or keep silent rolling backups in a second location.</p>
        </div>
      </div>
      <div className="data-management-stack">
        <div className="data-management-row">
          <div className="data-management-copy">
            <strong>Manual backup</strong>
            <p className="settings-helper">Choose a one-time destination for a complete `.bugpocket` backup.</p>
          </div>
          <div className="backup-transfer-actions">
            <button className="primary backup-export-button" disabled={exporting || importing} onClick={() => void exportWorkspaceBackup()}>
              <Download size={16} />
              {exporting ? 'Zipping...' : 'Export Workspace Backup'}
            </button>
            <button className="backup-import-button" disabled={exporting || importing} onClick={() => void importWorkspaceBackup()}>
              <Upload size={16} />
              {importing ? 'Restoring...' : 'Import Workspace Backup'}
            </button>
          </div>
        </div>
        <div className="data-management-row">
          <div className="data-management-copy">
            <strong>Automated Backup Location</strong>
            <p className="settings-helper">On startup, Bug Pocket writes a silent rolling backup here and keeps the latest 3 files.</p>
            <div className="backup-location-row">
              <div className="backup-location-copy">
                <span className="backup-location-title">Location Path</span>
                <p className={settings.autoBackupDirectoryPath ? 'backup-location configured' : 'backup-location'}>
                  {settings.autoBackupDirectoryPath || 'Not Configured - Auto Backups Disabled'}
                </p>
              </div>
              <div className="backup-location-actions">
                <button disabled={savingLocation} onClick={() => void chooseAutomatedBackupLocation()}>
                  {savingLocation ? 'Saving...' : 'Choose Folder'}
                </button>
                <button disabled={savingLocation || !settings.autoBackupDirectoryPath} onClick={() => void clearAutomatedBackupLocation()}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="data-management-row factory-reset-row">
          <div className="data-management-copy">
            <strong>Clear Current Workspace</strong>
            <p className="settings-helper">Delete only the connected workspace database. Shared screenshots used by another workspace or local mode are preserved.</p>
          </div>
          <button
            className="danger factory-reset-button"
            disabled={exporting || importing || resetting || !settings.currentWorkspaceId}
            onClick={() => { setResetConfirmText(''); setDestructiveAction('workspace'); }}
          >
            <Trash2 size={16} />
            {settings.currentWorkspaceId ? 'Clear Current Workspace' : 'No Workspace Connected'}
          </button>
        </div>
        <div className="data-management-row factory-reset-row">
          <div className="data-management-copy">
            <strong>Factory Reset</strong>
            <p className="settings-helper">Delete every workspace database, local capture, screenshot, and taxonomy value while keeping settings, shortcuts, AI keys, templates, and preset slots.</p>
          </div>
          <button className="danger factory-reset-button" disabled={exporting || importing || resetting} onClick={() => { setResetConfirmText(''); setDestructiveAction('factory'); }}>
            <Trash2 size={16} />
            Clear All Local Data
          </button>
        </div>
      </div>
    </div>
    {destructiveAction && createPortal(
      <div className="backup-restore-backdrop factory-reset-backdrop" role="alertdialog" aria-modal="true" aria-label={destructiveAction === 'factory' ? 'Confirm factory reset' : 'Confirm workspace deletion'}>
        <div className="backup-restore-dialog factory-reset-dialog">
          <Trash2 className="factory-reset-icon" size={28} />
          <div>
            <h2>{destructiveAction === 'factory' ? 'Clear all local data?' : 'Clear the current workspace?'}</h2>
            <p>
              {destructiveAction === 'factory'
                ? 'This permanently deletes every workspace database, local capture, screenshot, and taxonomy value. It bypasses the trash and cannot be undone. Settings, hotkeys, AI keys, templates, and preset slots remain.'
                : 'This permanently deletes only the currently connected workspace database. Screenshots still referenced by another workspace or local mode remain intact.'}
            </p>
            <label className="factory-reset-phrase">
              <span>Type CLEAR to confirm</span>
              <input value={resetConfirmText} onChange={(event) => setResetConfirmText(event.target.value)} disabled={resetting} autoFocus />
            </label>
            <div className="factory-reset-actions">
              <button disabled={resetting} onClick={() => { setDestructiveAction(null); setResetConfirmText(''); }}>Cancel</button>
              <button
                className="danger factory-reset-confirm"
                disabled={resetting || resetConfirmText.trim() !== 'CLEAR'}
                onClick={() => void (destructiveAction === 'factory' ? factoryResetLocalData() : clearCurrentWorkspace())}
              >
                {resetting ? 'Clearing...' : destructiveAction === 'factory' ? 'Clear All Local Data' : 'Clear Current Workspace'}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}

    {importing && createPortal(
      <div className="backup-restore-backdrop" role="alertdialog" aria-modal="true" aria-label="Restoring workspace backup">
        <div className="backup-restore-dialog">
          <RefreshCw className="backup-restore-spinner" size={28} />
          <div>
            <h2>Restoring workspace backup</h2>
            <p>Bug Pocket is replacing the local database and attachments. The app will reload automatically when it is done.</p>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

