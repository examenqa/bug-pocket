import React, { useState } from 'react';

export function CapturePreferencesPanel({
  screenshotReviewEnabled,
  runOnSystemStartup,
  refresh
}: {
  screenshotReviewEnabled: boolean;
  runOnSystemStartup: boolean;
  refresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const updatePreference = async (nextEnabled: boolean): Promise<void> => {
    setSaving(true);
    try {
      await window.bugPocket.updateQuickCaptureAnnotationReview(nextEnabled);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const updateStartupPreference = async (nextEnabled: boolean): Promise<void> => {
    setSaving(true);
    try {
      await window.bugPocket.toggleStartup(nextEnabled);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel capture-preferences-panel">
      <div className="panel-heading">
        <div>
          <h2>Capture Preferences</h2>
          <p className="settings-helper">Control screenshot review and Windows startup behavior.</p>
        </div>
      </div>
      <div className="settings-compact-toggle-list">
        <label className="settings-compact-toggle">
          <input
            type="checkbox"
            checked={screenshotReviewEnabled}
            disabled={saving}
            onChange={(event) => void updatePreference(event.target.checked)}
          />
          <span>
            <strong>Review screenshots before attaching in Quick Capture</strong>
            <small>When enabled, snips open in the annotation editor before they are attached.</small>
          </span>
        </label>
        <label className="settings-compact-toggle">
          <input
            type="checkbox"
            checked={runOnSystemStartup}
            disabled={saving}
            onChange={(event) => void updateStartupPreference(event.target.checked)}
          />
          <span>
            <strong>Run on System Startup</strong>
            <small>Starts Bug Pocket with Windows and opens it hidden in the background.</small>
          </span>
        </label>
      </div>
    </div>
  );
}
