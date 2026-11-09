'use strict';
// Validation-only normal-startup recovery. Import is safe on host Node.
// Real application launches belong to a separate runtime authorization.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createApplicationSession, until } = require('./test-toolchain-startup.cjs');
const { cleanupAfterClose, appendFailure } = require('./validation-process-lifecycle.cjs');
const { prepareValidationPaths, resolveVerifiedElectron, assertMeasuredVersions, readNativeIdentity, hashFile, createPathGuard } = require('./validation-paths.cjs');

const ROOT = path.resolve(__dirname, '..');
const DIALOG_MARKER = '[storage-recovery-dialog] ';
const STARTUP_ERROR = 'Windows secure storage did not become available. Cloud authentication was not initialized.';
const SESSION_KEY = 'exa66-normal-startup-session';
const SESSION_VALUE = JSON.stringify({ access_token: 'synthetic-exa66-session', refresh_token: 'synthetic-exa66-refresh' });
const API_KEY = 'synthetic-exa66-api-key';
const PHASES = Object.freeze(['seed', 'unavailable', 'recovery']);

function parseCli(argv) {
  const values = {};
  const allowed = new Set(['profile-root', 'evidence', 'electron', 'verification', 'modes']);
  for (const value of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(value);
    assert.ok(match && allowed.has(match[1]), 'Unknown recovery argument: ' + value);
    assert.equal(values[match[1]], undefined, 'Duplicate recovery argument: ' + match[1]);
    values[match[1]] = match[2];
  }
  for (const name of ['profile-root', 'evidence', 'electron', 'verification']) {
    assert.ok(values[name] && path.isAbsolute(values[name]), 'Pass --' + name + '=<absolute path>');
  }
  const modes = (values.modes || 'start,packaged').split(',');
  assert.ok(modes.length && modes.every(mode => ['start', 'packaged'].includes(mode)), 'Only start,packaged recovery modes are supported');
  assert.equal(new Set(modes).size, modes.length, 'Duplicate recovery mode');
  return { profileRoot: values['profile-root'], evidence: values.evidence, executable: values.electron, verification: values.verification, modes };
}

function callExpression(operation, value) {
  return '(' + operation.toString() + ')(' + JSON.stringify(value) + ')';
}
function reportedOperationExpression(operation, value) {
  return '(function(){try{return {ok:true,value:' + callExpression(operation, value) +
    '};}catch(error){return {ok:false,error:{name:error.name,message:error.message,stack:error.stack,diagnostics:error.diagnostics||[]}};}})()';
}
function unwrapOperationResult(envelope) {
  assert.ok(envelope && typeof envelope.ok === 'boolean', 'Missing explicit persistence-operation result');
  if (envelope.ok) return envelope.value;
  const details = envelope.error || {};
  const error = new Error(details.message || 'Persistence operation failed');
  error.name = details.name || 'Error';
  if (details.stack) error.stack = details.stack;
  error.diagnostics = Array.isArray(details.diagnostics) ? [...details.diagnostics] : [];
  throw error;
}

// Runs only inside the paused, owned Electron main process before application
// imports. All modal startup errors are captured rather than shown. Unexpected
// dialogs fail the host check; none can hang this automated fixture.
function installStartupInjection(options) {
  const electron = require('electron');
  const Module = require('node:module');
  const state = { phase: options.phase, dialogs: [], sqliteOpenAttempts: 0, encryptAttempts: 0, decryptAttempts: 0 };
  globalThis.__exa66StorageRecovery = state;
  const originalLoad = Module._load;
  if (options.phase === 'unavailable') {
    electron.safeStorage.isEncryptionAvailable = () => false;
    electron.safeStorage.encryptString = () => { state.encryptAttempts++; throw new Error('Encryption attempted during injected storage unavailability'); };
    electron.safeStorage.decryptString = () => { state.decryptAttempts++; throw new Error('Decryption attempted during injected storage unavailability'); };
    // Loading JS is allowed; opening SQLite before the availability gate is not.
    Module._load = function (name, parent, isMain) {
      const result = originalLoad.call(this, name, parent, isMain);
      if (name !== 'better-sqlite3') return result;
      return new Proxy(result, { construct() {
        state.sqliteOpenAttempts++;
        throw new Error('SQLite opened before the secure-storage availability gate');
      } });
    };
    electron.app.once('will-quit', () => { Module._load = originalLoad; });
  }
  electron.dialog.showErrorBox = (title, message) => {
    const record = { title, message, phase: options.phase,
      expected: options.phase === 'unavailable' && title === 'Bug Pocket could not start' && message === options.expectedError,
      sqliteOpenAttempts: state.sqliteOpenAttempts, encryptAttempts: state.encryptAttempts, decryptAttempts: state.decryptAttempts };
    state.dialogs.push(record);
    process.stdout.write(options.marker + JSON.stringify(record) + '\n');
    // No native modal is opened. Return to the existing production catch so its
    // real app.quit/graceful lifecycle still runs; do not call app.exit here.
  };
  return { phase: options.phase, errorDialogIntercepted: true,
    storageAvailabilityInjected: options.phase === 'unavailable', serviceOrProductionFlagChanged: false };
}

