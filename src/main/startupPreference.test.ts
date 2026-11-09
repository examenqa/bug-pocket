// Offline fixtures only. NOT RUN during regular-account source preparation.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAppUserModelId, isStoreExecution, readStartupStatus,
  requestStartupPreference, restoreStartupPreference, STORE_STARTUP_TASK_ID
} from './startupPreference';
import {
  createStoreStartupController, isStartupSecondInstance, mapStoreActivation,
  mapStoreStartupResult, shouldShowLaunchWindow, type StoreStartupBridge
} from './storeStartup';

const ordinary = { platform: 'win32' };
const store = { platform: 'win32', windowsStore: true };
const backgroundArg = '--background-start';

function fixture(openAtLogin = false, executableWillLaunchAtLogin = openAtLogin) {
  const state = { openAtLogin, executableWillLaunchAtLogin };
  const reads: { args: string[] }[] = [];
  const writes: { openAtLogin: boolean; args: string[] }[] = [];
  const api = {
    getLoginItemSettings(options: { args: string[] }) {
      reads.push(options);
      return {
        ...state,
        launchItems: state.openAtLogin
          ? [{ name: 'com.bugpocket.app', args: [backgroundArg], scope: 'user', enabled: state.executableWillLaunchAtLogin }]
          : []
      };
    },
    setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }) {
      writes.push(settings);
      state.openAtLogin = settings.openAtLogin;
      state.executableWillLaunchAtLogin = settings.openAtLogin;
    }
  };
  return { state, reads, writes, api };
}

test('AppX/MSIX identity selects the Store AUMID without changing ordinary identity', () => {
  assert.equal(getAppUserModelId(store), 'ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket');
  assert.equal(getAppUserModelId(ordinary), 'com.bugpocket.app');
  assert.equal(isStoreExecution({ platform: 'win32', windowsStore: false }), false);
  assert.equal(isStoreExecution({ platform: 'darwin', windowsStore: true }), false);
});

test('Store reads, explicit changes and launch restoration never use registry login APIs', () => {
  const { api, reads, writes } = fixture();
  for (const enabled of [false, true]) {
    const status = requestStartupPreference(store, api, backgroundArg, enabled);
    assert.equal(status.state, 'unsupported');
    assert.equal(status.enabled, null, 'Unknown task state cannot confirm either preference.');
    assert.equal(status.taskId, STORE_STARTUP_TASK_ID);
    restoreStartupPreference(store, api, backgroundArg, enabled);
  }
  assert.equal(readStartupStatus(store, api, backgroundArg).mode, 'store');
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
});

test('ordinary opt-in/out retains background arguments and reports OS read-back', () => {
  const { api, reads, writes } = fixture();
  assert.equal(requestStartupPreference(ordinary, api, backgroundArg, true).enabled, true);
  assert.equal(requestStartupPreference(ordinary, api, backgroundArg, false).enabled, false);
  assert.deepEqual(writes, [
    { openAtLogin: true, args: [backgroundArg] },
    { openAtLogin: false, args: [] }
  ]);
  assert.ok(reads.every(options => options.args[0] === backgroundArg));
});

test('a silent no-op from the login setter does not report enablement', () => {
  const { api } = fixture();
  api.setLoginItemSettings = () => undefined;
  const result = requestStartupPreference(ordinary, api, backgroundArg, true);
  assert.equal(result.enabled, false);
  assert.match(result.message, /did not confirm enabling/);
});

test('Windows-disabled startup survives repeated launches and explicit enable retries', () => {
  const { api, writes } = fixture(true, false);
  restoreStartupPreference(ordinary, api, backgroundArg, true);
  restoreStartupPreference(ordinary, api, backgroundArg, true);
  assert.equal(requestStartupPreference(ordinary, api, backgroundArg, true).state, 'blocked');
  assert.deepEqual(writes, [], 'Do not clear Windows startup approval restrictions.');
  assert.equal(requestStartupPreference(ordinary, api, backgroundArg, false).state, 'disabled');
  assert.deepEqual(writes, [{ openAtLogin: false, args: [] }]);
});

test('ordinary launch restoration avoids redundant writes and can remove a blocked registration', () => {
  const enabled = fixture(true, true);
  restoreStartupPreference(ordinary, enabled.api, backgroundArg, true);
  assert.deepEqual(enabled.writes, []);
  const blocked = fixture(true, false);
  restoreStartupPreference(ordinary, blocked.api, backgroundArg, false);
  assert.deepEqual(blocked.writes, [{ openAtLogin: false, args: [] }]);
});

test('unreadable OS status is unknown and prevents unconfirmed writes', () => {
  const { api, writes } = fixture();
  api.getLoginItemSettings = () => { throw new Error('unavailable'); };
  const result = requestStartupPreference(ordinary, api, backgroundArg, true);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.enabled, null);
  restoreStartupPreference(ordinary, api, backgroundArg, true);
  assert.deepEqual(writes, []);
});

test('another approved entry cannot hide Windows disabling our background-start entry', () => {
  const { api, writes } = fixture(true, true);
  for (const ownArgs of [[backgroundArg], ['--different-argument']]) {
    api.getLoginItemSettings = () => ({
      openAtLogin: ownArgs[0] === backgroundArg,
      executableWillLaunchAtLogin: true,
      launchItems: [
        { name: 'com.bugpocket.app', args: ownArgs, scope: 'user', enabled: false },
        { name: 'another-entry', args: [], scope: 'user', enabled: true }
      ]
    });
    assert.equal(readStartupStatus(ordinary, api, backgroundArg).state, 'blocked');
    restoreStartupPreference(ordinary, api, backgroundArg, true);
    assert.equal(requestStartupPreference(ordinary, api, backgroundArg, true).enabled, false);
  }
  assert.deepEqual(writes, []);
});

