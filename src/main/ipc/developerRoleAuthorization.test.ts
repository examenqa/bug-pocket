const authorizationTest: typeof import('node:test') = require('node:test');
const authorizationAssert: typeof import('node:assert/strict') = require('node:assert/strict');
const {
  deleteBugChannel: developerDeleteBugChannel,
  registerBugDeletionIpc: registerDeveloperBugDeletionIpc
}: typeof import('./bugDeletionIpc') = require('./bugDeletionIpc.ts');
const {
  createIpcArgumentValidators: createDeveloperIpcArgumentValidators,
  createSecureIpcRegistrar: createDeveloperSecureIpcRegistrar
}: typeof import('./secureIpc') = require('./secureIpc.ts');
const {
  assertWorkspaceWriteAccess: assertDeveloperWorkspaceWriteAccess,
  workspaceReadOnlyError: developerWorkspaceReadOnlyError
}: typeof import('./workspaceWriteAccess') = require('./workspaceWriteAccess.ts');

authorizationTest('a cached read-only workspace permission is rejected before destructive bug IPC reaches the database', async () => {
  let registeredHandler: ((event: unknown, id: unknown) => unknown) | undefined;
  const ipc = {
    handle: (channel: string, handler: (event: unknown, id: unknown) => unknown) => {
      authorizationAssert.equal(channel, developerDeleteBugChannel);
      registeredHandler = handler;
    }
  } as Parameters<typeof registerDeveloperBugDeletionIpc>[0];

  const authenticatedDeveloperEvent = {
    senderFrame: {
      parent: null,
      url: 'file:///trusted/index.html'
    },
    session: {
      authenticated: true,
      workspaceId: '550e8400-e29b-41d4-a716-446655440000',
      workspaceRole: 'auditor' as const,
      workspaceCanWrite: false
    }
  };
  const deletedBugIds: number[] = [];
  let authorizationChecks = 0;
  let changedEvents = 0;
  let toastEvents = 0;

  const secureIpc = createDeveloperSecureIpcRegistrar(
    ipc,
    createDeveloperIpcArgumentValidators(),
    (event) => {
      const candidate = event as unknown as typeof authenticatedDeveloperEvent;
      return candidate.session.authenticated && candidate.senderFrame.url === 'file:///trusted/index.html';
    }
  );
  registerDeveloperBugDeletionIpc(secureIpc, {
    authorizeMutation: () => {
      authorizationChecks += 1;
      assertDeveloperWorkspaceWriteAccess(authenticatedDeveloperEvent.session.workspaceCanWrite);
    },
    deleteBug: (id) => deletedBugIds.push(id),
    emitBugsChanged: () => { changedEvents += 1; },
    emitDeletedToast: () => { toastEvents += 1; }
  });

  authorizationAssert.ok(registeredHandler, 'Expected bugs:delete to register an IPC handler.');
  authorizationAssert.equal(authenticatedDeveloperEvent.session.workspaceRole, 'auditor');
  authorizationAssert.equal(authenticatedDeveloperEvent.session.workspaceCanWrite, false);

  await authorizationAssert.rejects(
    Promise.resolve().then(() => registeredHandler!(authenticatedDeveloperEvent, 73)),
    new RegExp(developerWorkspaceReadOnlyError)
  );

  authorizationAssert.equal(authorizationChecks, 1);
  authorizationAssert.deepEqual(deletedBugIds, [], 'Authorization must abort before the database mutation.');
  authorizationAssert.equal(changedEvents, 0);
  authorizationAssert.equal(toastEvents, 0);
});
