import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkspaceMembership, sortWorkspaceOptions } from './workspaceSelection';

const memberships = [
  { workspace_id: 'workspace-b', role: 'member' },
  { workspace_id: 'workspace-a', role: 'owner' }
];

test('a persisted accessible workspace is mounted even when memberships arrive out of order', () => {
  const result = resolveWorkspaceMembership(memberships, 'workspace-b');
  assert.equal(result.membership?.workspace_id, 'workspace-b');
  assert.equal(result.selectionRequired, false);
  assert.deepEqual(result.memberships.map((row) => row.workspace_id), ['workspace-a', 'workspace-b']);
});

test('multiple memberships without a valid preference require explicit selection', () => {
  const result = resolveWorkspaceMembership(memberships, 'workspace-removed');
  assert.equal(result.membership, null);
  assert.equal(result.selectionRequired, true);
});

test('a single membership is selected automatically and workspace options sort deterministically', () => {
  assert.equal(resolveWorkspaceMembership([memberships[0]], null).membership?.workspace_id, 'workspace-b');
  assert.deepEqual(
    sortWorkspaceOptions([
      { workspaceId: 'workspace-b', name: 'Zeta' },
      { workspaceId: 'workspace-c', name: 'Alpha' },
      { workspaceId: 'workspace-a', name: 'Alpha' }
    ]).map((workspace) => workspace.workspaceId),
    ['workspace-a', 'workspace-c', 'workspace-b']
  );
});