function parseDialogs(output) {
  const records = [];
  for (const line of output.split(/\r?\n/)) {
    const offset = line.indexOf(DIALOG_MARKER);
    if (offset < 0) continue;
    records.push(JSON.parse(line.slice(offset + DIALOG_MARKER.length)));
  }
  return records;
}
function assertExpectedStartupError(output) {
  const records = parseDialogs(output);
  assert.equal(records.length, 1, 'Expected exactly one captured startup dialog');
  const record = records[0];
  assert.equal(record.expected, true, 'Unexpected startup error: ' + record.message);
  assert.equal(record.phase, 'unavailable');
  assert.equal(record.title, 'Bug Pocket could not start');
  assert.equal(record.message, STARTUP_ERROR);
  for (const name of ['sqliteOpenAttempts', 'encryptAttempts', 'decryptAttempts']) assert.equal(record[name], 0, name + ' must stay zero during unavailability');
  return record;
}

// Same current-source classes as the accepted component fixture. The application
// itself starts normally (including packaged startup); this adapter fixture uses
// the successor's pinned tsx/source, explicitly not private bundled-module hacks.
function persistenceOperation(options) {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const electron = require('electron');
  assert.equal(electron.app.getPath('userData'), options.userData);
  assert.equal(electron.safeStorage.isEncryptionAvailable(), true, 'Real secure storage must be available');
  const sourceRequire = require('node:module').createRequire(path.join(options.sourceRoot, 'package.json'));
  sourceRequire('tsx/cjs');
  const { BugPocketDatabase } = sourceRequire(path.join(options.sourceRoot, 'src/main/database.ts'));
  const { SafeStorageAdapter } = sourceRequire(path.join(options.sourceRoot, 'src/main/sync/SafeStorageAdapter.ts'));
  const { saveByokAiConfig } = sourceRequire(path.join(options.sourceRoot, 'src/main/ai/byokIssueProcessor.ts'));
  const { decryptStoredApiKey } = sourceRequire(path.join(options.sourceRoot, 'src/main/ai/byokConfigResponse.ts'));
  const database = new BugPocketDatabase();
  const adapter = new SafeStorageAdapter(database, electron.safeStorage);
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  let primaryError;
  try {
    if (options.phase === 'seed') {
      assert.equal(adapter.getItem(options.sessionKey), null, 'Fresh fixture unexpectedly already contains a session');
      adapter.setItem(options.sessionKey, options.sessionValue);
      saveByokAiConfig(database, { provider: 'OpenRouter', baseUrl: 'https://example.invalid/v1', modelId: 'synthetic-model',
        customSystemPrompt: '', apiKeyOperation: { action: 'replace', value: options.apiKey } });
    }
    // Recovery is deliberately unseeded; only the earlier seed branch writes.
    assert.equal(adapter.getItem(options.sessionKey), options.sessionValue);
    const encrypted = database.getEncryptedSupabaseAuthItem(options.sessionKey);
    assert.ok(encrypted && !encrypted.equals(Buffer.from(options.sessionValue)));
    const encryptedKey = database.getEncryptedByokAiApiKey('OpenRouter');
    assert.equal(decryptStoredApiKey(encryptedKey, electron.safeStorage), options.apiKey);
    const before = Buffer.from(encrypted);
    let unavailableDecryptCalls = 0;
    const unavailable = new SafeStorageAdapter(database, {
      isEncryptionAvailable: () => false,
      encryptString: value => electron.safeStorage.encryptString(value),
      decryptString: value => { unavailableDecryptCalls++; return electron.safeStorage.decryptString(value); }
    });
    assert.throws(() => unavailable.getItem(options.sessionKey), /Secure session storage is unavailable/);
    assert.equal(unavailableDecryptCalls, 0);
    assert.ok(database.getEncryptedSupabaseAuthItem(options.sessionKey).equals(before), 'Transient unavailability changed ciphertext');
    // A different disposable key exercises actual adapter decryption failure:
    // it expires that key, and must not be confused with transient unavailability.
    if (options.phase === 'seed') {
      const brokenKey = options.sessionKey + '-decrypt-failure';
      adapter.setItem(brokenKey, 'synthetic-disposable-decrypt-failure');
      const decryptFailure = new SafeStorageAdapter(database, {
        isEncryptionAvailable: () => true,
        encryptString: value => electron.safeStorage.encryptString(value),
        decryptString: () => { throw new Error('synthetic-decrypt-failure'); }
      });
      assert.equal(decryptFailure.getItem(brokenKey), null);
      assert.equal(database.getEncryptedSupabaseAuthItem(brokenKey), null);
    }
    assert.equal(adapter.getItem(options.sessionKey), options.sessionValue);
    assert.ok(database.getEncryptedSupabaseAuthItem(options.sessionKey).equals(before));
    assert.equal(database.localDb.pragma('integrity_check', { simple: true }), 'ok');
    const sqliteVersion = database.localDb.prepare('SELECT sqlite_version() AS version').get().version;
    for (const name of ['local.sqlite', 'local.sqlite-wal']) {
      const file = path.join(options.userData, name);
      if (!fs.existsSync(file)) continue;
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.includes(Buffer.from(options.sessionValue)), false, 'Session plaintext found in database/WAL');
      assert.equal(bytes.includes(Buffer.from(options.apiKey)), false, 'API key plaintext found in database/WAL');
    }
    return { phase: options.phase, seeded: options.phase === 'seed', unseededReader: options.phase === 'recovery',
      session: true, byok: true, ciphertextSha256: digest(encrypted), byokCiphertextSha256: digest(Buffer.from(encryptedKey)),
      transientUnavailable: { throwsBeforeDecryption: true, ciphertextRetained: true },
      decryptionFailure: { verifiedDuringSeedPhase: true, repeatedByReader: false, primarySessionRetained: true },
      sqliteVersion, integrity: 'ok', plaintextAbsent: true,
      adapterSource: path.join(options.sourceRoot, 'src/main/sync/SafeStorageAdapter.ts'),
      scope: 'Normal application startup plus current-source adapter fixture; no live provider/BYOC request' };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { database.close(); }
    catch (closeError) {
      if (primaryError) (primaryError.diagnostics ??= []).push('Close fixture database: ' + closeError.message);
      else throw closeError;
    }
  }
}

