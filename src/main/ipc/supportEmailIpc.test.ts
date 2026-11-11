import assert from 'node:assert/strict';
import test from 'node:test';
import type { IpcMainInvokeEvent } from 'electron';
import { createIpcArgumentValidators, createSecureIpcRegistrar } from './secureIpc';
import { registerSupportEmailIpc, supportEmailChannel } from './supportEmailIpc';

function setup(requestComposer: (uri: string) => Promise<void>) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const trusted = {} as IpcMainInvokeEvent;
  const untrusted = {} as IpcMainInvokeEvent;
  const registrar = createSecureIpcRegistrar({
    handle(channel, listener) { handlers.set(channel, listener); }
  }, createIpcArgumentValidators(), (event) => event === trusted);
  registerSupportEmailIpc(registrar, requestComposer);
  return { invoke: handlers.get(supportEmailChannel)!, trusted, untrusted };
}

test('composer IPC constructs only the fixed recipient and subject in main', async () => {
  const requests: string[] = [];
  const { invoke, trusted } = setup(async (uri) => { requests.push(uri); });
  assert.deepEqual(await invoke(trusted), { requested: true });
  assert.deepEqual(requests, ['mailto:valisheik@examenqa.com?subject=Bug%20Pocket%20report']);
  const uri = new URL(requests[0]);
  assert.equal(uri.protocol, 'mailto:');
  assert.equal(uri.pathname, 'valisheik@examenqa.com');
  assert.deepEqual([...uri.searchParams], [['subject', 'Bug Pocket report']]);
  assert.equal(uri.searchParams.has('body'), false);
  assert.equal(uri.searchParams.has('attachment'), false);
});

test('composer IPC rejects untrusted senders and every unexpected argument before launch', () => {
  let calls = 0;
  const { invoke, trusted, untrusted } = setup(async () => { calls += 1; });
  assert.throws(() => invoke(untrusted), /untrusted renderer/);
  for (const value of [
    undefined, null, {}, [],
    'mailto:other@example.invalid',
    { recipient: 'other@example.invalid' },
    { subject: 'renderer subject' },
    { body: 'private report' },
    { url: 'https://example.invalid' }
  ]) {
    assert.throws(() => invoke(trusted, value), TypeError);
  }
  assert.throws(() => invoke(trusted, 'valisheik@examenqa.com', 'Bug Pocket report'), TypeError);
  assert.equal(calls, 0);
});

test('composer failure returns a manual-email fallback without a sending claim or raw error', async () => {
  const { invoke, trusted } = setup(async () => { throw new Error('private native details'); });
  const result = await invoke(trusted) as { requested: false; error: string };
  assert.equal(result.requested, false);
  assert.match(result.error, /report is kept/);
  assert.match(result.error, /Copy it and email valisheik@examenqa.com manually/);
  assert.doesNotMatch(result.error, /private native details|sent successfully|delivered|reviewed/);
});

test('generic external-link validation remains HTTP(S) only', () => {
  const validate = createIpcArgumentValidators()['shell:openExternal'];
  assert.doesNotThrow(() => validate(['https://example.invalid/path']));
  assert.doesNotThrow(() => validate(['http://localhost:8080/path']));
  for (const uri of [
    'mailto:valisheik@examenqa.com?subject=Bug%20Pocket%20report',
    'file:///C:/private.txt',
    'javascript:alert(1)',
    'data:text/plain,report'
  ]) assert.throws(() => validate([uri]), TypeError);
});
