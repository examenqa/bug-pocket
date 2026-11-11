import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendSupportText,
  createSupportDraftController,
  copySupportReport,
  getSupportDraftController,
  requestSupportEmail,
  selectedSupportText,
  supportPayloadForDraft,
  supportReportText
} from './supportDraft';

test('email report preview includes only the visible category, exact edited message and optional contact', () => {
  const reviewed = {
    category: 'ai_output' as const,
    message: '  Reviewed text\nwith my edits.  ',
    email: 'qa@example.invalid',
    bug_id: 'hidden bug',
    workspace_id: 'hidden workspace',
    attachments: ['hidden screenshot'],
    original_ai_output: 'unselected output'
  };
  assert.equal(supportReportText(reviewed),
    'Category: Inappropriate AI output\n\nMessage:\n  Reviewed text\nwith my edits.  \n\nContact email: qa@example.invalid');
  assert.equal(supportReportText({ ...reviewed, category: 'bug', email: '' }),
    'Category: Bug feedback\n\nMessage:\n  Reviewed text\nwith my edits.  ');
  assert.equal(supportReportText({ category: 'feature', message: 'Idea', email: '   ' }),
    'Category: Feature feedback\n\nMessage:\nIdea');
});

test('copy uses exactly the selectable preview through an injected clipboard without clearing a draft', async () => {
  const controller = createSupportDraftController('bug');
  controller.update({ message: 'Explicit report', email: 'qa@example.invalid' });
  const before = controller.getSnapshot();
  const copied: string[] = [];
  const result = await copySupportReport(before, async (text) => { copied.push(text); });
  assert.deepEqual(copied, [supportReportText(before)]);
  assert.equal(result.success, true);
  assert.match(result.message, /Report copied/);
  assert.equal(controller.getSnapshot(), before);
  controller.update({ message: '"'.repeat(9000), email: '' });
  let longCopy = '';
  const longResult = await copySupportReport(controller.getSnapshot(), async (text) => { longCopy = text; });
  assert.equal(longResult.success, true);
  assert.equal(longCopy, supportReportText(controller.getSnapshot()), 'plaintext copy has no JSON transport body');
});

test('clipboard failure keeps the exact preview and edited draft available for manual copying', async () => {
  const controller = createSupportDraftController('ai_output');
  controller.update({ message: 'Explicitly inserted and reviewed text' });
  const before = controller.getSnapshot();
  let attempted = '';
  const result = await copySupportReport(before, async (text) => {
    attempted = text;
    throw new Error('private clipboard diagnostic');
  });
  assert.equal(result.success, false);
  assert.match(result.message, /Select the report preview and copy it manually/);
  assert.doesNotMatch(result.message, /private clipboard diagnostic/);
  assert.equal(attempted, supportReportText(controller.getSnapshot()));
  const stop = controller.subscribe(() => {});
  stop(); // Close/reopen removes listeners, not the draft.
  assert.equal(controller.getSnapshot(), before);
  controller.update({ message: 'Still editable' });
  assert.equal(controller.getSnapshot().message, 'Still editable');
  assert.equal(controller.discard(), true);
  assert.equal(controller.getSnapshot().message, '');
});

test('composer fake receives no report data and success describes only a request', async () => {
  const controller = createSupportDraftController('feature');
  controller.update({ message: 'Keep private until pasted', email: 'qa@example.invalid' });
  const before = controller.getSnapshot();
  const calls: unknown[][] = [];
  const result = await requestSupportEmail(async (...args: unknown[]) => {
    calls.push(args);
    return { requested: true };
  });
  assert.deepEqual(calls, [[]]);
  assert.equal(result.success, true);
  assert.match(result.message, /Email-app request made/);
  assert.match(result.message, /If a composer appears/);
  assert.match(result.message, /Sending, delivery and review are not confirmed/);
  assert.equal(controller.getSnapshot(), before);
});

test('failed or malformed composer responses use the manual fallback without claiming a request succeeded', async () => {
  for (const reply of [undefined, null, {}, { success: true }, { requested: 'true' }, { requested: false, error: 'private error' }]) {
    const result = await requestSupportEmail(async () => reply);
    assert.equal(result.success, false);
    assert.match(result.message, /valisheik@examenqa.com manually/);
    assert.match(result.message, /draft has been kept/);
    assert.doesNotMatch(result.message, /private error|sent successfully|Email-app request made/);
  }
  const result = await requestSupportEmail(async () => { throw new Error('private failure'); });
  assert.equal(result.success, false);
  assert.doesNotMatch(result.message, /private failure/);
});

test('composer completion cannot replace edits made while a fake request is pending', async () => {
  const controller = createSupportDraftController('ai_output');
  let complete!: (value: unknown) => void;
  const pending = requestSupportEmail(() => new Promise((resolve) => { complete = resolve; }));
  controller.update({ category: 'bug', message: 'New reviewed text', email: 'qa@example.invalid' });
  const edited = controller.getSnapshot();
  complete({ requested: true });
  await pending;
  assert.equal(controller.getSnapshot(), edited);
});

