import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  MAX_SUPPORT_BODY_BYTES,
  MAX_SUPPORT_EMAIL_LENGTH,
  MAX_SUPPORT_MESSAGE_BYTES,
  normalizeSupportFeedbackPayload,
  SUPPORT_FORWARDING_ENABLED,
  utf8ByteLength
} from '../../../../shared/supportFeedback';
import { submitSupportFeedback } from '../../utils/supportFeedback';
import {
  appendSupportText,
  getSupportDraftController,
  selectedSupportText,
  supportPayloadForDraft,
  type SupportDraftMode,
  type SupportTextSelection
} from '../../utils/supportDraft';

export type SupportModalMode = SupportDraftMode;

interface SupportModalProps {
  mode: SupportModalMode;
  open: boolean;
  onClose: () => void;
  textSelections?: readonly SupportTextSelection[];
}

const noTextSelections: readonly SupportTextSelection[] = [];

function titleForMode(mode: SupportModalMode): string {
  if (mode === 'ai_output') return 'Report inappropriate AI output';
  return mode === 'feature' ? 'Request a Feature' : 'Report a Bug';
}

export function SupportModal({ mode, open, onClose, textSelections = noTextSelections }: SupportModalProps) {
  const controller = getSupportDraftController(mode);
  const draft = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionNotice, setSelectionNotice] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const closeRef = useRef(onClose);
  const formId = useId();

  const closeAndKeepDraft = (): void => {
    setSelectedIds([]);
    setSelectionNotice('');
    onClose();
  };

  useEffect(() => {
    closeRef.current = () => {
      setSelectedIds([]);
      setSelectionNotice('');
      onClose();
    };
  }, [onClose]);

  useEffect(() => {
    // Reopening never overwrites an existing message/email; uninserted choices reset.
    setSelectedIds([]);
    setSelectionNotice('');
  }, [mode, open, draft.category]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    messageRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, [tabindex="0"]'
      ) ?? []).filter((element) => !element.matches(':disabled') && element.tabIndex >= 0);
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  const payload = supportPayloadForDraft(draft);
  const validation = normalizeSupportFeedbackPayload(payload);
  const messageBytes = utf8ByteLength(draft.message.trim());
  const bodyBytes = validation.success ? utf8ByteLength(validation.body) : utf8ByteLength(JSON.stringify(payload));
  const preview = selectedSupportText(textSelections, selectedIds);
  const unknown = draft.result?.delivery_status === 'unknown';
  const accepted = draft.result?.success === true && draft.result.delivery_status === 'accepted_by_recipient';
  const inputDisabled = draft.isSubmitting;

  const submit = (): void => {
    if (!SUPPORT_FORWARDING_ENABLED || draft.isSubmitting || !validation.success) return;
    void controller.submit((value) => submitSupportFeedback(window.bugPocket.sendFeedback, value));
  };

  const insertSelectedText = (): void => {
    if (!preview || draft.isSubmitting) return;
    controller.update({ message: appendSupportText(draft.message, preview) });
    setSelectedIds([]);
    setSelectionNotice('Selected current text added. You can edit or remove it in the message.');
    messageRef.current?.focus();
  };

  const discard = (): void => {
    if (controller.discard()) onClose();
  };

  return createPortal(
    <div className="support-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAndKeepDraft(); }}>
      <section
        ref={dialogRef}
        className="support-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        aria-describedby={`${formId}-availability`}
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        <header>
          <div>
            <h2 id={`${formId}-title`}>{titleForMode(draft.category)}</h2>
            <p>Prepare a text-only support draft. Images cannot be attached.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close and keep support draft" onClick={closeAndKeepDraft}><X size={18} /></button>
        </header>

        <p id={`${formId}-availability`} role="status">Support submission is unavailable in this version. You can prepare a draft here; nothing will be sent.</p>
        <p>Your draft stays in this app window's memory when you close this dialog. Use Discard draft to remove it.</p>
        {(draft.message || draft.email) && <p>A draft is already in progress. Review it before inserting any more text from this page.</p>}

        <label>
          <span>Category</span>
          <select value={draft.category} disabled={inputDisabled} onChange={(event) => controller.update({ category: event.target.value as SupportModalMode })}>
            <option value="bug">Bug feedback</option>
            <option value="feature">Feature feedback</option>
            <option value="ai_output">Inappropriate AI output</option>
          </select>
        </label>

        {textSelections.length > 0 && (
          <fieldset disabled={inputDisabled}>
            <legend>Choose current text to include</legend>
            <p>Nothing is selected automatically. Current text may include your edits; it is not a saved original AI response. Preview your choices before inserting them.</p>
            {textSelections.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(option.id)}
                  disabled={inputDisabled || !option.text.trim()}
                  onChange={(event) => setSelectedIds((current) => event.target.checked
                    ? [...current, option.id]
                    : current.filter((id) => id !== option.id))}
                />
                <span>{option.label}{!option.text.trim() ? ' (empty)' : ''}</span>
              </label>
            ))}
            <label>
              <span>Selected text preview</span>
              <textarea value={preview} readOnly placeholder="Choose text above to preview it here." />
            </label>
            <button type="button" disabled={!preview || inputDisabled} onClick={insertSelectedText}>Insert selected text into message</button>
            {selectionNotice && <p role="status">{selectionNotice}</p>}
          </fieldset>
        )}

        <label>
          <span>Final message</span>
          <textarea
            ref={messageRef}
            value={draft.message}
            onChange={(event) => controller.update({ message: event.target.value })}
            placeholder="Describe what you want to report."
            disabled={inputDisabled}
            aria-describedby={`${formId}-limits`}
          />
        </label>

        <label>
          <span>Email <em>optional</em></span>
          <input type="email" value={draft.email} maxLength={MAX_SUPPORT_EMAIL_LENGTH} onChange={(event) => controller.update({ email: event.target.value })} placeholder="you@example.com" disabled={inputDisabled} />
        </label>
        <p id={`${formId}-limits`}>{messageBytes.toLocaleString()} / {MAX_SUPPORT_MESSAGE_BYTES.toLocaleString()} message bytes; {bodyBytes.toLocaleString()} / {MAX_SUPPORT_BODY_BYTES.toLocaleString()} JSON bytes. Review the final text and remove confidential information.</p>
        {draft.message.trim() && !validation.success && <p className="support-modal-error" role="alert">{validation.result.error}</p>}
        {draft.result && !draft.result.success && <p className="support-modal-error" role="alert">{draft.result.error}</p>}
        {unknown && <p role="alert">We could not confirm whether support received this report. It may have arrived. Retrying may send a duplicate. Your draft has been kept.</p>}
        {accepted && <p className="support-modal-success" role="status">Accepted by the recipient service. This does not mean it has been reviewed.</p>}
        {draft.isSubmitting && <p role="status">Waiting for an acknowledgement. Closing this dialog does not retract a request already sent.</p>}

        <footer>
          <button type="button" disabled={draft.isSubmitting} onClick={discard}>Discard draft</button>
          <button type="button" onClick={closeAndKeepDraft}>Close and keep draft</button>
          <button className="primary" type="button" disabled={!SUPPORT_FORWARDING_ENABLED || draft.isSubmitting || !validation.success} onClick={submit}>
            {draft.isSubmitting ? 'Sending...' : unknown ? 'Retry (may duplicate)' : 'Send unavailable'}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
