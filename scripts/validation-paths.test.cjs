'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { deflateRawSync } = require('node:zlib');
const test = require('node:test');
const { createPathGuard, prepareValidationPaths, assertOwnedProfile, assertMeasuredVersions, readNativeIdentity, createRuntimeVerifier, zipEntryDigest, EXPECTED_VERSIONS } = require('./validation-paths.cjs');
const { parseArguments, assertNoPlaintext, runRecordedChild, runDriver, inspectSqliteProbe } = require('./runtime-compatibility.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const hostRoot = process.env.BUG_POCKET_HOST_TEST_ROOT;
assert.ok(hostRoot && path.isAbsolute(hostRoot), 'Set BUG_POCKET_HOST_TEST_ROOT to the durable review scratch directory');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(hostRoot, 'validation-paths-'));
  const repo = path.join(base, 'repo'); const profiles = path.join(base, 'profiles'); const evidence = path.join(base, 'result.json'); const temp = path.join(base, 'system-temp');
  for (const value of [repo, profiles, temp]) fs.mkdirSync(value);
  const inspectAttributes = paths => paths.map(value => ({ path: value, attributes: 0 }));
  const guard = createPathGuard({ repositoryRoot: repo, forbiddenRoots: [temp], inspectAttributes });
  t.after(() => { assert.ok(path.relative(hostRoot, base).startsWith('validation-paths-')); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, repo, profiles, evidence, temp, guard, inspectAttributes, context: () => prepareValidationPaths({ profileRoot: profiles, evidence, repositoryRoot: repo, label: 'fixture', guard }) };
}
function makeZip(entries, method = 0) {
  const locals = []; const directory = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const nameBytes = Buffer.from(name); const encoded = method === 8 ? deflateRawSync(bytes) : bytes;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt32LE(encoded.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, encoded);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10); central.writeUInt32LE(encoded.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, nameBytes); offset += local.length + nameBytes.length + encoded.length;
  }
  const table = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, table, end]);
}
function verifiedFixture(t) {
  const f = fixture(t); const bytes = Buffer.from('Synthetic executable bytes; never executable code');
  const wrapper = path.join(f.repo, 'node_modules', 'electron'); fs.mkdirSync(path.join(wrapper, 'dist'), { recursive: true });
  const executable = path.join(wrapper, 'dist', 'electron.exe'); fs.writeFileSync(executable, bytes);
  fs.writeFileSync(path.join(wrapper, 'package.json'), JSON.stringify({ version: '45.2.1' })); fs.writeFileSync(path.join(wrapper, 'path.txt'), 'electron.exe'); fs.writeFileSync(path.join(f.repo, 'package.json'), JSON.stringify({ devDependencies: { electron: '45.2.1' } }));
  const archive = path.join(f.base, 'synthetic.zip'); const zip = makeZip([['electron.exe', bytes]], 8); fs.writeFileSync(archive, zip);
  const checksums = path.join(f.base, 'SHASUMS256.txt'); const sums = Buffer.from(`${sha(zip)}  electron-v45.2.1-win32-x64.zip\n`); fs.writeFileSync(checksums, sums);
  const official = { electron: '45.2.1', platform: 'win32', arch: 'x64', commit: 'synthetic-source-identity', assetId: 123, size: zip.length, sha256: sha(zip), checksumSha256: sha(sums), url: 'https://example.invalid/synthetic.zip' };
  const verification = path.join(f.base, 'verification.json');
  const metadata = { schemaVersion: 1, runtime: { electron: official.electron, platform: official.platform, arch: official.arch, commit: official.commit }, archive: { path: archive, sha256: official.sha256, size: official.size, assetId: official.assetId, url: official.url }, checksums: { path: checksums, sha256: official.checksumSha256 }, executable: { path: executable, sha256: sha(bytes), size: bytes.length } };
  const save = () => fs.writeFileSync(verification, JSON.stringify(metadata)); save();
  const verify = createRuntimeVerifier({ official, guardFactory: () => f.guard });
  return { ...f, wrapper, bytes, executable, archive, checksums, verification, metadata, save, verify: () => verify({ repositoryRoot: f.repo, executable, verification }) };
}

