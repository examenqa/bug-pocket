const boundaryTest: typeof import('node:test') = require('node:test');
const boundaryAssert: typeof import('node:assert/strict') = require('node:assert/strict');
const { readFileSync: readBoundaryFile }: typeof import('node:fs') = require('node:fs');
const { resolve: resolveBoundaryPath }: typeof import('node:path') = require('node:path');
const {
  deleteBugChannel,
  registerBugDeletionIpc
}: typeof import('./bugDeletionIpc') = require('./bugDeletionIpc.ts');
const {
  createIpcArgumentValidators,
  createSecureIpcRegistrar
}: typeof import('./secureIpc') = require('./secureIpc.ts');

function hasProductionContentSecurityPolicy(html: string): boolean {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const cspTag = metaTags.find((tag) =>
    /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag)
  );
  if (!cspTag) return false;
  const content = cspTag.match(/content\s*=\s*"([^"]*)"/i)?.[1]
    ?? cspTag.match(/content\s*=\s*'([^']*)'/i)?.[1]
    ?? '';
  return (
    /(?:^|;)\s*default-src\s+'self'(?:\s|;|$)/i.test(content) &&
    /(?:^|;)\s*script-src\s+'self'(?:\s|;|$)/i.test(content) &&
    !/(?:^|;)\s*script-src[^;]*'unsafe-(?:eval|inline)'/i.test(content) &&
    /(?:^|;)\s*object-src\s+'none'(?:\s|;|$)/i.test(content)
  );
}

boundaryTest('renderer index.html installs a restrictive production CSP', () => {
  const rendererHtml = readBoundaryFile(
    resolveBoundaryPath(process.cwd(), 'src', 'renderer', 'index.html'),
    'utf8'
  );

  boundaryAssert.equal(
    hasProductionContentSecurityPolicy(rendererHtml),
    true,
    'Expected a self-only script policy with object execution disabled.'
  );
});

boundaryTest('bug and triage validators accept an unselected environment', () => {
  const validators = createIpcArgumentValidators();
  const environmentValues = [null, undefined, ''];

  for (const environment of environmentValues) {
    validators['ai:triageBug']([{ note: 'Fresh installation', environment }, 'request']);
    validators['bugs:createQuick']([{
      capture_context: { workspaceId: null, draftId: 'active-draft' },
      entry_type: 'Bug',
      application_id: null,
      module_id: null,
      environment_id: environment,
      device_id: environment,
      browser_id: environment,
      user_role_id: null,
      note: 'Fresh installation',
      attachment_ids: []
    }]);
    validators['bugs:update']([42, {
      entry_type: 'Bug',
      application_id: null,
      module_id: null,
      environment_id: environment,
      device_id: environment,
      browser_id: environment,
      user_role_id: null,
      title: 'Unselected environment',
      note: 'Fresh installation',
      other_details: '',
      steps_to_reproduce: '',
      expected_result: '',
      actual_result: '',
      status: 'Draft',
      severity: 'Medium',
      reported: false,
      issue_platform: '',
      issue_id: '',
      issue_url: '',
      tags: ''
    }]);
  }

  const longDiagnostic = 'x'.repeat(1_001);
  validators['ai:triageBug']([{
    note: 'Verbose diagnostics',
    environment: longDiagnostic,
    device: longDiagnostic,
    browser: longDiagnostic,
    os: longDiagnostic,
    steps_to_reproduce: longDiagnostic
  }, 'request']);
  validators['ai:processIssueWithByok']([{
    rawInput: 'Verbose diagnostics',
    taxonomy: {
      environment: longDiagnostic,
      device: longDiagnostic,
      browser: longDiagnostic,
      os: longDiagnostic
    }
  }, 'request']);

  boundaryAssert.throws(
    () => validators['ai:triageBug']([{ note: 'Too long', device: 'x'.repeat(5_001) }, 'request']),
    /Invalid IPC payload/i
  );
});

