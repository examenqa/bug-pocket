'use strict';
// Deterministic host-only fixtures: no application process, socket, Electron,
// native addon, SQLite connection or network request is created by this suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const recovery = require('./test-runtime-storage-recovery.cjs');
const { EXPECTED_VERSIONS } = require('./validation-paths.cjs');
const { cleanupAfterClose } = require('./validation-process-lifecycle.cjs');

const absolute = name => path.resolve('synthetic-recovery-fixtures', name);
const expectedRecord = extra => ({ title: 'Bug Pocket could not start', message: recovery.STARTUP_ERROR, phase: 'unavailable',
  expected: true, sqliteOpenAttempts: 0, encryptAttempts: 0, decryptAttempts: 0, ...extra });
const dialogLine = record => recovery.DIALOG_MARKER + JSON.stringify(record) + '\n';
const identity = { executable: absolute('electron-fixture.txt'), sha256: 'a'.repeat(64) };
const native = { binding: absolute('native-fixture.txt'), sha256: 'b'.repeat(64), packageVersion: '12.11.1' };
const baselineBinary = { executable: { path: identity.executable, sha256: identity.sha256 }, sourceNative: native };

function injectionFixture(phase) {
  const app = new EventEmitter();
  const originalAvailable = () => true;
  const originalLoad = () => class FakeDatabase {};
  const Module = { _load: originalLoad };
  const electron = { app, safeStorage: { isEncryptionAvailable: originalAvailable, encryptString: () => {}, decryptString: () => {} },
    dialog: { showErrorBox: () => { throw new Error('Native modal must never be invoked by this fixture'); } } };
  let output = '';
  const context = { require(name) { if (name === 'electron') return electron; if (name === 'node:module') return Module; throw new Error('Unexpected fixture import ' + name); },
    process: { stdout: { write: value => { output += value; } } }, Proxy, Error };
  const result = vm.runInNewContext(recovery.callExpression(recovery.installStartupInjection,
    { phase, expectedError: recovery.STARTUP_ERROR, marker: recovery.DIALOG_MARKER }), context);
  return { app, electron, Module, originalLoad, originalAvailable, result, output: () => output };
}

test('recovery CLI requires external absolute metadata inputs and rejects older-writer/duplicate/unknown arguments', () => {
  const args = ['--profile-root=' + absolute('profiles'), '--evidence=' + absolute('evidence.json'),
    '--electron=' + identity.executable, '--verification=' + absolute('verification.json')];
  assert.deepEqual(recovery.parseCli(args).modes, ['start', 'packaged']);
  assert.throws(() => recovery.parseCli([...args, '--old-writer=' + absolute('old.exe')]), /Unknown/);
  assert.throws(() => recovery.parseCli([...args, '--electron=' + identity.executable]), /Duplicate/);
  assert.throws(() => recovery.parseCli(args.filter(value => !value.startsWith('--verification='))), /verification/);
  assert.throws(() => recovery.parseCli([...args, '--modes=start,start']), /Duplicate/);
  assert.throws(() => recovery.parseCli([...args, '--modes=dev']), /Only/);
});

test('pre-import unavailable injection captures the exact error without opening a native modal', () => {
  const fixture = injectionFixture('unavailable');
  assert.equal(fixture.electron.safeStorage.isEncryptionAvailable(), false);
  assert.equal(fixture.result.serviceOrProductionFlagChanged, false);
  fixture.electron.dialog.showErrorBox('Bug Pocket could not start', recovery.STARTUP_ERROR);
  assert.equal(recovery.assertExpectedStartupError(fixture.output()).expected, true);
  fixture.app.emit('will-quit');
  assert.equal(fixture.Module._load, fixture.originalLoad);
});

test('unavailable injection detects SQLite-open and crypto attempts rather than silently permitting them', () => {
  const fixture = injectionFixture('unavailable');
  const Database = fixture.Module._load('better-sqlite3');
  assert.throws(() => new Database(), /before.*availability gate/);
  assert.throws(() => fixture.electron.safeStorage.encryptString('synthetic'), /Encryption attempted/);
  assert.throws(() => fixture.electron.safeStorage.decryptString(Buffer.from('synthetic')), /Decryption attempted/);
  fixture.electron.dialog.showErrorBox('Bug Pocket could not start', recovery.STARTUP_ERROR);
  assert.throws(() => recovery.assertExpectedStartupError(fixture.output()), /must stay zero/);
});

