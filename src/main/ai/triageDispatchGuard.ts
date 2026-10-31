import { AiPublicError } from '../../shared/aiError';

/** Main-owned synchronous authorization at the final triage send boundary. */
export type AiDispatchGuard = (signal: AbortSignal) => undefined;

interface TriageDispatchState {
  getCurrentWorkspaceId(): string | null;
  canWrite(workspaceId: string): boolean;
  isShuttingDown(): boolean;
  isInMaintenance(): boolean;
}

export function createTriageDispatchGuard(state: TriageDispatchState): AiDispatchGuard {
  let originatingWorkspace: string | null;
  try {
    originatingWorkspace = state.getCurrentWorkspaceId();
    if (originatingWorkspace !== null && typeof originatingWorkspace !== 'string') throw new Error();
  } catch {
    throw new AiPublicError('AI_TRIAGE_BLOCKED');
  }

  return signal => {
    signal.throwIfAborted();
    let allowed: boolean;
    try {
      allowed = state.isShuttingDown() === false && state.isInMaintenance() === false
        && state.getCurrentWorkspaceId() === originatingWorkspace
        && (originatingWorkspace === null || state.canWrite(originatingWorkspace) === true);
    } catch {
      allowed = false;
    }
    if (!allowed) throw new AiPublicError('AI_TRIAGE_BLOCKED');
    return undefined;
  };
}
