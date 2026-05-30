import React, { useEffect, useState } from 'react';

export function JiraWorkspacePanel({
  value,
  mutationReady,
  refresh
}: {
  value: string | null;
  mutationReady: boolean;
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const save = async (): Promise<void> => {
    setStatus('');
    await window.bugPocket.updateJiraWorkspaceUrl(draft);
    await refresh();
    setStatus(draft.trim() ? 'Jira workspace saved.' : 'Jira workspace cleared.');
    window.setTimeout(() => setStatus(''), 1800);
  };

  return (
    <div className="panel jira-workspace-panel">
      <div className="panel-heading">
        <div>
          <h2>Jira Workspace</h2>
          <p className="settings-helper">Used by Open Jira when an entry does not already have an Issue URL.</p>
        </div>
      </div>
      <div className="jira-workspace-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          placeholder="https://your-team.atlassian.net"
          disabled={!mutationReady}
        />
        <button onClick={() => void save()} disabled={!mutationReady}>Save</button>
      </div>
      {status && <p className="settings-save-note">{status}</p>}
    </div>
  );
}