test('seed and recovery injection retain real storage methods and capture unexpected dialogs as failures', () => {
  for (const phase of ['seed', 'recovery']) {
    const fixture = injectionFixture(phase);
    assert.equal(fixture.electron.safeStorage.isEncryptionAvailable, fixture.originalAvailable);
    assert.equal(fixture.Module._load, fixture.originalLoad);
    fixture.electron.dialog.showErrorBox('Unexpected', 'synthetic failure');
    assert.equal(recovery.parseDialogs(fixture.output())[0].expected, false);
    assert.throws(() => recovery.assertExpectedStartupError(fixture.output()), /Unexpected startup error/);
  }
});

test('markers alone cannot disguise wrong error, multiple dialogs, or opening SQLite', () => {
  assert.throws(() => recovery.assertExpectedStartupError('passed\n'), /exactly one/);
  assert.throws(() => recovery.assertExpectedStartupError(dialogLine(expectedRecord({ message: 'wrong' }))), /strictly equal/);
  assert.throws(() => recovery.assertExpectedStartupError(dialogLine(expectedRecord()) + dialogLine(expectedRecord())), /exactly one/);
  assert.throws(() => recovery.assertExpectedStartupError(dialogLine(expectedRecord({ sqliteOpenAttempts: 1 }))), /must stay zero/);
});