test('missing approval metadata cannot confirm enablement or authorise another write', () => {
  const { api, writes } = fixture(true, true);
  api.getLoginItemSettings = () => ({ openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [] });
  assert.equal(requestStartupPreference(ordinary, api, backgroundArg, true).enabled, null);
  assert.deepEqual(writes, []);
});

const nativeResult = (state: string, enabled: boolean | null) => ({
  taskId: STORE_STARTUP_TASK_ID, identityVerified: true, state, enabled
});

test('Store state feedback distinguishes Windows user and policy controls', () => {
  for (const [state, enabled, canEnable, canDisable] of [
    ['disabled', false, true, true], ['enabled', true, true, true],
    ['disabledByUser', false, false, true], ['disabledByPolicy', false, false, false],
    ['enabledByPolicy', true, false, false]
  ] as const) {
    const result = mapStoreStartupResult(nativeResult(state, enabled));
    assert.equal(result.state, state);
    assert.equal(result.enabled, enabled);
    assert.equal(result.canEnable, canEnable);
    assert.equal(result.canDisable, canDisable);
  }
});

test('wrong package identity, wrong task, malformed state and bridge errors cannot confirm startup', () => {
  for (const value of [
    { ...nativeResult('enabled', true), identityVerified: false },
    { ...nativeResult('enabled', true), taskId: 'another-task' },
    nativeResult('enabled', false), nativeResult('error', null), null
  ]) assert.equal(mapStoreStartupResult(value).enabled, null);
  assert.equal(mapStoreStartupResult(nativeResult('unsupported', null)).state, 'unsupported');
  const denied = mapStoreStartupResult({ ...nativeResult('error', null), errorCode: 'access_denied' });
  assert.equal(denied.enabled, null);
  assert.match(denied.message, /Windows denied access/);
});

test('Store activation is quiet only for Windows-confirmed exact-task activation', () => {
  const activation = { taskId: STORE_STARTUP_TASK_ID, identityVerified: true, activationKnown: true, startupActivation: true };
  const startup = mapStoreActivation(activation);
  assert.equal(shouldShowLaunchWindow(true, startup, false), false);
  assert.equal(shouldShowLaunchWindow(true, mapStoreActivation({ ...activation, startupActivation: false }), true), true);
  for (const value of [null, { ...activation, identityVerified: false }, { ...activation, taskId: 'other' }, { ...activation, activationKnown: false }]) {
    assert.equal(shouldShowLaunchWindow(true, mapStoreActivation(value), true), true);
  }
  assert.equal(shouldShowLaunchWindow(false, startup, false), true);
  assert.equal(shouldShowLaunchWindow(false, startup, true), false);
});

test('only a fixed startup marker suppresses an existing Store window activation', () => {
  const marker = { bugPocketStartup: 1, taskId: STORE_STARTUP_TASK_ID, identityVerified: true, startupActivation: true };
  assert.equal(isStartupSecondInstance(marker), true);
  for (const value of [null, {}, { ...marker, identityVerified: false }, { ...marker, startupActivation: false }, { ...marker, taskId: 'other' }, { ...marker, bugPocketStartup: '1' }]) {
    assert.equal(isStartupSecondInstance(value), false);
  }
});

test('Store reads and activation never enable startup; explicit requests use actual returned state', async () => {
  const calls: string[] = [];
  const bridge: StoreStartupBridge = {
    read: async () => { calls.push('read'); return nativeResult('disabled', false); },
    enable: async () => { calls.push('enable'); return nativeResult('disabledByUser', false); },
    disable: async () => { calls.push('disable'); return nativeResult('disabled', false); },
    activation: async () => { calls.push('activation'); return { taskId: STORE_STARTUP_TASK_ID, identityVerified: true, activationKnown: true, startupActivation: false }; }
  };
  const controller = createStoreStartupController(() => bridge);
  await controller.activation();
  await controller.read();
  assert.deepEqual(calls, ['activation', 'read']);
  assert.equal((await controller.set(true)).state, 'disabledByUser');
  assert.equal((await controller.set(false)).enabled, false);
  assert.deepEqual(calls, ['activation', 'read', 'enable', 'disable']);
});

test('Store queue serializes native work and shutdown drains without starting new requests', async () => {
  const calls: string[] = [];
  let finishRead!: (value: unknown) => void;
  const bridge: StoreStartupBridge = {
    read: () => { calls.push('read'); return new Promise(resolve => { finishRead = resolve; }); },
    enable: async () => { calls.push('enable'); return nativeResult('enabled', true); },
    disable: async () => nativeResult('disabled', false),
    activation: async () => null
  };
  const controller = createStoreStartupController(() => bridge);
  const read = controller.read();
  const enable = controller.set(true);
  await Promise.resolve();
  const closing = controller.close();
  await assert.rejects(controller.read(), /shutting down/);
  assert.deepEqual(calls, ['read']);
  finishRead(nativeResult('disabled', false));
  await Promise.all([read, enable, closing]);
  assert.deepEqual(calls, ['read', 'enable']);
  controller.resume();
  assert.equal((await controller.set(false)).enabled, false);
});

test('missing or failing native bridge is unavailable and cannot misclassify a manual launch', async () => {
  const controller = createStoreStartupController(() => { throw new Error('missing addon'); });
  assert.equal((await controller.read()).enabled, null);
  assert.equal((await controller.set(true)).state, 'unavailable');
  assert.deepEqual(await controller.activation(), { identityVerified: false, activationKnown: false, startupActivation: false });
});
