import React from 'react';

export function SyncSettings() {
  return (
    <div className="settings-tab-stack">
      <section className="settings-section-group sync-placeholder" aria-labelledby="settings-sync-heading">
        <div className="settings-section-heading">
          <h2 id="settings-sync-heading">Cloud Sync</h2>
          <p>Supabase sync is planned, but the current MVP remains local-first and offline-safe.</p>
        </div>
        <div className="panel sync-placeholder-panel">
          <h3>Not connected yet</h3>
          <p>Future sync will add login, workspaces, team sharing, attachment upload, and a retrying sync queue. Local capture will continue to save immediately before any cloud work starts.</p>
          <div className="sync-placeholder-grid">
            <span>Supabase Auth</span>
            <span>Workspace/team support</span>
            <span>Attachment storage sync</span>
            <span>Conflict handling with updated_at</span>
          </div>
        </div>
      </section>
    </div>
  );
}