test('database snapshot compares raw bytes and missing WAL/SHM identities', () => {
  const bytes = Buffer.from('inert database-shaped fixture');
  const snapshot = recovery.databaseSnapshot(absolute('profile'), { exists: file => file.endsWith('local.sqlite'), read: () => bytes });
  assert.equal(snapshot['local.sqlite'].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(snapshot['local.sqlite-wal'], null);
  recovery.assertDatabaseUnchanged(snapshot, structuredClone(snapshot));
  assert.throws(() => recovery.assertDatabaseUnchanged(snapshot, { ...snapshot, 'local.sqlite-wal': { bytes: 1, sha256: 'different' } }), /changed/);
});

function phaseFixture(phase, overrides = {}) {
  let output = phase === 'unavailable' ? dialogLine(expectedRecord()) : '';
  const isolated = { versions: { ...EXPECTED_VERSIONS }, platform: 'win32', arch: 'x64', executable: identity.executable, pid: 41, userData: absolute('profile') };
  const session = { command: ['synthetic-no-process'], isolation: isolated, stdout: () => output, stderr: () => '',
    main: { evaluate: async expression => expression.includes('persistenceOperation') ?
      { ok: true, value: { phase, seeded: phase === 'seed', unseededReader: phase === 'recovery', session: true, byok: true,
        ciphertextSha256: 'session-sha', byokCiphertextSha256: 'key-sha' } } : true },
    finish: async error => ({ error, diagnostics: error?.diagnostics || [], terminationConfirmed: true, processes: [{ pid: 41, confirmedClosed: true }] }) };
  const dependencies = {
    captureBinaries: () => structuredClone(baselineBinary),
    waitUntil: async check => assert.ok(await check(), 'Synthetic wait fixture did not become ready'),
    createSession: async options => {
      try { await options.beforeImport({ isolation: isolated, evaluate: async () => ({ injected: true }) }); }
      catch (error) { error.sessionResult = await session.finish(error); throw error; }
      return session;
    }
  };
  Object.assign(session, overrides.session || {});
  Object.assign(dependencies, overrides.dependencies || {});
  return { session, dependencies, isolated, append: value => { output += value; },
    options: { mode: 'start', phase, profile: absolute('profile'), userData: absolute('profile-dev'),
      identity, native, baselineBinary, assertOwned: () => {} } };
}

test('phase records actual measured isolation and per-phase binary identity', async () => {
  const fixture = phaseFixture('seed');
  const result = await recovery.runRecoveryPhase(fixture.options, fixture.dependencies);
  assert.equal(result.lifecycle.terminationConfirmed, true);
  assert.equal(result.isolationBeforeUserCode.pid, 41);
  assert.equal(result.isolationBeforeUserCode.versions.modules, '150');
  assert.deepEqual(result.binaryIdentity, baselineBinary);
});

test('wrong measured ABI fails before pre-import injection or data operation', async () => {
  const fixture = phaseFixture('seed');
  fixture.isolated.versions.modules = '148';
  await assert.rejects(recovery.runRecoveryPhase(fixture.options, fixture.dependencies), /Wrong measured modules/);
});

test('changed executable identity fails before any session launch', async () => {
  const fixture = phaseFixture('seed');
  let launched = false;
  fixture.dependencies.captureBinaries = () => ({ changed: true });
  fixture.dependencies.createSession = async () => { launched = true; throw new Error('must not launch'); };
  await assert.rejects(recovery.runRecoveryPhase(fixture.options, fixture.dependencies), /identity changed before launch/);
  assert.equal(launched, false);
});

test('misleading operation success cannot pass an unconfirmed wrapper or child close', async () => {
  const fixture = phaseFixture('seed', { session: { finish: async () => ({ terminationConfirmed: false, diagnostics: [], processes: [] }) } });
  await assert.rejects(recovery.runRecoveryPhase(fixture.options, fixture.dependencies), error => {
    assert.equal(error.terminationConfirmed, false);
    assert.equal(error.storageRecoveryPhase.lifecycle.terminationConfirmed, false);
    return true;
  });
});

test('late unexpected dialog after earlier success fails final closed-output validation', async () => {
  const fixture = phaseFixture('unavailable');
  fixture.session.finish = async error => {
    fixture.append(dialogLine(expectedRecord({ expected: false, message: 'late unexpected failure' })));
    return { error, terminationConfirmed: true, diagnostics: [], processes: [] };
  };
  await assert.rejects(recovery.runRecoveryPhase(fixture.options, fixture.dependencies), /exactly one/);
});

test('primary operation error survives thrown finish failure and late dialog diagnostics', async () => {
  const primary = new Error('first synthetic operation failure');
  const fixture = phaseFixture('seed');
  fixture.session.main.evaluate = async () => { throw primary; };
  fixture.session.finish = async () => { fixture.append(dialogLine(expectedRecord())); throw new Error('secondary finish failure'); };
  await assert.rejects(recovery.runRecoveryPhase(fixture.options, fixture.dependencies), error => {
    assert.equal(error, primary);
    assert.equal(error.terminationConfirmed, false);
    assert.ok(error.diagnostics.some(value => value.includes('secondary finish')));
    assert.ok(error.diagnostics.some(value => value.includes('Unexpected startup dialog')));
    return true;
  });
});

function scenarioFixture() {
  const snapshot = { 'local.sqlite': { bytes: 1, sha256: 'unchanged' }, 'local.sqlite-wal': null, 'local.sqlite-shm': null };
  const calls = [];
  const dependencies = { mkdir: () => {}, snapshot: () => structuredClone(snapshot),
    runPhase: async ({ phase }) => {
      calls.push(phase);
      return { phase, result: { seeded: phase === 'seed', unseededReader: phase === 'recovery',
        ciphertextSha256: 'session', byokCiphertextSha256: 'byok' }, lifecycle: { terminationConfirmed: true, processes: [] } };
    } };
  return { calls, dependencies, options: { mode: 'start', directory: absolute('scenario'), identity, native, baselineBinary, assertOwned: () => {} } };
}

test('scenario orders three same-version launches and keeps recovery unseeded', async () => {
  const fixture = scenarioFixture();
  const result = await recovery.runRecoveryScenario(fixture.options, fixture.dependencies);
  assert.deepEqual(fixture.calls, ['seed', 'unavailable', 'recovery']);
  assert.equal(result.phases[2].result.unseededReader, true);
  assert.equal(result.databaseUnchangedWhileUnavailable, true);
});

test('completed writer close does not authorize cleanup for a failed phase with no closure proof', async () => {
  const fixture = scenarioFixture();
  const runPhase = fixture.dependencies.runPhase;
  fixture.dependencies.runPhase = async options => {
    if (options.phase === 'unavailable') throw new Error('unknown child state');
    return runPhase(options);
  };
  await assert.rejects(recovery.runRecoveryScenario(fixture.options, fixture.dependencies), error => {
    assert.equal(error.terminationConfirmed, false);
    assert.equal(error.storageRecoveryScenario.phases.length, 1);
    return true;
  });
});

test('scenario refuses changed database bytes and stops before recovery launch', async () => {
  const fixture = scenarioFixture();
  let snapshots = 0;
  fixture.dependencies.snapshot = () => ({ 'local.sqlite': { bytes: ++snapshots, sha256: 'different' } });
  await assert.rejects(recovery.runRecoveryScenario(fixture.options, fixture.dependencies), /changed SQLite/);
  assert.deepEqual(fixture.calls, ['seed', 'unavailable']);
});

test('scenario rejects a reader that changes the original ciphertext', async () => {
  const fixture = scenarioFixture();
  const runPhase = fixture.dependencies.runPhase;
  fixture.dependencies.runPhase = async options => {
    const result = await runPhase(options);
    if (options.phase === 'recovery') result.result.ciphertextSha256 = 'reseeded';
    return result;
  };
  await assert.rejects(recovery.runRecoveryScenario(fixture.options, fixture.dependencies), /reseeded or changed/);
});

function persistenceFixture({ preseed = false, failRead, failClose } = {}) {
  const values = new Map();
  const writes = [];
  let key = preseed ? 'encrypted-key' : '';
  let closeCalls = 0;
  const options = { phase: preseed ? 'recovery' : 'seed', sourceRoot: absolute('source'),
    userData: absolute('profile'), sessionKey: 'synthetic-session-key', sessionValue: 'synthetic-session', apiKey: 'synthetic-api-key' };
  const crypto = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('encrypted:' + value),
    decryptString: value => value.toString().slice('encrypted:'.length) };
  if (preseed) values.set(options.sessionKey, crypto.encryptString(options.sessionValue));
  class Database {
    constructor() { this.localDb = { pragma: () => 'ok', prepare: () => ({ get: () => ({ version: 'synthetic-sqlite' }) }) }; }
    getEncryptedSupabaseAuthItem(name) { return values.get(name) || null; }
    getEncryptedByokAiApiKey() { return key; }
    close() { closeCalls++; if (failClose) throw failClose; }
  }
  class Adapter {
    constructor(database, storage) { this.database = database; this.storage = storage; }
    getItem(name) {
      if (failRead) throw failRead;
      const value = values.get(name);
      if (!value) return null;
      if (!this.storage.isEncryptionAvailable()) throw new Error('Secure session storage is unavailable');
      try { return this.storage.decryptString(value); } catch { values.delete(name); return null; }
    }
    setItem(name, value) { writes.push(name); values.set(name, this.storage.encryptString(value)); }
  }
  const sourceRequire = name => {
    if (name === 'tsx/cjs') return {};
    if (name.endsWith('database.ts')) return { BugPocketDatabase: Database };
    if (name.endsWith('SafeStorageAdapter.ts')) return { SafeStorageAdapter: Adapter };
    if (name.endsWith('byokIssueProcessor.ts')) return { saveByokAiConfig: () => { key = 'encrypted-key'; } };
    if (name.endsWith('byokConfigResponse.ts')) return { decryptStoredApiKey: () => options.apiKey };
    throw new Error('Unexpected source fixture import ' + name);
  };
  const context = { Buffer, console, require(name) {
    if (name === 'node:assert/strict') return assert;
    if (name === 'node:fs') return { existsSync: () => false };
    if (name === 'node:path') return path;
    if (name === 'node:crypto') return require('node:crypto');
    if (name === 'node:module') return { createRequire: () => sourceRequire };
    if (name === 'electron') return { app: { getPath: () => options.userData }, safeStorage: crypto };
    throw new Error('Unexpected isolated import ' + name);
  } };
  return { run: () => vm.runInNewContext(recovery.callExpression(recovery.persistenceOperation, options), context),
    writes, closeCalls: () => closeCalls };
}

