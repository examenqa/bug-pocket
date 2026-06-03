import React, { useEffect, useState } from 'react';
import { AlertTriangle, Keyboard, RefreshCw } from 'lucide-react';
import type { ShortcutAction, ShortcutSetting } from '../../../../shared/types';
import { shortcutDisplay } from '../../utils/display';
import { eventToAccelerator, isModifierOnlyKey } from '../../utils/shortcuts';

const DEFAULT_SHORTCUTS: Record<ShortcutAction, { accelerator: string; enabled: boolean }> = {
  quick_capture: { accelerator: 'CommandOrControl+Alt+P', enabled: true },
  global_screenshot: { accelerator: 'CommandOrControl+Alt+S', enabled: true },
  main_panel: { accelerator: 'CommandOrControl+Alt+M', enabled: true }
};

export function ShortcutSettingsPanel({
  shortcuts,
  refresh
}: {
  shortcuts: ShortcutSetting[];
  refresh: () => Promise<void>;
}) {
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState('');
  const shortcutDescriptions: Record<ShortcutAction, string> = {
    quick_capture: 'Opens the Quick Capture Panel',
    global_screenshot: 'Starts global screenshot snip directly',
    main_panel: 'Opens the Main App Panel'
  };

  const areShortcutsModified = shortcuts.some((shortcut) => {
    const defaultShortcut = DEFAULT_SHORTCUTS[shortcut.action];
    if (!defaultShortcut) return false;
    return shortcut.accelerator !== defaultShortcut.accelerator || Boolean(shortcut.is_enabled) !== defaultShortcut.enabled;
  });

  const updateShortcut = async (shortcut: ShortcutSetting, accelerator: string, enabled = true): Promise<void> => {
    setError('');
    await window.bugPocket.updateShortcut(shortcut.action, accelerator, enabled);
    await refresh();
  };

  const resetShortcuts = async (): Promise<void> => {
    setRecordingAction(null);
    setError('');
    await Promise.all(
      Object.entries(DEFAULT_SHORTCUTS).map(([action, shortcut]) =>
        window.bugPocket.updateShortcut(action as ShortcutAction, shortcut.accelerator, shortcut.enabled)
      )
    );
    await refresh();
  };

  useEffect(() => {
    if (!recordingAction) return;
    void window.bugPocket.suspendShortcuts();
    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (isModifierOnlyKey(event.key)) return;
      if (event.key === 'Escape') {
        setRecordingAction(null);
        setError('');
        return;
      }
      const accelerator = eventToAccelerator(event);
      if (!accelerator) {
        setError('Use at least one modifier key plus a letter, number, or function key.');
        return;
      }
      const shortcut = shortcuts.find((item) => item.action === recordingAction);
      if (!shortcut) return;
      setRecordingAction(null);
      void updateShortcut(shortcut, accelerator, true);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      void window.bugPocket.resumeShortcuts();
    };
  }, [recordingAction, shortcuts]);

  return (
    <div className="panel shortcuts-panel">
      <div className="panel-heading">
        <h2><Keyboard size={16} /> Global Shortcuts</h2>
      </div>
      <div className="shortcut-helper-row">
        <p className="settings-helper">Recommended defaults: Ctrl+Alt+P for Quick Capture, Ctrl+Alt+S for Global Screenshot, and Ctrl+Alt+M for the Main App Panel.</p>
        <button className="shortcut-reset-button" disabled={!areShortcutsModified} onClick={() => void resetShortcuts()}>
          <RefreshCw size={14} />
          Reset Shortcuts
        </button>
      </div>
      <div className="shortcut-list">
        {shortcuts.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.action}>
            <div className="shortcut-copy">
              <strong>{shortcut.label}</strong>
              <span>{shortcutDescriptions[shortcut.action]}</span>
              {shortcut.registration_error && (
                <em className="shortcut-warning"><AlertTriangle size={14} /> {shortcut.registration_error}</em>
              )}
            </div>
            <kbd className={shortcut.is_enabled ? 'shortcut-kbd' : 'shortcut-kbd disabled'}>{shortcut.is_enabled ? shortcutDisplay(shortcut, 'Not set') : 'Disabled'}</kbd>
            <button onClick={() => setRecordingAction(shortcut.action)}>
              {recordingAction === shortcut.action ? 'Press keys...' : 'Record'}
            </button>
            <label className="shortcut-toggle">
              <input
                type="checkbox"
                checked={!!shortcut.is_enabled}
                onChange={(event) => void updateShortcut(shortcut, shortcut.accelerator, event.target.checked)}
              />
              Enabled
            </label>
          </div>
        ))}
      </div>
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
