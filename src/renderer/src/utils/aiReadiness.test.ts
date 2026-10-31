import test from 'node:test';
import assert from 'node:assert/strict';
import { AiReadinessMonitor, aiConfigurationReady, readAiReadiness, type AiReadiness } from './aiReadiness';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Presence deliberately includes invalid/revoked/undecryptable stored credentials.
// This pure predicate cannot establish authentication or native service health.
for (const nativeEnabled of [false, true]) {
  for (const credential of ['absent', 'decryptable', 'revoked', 'undecryptable'] as const) {
    test(`readiness state table: native ${nativeEnabled}, BYOK ${credential}`, () => {
      const hasByokKey = credential !== 'absent';
      const configuration = readAiReadiness({ hasApiKey: hasByokKey }, { aiTriageEnabled: nativeEnabled });
      assert.deepEqual(configuration, { status: 'known', hasByokKey, nativeEnabled });
      assert.equal(aiConfigurationReady(configuration), hasByokKey || nativeEnabled);
    });
  }
}

test('missing or malformed safe fields remain unknown, including enabled native with unknown key presence', () => {
  for (const config of [undefined, null, false, {}, { hasApiKey: undefined }, { hasApiKey: 'false' }, { hasApiKey: 0 }]) {
    assert.deepEqual(readAiReadiness(config, { aiTriageEnabled: true }), { status: 'unknown' });
  }
  for (const settings of [undefined, null, false, {}, { aiTriageEnabled: undefined }, { aiTriageEnabled: 'true' }, { aiTriageEnabled: 1 }]) {
    assert.deepEqual(readAiReadiness({ hasApiKey: true }, settings), { status: 'unknown' });
  }
  assert.equal(aiConfigurationReady({ status: 'unknown' }), false);
});

test('refresh rereads both safe sources for key Save/Clear, provider and native notifications', async () => {
  let key = false, native = false, configReads = 0, settingsReads = 0;
  const published: AiReadiness[] = [];
  const monitor = new AiReadinessMonitor(
    async () => { configReads++; return { hasApiKey: key }; },
    async () => { settingsReads++; return { aiTriageEnabled: native }; },
    value => published.push(value)
  );
  for (const state of [[false, false], [true, false], [false, false], [false, true], [true, true], [false, true], [false, false]]) {
    [key, native] = state;
    const refreshed = await monitor.refresh();
    assert.deepEqual(refreshed, { status: 'known', hasByokKey: key, nativeEnabled: native });
    assert.equal(monitor.isCurrent(refreshed), true);
  }
  assert.equal(configReads, 7);
  assert.equal(settingsReads, 7);
  assert.deepEqual(published.filter(value => value.status === 'unknown').length, 7);
  monitor.dispose();
});

test('a failed read invalidates prior readiness and does not infer absent BYOK from failure', async () => {
  let fail = false;
  const published: AiReadiness[] = [];
  const monitor = new AiReadinessMonitor(
    async () => { if (fail) throw new Error('synthetic read failure'); return { hasApiKey: true }; },
    async () => ({ aiTriageEnabled: true }),
    value => published.push(value)
  );
  const prior = await monitor.refresh();
  fail = true;
  const pending = monitor.refresh();
  assert.equal(monitor.isCurrent(prior), false, 'invalidation occurs before the new read settles');
  assert.deepEqual(await pending, { status: 'unknown' });
  assert.deepEqual(published.at(-1), { status: 'unknown' });
  assert.equal(monitor.isCurrent(published.at(-1)!), false);
  monitor.dispose();
});

test('settings read rejection and synchronous read failure fail closed', async () => {
  for (const synchronous of [false, true]) {
    const monitor = new AiReadinessMonitor(
      () => { if (synchronous) throw new Error('synthetic sync failure'); return Promise.resolve({ hasApiKey: false }); },
      async () => { throw new Error('synthetic settings failure'); },
      () => {}
    );
    assert.deepEqual(await monitor.refresh(), { status: 'unknown' });
    monitor.dispose();
  }
});

test('newer cross-window configuration wins over an older successful read', async () => {
  const config = [deferred<unknown>(), deferred<unknown>()];
  const settings = [deferred<unknown>(), deferred<unknown>()];
  let configIndex = 0, settingsIndex = 0;
  const published: AiReadiness[] = [];
  const monitor = new AiReadinessMonitor(() => config[configIndex++].promise, () => settings[settingsIndex++].promise, value => published.push(value));
  const old = monitor.refresh();
  const fresh = monitor.refresh();
  config[1].resolve({ hasApiKey: false }); settings[1].resolve({ aiTriageEnabled: false });
  const accepted = await fresh;
  config[0].resolve({ hasApiKey: true }); settings[0].resolve({ aiTriageEnabled: true });
  assert.deepEqual(await old, { status: 'unknown' });
  assert.deepEqual(published.at(-1), { status: 'known', hasByokKey: false, nativeEnabled: false });
  assert.equal(monitor.isCurrent(accepted), true);
  assert.equal(published.filter(value => value.status === 'known').length, 1);
  monitor.dispose();
});

test('an older failed read cannot replace newer known readiness', async () => {
  const first = deferred<unknown>();
  let reads = 0;
  const published: AiReadiness[] = [];
  const monitor = new AiReadinessMonitor(() => ++reads === 1 ? first.promise : Promise.resolve({ hasApiKey: false }), async () => ({ aiTriageEnabled: true }), value => published.push(value));
  const old = monitor.refresh();
  const fresh = await monitor.refresh();
  first.reject(new Error('late failure'));
  assert.deepEqual(await old, { status: 'unknown' });
  assert.equal(monitor.isCurrent(fresh), true);
  assert.equal(published.at(-1), fresh);
  monitor.dispose();
});

test('disposing during reads blocks late publication, currentness and future reads', async () => {
  const pendingConfig = deferred<unknown>();
  let reads = 0;
  const published: AiReadiness[] = [];
  const monitor = new AiReadinessMonitor(() => { reads++; return pendingConfig.promise; }, async () => ({ aiTriageEnabled: true }), value => published.push(value));
  const pending = monitor.refresh();
  monitor.dispose();
  pendingConfig.resolve({ hasApiKey: true });
  assert.deepEqual(await pending, { status: 'unknown' });
  assert.deepEqual(published, [{ status: 'unknown' }]);
  assert.equal(monitor.isCurrent({ status: 'known', hasByokKey: true, nativeEnabled: true }), false);
  assert.deepEqual(await monitor.refresh(), { status: 'unknown' });
  assert.equal(reads, 1);
});