test('actual persistence-operation reader logic never seeds any key', () => {
  const fixture = persistenceFixture({ preseed: true });
  const result = fixture.run();
  assert.equal(result.seeded, false);
  assert.equal(result.unseededReader, true);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.closeCalls(), 1);
});

test('fixture database close error is diagnostic when an earlier operation failed', () => {
  const primary = new Error('original synthetic read failure');
  const fixture = persistenceFixture({ failRead: primary, failClose: new Error('secondary synthetic database close failure') });
  assert.throws(fixture.run, error => {
    assert.equal(error, primary);
    assert.ok(error.diagnostics.some(value => value.includes('secondary synthetic database close')));
    return true;
  });
});

function mainFixture(scenario) {
  let removed = 0;
  const saved = [];
  const context = { profile: absolute('owned-profile'), assertOwned: () => {}, removeProfile: async () => { removed++; },
    writeEvidence: value => { saved.push(structuredClone(value)); } };
  return { args: ['--profile-root=' + absolute('profiles'), '--evidence=' + absolute('evidence.json'),
    '--electron=' + identity.executable, '--verification=' + absolute('verification.json'), '--modes=start'],
    dependencies: { verify: () => identity, nativeIdentity: () => native, captureBinaries: () => baselineBinary,
      preparePaths: () => context, scenario, cleanup: (receipt, options) => cleanupAfterClose(receipt, { ...options, wait: async () => {} }) },
    context, saved, removed: () => removed };
}
const closedScenario = async () => ({ mode: 'start', phases: recovery.PHASES.map(phase => ({ phase, lifecycle: { terminationConfirmed: true, processes: [] } })) });

