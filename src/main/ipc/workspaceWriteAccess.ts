import type { WorkspaceRole } from '../../shared/types';

export const workspaceReadOnlyError = 'Unauthorized: Read-only access';
export const workspaceAdminError = 'Unauthorized: Workspace admin access required';

export function assertWorkspaceWriteAccess(canWrite: boolean): void {
  if (!canWrite) throw new Error(workspaceReadOnlyError);
}

export function assertWorkspaceAdminAccess(role: WorkspaceRole): void {
  if (role !== 'owner' && role !== 'admin') throw new Error(workspaceAdminError);
}