test('host import does not require an Electron wrapper/native addon or start any application', () => {
  const Module = require('node:module'); const childProcess = require('node:child_process'); const load = Module._load; const originalSpawn = childProcess.spawn; const originalExec = childProcess.execFileSync;
  try {
    Module._load = function(request, ...args) { assert.ok(request !== 'electron' && request !== 'better-sqlite3'); return load.call(this, request, ...args); };
    childProcess.spawn = childProcess.execFileSync = () => assert.fail('Host imports must not launch a child');
    for (const file of ['./validation-paths.cjs', './runtime-compatibility.cjs']) { delete require.cache[require.resolve(file)]; require(file); }
  } finally { Module._load = load; childProcess.spawn = originalSpawn; childProcess.execFileSync = originalExec; }
});
test('relative, drive-relative, escaping, protected, OneDrive and Temp paths fail before profile writes', t => {
  const f = fixture(t); const before = fs.readdirSync(f.profiles);
  for (const value of ['relative', 'C:relative', path.join(f.repo, 'profiles'), path.join(f.base, 'OneDrive', 'profiles'), path.join(f.temp, 'profiles'), f.base + path.sep + '..' + path.sep + 'escape', path.parse(f.base).root]) assert.throws(() => prepareValidationPaths({ profileRoot: value, evidence: f.evidence, repositoryRoot: f.repo, label: 'fixture', guard: f.guard }));
  assert.deepEqual(fs.readdirSync(f.profiles), before); assert.equal(fs.existsSync(f.evidence), false);
});
test('preexisting evidence and overlapping profile/evidence targets fail before writes', t => {
  const f = fixture(t); fs.writeFileSync(f.evidence, 'protected original');
  assert.throws(() => f.context(), /already exists/); assert.deepEqual(fs.readdirSync(f.profiles), []); assert.equal(fs.readFileSync(f.evidence, 'utf8'), 'protected original');
  assert.throws(() => prepareValidationPaths({ profileRoot: f.profiles, evidence: path.join(f.profiles, 'result.json'), repositoryRoot: f.repo, label: 'fixture', guard: f.guard }), /outside/);
});
test('missing external parents are prerequisites and are never recursively created', t => {
  const f = fixture(t); const missing = path.join(f.base, 'missing');
  assert.throws(() => prepareValidationPaths({ profileRoot: missing, evidence: f.evidence, repositoryRoot: f.repo, label: 'fixture', guard: f.guard }), /missing/); assert.equal(fs.existsSync(missing), false);
});
test('non-symlink Windows reparse attributes fail closed', t => {
  const f = fixture(t); const guard = createPathGuard({ repositoryRoot: f.repo, forbiddenRoots: [f.temp], inspectAttributes: paths => paths.map(value => ({ path: value, attributes: value === f.profiles ? 0x400 : 0 })) });
  assert.throws(() => prepareValidationPaths({ profileRoot: f.profiles, evidence: f.evidence, repositoryRoot: f.repo, label: 'fixture', guard }), /Reparse/); assert.deepEqual(fs.readdirSync(f.profiles), []);
});
test('junction ancestors cannot redirect profile creation outside its declared root', t => {
  const f = fixture(t); const target = path.join(f.base, 'target'); fs.mkdirSync(target); const link = path.join(f.base, 'junction'); fs.symlinkSync(target, link, 'junction');
  assert.throws(() => prepareValidationPaths({ profileRoot: link, evidence: f.evidence, repositoryRoot: f.repo, label: 'fixture', guard: f.guard }), /Link\/junction/); assert.deepEqual(fs.readdirSync(target), []);
});
test('ownership markers reject a different profile, token and label before removal', async t => {
  const f = fixture(t); const context = f.context();
  assert.throws(() => assertOwnedProfile({ ...context, repositoryRoot: f.repo, guard: f.guard, ownerToken: '00000000-0000-4000-8000-000000000000' }), /token differs/);
  assert.throws(() => assertOwnedProfile({ ...context, repositoryRoot: f.repo, guard: f.guard, label: 'other' }), /label differs/);
  await assert.rejects(context.removeProfile(f.profiles, { recursive: true, force: true }), /not the owned profile/);
  assert.equal(fs.existsSync(context.profile), true);
});
test('a late ownership replacement cannot authorize cleanup', async t => {
  const f = fixture(t); const context = f.context(); const marker = path.join(context.profile, '.bug-pocket-validation-owner.json');
  const owner = JSON.parse(fs.readFileSync(marker, 'utf8')); owner.ownerToken = '00000000-0000-4000-8000-000000000000'; fs.writeFileSync(marker, JSON.stringify(owner));
  await assert.rejects(context.removeProfile(context.profile, { recursive: true, force: true }), /token differs/); assert.equal(fs.existsSync(context.profile), true);
});
test('nested profile junction and hard link rejection retain both profile and target', async t => {
  const f = fixture(t); const context = f.context(); const target = path.join(f.base, 'protected'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep'), 'original'); const link = path.join(context.profile, 'linked'); fs.symlinkSync(target, link, 'junction');
  await assert.rejects(context.removeProfile(context.profile, { recursive: true, force: true }), /link\/junction/i); assert.equal(fs.readFileSync(path.join(target, 'keep'), 'utf8'), 'original'); fs.unlinkSync(link);
  fs.linkSync(path.join(target, 'keep'), path.join(context.profile, 'hard-link'));
  await assert.rejects(context.removeProfile(context.profile, { recursive: true, force: true }), /hard link/i); assert.equal(fs.existsSync(context.profile), true);
});
test('external evidence updates only its own regular file and cleanup removes only its owned profile', async t => {
  const f = fixture(t); const context = f.context(); context.writeEvidence({ status: 'RUNNING' }); context.writeEvidence({ status: 'PASSED' });
  assert.equal(JSON.parse(fs.readFileSync(f.evidence, 'utf8')).validationOwner, context.ownerToken); await context.removeProfile(context.profile, { recursive: true, force: true });
  assert.equal(fs.existsSync(context.profile), false); assert.equal(fs.existsSync(f.profiles), true); assert.equal(JSON.parse(fs.readFileSync(f.evidence, 'utf8')).status, 'PASSED');
});
test('evidence hard links and replaced ownership are rejected without overwriting originals', t => {
  const f = fixture(t); const context = f.context(); context.writeEvidence({ status: 'RUNNING' }); const original = fs.readFileSync(f.evidence); const copy = path.join(f.base, 'protected.json'); fs.linkSync(f.evidence, copy);
  assert.throws(() => context.writeEvidence({ status: 'PASSED' }), /Hard-linked/); assert.deepEqual(fs.readFileSync(copy), original); fs.unlinkSync(copy);
  fs.writeFileSync(f.evidence, JSON.stringify({ validationOwner: 'different' })); assert.throws(() => context.writeEvidence({ status: 'PASSED' }), /ownership differs/);
});
test('measured runtime versions reject every wrong component, platform and ABI', () => {
  assertMeasuredVersions(EXPECTED_VERSIONS, { platform: 'win32', arch: 'x64' });
  for (const key of Object.keys(EXPECTED_VERSIONS)) assert.throws(() => assertMeasuredVersions({ ...EXPECTED_VERSIONS, [key]: 'wrong' }, { platform: 'win32', arch: 'x64' }), /Wrong measured/);
  assert.throws(() => assertMeasuredVersions(EXPECTED_VERSIONS, { platform: 'linux', arch: 'x64' }), /platform/); assert.throws(() => assertMeasuredVersions(EXPECTED_VERSIONS, { platform: 'win32', arch: 'arm64' }), /architecture/);
});
test('ZIP entry hashing reads synthetic stored/deflated bytes without extraction or execution', () => {
  const bytes = Buffer.from('synthetic payload'); for (const method of [0, 8]) assert.deepEqual(zipEntryDigest(makeZip([['electron.exe', bytes]], method), 'electron.exe'), { sha256: sha(bytes), size: bytes.length });
  assert.throws(() => zipEntryDigest(Buffer.from('bad zip'), 'electron.exe'), /end record/);
  assert.throws(() => zipEntryDigest(makeZip([['other', bytes]]), 'electron.exe'), /missing/);
  assert.throws(() => zipEntryDigest(makeZip([['electron.exe', bytes], ['electron.exe', bytes]]), 'electron.exe'), /Duplicate/);
});
test('verifier binds exact wrapper, archive, checksum and extracted executable bytes', t => {
  const f = verifiedFixture(t); const result = f.verify(); assert.equal(result.executable, f.executable); assert.equal(result.sha256, sha(f.bytes)); assert.match(result.signatureAssurance, /no signature/);
  fs.writeFileSync(f.executable, 'arbitrary replacement bytes'); f.metadata.executable.sha256 = sha(Buffer.from('arbitrary replacement bytes')); f.metadata.executable.size = fs.statSync(f.executable).size; f.save(); assert.throws(() => f.verify(), /official ZIP entry/);
});
test('wrong tag/artifact metadata, archive bytes and checksum bytes are stop conditions', t => {
  const f = verifiedFixture(t); const originalCommit = f.metadata.runtime.commit; f.metadata.runtime.commit = 'other'; f.save(); assert.throws(() => f.verify(), /commit/); f.metadata.runtime.commit = originalCommit; f.save();
  f.metadata.archive.assetId++; f.save(); assert.throws(() => f.verify(), /assetId/); f.metadata.archive.assetId--; f.save();
  const archive = fs.readFileSync(f.archive); const changed = Buffer.from(archive); changed[30] ^= 1; fs.writeFileSync(f.archive, changed); assert.throws(() => f.verify(), /archive SHA256/); fs.writeFileSync(f.archive, archive);
  fs.appendFileSync(f.checksums, 'changed'); assert.throws(() => f.verify(), /checksum text/);
});
test('wrapper path traversal and alternate executable fail without requiring the wrapper', t => {
  const f = verifiedFixture(t); fs.writeFileSync(path.join(f.wrapper, 'path.txt'), '..\\other.exe'); assert.throws(() => f.verify(), /wrapper path/); fs.writeFileSync(path.join(f.wrapper, 'path.txt'), 'electron.exe');
  fs.writeFileSync(path.join(f.wrapper, 'package.json'), JSON.stringify({ version: '43.1.0' })); assert.throws(() => f.verify(), /npm wrapper/);
});
test('native identity hashes synthetic file bytes without loading them', t => {
  const f = fixture(t); const nativeRoot = path.join(f.repo, 'node_modules', 'better-sqlite3'); fs.mkdirSync(path.join(nativeRoot, 'build', 'Release'), { recursive: true }); fs.writeFileSync(path.join(nativeRoot, 'package.json'), JSON.stringify({ version: '12.11.1' })); const binding = path.join(nativeRoot, 'build', 'Release', 'better_sqlite3.node'); fs.writeFileSync(binding, 'synthetic non-native fixture');
  const result = readNativeIdentity(f.repo, { guard: f.guard }); assert.equal(result.sha256, sha(Buffer.from('synthetic non-native fixture'))); assert.equal(result.packageVersion, '12.11.1'); assert.equal(result.expectedAbi, '150');
});
test('CLI requires external destinations and explicit verified executable; old writer arguments fail', () => {
  const good = ['--profile-root=C:\\profiles', '--evidence=C:\\record.json', '--electron=C:\\electron.exe', '--verification=C:\\identity.json']; assert.equal(parseArguments(good).electron, 'C:\\electron.exe');
  for (const args of [good.slice(0, 3), [...good, '--writer=C:\\old.exe'], [...good, good[0]], [...good, '--unknown=value']]) assert.throws(() => parseArguments(args));
});
test('plaintext scanner catches standalone synthetic credential tokens as well as JSON', t => {
  const f = fixture(t); const file = path.join(f.profiles, 'local.sqlite'); fs.writeFileSync(file, 'opaque encrypted fixture'); assertNoPlaintext(f.profiles); fs.writeFileSync(file, 'synthetic-runtime-session'); assert.throws(() => assertNoPlaintext(f.profiles), /plaintext/);
});
test('recorded child requires close plus marker and zero exit and records owned PID', async () => {
  const child = new EventEmitter(); child.pid = 12345; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => true; child.unref = () => {}; child.stdout.destroy = child.stderr.destroy = () => {};
  const record = {}; const promise = runRecordedChild({ executable: 'synthetic-never-started.exe', profile: 'fixture', profileRoot: 'fixture-root', ownerToken: 'fixture-token', verification: 'fixture.json', phase: 'write', record, startChild: () => child });
  child.stdout.emit('data', '[runtime-compatibility] write passed'); child.emit('exit', 0, null); assert.equal(record.closureConfirmed, false); child.emit('close', 0, null); await promise; assert.equal(record.closureConfirmed, true); assert.equal(record.pid, 12345); assert.equal(record.exitCode, 0);
});
function orchestrationFixture(t) {
  const f = fixture(t); const executable = path.join(f.base, 'synthetic.exe'); const binding = path.join(f.base, 'synthetic.node'); fs.writeFileSync(executable, 'never executed'); fs.writeFileSync(binding, 'never loaded');
  let context;
  const dependencies = { checkBuild: () => {}, resolveVerifiedElectron: () => ({ executable, sha256: sha(Buffer.from('never executed')), verification: path.join(f.base, 'metadata.json') }), readNativeIdentity: () => ({ binding, sha256: sha(Buffer.from('never loaded')) }), prepareValidationPaths: () => (context = prepareValidationPaths({ profileRoot: f.profiles, evidence: f.evidence, repositoryRoot: f.repo, label: 'runtime-compatibility', guard: f.guard })) };
  const args = [`--profile-root=${f.profiles}`, `--evidence=${f.evidence}`, `--electron=${executable}`, `--verification=${path.join(f.base, 'metadata.json')}`];
  return { ...f, executable, binding, dependencies, args, context: () => context };
}
test('actual driver orchestration uses the same verified executable and an unseeded second phase', async t => {
  const f = orchestrationFixture(t); const calls = [];
  f.dependencies.runRecordedChild = async ({ executable, profile, phase, record }) => {
    calls.push({ executable, phase }); record.pid = calls.length; record.closureConfirmed = true;
    if (phase === 'write') fs.writeFileSync(path.join(profile, 'local.sqlite'), 'synthetic opaque database bytes'); else assert.equal(fs.readFileSync(path.join(profile, 'local.sqlite'), 'utf8'), 'synthetic opaque database bytes');
    fs.writeFileSync(path.join(profile, `runtime-compatibility-${phase}.json`), JSON.stringify({ status: 'PASSED', phase, pid: record.pid, executable: { sha256: sha(Buffer.from('never executed')) }, native: { sha256: sha(Buffer.from('never loaded')) }, versions: EXPECTED_VERSIONS, platform: 'win32', arch: 'x64', readerSeeded: phase === 'read' ? false : null }));
  };
  const result = await runDriver(f.args, f.dependencies); assert.deepEqual(calls, [{ executable: f.executable, phase: 'write' }, { executable: f.executable, phase: 'read' }]); assert.equal(result.cleanup, 'REMOVED_AFTER_CONFIRMED_CLOSE'); assert.equal(fs.existsSync(result.profile), false); assert.equal(JSON.parse(fs.readFileSync(f.evidence, 'utf8')).phases.length, 2);
});
test('actual driver retains an uncertain child profile and original failure without launching a reader', async t => {
  const f = orchestrationFixture(t); const original = Object.assign(new Error('synthetic timeout'), { terminationConfirmed: false }); let calls = 0;
  f.dependencies.runRecordedChild = async ({ record }) => { calls++; record.pid = 10; record.closureConfirmed = false; throw original; };
  await assert.rejects(runDriver(f.args, f.dependencies), error => error === original); assert.equal(calls, 1); assert.equal(fs.existsSync(f.context().profile), true); assert.equal(JSON.parse(fs.readFileSync(f.evidence, 'utf8')).cleanup, 'RETAINED');
});
test('evidence failure during a child failure appends diagnostics and preserves the first failure', async t => {
  const f = orchestrationFixture(t); const original = Object.assign(new Error('first synthetic failure'), { terminationConfirmed: false }); const prepare = f.dependencies.prepareValidationPaths; let failed = false;
  f.dependencies.prepareValidationPaths = () => { const context = prepare(); const write = context.writeEvidence; context.writeEvidence = value => { if (failed) throw new Error('synthetic evidence failure'); return write(value); }; return context; };
  f.dependencies.runRecordedChild = async () => { failed = true; throw original; };
  await assert.rejects(runDriver(f.args, f.dependencies), error => error === original); assert.match(original.diagnostics.join('\n'), /Phase evidence failed/); assert.match(original.diagnostics.join('\n'), /Evidence finalization failed/); assert.equal(fs.existsSync(f.context().profile), true);
});

test('external destinations reject another Git checkout or worktree before mutation', t => {
  const f = fixture(t); const other = path.join(f.base, 'other-checkout'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, '.git'), 'gitdir: synthetic metadata');
  const profiles = path.join(other, 'profiles'); fs.mkdirSync(profiles);
  assert.throws(() => prepareValidationPaths({ profileRoot: profiles, evidence: f.evidence, repositoryRoot: f.repo, label: 'fixture', guard: f.guard }), /Git checkout/);
  assert.deepEqual(fs.readdirSync(profiles), []); assert.equal(fs.existsSync(f.evidence), false);
});
test('synthetic SQLite probe returns metadata and closes after successful inspection', () => {
  const events = [];
  const probe = {
    prepare(sql) {
      assert.equal(sql, 'SELECT sqlite_version() AS version');
      events.push('prepare');
      return { get: () => ({ version: 'synthetic-sqlite-version' }) };
    },
    pragma(name, options) {
      assert.deepEqual(options, { simple: true });
      events.push(name);
      return name === 'integrity_check' ? 'ok' : 4;
    },
    close() { events.push('close'); }
  };
  assert.deepEqual(inspectSqliteProbe(probe, 'synthetic-database-path'), {
    libraryVersion: 'synthetic-sqlite-version', integrity: 'ok', userVersion: 4,
    databasePath: 'synthetic-database-path', nativeLoad: true
  });
  assert.deepEqual(events, ['prepare', 'integrity_check', 'user_version', 'close']);
});

test('synthetic SQLite integrity failure survives probe close failure with diagnostics', () => {
  const closeError = new Error('synthetic probe close failure');
  let closes = 0;
  const probe = {
    prepare: () => ({ get: () => ({ version: 'synthetic-sqlite-version' }) }),
    pragma: name => name === 'integrity_check' ? 'synthetic integrity corruption' : 4,
    close() { closes++; throw closeError; }
  };
  assert.throws(() => inspectSqliteProbe(probe, 'synthetic-database-path'), error => {
    assert.notEqual(error, closeError);
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.match(error.message, /Fresh profile database integrity failed/);
    assert.deepEqual(error.diagnostics, ['SQLite probe close failed: synthetic probe close failure']);
    return true;
  });
  assert.equal(closes, 1);
});