test('opening an AI draft selects no report content and payload contains only explicit fields', () => {
  const controller = createSupportDraftController('ai_output');
  const options = [
    { id: 'note', label: 'Current bug note', text: 'selected synthetic note' },
    { id: 'other', label: 'Current other text', text: 'not selected' }
  ];
  assert.equal(controller.getSnapshot().message, '');
  assert.equal(selectedSupportText(options, []), '');
  const preview = selectedSupportText(options, ['note']);
  assert.equal(preview, 'Current bug note:\nselected synthetic note');
  assert.equal(controller.getSnapshot().message, '', 'preview does not insert content');
  controller.update({ message: appendSupportText('My description', preview) });
  const payload = supportPayloadForDraft(controller.getSnapshot());
  assert.equal(payload.message, 'My description\n\nCurrent bug note:\nselected synthetic note');
  assert.equal(payload.type, 'Bug');
  assert.equal(payload.report_kind, 'ai_output');
  assert.equal(payload.user_email, undefined);
  assert.deepEqual(Object.keys(payload).sort(), ['message', 'report_kind', 'type', 'user_email']);
  assert.equal(options[0].text, 'selected synthetic note', 'source current text is unchanged');
});

test('ordinary categories remain Bug/Feature and changing category keeps an editable draft', () => {
  const controller = createSupportDraftController('bug');
  controller.update({ message: 'Synthetic request', email: ' qa@example.invalid ' });
  controller.update({ category: 'feature' });
  assert.deepEqual(supportPayloadForDraft(controller.getSnapshot()), {
    type: 'Feature', report_kind: 'feedback', message: 'Synthetic request', user_email: 'qa@example.invalid'
  });
});

test('a failed attempt survives listener removal and resubscription until explicit discard', async () => {
  const controller = createSupportDraftController('bug');
  const stop = controller.subscribe(() => {});
  controller.update({ message: 'Keep this local draft', email: 'qa@example.invalid' });
  await controller.submit(async () => ({ success: false, delivery_status: 'not_sent', code: 'unavailable' }));
  stop(); // Dialog dismissal/route unmount removes its subscriber, not its draft.
  const resumed = controller.getSnapshot();
  assert.equal(resumed.message, 'Keep this local draft');
  assert.equal(resumed.email, 'qa@example.invalid');
  assert.equal(resumed.result?.delivery_status, 'not_sent');
  const stopAgain = controller.subscribe(() => {});
  assert.equal(controller.getSnapshot(), resumed);
  stopAgain();
  assert.equal(controller.discard(), true);
  assert.equal(controller.getSnapshot().message, '');
  assert.equal(controller.getSnapshot().email, '');
  assert.equal(controller.getSnapshot().result, null);
});

test('mode store is finite and preserves a deliberately written draft across view remounts', () => {
  const firstView = getSupportDraftController('ai_output');
  firstView.discard();
  firstView.update({ message: 'Explicit synthetic draft' });
  const nextView = getSupportDraftController('ai_output');
  assert.equal(nextView, firstView);
  assert.equal(nextView.getSnapshot().message, 'Explicit synthetic draft');
  assert.notEqual(getSupportDraftController('bug'), nextView);
  nextView.discard();
});

test('same-tick duplicate submission is locked and an unresolved attempt cannot discard or edit', async () => {
  const controller = createSupportDraftController('ai_output');
  controller.update({ message: 'One synthetic report' });
  let release: ((value: unknown) => void) | undefined;
  let calls = 0;
  const sender = async (): Promise<unknown> => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = controller.submit(sender);
  const second = controller.submit(sender);
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().isSubmitting, true);
  assert.equal(controller.discard(), false);
  controller.update({ message: 'must not overwrite in flight' });
  assert.equal(controller.getSnapshot().message, 'One synthetic report');
  release?.({ success: false, delivery_status: 'unknown', code: 'delivery_unknown' });
  assert.equal(await second, undefined);
  await first;
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().isSubmitting, false);
  assert.equal(controller.getSnapshot().message, 'One synthetic report');
  assert.equal(controller.getSnapshot().result?.delivery_status, 'unknown');
});

test('generic success cannot clear a draft and an ambiguous retry occurs only when explicitly invoked', async () => {
  const controller = createSupportDraftController('bug');
  controller.update({ message: 'Do not erase after malformed response' });
  let calls = 0;
  await controller.submit(async () => { calls += 1; return { success: true }; });
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().message, 'Do not erase after malformed response');
  assert.equal(controller.getSnapshot().result?.delivery_status, 'unknown');
  await controller.submit(async () => { calls += 1; throw new Error('synthetic private upstream diagnostic'); });
  assert.equal(calls, 2, 'second attempt requires an explicit second call');
  assert.equal(controller.getSnapshot().message, 'Do not erase after malformed response');
  assert.equal(controller.getSnapshot().result?.delivery_status, 'unknown');
  assert.ok(!controller.getSnapshot().result?.error?.includes('private upstream diagnostic'));
});

test('recognized recipient acknowledgement alone clears submitted content without claiming human review', async () => {
  const controller = createSupportDraftController('feature');
  controller.update({ message: 'Synthetic accepted content', email: 'qa@example.invalid' });
  const result = await controller.submit(async () => ({
    success: true,
    delivery_status: 'accepted_by_recipient',
    report_id: 'synthetic-report-001'
  }));
  assert.equal(result?.success, true);
  assert.equal(controller.getSnapshot().message, '');
  assert.equal(controller.getSnapshot().email, '');
  assert.equal(controller.getSnapshot().result?.delivery_status, 'accepted_by_recipient');
});
