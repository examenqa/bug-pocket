import type { SupportEmailResult } from '../../shared/types';
import { SUPPORT_EMAIL_RECIPIENT } from '../../shared/supportFeedback';
import type { SecureIpcRegistrar } from './secureIpc';

export const supportEmailChannel = 'support:openEmail';

/** Registered through secure IPC: no renderer-provided data enters the composer. */
export function registerSupportEmailIpc(
  ipc: SecureIpcRegistrar,
  requestComposer: (uri: string) => Promise<void>
): void {
  ipc.handle(supportEmailChannel, async (): Promise<SupportEmailResult> => {
    const uri = `mailto:${SUPPORT_EMAIL_RECIPIENT}?subject=` + encodeURIComponent('Bug Pocket report');
    try {
      await requestComposer(uri);
      return { requested: true };
    } catch {
      return {
        requested: false,
        error: 'Could not request an email composer. Your report is kept. Copy it and email valisheik@examenqa.com manually.'
      };
    }
  });
}
