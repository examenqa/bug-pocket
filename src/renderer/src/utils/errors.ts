import { getAiErrorMessage, parseAiErrorMessage } from '../../../shared/aiError';

const ipcFieldLabels: Record<string, string> = {
  note: 'bug note',
  title: 'title',
  environment: 'environment',
  device: 'device',
  browser: 'browser',
  attachment_id: 'attachment',
  rawInput: 'bug text',
  application: 'application',
  module: 'module',
  user_role: 'user role',
  steps_to_reproduce: 'steps to reproduce',
  expected_result: 'expected result',
  actual_result: 'actual result',
  other_details: 'other details',
  refinement_note: 'refinement note'
};

export function parseErrorForUI(error: unknown): string {
  const publicMessage = parseAiErrorMessage(error);
  if (publicMessage) return publicMessage;

  // IPC validators produce this fixed grammar without including argument values.
  // Retain contract guidance, but never reflect an arbitrary error or field name.
  let message: string;
  try { message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''; }
  catch { return getAiErrorMessage('AI_FAILED'); }
  if (message.length <= 512) {
    const normalized = message.replace(/^Error invoking remote method 'ai:(?:triageBug|processIssueWithByok)': (?:TypeError: |Error: )?/, '');
    const validation = /^Invalid IPC payload at (arguments(?:\[\d+\])?(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*): expected [^\r\n]{1,200}\.$/.exec(normalized);
    if (validation) {
      const field = validation[1].split(/[.\[\]]/).filter(Boolean).pop() || '';
      const label = Object.hasOwn(ipcFieldLabels, field) ? ipcFieldLabels[field] : '';
      return label
        ? `Validation Error: Invalid IPC payload for ${label}. Check this field and try again.`
        : 'Validation Error: The AI request did not match the application contract. Reopen the report and try again.';
    }
  }

  return getAiErrorMessage('AI_FAILED');
}
