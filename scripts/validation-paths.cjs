'use strict';
// Validation-only filesystem and identity checks. Importing this module never
// loads Electron, downloads a runtime, opens SQLite, or starts a child process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { inflateRawSync } = require('node:zlib');

const EXPECTED_VERSIONS = Object.freeze({ electron: '45.2.1', chrome: '156.0.8078.75', node: '24.22.1', v8: '15.6.75.25-electron.0', modules: '150' });
const OFFICIAL_RUNTIME = Object.freeze({ electron: '45.2.1', platform: 'win32', arch: 'x64', commit: 'f81ca3d4f09f57667238120adacb01239d5ecd89', assetId: 693536760, size: 158187314, sha256: '7c342aee45d5b4ccafe5dfe9037028796b082735a576e21e2b4e2d8422ebb727', checksumSha256: '7ffbf4a406ba5df5bd97e8a549ed1042af209456f98cf041c4dfababdc2f9abb', url: 'https://github.com/electron/electron/releases/download/v45.2.1/electron-v45.2.1-win32-x64.zip' });
const OWNER_FILE = '.bug-pocket-validation-owner.json';
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hashBytes(fs.readFileSync(file));
const samePath = (left, right) => path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
function inside(parent, child) { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }

// Node lstat recognizes junctions/symlinks, but does not expose every Windows
// reparse tag. Read FILE_ATTRIBUTE_REPARSE_POINT as well. Only future runner
// execution calls this; deterministic host tests inject attribute fixtures.
function inspectWindowsAttributes(paths) {
  assert.equal(process.platform, 'win32', 'Validation path attributes require Windows');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';$paths=ConvertFrom-Json ([Console]::In.ReadToEnd());$rows=@(foreach($p in $paths){$i=Get-Item -LiteralPath $p -Force;[pscustomobject]@{path=$p;attributes=[long]$i.Attributes}});ConvertTo-Json -InputObject $rows -Compress`;
  const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input: JSON.stringify(paths), encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  const rows = JSON.parse(output.replace(/^\uFEFF/, '').trim());
  assert.ok(Array.isArray(rows) && rows.length === paths.length, 'Incomplete Windows path-attribute response');
  return rows;
}
function defaultForbiddenRoots() {
  return [...Object.entries(process.env).filter(([key, value]) => /^OneDrive/i.test(key) && value).map(([, value]) => value), os.tmpdir(), process.env.TEMP, process.env.TMP, path.join(os.homedir(), 'AppData', 'Local', 'Temp'), path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp')].filter(Boolean);
}
function createPathGuard({ repositoryRoot, forbiddenRoots = defaultForbiddenRoots(), inspectAttributes = inspectWindowsAttributes, fsApi = fs } = {}) {
  assert.ok(repositoryRoot && path.isAbsolute(repositoryRoot), 'Pass an absolute repository root');
  const exclusions = [repositoryRoot, ...forbiddenRoots].map(value => path.resolve(value));
  function absolute(value) {
    assert.equal(typeof value, 'string', 'Path must be a string');
    assert.ok(path.isAbsolute(value), 'Path must be absolute');
    assert.ok(!/^\\\\|^\\\?\\/.test(value), 'UNC/device paths are not allowed');
    if (process.platform === 'win32') assert.match(value, /^[A-Za-z]:[\\/]/, 'Path must have an explicit local drive');
    const pieces = value.slice(path.parse(value).root.length).split(/[\\/]/);
    assert.ok(!pieces.some(piece => piece === '.' || piece === '..' || /[<>:"|?*\x00-\x1f]/.test(piece) || /[. ]$/.test(piece)), 'Ambiguous or escaping path component');
    return path.resolve(value);
  }
  function inspect(paths) {
    if (!paths.length) return;
    const rows = inspectAttributes(paths);
    assert.ok(Array.isArray(rows) && rows.length === paths.length, 'Incomplete reparse inspection');
    for (let i = 0; i < paths.length; i++) {
      assert.ok(samePath(rows[i].path, paths[i]), 'Path-attribute identity differs');
      assert.ok(Number.isSafeInteger(rows[i].attributes) && !(rows[i].attributes & 0x400), `Reparse point rejected: ${paths[i]}`);
    }
  }
  function check(value, { external = true, mustExist = false, directory = false, file = false } = {}) {
    const target = absolute(value);
    if (external) {
      assert.ok(!samePath(target, path.parse(target).root), 'Filesystem root is not a validation destination');
      assert.ok(!/(^|[\\/])OneDrive(?:[ -][^\\/]*)?([\\/]|$)/i.test(target), 'OneDrive paths are not allowed');
      assert.ok(!exclusions.some(root => inside(root, target)), 'Repository, OneDrive or system Temp destination rejected');
    }
    const existing = [];
    let current = path.parse(target).root;
    const pieces = target.slice(current.length).split(path.sep).filter(Boolean);
    const prefixes = [current];
    for (const piece of pieces) { current = path.join(current, piece); prefixes.push(current); }
    let targetStat;
    for (const prefix of prefixes) {
      let stat;
      try { stat = fsApi.lstatSync(prefix); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
      assert.equal(stat.isSymbolicLink(), false, `Link/junction rejected: ${prefix}`);
      assert.ok(stat.isDirectory() || stat.isFile(), `Unsupported path object: ${prefix}`);
      if (external && stat.isDirectory()) assert.equal(fsApi.existsSync(path.join(prefix, '.git')), false, `Git checkout destination rejected: ${prefix}`);
      if (stat.isFile()) assert.equal(stat.nlink, 1, `Hard-linked file rejected: ${prefix}`);
      assert.ok(samePath(fsApi.realpathSync(prefix), prefix), `Canonical path escape/alias rejected: ${prefix}`);
      existing.push(prefix);
      if (samePath(prefix, target)) targetStat = stat;
    }
    inspect(existing);
    if (mustExist) assert.ok(targetStat, `Required path is missing: ${target}`);
    if (directory && targetStat) assert.ok(targetStat.isDirectory(), `Expected directory: ${target}`);
    if (file && targetStat) assert.ok(targetStat.isFile(), `Expected regular file: ${target}`);
    return target;
  }
  function tree(value) {
    const target = check(value, { mustExist: true, directory: true });
    const objects = [];
    const pending = [target];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fsApi.readdirSync(current)) {
        const item = path.join(current, entry);
        assert.ok(inside(target, item), 'Profile tree escaped ownership root');
        const stat = fsApi.lstatSync(item);
        assert.equal(stat.isSymbolicLink(), false, `Profile link/junction rejected: ${item}`);
        assert.ok(stat.isDirectory() || stat.isFile(), 'Unsupported profile object');
        if (stat.isFile()) assert.equal(stat.nlink, 1, `Profile hard link rejected: ${item}`);
        assert.ok(samePath(fsApi.realpathSync(item), item), 'Profile canonical path escaped');
        objects.push(item);
        if (stat.isDirectory()) pending.push(item);
      }
    }
    inspect(objects);
    return target;
  }
  return { check, tree };
}
function assertOwnedProfile({ profileRoot, profile, ownerToken, repositoryRoot, label, guard = createPathGuard({ repositoryRoot }) }) {
  const root = guard.check(profileRoot, { mustExist: true, directory: true });
  const target = guard.check(profile, { mustExist: true, directory: true });
  assert.ok(inside(root, target) && !samePath(root, target) && samePath(path.dirname(target), root), 'Profile must be a direct owned child');
  guard.tree(target);
  const marker = guard.check(path.join(target, OWNER_FILE), { mustExist: true, file: true });
  const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.match(ownerToken || '', /^[a-f0-9-]{36}$/i, 'Invalid profile ownership token');
  assert.equal(owner.ownerToken, ownerToken, 'Profile ownership token differs');
  assert.equal(owner.label, label, 'Profile owner label differs');
  assert.ok(samePath(owner.profile, target) && samePath(owner.profileRoot, root), 'Profile ownership path differs');
  return target;
}
function prepareValidationPaths({ profileRoot, evidence, repositoryRoot, label, guard = createPathGuard({ repositoryRoot }) }) {
  assert.match(label || '', /^[a-z0-9-]+$/, 'Use a simple validation label');
  const parent = guard.check(profileRoot, { mustExist: true, directory: true });
  const output = guard.check(evidence, { file: true });
  guard.check(path.dirname(output), { mustExist: true, directory: true });
  assert.ok(!inside(parent, output), 'Evidence must be outside the profile root');
  assert.equal(fs.existsSync(output), false, 'Evidence destination already exists');
  // Every input was checked before the first write. The caller creates these
  // external parents explicitly; no recursive ancestor creation is attempted.
  const profile = fs.mkdtempSync(path.join(parent, `bug-pocket-${label}-`));
  const ownerToken = randomUUID();
  const owner = { ownerToken, label, profileRoot: parent, profile };
  fs.writeFileSync(path.join(profile, OWNER_FILE), JSON.stringify(owner) + '\n', { flag: 'wx' });
  const owned = () => assertOwnedProfile({ ...owner, repositoryRoot, guard });
  let evidenceCreated = false;
  function writeEvidence(value) {
    guard.check(path.dirname(output), { mustExist: true, directory: true });
    guard.check(output, { file: true });
    if (fs.existsSync(output)) {
      assert.ok(evidenceCreated, 'Refusing an unowned evidence file');
      assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).validationOwner, ownerToken, 'Evidence ownership differs');
    } else assert.equal(evidenceCreated, false, 'Owned evidence disappeared');
    const bytes = JSON.stringify({ ...value, validationOwner: ownerToken }, null, 2) + '\n';
    if (!evidenceCreated) { fs.writeFileSync(output, bytes, { flag: 'wx' }); evidenceCreated = true; }
    else {
      const staging = guard.check(path.join(path.dirname(output), `.bug-pocket-evidence-${randomUUID()}.json`));
      fs.writeFileSync(staging, bytes, { flag: 'wx' });
      guard.check(output, { mustExist: true, file: true });
      fs.renameSync(staging, output);
    }
  }
  async function removeProfile(target, options) {
    assert.ok(samePath(target, profile), 'Cleanup target is not the owned profile');
    owned();
    await fs.promises.rm(profile, options);
  }
  return { ...owner, evidence: output, assertOwned: owned, writeEvidence, removeProfile };
}
function assertMeasuredVersions(versions, { platform = process.platform, arch = process.arch } = {}) {
  assert.equal(platform, 'win32', 'Wrong measured platform');
  assert.equal(arch, 'x64', 'Wrong measured architecture');
  for (const [key, value] of Object.entries(EXPECTED_VERSIONS)) assert.equal(versions[key], value, `Wrong measured ${key}`);
  return { ...EXPECTED_VERSIONS, platform, arch };
}
// The official artifact is ZIP32. Read only the electron.exe entry; do not
// extract or execute it. Binding the measured executable hash to these verified
// archive bytes avoids trusting an arbitrary hash merely written into JSON.
function zipEntryDigest(archiveBytes, name) {
  let end = -1;
  for (let offset = archiveBytes.length - 22; offset >= Math.max(0, archiveBytes.length - 65557); offset--) {
    if (archiveBytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + archiveBytes.readUInt16LE(offset + 20) === archiveBytes.length) { end = offset; break; }
  }
  assert.ok(end >= 0, 'ZIP end record missing');
  assert.equal(archiveBytes.readUInt16LE(end + 4), 0, 'Split ZIP rejected');
  assert.equal(archiveBytes.readUInt16LE(end + 6), 0, 'Split ZIP rejected');
  const count = archiveBytes.readUInt16LE(end + 10);
  assert.equal(archiveBytes.readUInt16LE(end + 8), count, 'Split ZIP entry count');
  assert.ok(count !== 0xffff, 'ZIP64 is not accepted by this verification reader');
  let cursor = archiveBytes.readUInt32LE(end + 16);
  const centralEnd = cursor + archiveBytes.readUInt32LE(end + 12);
  assert.ok(centralEnd <= end, 'ZIP central directory outside archive');
  let found;
  for (let i = 0; i < count; i++) {
    assert.ok(cursor + 46 <= centralEnd && archiveBytes.readUInt32LE(cursor) === 0x02014b50, 'Malformed ZIP directory');
    const nameLength = archiveBytes.readUInt16LE(cursor + 28);
    const extraLength = archiveBytes.readUInt16LE(cursor + 30);
    const commentLength = archiveBytes.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    assert.ok(next <= centralEnd, 'ZIP entry outside directory');
    const entryName = archiveBytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (entryName === name) {
      assert.equal(found, undefined, 'Duplicate executable ZIP entry');
      assert.equal(archiveBytes.readUInt16LE(cursor + 8) & 1, 0, 'Encrypted ZIP rejected');
      const method = archiveBytes.readUInt16LE(cursor + 10);
      const compressed = archiveBytes.readUInt32LE(cursor + 20);
      const size = archiveBytes.readUInt32LE(cursor + 24);
      const local = archiveBytes.readUInt32LE(cursor + 42);
      assert.ok(size > 0 && size < 512 * 1024 * 1024 && compressed !== 0xffffffff && local !== 0xffffffff, 'Unsupported executable ZIP size');
      assert.ok(local + 30 <= archiveBytes.length && archiveBytes.readUInt32LE(local) === 0x04034b50, 'ZIP local header missing');
      const start = local + 30 + archiveBytes.readUInt16LE(local + 26) + archiveBytes.readUInt16LE(local + 28);
      assert.ok(start + compressed <= cursor, 'ZIP executable outside payload');
      const encoded = archiveBytes.subarray(start, start + compressed);
      assert.ok(method === 0 || method === 8, 'Unsupported ZIP compression');
      const bytes = method === 0 ? encoded : inflateRawSync(encoded, { maxOutputLength: size });
      assert.equal(bytes.length, size, 'ZIP executable size differs');
      found = { sha256: hashBytes(bytes), size };
    }
    cursor = next;
  }
  assert.equal(cursor, centralEnd, 'ZIP directory length differs');
  assert.ok(found, 'Executable missing from official ZIP');
  return found;
}
function createRuntimeVerifier({ official = OFFICIAL_RUNTIME, guardFactory = createPathGuard } = {}) {
  return function resolveVerifiedElectron({ repositoryRoot, executable, verification }) {
    const guard = guardFactory({ repositoryRoot });
    const metadataFile = guard.check(verification, { mustExist: true, file: true });
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    assert.equal(metadata.schemaVersion, 1, 'Unsupported runtime verification schema');
    for (const key of ['electron', 'platform', 'arch', 'commit']) assert.equal(metadata.runtime?.[key], official[key], `Wrong verified ${key}`);
    for (const key of ['sha256', 'size', 'assetId', 'url']) assert.equal(metadata.archive?.[key], official[key], `Wrong official archive ${key}`);
    assert.equal(metadata.checksums?.sha256, official.checksumSha256, 'Wrong official checksum-text identity');
    const archive = guard.check(metadata.archive.path, { mustExist: true, file: true });
    const checksums = guard.check(metadata.checksums.path, { mustExist: true, file: true });
    assert.equal(fs.statSync(archive).size, official.size, 'Downloaded archive byte count differs');
    const archiveBytes = fs.readFileSync(archive);
    assert.equal(hashBytes(archiveBytes), official.sha256, 'Downloaded archive SHA256 differs');
    assert.equal(hashFile(checksums), official.checksumSha256, 'Official checksum text bytes differ');
    const checksumLines = fs.readFileSync(checksums, 'utf8').split(/\r?\n/);
    assert.ok(checksumLines.some(line => line.trim() === `${official.sha256}  electron-v45.2.1-win32-x64.zip` || line.trim() === `${official.sha256} *electron-v45.2.1-win32-x64.zip`), 'Official runtime checksum line differs');
    const packageFile = guard.check(path.join(repositoryRoot, 'node_modules', 'electron', 'package.json'), { external: false, mustExist: true, file: true });
    assert.equal(JSON.parse(fs.readFileSync(packageFile, 'utf8')).version, '45.2.1', 'Wrong Electron npm wrapper');
    assert.equal(JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).devDependencies.electron, '45.2.1', 'Electron must be pinned exactly');
    const pathFile = guard.check(path.join(repositoryRoot, 'node_modules', 'electron', 'path.txt'), { external: false, mustExist: true, file: true });
    assert.equal(fs.readFileSync(pathFile, 'utf8').trim(), 'electron.exe', 'Unsafe/unexpected Electron wrapper path');
    const target = guard.check(executable, { external: false, mustExist: true, file: true });
    const expected = path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
    assert.ok(samePath(target, expected) && samePath(metadata.executable?.path || '', target), 'Executable differs from verified wrapper distribution');
    assert.match(metadata.executable?.sha256 || '', /^[a-f0-9]{64}$/, 'Invalid measured executable hash');
    assert.equal(hashFile(target), metadata.executable.sha256, 'Extracted executable SHA256 differs');
    assert.equal(fs.statSync(target).size, metadata.executable.size, 'Extracted executable size differs');
    const entry = zipEntryDigest(archiveBytes, 'electron.exe');
    assert.equal(entry.sha256, metadata.executable.sha256, 'Executable bytes do not match the official ZIP entry');
    assert.equal(entry.size, metadata.executable.size, 'Executable ZIP size differs');
    return { executable: target, sha256: entry.sha256, size: entry.size, verification: metadataFile, verificationSha256: hashFile(metadataFile), archive: { ...metadata.archive, path: archive }, checksums: { ...metadata.checksums, path: checksums }, runtime: { ...metadata.runtime }, signatureAssurance: 'none; tag/release metadata supplies no signature assurance' };
  };
}
const resolveVerifiedElectron = createRuntimeVerifier();
function readNativeIdentity(repositoryRoot, { guard = createPathGuard({ repositoryRoot }) } = {}) {
  const packageFile = guard.check(path.join(repositoryRoot, 'node_modules', 'better-sqlite3', 'package.json'), { external: false, mustExist: true, file: true });
  const packageVersion = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
  assert.equal(packageVersion, '12.11.1', 'Wrong native SQLite package');
  const binding = guard.check(path.join(repositoryRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'), { external: false, mustExist: true, file: true });
  return { binding, sha256: hashFile(binding), size: fs.statSync(binding).size, packageVersion, expectedAbi: '150', scope: 'File identity only; successful loading and SQLite version require the separately authorized Electron child.' };
}
module.exports = { EXPECTED_VERSIONS, OFFICIAL_RUNTIME, createPathGuard, prepareValidationPaths, assertOwnedProfile, assertMeasuredVersions, hashFile, readNativeIdentity, resolveVerifiedElectron, createRuntimeVerifier, zipEntryDigest };