function databaseSnapshot(userData, { exists = fs.existsSync, read = fs.readFileSync } = {}) {
  return Object.fromEntries(['local.sqlite', 'local.sqlite-wal', 'local.sqlite-shm'].map(name => {
    const file = path.join(userData, name);
    if (!exists(file)) return [name, null];
    const bytes = read(file);
    return [name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  }));
}
function assertDatabaseUnchanged(before, after) {
  assert.deepEqual(after, before, 'Unavailable startup changed SQLite/ciphertext bytes');
}

function receiptData(receipt) {
  return { terminationConfirmed: receipt.terminationConfirmed, processes: receipt.processes || [],
    diagnostics: receipt.diagnostics || [], ...(receipt.error ? { error: { name: receipt.error.name, message: receipt.error.message } } : {}),
    ...(receipt.retainedProfile ? { retainedProfile: receipt.retainedProfile } : {}) };
}
function samePath(left, right) { return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase(); }

function captureBinaryIdentity({ mode, identity, native, sourceRoot = ROOT }, dependencies = {}) {
  const hash = dependencies.hash || hashFile;
  const stat = dependencies.stat || fs.statSync;
  const guard = dependencies.guard || createPathGuard({ repositoryRoot: sourceRoot });
  const actualNative = (dependencies.nativeIdentity || readNativeIdentity)(sourceRoot);
  assert.equal(actualNative.sha256, native.sha256, 'Source native binding changed between phases');
  assert.equal(actualNative.packageVersion, '12.11.1');
  const sourceExecutable = guard.check(identity.executable, { external: false, mustExist: true, file: true });
  assert.equal(hash(sourceExecutable), identity.sha256, 'Verified Electron executable changed between phases');
  const executable = guard.check(mode === 'packaged' ? path.join(sourceRoot, 'release-build/win-unpacked/Bug Pocket.exe') : sourceExecutable,
    { external: false, mustExist: true, file: true });
  let packagedNative;
  if (mode === 'packaged') {
    const binding = guard.check(path.join(sourceRoot, 'release-build/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
      { external: false, mustExist: true, file: true });
    packagedNative = { binding, sha256: hash(binding), size: stat(binding).size };
    assert.equal(packagedNative.sha256, actualNative.sha256, 'Packaged/source native bindings differ; inspect the rebuild before validation');
  }
  const sourceFiles = {};
  for (const name of ['src/main/database.ts', 'src/main/sync/SafeStorageAdapter.ts', 'src/main/ai/byokIssueProcessor.ts', 'src/main/ai/byokConfigResponse.ts']) {
    const file = guard.check(path.join(sourceRoot, name), { external: false, mustExist: true, file: true });
    sourceFiles[name] = hash(file);
  }
  return { executable: { path: executable, sha256: hash(executable), size: stat(executable).size },
    sourceExecutable: { path: sourceExecutable, sha256: identity.sha256 }, sourceNative: actualNative,
    ...(packagedNative ? { packagedNative } : {}), sourceFiles,
    scope: mode === 'packaged' ? 'Icon-edited packaged EXE pinned across all three launches; source and packaged bindings recorded separately' : 'Verified official extracted executable and current source native binding' };
}

async function runRecoveryPhase({ mode, phase, profile, userData, identity, native, baselineBinary, sourceRoot = ROOT, assertOwned }, dependencies = {}) {
  const createSession = dependencies.createSession || createApplicationSession;
  const waitUntil = dependencies.waitUntil || until;
  const measured = dependencies.assertMeasured || assertMeasuredVersions;
  const capture = dependencies.captureBinaries || captureBinaryIdentity;
  let session, result, firstError, receipt, phaseBinary;
  try {
    await assertOwned();
    phaseBinary = capture({ mode, identity, native, sourceRoot });
    assert.deepEqual(phaseBinary, baselineBinary, 'Executable/native/source identity changed before launch');
    session = await createSession({ mode, profile, applicationRoot: sourceRoot, inspectionTimeoutMs: 60_000,
      beforeImport: async ({ isolation, evaluate }) => {
        measured(isolation.versions, { platform: isolation.platform, arch: isolation.arch });
        assert.deepEqual(capture({ mode, identity, native, sourceRoot }), baselineBinary, 'Executable/native/source identity changed at pre-import pause');
        const expected = mode === 'packaged' ? path.join(sourceRoot, 'release-build/win-unpacked/Bug Pocket.exe') : identity.executable;
        assert.ok(samePath(isolation.executable, expected), 'Normal startup launched an unexpected Electron executable');
        await assertOwned();
        return evaluate(callExpression(installStartupInjection, { phase, expectedError: STARTUP_ERROR, marker: DIALOG_MARKER }));
      } });
    if (phase === 'unavailable') {
      await waitUntil(() => parseDialogs(session.stdout()).length > 0, 'captured secure-storage startup error', 35_000);
      result = { phase, startupError: assertExpectedStartupError(session.stdout()), databaseOpened: false,
        dialogMechanism: 'Pre-import showErrorBox interceptor captures the exact error, returns immediately, and lets the real app.quit path run; native modal not opened' };
    } else {
      await waitUntil(async () => {
        const dialogs = parseDialogs(session.stdout());
        assert.equal(dialogs.length, 0, 'Unexpected dialog in normal startup: ' + JSON.stringify(dialogs));
        return session.main.evaluate('(function(){const e=require("electron");return e.app.isReady() && e.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes("#/dashboard"));})()');
      }, 'normal dashboard after real secure-storage availability', 40_000);
      await assertOwned();
      result = unwrapOperationResult(await session.main.evaluate(reportedOperationExpression(persistenceOperation, {
        phase, sourceRoot, userData, sessionKey: SESSION_KEY, sessionValue: SESSION_VALUE, apiKey: API_KEY
      })));
      assert.equal(result.seeded, phase === 'seed', 'Reader must not seed or repair data');
      assert.equal(result.session, true);
      assert.equal(result.byok, true);
    }
  } catch (error) { firstError = error; }
  finally {
    if (session) {
      try { receipt = await session.finish(firstError); }
      catch (finishError) {
        receipt = { error: firstError, diagnostics: firstError?.diagnostics || [], terminationConfirmed: false };
        appendFailure(receipt, finishError, 'Session finish');
      }
    } else {
      receipt = firstError?.sessionResult || { error: firstError, diagnostics: firstError?.diagnostics || [], terminationConfirmed: false };
    }
  }
  // Validate immutable final stdout after all closure/teardown output has arrived.
  // A late unexpected dialog cannot hide behind an earlier success observation.
  if (session) {
    try {
      if (phase === 'unavailable') assertExpectedStartupError(session.stdout());
      else assert.equal(parseDialogs(session.stdout()).length, 0, 'Unexpected startup dialog appeared during teardown');
    } catch (lateError) { appendFailure(receipt, lateError, 'Final startup-dialog evidence'); }
  }
  const evidence = { mode, phase, profile, userData, ...(result ? { result } : {}),
    isolationBeforeUserCode: session?.isolation, binaryIdentity: phaseBinary,
    command: session?.command || firstError?.sessionOutput?.command,
    stdout: session ? session.stdout() : firstError?.sessionOutput?.stdout || '',
    stderr: session ? session.stderr() : firstError?.sessionOutput?.stderr || '', lifecycle: receiptData(receipt) };
  if (receipt.error || firstError || receipt.terminationConfirmed !== true) {
    const error = receipt.error || firstError || new Error('Recovery phase closure was not confirmed');
    error.terminationConfirmed = receipt.terminationConfirmed === true;
    error.storageRecoveryPhase = evidence;
    throw error;
  }
  return evidence;
}

async function runRecoveryScenario({ mode, directory, identity, native, baselineBinary, sourceRoot = ROOT, assertOwned }, dependencies = {}) {
  const mkdir = dependencies.mkdir || (target => fs.mkdirSync(target));
  const snapshot = dependencies.snapshot || databaseSnapshot;
  const runPhase = dependencies.runPhase || runRecoveryPhase;
  const profile = path.join(directory, 'profile');
  const userData = mode === 'packaged' ? profile : profile + '-dev';
  await assertOwned();
  mkdir(directory);
  mkdir(profile);
  if (userData !== profile) mkdir(userData);
  const phases = [];
  let inFlight = false;
  const phaseOptions = phase => ({ mode, phase, profile, userData, identity, native, baselineBinary, sourceRoot, assertOwned });
  const launch = async phase => {
    inFlight = true;
    const result = await runPhase(phaseOptions(phase), dependencies);
    assert.equal(result.lifecycle.terminationConfirmed, true, 'Phase returned without closure proof');
    phases.push(result);
    inFlight = false;
  };
  try {
    await launch('seed');
    const beforeUnavailable = snapshot(userData);
    assert.ok(beforeUnavailable['local.sqlite'], 'Seed process did not create a real SQLite file');
    await launch('unavailable');
    const afterUnavailable = snapshot(userData);
    assertDatabaseUnchanged(beforeUnavailable, afterUnavailable);
    await launch('recovery');
    assert.equal(phases[2].result.unseededReader, true);
    assert.equal(phases[2].result.ciphertextSha256, phases[0].result.ciphertextSha256, 'Recovery reseeded or changed primary session ciphertext');
    assert.equal(phases[2].result.byokCiphertextSha256, phases[0].result.byokCiphertextSha256, 'Recovery changed the persisted BYOK key');
    return { mode, phases, beforeUnavailable, afterUnavailable, databaseUnchangedWhileUnavailable: true };
  } catch (error) {
    error.storageRecoveryScenario = { mode, phases, ...(error.storageRecoveryPhase ? { failedPhase: error.storageRecoveryPhase } : {}) };
    if (inFlight) error.terminationConfirmed = error.terminationConfirmed === true;
    else if (error.terminationConfirmed !== false) error.terminationConfirmed = phases.every(item => item.lifecycle.terminationConfirmed === true);
    throw error;
  }
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseCli(argv);
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(process.versions.electron, undefined, 'Launch recovery driver using the existing host Node, not Electron');
  for (const name of ['BUG_POCKET_COMPAT_WRITE_EXE', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_RUN_AS_NODE']) {
    assert.ok(!process.env[name], 'Unexpected inherited runtime override: ' + name);
  }
  const verify = dependencies.verify || resolveVerifiedElectron;
  const nativeIdentity = dependencies.nativeIdentity || readNativeIdentity;
  const identity = verify({ repositoryRoot: ROOT, executable: options.executable, verification: options.verification });
  const native = nativeIdentity(ROOT);
  const capture = dependencies.captureBinaries || captureBinaryIdentity;
  const baselines = Object.fromEntries(options.modes.map(mode => [mode, capture({ mode, identity, native, sourceRoot: ROOT })]));
  const preparePaths = dependencies.preparePaths || prepareValidationPaths;
  const context = preparePaths({ profileRoot: options.profileRoot, evidence: options.evidence, repositoryRoot: ROOT, label: 'storage-recovery' });
  const report = { schemaVersion: 1, capturedAt: new Date().toISOString(), scope: 'Synthetic normal-startup recovery only', identity, native,
    modes: options.modes, results: [], runtimeAuthorizationRequired: true,
    exclusions: ['No real DPAPI outage or Windows service change', 'No live provider/BYOC requests', 'No old ABI/import migration', 'Normal startup is real; adapter fixtures load pinned current source through tsx, not private packaged bundle modules'] };
  const receipt = { error: undefined, diagnostics: [], terminationConfirmed: true, processes: [] };
  const scenario = dependencies.scenario || runRecoveryScenario;
  const save = () => context.writeEvidence({ ...report, lifecycle: receiptData(receipt) });
  try {
    for (const mode of options.modes) {
      const result = await scenario({ mode, directory: path.join(context.profile, mode), identity, native, baselineBinary: baselines[mode], sourceRoot: ROOT, assertOwned: context.assertOwned }, dependencies);
      report.results.push(result);
      for (const phase of result.phases) {
        assert.equal(phase.lifecycle.terminationConfirmed, true, 'Scenario lacks confirmed phase closure');
        receipt.processes.push(...phase.lifecycle.processes);
      }
      save();
    }
  } catch (error) {
    appendFailure(receipt, error);
    receipt.terminationConfirmed = error.terminationConfirmed === true;
    report.failure = { message: error.message, ...(error.storageRecoveryScenario ? { scenario: error.storageRecoveryScenario } : {}) };
  }
  try { save(); } catch (error) { appendFailure(receipt, error, 'Write recovery evidence'); }
  await (dependencies.cleanup || cleanupAfterClose)(receipt, { profile: context.profile, assertOwned: context.assertOwned, remove: context.removeProfile });
  report.profileRemoved = !receipt.retainedProfile;
  try { save(); } catch (error) { appendFailure(receipt, error, 'Write final recovery evidence'); }
  if (receipt.error) throw receipt.error;
  return report;
}

module.exports = { STARTUP_ERROR, DIALOG_MARKER, PHASES, parseCli, callExpression, reportedOperationExpression, unwrapOperationResult, installStartupInjection, persistenceOperation,
  parseDialogs, assertExpectedStartupError, databaseSnapshot, assertDatabaseUnchanged, receiptData, captureBinaryIdentity, runRecoveryPhase, runRecoveryScenario, main };
if (require.main === module) {
  main().catch(error => { console.error(error.stack || error); for (const diagnostic of error.diagnostics || []) console.error(diagnostic); process.exitCode = 1; });
}
