'use strict';

// Temporary host-only fixtures; no application/dependency/native code executes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const { prepareStoreNotices } = require('./prepare-store-notices.cjs');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function write(root, id, bytes) {
  const file = path.join(root, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
function fixture(t) {
  const envelope = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-pocket-store-notices-'));
  t.after(() => {
    const resolved = path.resolve(envelope);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('bug-pocket-store-notices-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const root = path.join(envelope, 'source');
  const appOutDir = path.join(envelope, 'candidate');
  const application = { name: 'synthetic-store-notices', dependencies: { alpha: '1.2.3' }, devDependencies: { electron: '45.2.1' } };
  const metadata = json({ name: 'alpha', version: '1.2.3', license: 'SEE LICENSE IN LICENSE.txt', main: 'index.js' });
  const license = Buffer.from('Original synthetic licence — α\r\nCopyright Fixture Authors\r\nALL ORIGINAL TERMS\r\n');
  const electron = Buffer.from('Original candidate Electron licence\r\nCopyright Candidate Authors\r\n');
  const chromium = Buffer.from('<!doctype html>\r\n<title>Candidate Chromium</title>\r\n<pre>Original complete terms — ©</pre>');
  const lock = { lockfileVersion: 3, packages: { '': application, 'node_modules/alpha': { version: '1.2.3' } } };
  const applicationBytes = json(application), lockBytes = json(lock);
  write(root, 'package.json', applicationBytes);
  write(root, 'package-lock.json', lockBytes);
  write(root, 'node_modules/alpha/package.json', metadata);
  write(root, 'node_modules/alpha/LICENSE.txt', license);
  write(root, 'node_modules/alpha/index.js', 'throw new Error("PACKAGE ENTRYPOINT MUST NEVER RUN");\n');
  const manifest = {
    schemaVersion: 1, status: 'provisional', releaseComplianceApproved: false,
    packageJsonSha256: hash(applicationBytes), packageLockSha256: hash(lockBytes),
    packages: [{ path: 'node_modules/alpha', name: 'alpha', version: '1.2.3', metadataSha256: hash(metadata) }],
    inputs: [{ id: 'alpha-license', kind: 'notice', packagePath: 'node_modules/alpha',
      textSha256: hash(license), sources: [{ path: 'node_modules/alpha/LICENSE.txt', sha256: hash(license), startByte: 0, endByte: license.length }] }],
    nativeFiles: [],
    pending: ['artwork', 'electron-chromium', 'ffmpeg', 'final-artifact', 'lucide-feather', 'native-bare', 'native-sqlite']
      .map(id => ({ id, status: 'pending', reason: 'Synthetic unresolved ' + id }))
  };
  write(root, 'compliance/notices-inputs.json', json(manifest));
  write(appOutDir, 'LICENSE.electron.txt', electron);
  write(appOutDir, 'LICENSES.chromium.html', chromium);
  // Existing startup, SQLite, media and preload resources are inert sentinels.
  const existing = {
    'resources/store-startup/bug_pocket_store_startup.node': Buffer.from([0, 1, 2]),
    'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node': Buffer.from([3, 4, 5]),
    'resources/assets/icon.png': Buffer.from([6, 7, 8]),
    'resources/app.asar': Buffer.from('synthetic preload/application sentinel'),
    'ffmpeg.dll': Buffer.from('synthetic media sentinel')
  };
  for (const [id, bytes] of Object.entries(existing)) write(appOutDir, id, bytes);
  return { root, appOutDir, license, electron, chromium, existing, manifest,
    options: { root, appOutDir, electronVersion: '45.2.1', platform: 'win32', architecture: 'x64' } };
}
function output(f, id) { return path.join(f.appOutDir, 'resources/notices', id); }

test('stages original notices with exact candidate bytes and version associations, preserving existing resources', t => {
  const f = fixture(t);
  const inventory = prepareStoreNotices(f.options);
  assert.deepEqual(fs.readFileSync(output(f, 'electron/LICENSE.electron.txt')), f.electron);
  assert.deepEqual(fs.readFileSync(output(f, 'electron/LICENSES.chromium.html')), f.chromium);
  assert.deepEqual(fs.readFileSync(output(f, 'originals/node_modules/alpha/LICENSE.txt')), f.license);
  assert.ok(fs.readFileSync(output(f, 'THIRD_PARTY_NOTICES.provisional.txt')).includes(f.license));
  assert.equal(inventory.packages[0].version, '1.2.3');
  assert.equal(inventory.runtime.selectedElectronVersion, '45.2.1');
  assert.equal(inventory.runtime.expectedAlternateFFmpegAsset, 'ffmpeg-v45.2.1-win32-x64.zip');
  assert.equal(inventory.runtime.artifactVerification, 'pending');
  assert.equal(inventory.releaseComplianceApproved, false);
  assert.deepEqual(inventory.runtime.notices.map(row => row.sha256), [hash(f.electron), hash(f.chromium)]);
  assert.deepEqual(JSON.parse(fs.readFileSync(output(f, 'third-party-inventory.provisional.json'))), inventory);
  for (const [id, bytes] of Object.entries(f.existing)) assert.deepEqual(fs.readFileSync(path.join(f.appOutDir, id)), bytes);
  assert.deepEqual(fs.readFileSync(path.join(f.appOutDir, 'LICENSE.electron.txt')), f.electron);
  assert.deepEqual(fs.readFileSync(path.join(f.appOutDir, 'LICENSES.chromium.html')), f.chromium);
});

test('fails before output for either missing candidate notice and never substitutes installed Electron files', async t => {
  for (const name of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
    await t.test(name, inner => {
      const f = fixture(inner);
      write(f.root, 'node_modules/electron/dist/' + name, 'OLD INSTALLED NOTICE MUST NOT BE USED');
      fs.unlinkSync(path.join(f.appOutDir, name));
      assert.throws(() => prepareStoreNotices(f.options), error => error.code === 'MISSING_INPUT' && error.message.includes(name));
      assert.equal(fs.existsSync(output(f, '')), false);
    });
  }
});

test('fails before output for a missing original production licence', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'node_modules/alpha/LICENSE.txt'));
  assert.throws(() => prepareStoreNotices(f.options), { code: 'MISSING_INPUT' });
  assert.equal(fs.existsSync(output(f, '')), false);
});

test('rejects a version/platform/architecture mismatch without staging output', t => {
  const f = fixture(t);
  for (const delta of [{ electronVersion: '43.1.0' }, { architecture: 'arm64' }, { platform: 'linux' }]) {
    assert.throws(() => prepareStoreNotices({ ...f.options, ...delta }), { code: 'INVALID_INPUT' });
    assert.equal(fs.existsSync(output(f, '')), false);
  }
});

test('rejects empty and linked candidate notice files', async t => {
  await t.test('empty', inner => {
    const f = fixture(inner);
    write(f.appOutDir, 'LICENSES.chromium.html', Buffer.alloc(0));
    assert.throws(() => prepareStoreNotices(f.options), { code: 'INVALID_INPUT' });
    assert.equal(fs.existsSync(output(f, '')), false);
  });
  await t.test('linked', inner => {
    const f = fixture(inner);
    fs.unlinkSync(path.join(f.appOutDir, 'LICENSE.electron.txt'));
    // A directory junction needs no Windows symlink privilege and is always invalid here.
    fs.symlinkSync(f.root, path.join(f.appOutDir, 'LICENSE.electron.txt'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => prepareStoreNotices(f.options), { code: 'INVALID_INPUT' });
    assert.equal(fs.existsSync(output(f, '')), false);
  });
});

test('never overwrites an existing notice resource directory', t => {
  const f = fixture(t);
  write(f.appOutDir, 'resources/notices/original-evidence.txt', 'preserve this original');
  assert.throws(() => prepareStoreNotices(f.options), { code: 'EEXIST' });
  assert.deepEqual(fs.readdirSync(output(f, '')), ['original-evidence.txt']);
  assert.equal(fs.readFileSync(output(f, 'original-evidence.txt'), 'utf8'), 'preserve this original');
});

test('produces identical notice resources in separate fixture directories', t => {
  const a = fixture(t), b = fixture(t);
  const first = prepareStoreNotices(a.options), second = prepareStoreNotices(b.options);
  assert.deepEqual(first, second);
  for (const id of ['THIRD_PARTY_NOTICES.provisional.txt', 'third-party-inventory.provisional.json',
    'electron/LICENSE.electron.txt', 'electron/LICENSES.chromium.html', 'originals/node_modules/alpha/LICENSE.txt']) {
    assert.deepEqual(fs.readFileSync(output(a, id)), fs.readFileSync(output(b, id)));
  }
});
