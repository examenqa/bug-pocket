import assert from 'node:assert/strict';
import test from 'node:test';
import type { IpcMainInvokeEvent } from 'electron';
import { createIpcArgumentValidators, createSecureIpcRegistrar } from './secureIpc';

const payload = { type: 'Bug', message: 'Disposable synthetic report' };

test('support IPC shares category, UTF-8, escaping and explicit image restrictions', () => {
  const validate = createIpcArgumentValidators()['support:sendFeedback'];
  for (const value of [payload, { ...payload, type: 'Feature' }, { ...payload, report_kind: 'ai_output' }]) {
    assert.doesNotThrow(() => validate([value]));
  }
  for (const value of [
    { ...payload, report_kind: 'unexpected' },
    { ...payload, type: 'Feature', report_kind: 'ai_output' },
    { ...payload, message: '🚀'.repeat(2501) },
    { ...payload, message: '"'.repeat(9000) },
    { ...payload, user_email: 'invalid' },
    { ...payload, image_base64: '' },
    { ...payload, image_mime_type: 'image/png' },
    { ...payload, image_url: 'https://example.invalid/image' },
    { ...payload, hidden_report: { credentials: 'synthetic only' } }
  ]) {
    assert.throws(() => validate([value]), TypeError);
  }
  assert.throws(() => validate([]), TypeError);
  assert.throws(() => validate([payload, payload]), TypeError);
});

test('trusted sender and argument checks still run before any support listener', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const ipc = {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any) {
      handlers.set(channel, listener);
    }
  };
  const trusted = {} as IpcMainInvokeEvent;
  const untrusted = {} as IpcMainInvokeEvent;
  let calls = 0;
  const registrar = createSecureIpcRegistrar(ipc, createIpcArgumentValidators(), event => event === trusted);
  registrar.handle('support:sendFeedback', () => { calls += 1; return 'synthetic result'; });
  const invoke = handlers.get('support:sendFeedback')!;
  assert.throws(() => invoke(untrusted, payload), /untrusted renderer/);
  assert.throws(() => invoke(trusted, { ...payload, image_base64: 'refused' }), TypeError);
  assert.equal(calls, 0);
  assert.equal(invoke(trusted, payload), 'synthetic result');
  assert.equal(calls, 1);
});
