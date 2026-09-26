import { ChevronDown, ChevronUp, Cloud, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { SyncDiagnosticsRow, TeamInvitePayload } from '../../../../shared/types';

interface TeamInvitePanelProps {
  visible: boolean;
  inviteEmail: string;
  inviteRole: string;
  invitePassphrase: string;
  generatedInviteCode: string;
  generatingInvite: boolean;
  onInviteEmailChange(value: string): void;
  onInviteRoleChange(value: string): void;
  onInvitePassphraseChange(value: string): void;
  onGenerate(): void;
  onCopy(): void;
}

export function TeamInvitePanel({
  visible,
  inviteEmail,
  inviteRole,
  invitePassphrase,
  generatedInviteCode,
  generatingInvite,
  onInviteEmailChange,
  onInviteRoleChange,
  onInvitePassphraseChange,
  onGenerate,
  onCopy
}: TeamInvitePanelProps) {
  if (!visible) return null;

  return (
    <section className="sync-invite-panel" aria-labelledby="sync-invite-heading">
      <div>
        <strong id="sync-invite-heading">Invite Team Member</strong>
        <p>Pre-authorize a Supabase account, then generate an encrypted offline code for this workspace. Share the code and passphrase separately.</p>
      </div>
      <div className="sync-invite-member-fields">
        <label>
          <span>Team Member Email</span>
          <input
            type="email"
            value={inviteEmail}
            maxLength={320}
            autoComplete="email"
            placeholder="teammate@example.com"
            disabled={generatingInvite}
            onChange={(event) => onInviteEmailChange(event.target.value)}
          />
        </label>
        <label>
          <span>Workspace Role</span>
          <input
            type="text"
            value={inviteRole}
            maxLength={80}
            placeholder="member"
            disabled={generatingInvite}
            onChange={(event) => onInviteRoleChange(event.target.value)}
          />
        </label>
      </div>
      <div className="sync-invite-controls">
        <input
          type="password"
          value={invitePassphrase}
          minLength={12}
          maxLength={512}
          autoComplete="new-password"
          placeholder="Invite passphrase (12+ characters)"
          disabled={generatingInvite}
          onChange={(event) => onInvitePassphraseChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onGenerate();
          }}
        />
        <button
          type="button"
          className="secondary"
          disabled={generatingInvite || invitePassphrase.trim().length < 12 || !inviteEmail.trim() || !inviteRole.trim()}
          onClick={onGenerate}
        >
          {generatingInvite ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
          {generatingInvite ? 'Generating...' : 'Generate Invite'}
        </button>
      </div>
      {generatedInviteCode && (
        <div className="sync-invite-code">
          <textarea aria-label="Generated encrypted team invite code" value={generatedInviteCode} readOnly rows={3} />
          <button type="button" className="secondary compact" onClick={onCopy}>
            Copy Code
          </button>
        </div>
      )}
    </section>
  );
}

interface SyncDiagnosticsPanelProps {
  open: boolean;
  diagnostics: SyncDiagnosticsRow[];
  retrying: boolean;
  onToggle(): void;
  onRetry(): void;
  onRefresh(): void;
}

export function SyncDiagnosticsPanel({
  open,
  diagnostics,
  retrying,
  onToggle,
  onRetry,
  onRefresh
}: SyncDiagnosticsPanelProps) {
  const failedCount = diagnostics.filter((row) => row.last_error || row.retry_count >= 5).length;
  const missingBinaryCount = diagnostics.filter((row) => row.missing_binary).length;

  return (
    <div className={open ? 'panel settings-option-panel open' : 'panel settings-option-panel'}>
      <button type="button" className="settings-option-header" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>Sync Diagnostics</strong>
          <em>
            {diagnostics.length} pending item{diagnostics.length === 1 ? '' : 's'}
            {' \u00b7 '}{missingBinaryCount} missing binaries{' \u00b7 '}{failedCount} failed
          </em>
        </span>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {open && (
        <div className="settings-option-body">
          <div className="sync-action-row">
            <button type="button" className="secondary" disabled={retrying || !diagnostics.length} onClick={onRetry}>
              <RefreshCw className={retrying ? 'spin' : undefined} size={16} />
              {retrying ? 'Retrying...' : 'Force Retry'}
            </button>
            <button type="button" className="secondary" disabled={retrying} onClick={onRefresh}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
          <div className="option-list">
            {diagnostics.map((row) => (
              <div className="option-row sync-diagnostics-row" key={`${row.queue_type}-${row.id}`}>
                <span className="option-name">
                  <span className="sync-diagnostics-title-line">
                    <span>{row.label}</span>
                    <span className="sync-diagnostics-separator">{'\u2022'}</span>
                    <em>
                      {row.queue_type === 'download' ? 'binary download' : `${row.entity_type} \u00b7 ${row.operation}`}
                      {' \u00b7 '}retries {row.retry_count}
                    </em>
                  </span>
                  {row.missing_binary && !row.last_error && (
                    <small className="sync-diagnostics-missing">Binary is missing locally and queued for download.</small>
                  )}
                  {row.last_error && <small className="settings-error">{row.last_error}</small>}
                </span>
              </div>
            ))}
            {!diagnostics.length && <p className="muted">No pending sync payloads.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function SupabaseSetupGuideModal({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;

  return (
    <div className="sync-help-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="sync-help-modal" role="dialog" aria-modal="true" aria-labelledby="sync-help-title">
        <header>
          <div>
            <h2 id="sync-help-title">Supabase Quick Start</h2>
            <p>Bring your own Supabase project for Bug Pocket cloud sync.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close Supabase setup help" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <ol>
          <li>
            <strong>Create a Project</strong>
            <span>Log in to Supabase and click <b>New Project</b>. Select your organization, set a database password, and wait for the provisioning process to finish.</span>
            <button type="button" className="secondary sync-schema-link" onClick={() => void window.bugPocket.openExternalUrl('https://database.new')}>
              <ExternalLink size={15} /> Open Supabase
            </button>
          </li>
          <li>
            <strong>Project URL</strong>
            <span>In Supabase, go to Dashboard -&gt; Organization Dashboard -&gt; Project Dashboard. Copy the Project URL for the project you want Bug Pocket to use.</span>
          </li>
          <li>
            <strong>Publishable API Key</strong>
            <span>From the Project Dashboard, open API Keys -&gt; Publishable and secret API keys. Copy only the Publishable key. Never use the secret service_role key in Bug Pocket.</span>
          </li>
          <li>
            <strong>Schema Setup</strong>
            <span>{'Open Bug Pocket\u2019s installation schema and run it in the Supabase SQL Editor to build the required tables.'}</span>
            <button
              type="button"
              className="secondary sync-schema-link"
              onClick={() => void window.bugPocket.openExternalUrl('https://github.com/examenqa/bug-pocket/blob/main/supabase/schema-install.sql')}
            >
              <ExternalLink size={15} /> Open schema-install.sql
            </button>
          </li>
        </ol>
      </section>
    </div>
  );
}

interface InviteConfirmationModalProps {
  invite: TeamInvitePayload | null;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function InviteConfirmationModal({ invite, busy, onCancel, onConfirm }: InviteConfirmationModalProps) {
  if (!invite) return null;

  return (
    <div className="sync-help-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="sync-help-modal sync-invite-confirmation" role="dialog" aria-modal="true" aria-labelledby="sync-invite-confirmation-title">
        <header>
          <div>
            <h2 id="sync-invite-confirmation-title">Confirm Team Connection</h2>
            <p>Verify the destination before Bug Pocket stores this team connection locally.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cancel team invite import" disabled={busy} onClick={onCancel}>
            <X size={18} />
          </button>
        </header>
        <dl className="sync-invite-details">
          <div><dt>Project URL</dt><dd>{invite.url}</dd></div>
          <div><dt>Workspace ID</dt><dd>{invite.teamId}</dd></div>
          <div><dt>Invitee Email</dt><dd>{invite.targetEmail}</dd></div>
          <div><dt>Expires</dt><dd>{new Date(invite.expiresAt).toLocaleString()}</dd></div>
        </dl>
        <p className="settings-helper">Only continue when this project and workspace match the details provided by your team administrator.</p>
        <div className="sync-confirm-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Cloud size={16} />}
            {busy ? 'Connecting...' : 'Confirm & Connect'}
          </button>
        </div>
      </section>
    </div>
  );
}