boundaryTest('destructive IPC rejects untrusted senders and malformed payloads', async () => {
  let registeredChannel = '';
  let registeredHandler: ((event: unknown, payload: unknown) => unknown) | undefined;
  const ipc = {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      registeredChannel = channel;
      registeredHandler = handler;
    }
  } as Parameters<typeof registerBugDeletionIpc>[0];
  const receivedIds: unknown[] = [];
  let changedEvents = 0;
  let toastEvents = 0;

  const secureIpc = createSecureIpcRegistrar(
    ipc,
    createIpcArgumentValidators(),
    (event) => (event as { senderFrame?: { url?: string } }).senderFrame?.url === 'file:///trusted/index.html'
  );
  registerBugDeletionIpc(secureIpc, {
    authorizeMutation: () => undefined,
    deleteBug: (id) => receivedIds.push(id),
    emitBugsChanged: () => { changedEvents += 1; },
    emitDeletedToast: () => { toastEvents += 1; }
  });

  boundaryAssert.equal(registeredChannel, deleteBugChannel);
  boundaryAssert.ok(registeredHandler, 'Expected the destructive IPC handler to be registered.');
  const untrustedEvent = { senderFrame: { url: 'https://attacker.invalid/' } };
  const malformedPayload = { id: 'not-a-number', unexpected: true };
  await boundaryAssert.rejects(
    Promise.resolve().then(() => registeredHandler!(untrustedEvent, 1)),
    /untrusted renderer frame/i
  );
  await boundaryAssert.rejects(
    Promise.resolve().then(() => registeredHandler!({ senderFrame: { url: 'file:///trusted/index.html' } }, malformedPayload)),
    /Invalid IPC payload/i
  );

  boundaryAssert.equal(receivedIds.length, 0);
  boundaryAssert.equal(changedEvents, 0);
  boundaryAssert.equal(toastEvents, 0);

  await registeredHandler({ senderFrame: { url: 'file:///trusted/index.html' } }, 42);
  boundaryAssert.deepEqual(receivedIds, [42]);
  boundaryAssert.equal(changedEvents, 1);
  boundaryAssert.equal(toastEvents, 1);
});

boundaryTest('every registered invoke channel has an explicit argument schema', () => {
  const mainSource = readBoundaryFile(resolveBoundaryPath(process.cwd(), 'src', 'main', 'index.ts'), 'utf8');
  const registeredChannels = [...mainSource.matchAll(/secureIpc\.handle\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  registeredChannels.push(deleteBugChannel, 'get-ai-config');
  const validators = createIpcArgumentValidators();

  boundaryAssert.ok(registeredChannels.length > 50, 'Expected the full main-process IPC surface to be inspected.');
  for (const channel of new Set(registeredChannels)) {
    boundaryAssert.equal(typeof validators[channel], 'function', `Missing IPC schema for ${channel}`);
  }
});

boundaryTest('all renderer windows deny remote navigation and spawned windows', () => {
  const mainSource = readBoundaryFile(resolveBoundaryPath(process.cwd(), 'src', 'main', 'index.ts'), 'utf8');
  boundaryAssert.match(mainSource, /webContents\.on\(['"]will-navigate['"],\s*guardNavigation\)/);
  boundaryAssert.match(mainSource, /webContents\.setWindowOpenHandler/);
  boundaryAssert.match(mainSource, /return \{ action: ['"]deny['"] \}/);
  boundaryAssert.equal((mainSource.match(/hardenRendererWindow\((?:mainWindow|quickWindow|snipWindow)\)/g) ?? []).length, 3);
  boundaryAssert.equal((mainSource.match(/sandbox:\s*true/g) ?? []).length, 3);
  boundaryAssert.equal((mainSource.match(/webSecurity:\s*true/g) ?? []).length, 3);
});

boundaryTest('renderer bridge cannot request absolute attachment paths for AI triage', () => {
  const preloadSource = readBoundaryFile(resolveBoundaryPath(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8');
  const sharedTypes = readBoundaryFile(resolveBoundaryPath(process.cwd(), 'src', 'shared', 'types.ts'), 'utf8');
  boundaryAssert.doesNotMatch(preloadSource, /attachments:resolvePath|resolveAttachmentPath/);
  boundaryAssert.doesNotMatch(sharedTypes, /image_file_path/);
  boundaryAssert.match(sharedTypes, /attachment_id\?: string/);
});
