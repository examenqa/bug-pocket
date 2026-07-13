import type { WorkspaceRole } from '../../shared/types';

export const workspaceReadOnlyError = 'Unauthorized: Read-only access';

export function assertWorkspaceWriteAccess(role: WorkspaceRole): void {
  if (role === 'developer') throw new Error(workspaceReadOnlyError);
}