test('top-level recovery report deletes only after every phase closure and owned-path check', async () => {
  const fixture = mainFixture(closedScenario);
  const result = await recovery.main(fixture.args, fixture.dependencies);
  assert.equal(fixture.removed(), 1);
  assert.equal(result.profileRemoved, true);
  assert.equal(fixture.saved.at(-1).lifecycle.terminationConfirmed, true);
});

test('top-level unknown child state retains profile and preserves first failure', async () => {
  const primary = new Error('unconfirmed synthetic child');
  primary.terminationConfirmed = false;
  const fixture = mainFixture(async () => { throw primary; });
  await assert.rejects(recovery.main(fixture.args, fixture.dependencies), error => error === primary);
  assert.equal(fixture.removed(), 0);
  assert.equal(primary.retainedProfile, fixture.context.profile);
});

test('top-level first failure survives cleanup exhaustion and records the retained profile', async () => {
  const primary = new Error('first confirmed synthetic failure');
  primary.terminationConfirmed = true;
  const fixture = mainFixture(async () => { throw primary; });
  let attempts = 0;
  fixture.context.removeProfile = async () => { attempts++; throw Object.assign(new Error('synthetic profile busy'), { code: 'EBUSY' }); };
  await assert.rejects(recovery.main(fixture.args, fixture.dependencies), error => error === primary);
  assert.equal(attempts, 4);
  assert.equal(primary.retainedProfile, fixture.context.profile);
  assert.ok(primary.diagnostics.some(value => value.includes('synthetic profile busy')));
});


test('remote result envelope preserves first error type/message and database-close diagnostics', () => {
  function remoteFailure() {
    const error = new Error('first synthetic remote failure');
    error.name = 'SyntheticAssertionError';
    error.diagnostics = ['Close fixture database: synthetic close failure'];
    throw error;
  }
  const envelope = vm.runInNewContext(recovery.reportedOperationExpression(remoteFailure, {}));
  assert.throws(() => recovery.unwrapOperationResult(envelope), error => {
    assert.equal(error.name, 'SyntheticAssertionError');
    assert.equal(error.message, 'first synthetic remote failure');
    assert.ok(error.diagnostics[0].includes('synthetic close failure'));
    return true;
  });
});

test('binary identity distinguishes packaged EXE and pins its unpacked native binding', () => {
  const sourceRoot = absolute('source');
  const binding = path.join(sourceRoot, 'native-fixture.txt');
  const fixtureNative = { ...native, binding };
  const hashes = new Map([[identity.executable, identity.sha256], [binding, native.sha256]]);
  const dependencies = {
    guard: { check: file => file },
    nativeIdentity: () => fixtureNative,
    stat: () => ({ size: 5 }),
    hash: file => hashes.get(file) || (file.endsWith('better_sqlite3.node') ? native.sha256 : 'packaged-or-source-' + file)
  };
  const record = recovery.captureBinaryIdentity({ mode: 'packaged', identity, native: fixtureNative, sourceRoot }, dependencies);
  assert.notEqual(record.executable.sha256, identity.sha256);
  assert.equal(record.sourceExecutable.sha256, identity.sha256);
  assert.equal(record.packagedNative.sha256, native.sha256);
  assert.equal(Object.keys(record.sourceFiles).length, 4);
  dependencies.hash = file => file.endsWith('better_sqlite3.node') ? 'changed-native' : hashes.get(file) || 'source';
  assert.throws(() => recovery.captureBinaryIdentity({ mode: 'packaged', identity, native: fixtureNative, sourceRoot }, dependencies), /bindings differ/);
});

test('in-flight phase with a returned false closure receipt stays uncertain', async () => {
  const fixture = scenarioFixture();
  fixture.dependencies.runPhase = async () => ({ result: {}, lifecycle: { terminationConfirmed: false, processes: [] } });
  await assert.rejects(recovery.runRecoveryScenario(fixture.options, fixture.dependencies), error => {
    assert.equal(error.terminationConfirmed, false);
    return true;
  });
});