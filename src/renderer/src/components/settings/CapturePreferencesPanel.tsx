import React, { useEffect, useState } from 'react';
import type { StartupStatus } from '../../../../shared/types';

export function CapturePreferencesPanel({
  screenshotReviewEnabled,
  runOnSystemStartup,
  startupStatus,
  startupChoiceRequired = false,
  refresh
}: {
  screenshotReviewEnabled: boolean;
  runOnSystemStartup: boolean;
  startupStatus?: StartupStatus;
  startupChoiceRequired?: boolean;
  refresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [startupFeedback, setStartupFeedback] = useState('');
  useEffect(() => {
    setStartupFeedback('');
  }, [startupStatus?.mode, startupStatus?.state, startupStatus?.enabled]);

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
    setStartupFeedback('');
    try {
      const status = await window.bugPocket.toggleStartup(nextEnabled);
      setStartupFeedback(status.message);
      await refresh();
    } catch {
      setStartupFeedback('The startup change could not be confirmed. Refresh settings before trying again.');
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
      {startupChoiceRequired && (
        <div className="settings-helper" role="region" aria-label="Choose Windows startup behavior">
          <p>Keep Bug Pocket quietly available after Windows sign-in, with its global shortcuts ready?</p>
          <button type="button" disabled={saving || startupStatus?.canEnable !== true} onClick={() => void updateStartupPreference(true)}>Enable startup</button>
          <button type="button" disabled={saving} onClick={() => void updateStartupPreference(false)}>No thanks</button>
          <p>Bug Pocket requests startup only after you choose Enable startup. You can change this preference here later; Windows controls the final state.</p>
        </div>
      )}
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
            disabled={saving || !startupStatus || startupStatus.state === 'unsupported' || startupStatus.state === 'unavailable' ||
              (runOnSystemStartup ? startupStatus.canDisable === false : startupStatus.canEnable === false)}
            aria-describedby="startup-status"
            onChange={(event) => void updateStartupPreference(event.target.checked)}
          />
          <span>
            <strong>Run on System Startup</strong>
            <small id="startup-status" role="status">
              {startupFeedback || startupStatus?.message || 'Reading startup status...'}
              {startupStatus && startupStatus.enabled !== runOnSystemStartup && ` Saved preference: ${runOnSystemStartup ? 'on' : 'off'}.`}
              {startupStatus?.enabled === null && ' Windows startup status is unknown.'}
            </small>
          </span>
        </label>
      </div>
    </div>
  );
}
