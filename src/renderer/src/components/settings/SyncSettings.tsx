import React from 'react';

export function SyncSettings() {
  return (
    <div className="settings-tab-stack">
      <div className="panel sync-placeholder-panel">
        <div className="panel-heading">
          <div>
            <h2>Cloud Sync</h2>
            <p className="settings-helper">Supabase sync is planned, but the current MVP remains local-first and offline-safe.</p>
          </div>
        </div>
        <p>Future sync will add login, workspaces, team sharing, attachment upload, and a retrying sync queue. Local capture will continue to save immediately before any cloud work starts.</p>
        <div className="sync-placeholder-grid">
          <span>Supabase Auth</span>
          <span>Workspace/team support</span>
          <span>Attachment storage sync</span>
          <span>Conflict handling with updated_at</span>
        </div>
      </div>
    </div>
  );
}
