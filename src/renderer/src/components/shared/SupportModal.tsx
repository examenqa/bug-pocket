import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  MAX_SUPPORT_EMAIL_LENGTH,
  SUPPORT_EMAIL_RECIPIENT
} from '../../../../shared/supportFeedback';
import {
  appendSupportText,
  copySupportReport,
  getSupportDraftController,
  requestSupportEmail,
  selectedSupportText,
  supportCategoryLabels,
  supportReportText,
  type SupportDraftMode,
  type SupportHandoffResult,
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
  const [handoff, setHandoff] = useState<SupportHandoffResult | null>(null);
  const [handoffBusy, setHandoffBusy] = useState<'copy' | 'email' | null>(null);
  const handoffInFlight = useRef(false);
  const handoffVersion = useRef(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const reportRef = useRef<HTMLTextAreaElement | null>(null);
  const closeRef = useRef(onClose);
  const formId = useId();

  const closeAndKeepDraft = (): void => {
    setSelectedIds([]);
    setSelectionNotice('');
    handoffVersion.current += 1;
    setHandoff(null);
    onClose();
  };

  useEffect(() => {
    closeRef.current = () => {
      setSelectedIds([]);
      setSelectionNotice('');
      handoffVersion.current += 1;
      setHandoff(null);
      onClose();
    };
  }, [onClose]);

  useEffect(() => {
    // Reopening never overwrites an existing message/email; uninserted choices reset.
    setSelectedIds([]);
    setSelectionNotice('');
    handoffVersion.current += 1;
    setHandoff(null);
  }, [mode, open, draft.category]);

  useEffect(() => { setHandoff(null); }, [draft.message, draft.email]);

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

  const preview = selectedSupportText(textSelections, selectedIds);
  const report = supportReportText(draft);
  const canCopy = Boolean(draft.message.trim());
  const inputDisabled = draft.isSubmitting || handoffBusy !== null;

  const handoffReport = async (action: 'copy' | 'email'): Promise<void> => {
    if (handoffInFlight.current || draft.isSubmitting) return;
    if (action === 'copy' && !canCopy) return;
    handoffInFlight.current = true;
    const version = handoffVersion.current;
    setHandoffBusy(action);
    setHandoff(null);
    try {
      const result = action === 'copy'
        ? await copySupportReport(draft, (text) => window.bugPocket.copyText(text))
        : await requestSupportEmail(() => window.bugPocket.openSupportEmail());
      if (version !== handoffVersion.current) return;
      setHandoff(result);
      if (action === 'copy' && !result.success) {
        reportRef.current?.focus();
        reportRef.current?.select();
      }
    } finally {
      handoffInFlight.current = false;
      setHandoffBusy(null);
    }
  };

  const insertSelectedText = (): void => {
    if (!preview || inputDisabled) return;
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

        <p id={`${formId}-availability`}>Copy your reviewed report, then open your email app and paste it. You send the email yourself. The email-app request includes only the recipient and subject, with no body or attachment.</p>
        <p>Your draft stays in this app window's memory when you close this dialog. Use Discard draft to remove it.</p>
        {(draft.message || draft.email) && <p>A draft is already in progress. Review it before inserting any more text from this page.</p>}

        <label>
          <span>Category</span>
          <select value={draft.category} disabled={inputDisabled} onChange={(event) => controller.update({ category: event.target.value as SupportModalMode })}>
            <option value="bug">{supportCategoryLabels.bug}</option>
            <option value="feature">{supportCategoryLabels.feature}</option>
            <option value="ai_output">{supportCategoryLabels.ai_output}</option>
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
        <p id={`${formId}-limits`}>Review the final text and remove confidential information before copying it.</p>

        <label>
          <span>Official report recipient</span>
          <input type="text" value={SUPPORT_EMAIL_RECIPIENT} readOnly onFocus={(event) => event.currentTarget.select()} />
        </label>
        <label>
          <span>Exact report preview</span>
          <textarea ref={reportRef} value={report} readOnly aria-describedby={`${formId}-copy-help`} />
        </label>
        <p id={`${formId}-copy-help`}>Copy report copies exactly this preview. If clipboard access fails, select and copy this text manually, then email the official recipient.</p>
        {handoff && <p className={handoff.success ? 'support-modal-success' : 'support-modal-error'} role={handoff.success ? 'status' : 'alert'}>{handoff.message}</p>}
        {handoffBusy && <p role="status">{handoffBusy === 'copy' ? 'Copying report…' : 'Requesting email app…'}</p>}

        <footer>
          <button type="button" disabled={inputDisabled} onClick={discard}>Discard draft</button>
          <button type="button" onClick={closeAndKeepDraft}>Close and keep draft</button>
          <button className="primary" type="button" disabled={inputDisabled || !canCopy} onClick={() => void handoffReport('copy')}>Copy report</button>
          <button type="button" disabled={inputDisabled} onClick={() => void handoffReport('email')}>Open email app</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
