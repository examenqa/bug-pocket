import type { FeedbackPayload } from '../../../shared/types';
import {
  safeSupportFeedbackResult,
  SUPPORT_EMAIL_RECIPIENT,
  supportFailure,
  type SupportFeedbackResult
} from '../../../shared/supportFeedback';

export type SupportDraftMode = 'bug' | 'feature' | 'ai_output';

export const supportCategoryLabels: Record<SupportDraftMode, string> = {
  bug: 'Bug feedback',
  feature: 'Feature feedback',
  ai_output: 'Inappropriate AI output'
};

export interface SupportTextSelection {
  id: string;
  label: string;
  text: string;
}

export interface SupportDraftSnapshot {
  category: SupportDraftMode;
  message: string;
  email: string;
  isSubmitting: boolean;
  result: SupportFeedbackResult | null;
}

type DraftSubmitter = (payload: FeedbackPayload) => Promise<unknown>;

export interface SupportHandoffResult {
  success: boolean;
  message: string;
}

/** Exactly the visible category, edited message and optional contact; never report metadata. */
export function supportReportText(draft: Pick<SupportDraftSnapshot, 'category' | 'message' | 'email'>): string {
  return `Category: ${supportCategoryLabels[draft.category]}\n\nMessage:\n${draft.message}`
    + (draft.email.trim() ? `\n\nContact email: ${draft.email}` : '');
}

export async function copySupportReport(
  draft: Pick<SupportDraftSnapshot, 'category' | 'message' | 'email'>,
  copyText: (text: string) => Promise<unknown>
): Promise<SupportHandoffResult> {
  try {
    await copyText(supportReportText(draft));
    return { success: true, message: 'Report copied. Paste it into your email app and send it yourself.' };
  } catch {
    return {
      success: false,
      message: 'Could not copy the report. Select the report preview and copy it manually. Your draft has been kept.'
    };
  }
}

export async function requestSupportEmail(requestComposer: () => Promise<unknown>): Promise<SupportHandoffResult> {
  try {
    const result = await requestComposer();
    if (result && typeof result === 'object' && 'requested' in result && result.requested === true) {
      return {
        success: true,
        message: 'Email-app request made. If a composer appears, paste the copied report and send it yourself. Sending, delivery and review are not confirmed.'
      };
    }
  } catch {
    // A missing mail app or IPC failure leaves the editable draft untouched.
  }
  return {
    success: false,
    message: `Could not request an email composer. Copy the report or select its preview and email ${SUPPORT_EMAIL_RECIPIENT} manually. Your draft has been kept.`
  };
}

export function supportPayloadForDraft(draft: Pick<SupportDraftSnapshot, 'category' | 'message' | 'email'>): FeedbackPayload {
  return {
    type: draft.category === 'feature' ? 'Feature' : 'Bug',
    report_kind: draft.category === 'ai_output' ? 'ai_output' : 'feedback',
    message: draft.message,
    user_email: draft.email.trim() || undefined
  };
}

export function selectedSupportText(options: readonly SupportTextSelection[], selectedIds: readonly string[]): string {
  const selected = new Set(selectedIds);
  return options
    .filter((option) => selected.has(option.id) && option.text.trim())
    .map((option) => `${option.label}:\n${option.text}`)
    .join('\n\n');
}

export function appendSupportText(message: string, selectedText: string): string {
  if (!selectedText) return message;
  return message ? `${message}\n\n${selectedText}` : selectedText;
}

/** Local renderer memory only. No storage, report lookup, transport, or automatic content collection. */
export function createSupportDraftController(initialCategory: SupportDraftMode) {
  const emptyDraft = (): SupportDraftSnapshot => ({
    category: initialCategory,
    message: '',
    email: '',
    isSubmitting: false,
    result: null
  });
  let snapshot = emptyDraft();
  const listeners = new Set<() => void>();
  const publish = (next: SupportDraftSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: (): SupportDraftSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update: (change: Partial<Pick<SupportDraftSnapshot, 'category' | 'message' | 'email'>>): void => {
      if (snapshot.isSubmitting) return;
      publish({ ...snapshot, ...change, result: null });
    },
    discard: (): boolean => {
      if (snapshot.isSubmitting) return false;
      publish(emptyDraft());
      return true;
    },
    submit: async (submitter: DraftSubmitter): Promise<SupportFeedbackResult | undefined> => {
      // Synchronous state, shared by every mounted view, prevents same-tick duplicate sends.
      if (snapshot.isSubmitting) return undefined;
      const payload = supportPayloadForDraft(snapshot);
      publish({ ...snapshot, isSubmitting: true, result: null });
      let result: SupportFeedbackResult;
      try {
        result = safeSupportFeedbackResult(await submitter(payload));
      } catch {
        result = supportFailure('delivery_unknown', 'unknown');
      }
      if (result.success && result.delivery_status === 'accepted_by_recipient') {
        publish({ ...emptyDraft(), result });
      } else {
        publish({ ...snapshot, isSubmitting: false, result });
      }
      return result;
    }
  };
}

// Three finite drafts survive dialog/route unmounts for this renderer's lifetime.
// Keys contain no bug/workspace identifiers; only explicitly edited/inserted text is held.
const supportDrafts = {
  bug: createSupportDraftController('bug'),
  feature: createSupportDraftController('feature'),
  ai_output: createSupportDraftController('ai_output')
};

export function getSupportDraftController(mode: SupportDraftMode) {
  return supportDrafts[mode];
}
