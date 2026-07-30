import type { SyncWorkspaceOption, WorkspaceRole } from '../../shared/types';

export interface WorkspaceMembershipCandidate {
  workspace_id: string;
  role?: WorkspaceRole | string | null;
}

export interface WorkspaceMembershipResolution {
  membership: WorkspaceMembershipCandidate | null;
  memberships: WorkspaceMembershipCandidate[];
  selectionRequired: boolean;
}

export function resolveWorkspaceMembership(
  candidates: WorkspaceMembershipCandidate[],
  preferredWorkspaceId: string | null | undefined
): WorkspaceMembershipResolution {
  const byWorkspaceId = new Map<string, WorkspaceMembershipCandidate>();
  for (const candidate of candidates) {
    const workspaceId = String(candidate.workspace_id ?? '').trim();
    if (!workspaceId || byWorkspaceId.has(workspaceId)) continue;
    byWorkspaceId.set(workspaceId, { ...candidate, workspace_id: workspaceId });
  }

  const memberships = [...byWorkspaceId.values()]
    .sort((left, right) => left.workspace_id.localeCompare(right.workspace_id));
  const preferred = String(preferredWorkspaceId ?? '').trim();
  const persistedMembership = preferred
    ? memberships.find((membership) => membership.workspace_id === preferred) ?? null
    : null;

  if (persistedMembership) {
    return { membership: persistedMembership, memberships, selectionRequired: false };
  }
  if (memberships.length === 1) {
    return { membership: memberships[0], memberships, selectionRequired: false };
  }
  return { membership: null, memberships, selectionRequired: memberships.length > 1 };
}

export function sortWorkspaceOptions(options: SyncWorkspaceOption[]): SyncWorkspaceOption[] {
  return [...options].sort((left, right) => {
    const nameOrder = (left.name ?? '').localeCompare(right.name ?? '', undefined, { sensitivity: 'base' });
    return nameOrder || left.workspaceId.localeCompare(right.workspaceId);
  });
}
