'use strict';

// Temporary host-only fixtures; no application/dependency/native code executes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const storeNoticeHook = require('./prepare-store-notices.cjs');
const { prepareStoreNotices } = storeNoticeHook;

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
  const application = { name: 'synthetic-store-notices', dependencies: { alpha: '1.2.3' }, devDependencies: { electron: '45.3.3' } };
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
  write(root, 'compliance/notices-inputs-sqlite13.json', json(manifest));
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
  const identity = {
    packageName: 'ExamenQA.BugPocket', packagePublisher: 'CN=Test Publisher', applicationId: 'BugPocket',
    applicationVersion: '1.1.0', packageVersion: '1.1.0.0', electronVersion: '45.3.3',
    platform: 'win32', architecture: 'x64'
  };
  const release = { ...identity, ffmpegDllSha256: hash(existing['ffmpeg.dll']) };
  const archiveBase = 'bug-pocket-1.1.0.0-win-x64-electron-45.3.3-ffmpeg-source';
  const archiveName = archiveBase + '.zip';
  const deliveryDir = 'release-store/ffmpeg-source-delivery/' + archiveBase;
  const archive = Buffer.from('synthetic archive checked against the fixture lock');
  const delivery = {
    [archiveName]: archive,
    [archiveName + '.sha256']: Buffer.from(hash(archive) + '  ' + archiveName + '\n'),
    'SOURCE-MAP.json': json({ release }),
    'INVENTORY.json': json({ release }),
    'BUILDING.txt': Buffer.from('fixture build instructions'),
    'RECIPIENT.txt': Buffer.from('fixture recipient instructions'),
    'COPYING.LGPL-2.1.txt': Buffer.from('fixture LGPL'),
    'OPUS-COPYING.txt': Buffer.from('fixture Opus terms'),
    'OPUS-LICENSE-PLEASE-READ.txt': Buffer.from('fixture Opus notice')
  };
  const deliveryLock = {
    schemaVersion: 1, release,
    files: Object.fromEntries(Object.entries(delivery).map(([name, bytes]) => [
      name, { bytes: bytes.length, sha256: hash(bytes) }
    ]))
  };
  write(root, 'compliance/ffmpeg-source-delivery.json', json(deliveryLock));
  for (const [name, bytes] of Object.entries(delivery)) write(root, path.join(deliveryDir, name), bytes);
  return { root, appOutDir, license, electron, chromium, existing, manifest, release,
    archiveName, deliveryDir, delivery, deliveryLock, options: { root, appOutDir, ...identity } };
}
function output(f, id) { return path.join(f.appOutDir, 'resources/notices', id); }

test('stages original notices with exact candidate bytes and version associations, preserving existing resources', t => {
  const f = fixture(t);
  const inventory = prepareStoreNotices(f.options);
  assert.deepEqual(fs.readFileSync(output(f, 'electron/LICENSE.electron.txt')), f.electron);
  assert.deepEqual(fs.readFileSync(output(f, 'electron/LICENSES.chromium.html')), f.chromium);
  assert.deepEqual(fs.readFileSync(output(f, 'originals/node_modules/alpha/LICENSE.txt')), f.license);
  const combined = fs.readFileSync(output(f, 'THIRD_PARTY_NOTICES.provisional.txt'));
  assert.ok(combined.toString('utf8').startsWith(
    'Bug Pocket copyright (c) 2026 Examen QA.\n\n' +
    'Bug Pocket uses FFmpeg under the GNU Lesser General Public License, version 2.1 or later.\n' +
    'See electron/LICENSES.chromium.html for the FFmpeg copyright and licence notices.\n' +
    'FFmpeg source and licence: see ffmpeg-source/RECIPIENT.txt or https://bugpocket.app/help.\n\n'
  ));
  assert.ok(combined.includes(f.license));
  assert.equal(inventory.packages[0].version, '1.2.3');
  assert.equal(inventory.runtime.selectedElectronVersion, '45.3.3');
  assert.equal(inventory.runtime.expectedAlternateFFmpegAsset, 'ffmpeg-v45.3.3-win32-x64.zip');
  assert.equal(inventory.runtime.artifactVerification, 'pending');
  const archive = f.delivery[f.archiveName];
  assert.deepEqual(inventory.runtime.ffmpegSource, {
    release: f.release, path: 'ffmpeg-source/' + f.archiveName, bytes: archive.length, sha256: hash(archive)
  });
  assert.deepEqual(fs.readdirSync(output(f, 'ffmpeg-source')).sort(), Object.keys(f.delivery).sort());
  for (const [name, bytes] of Object.entries(f.delivery)) {
    assert.deepEqual(fs.readFileSync(output(f, path.join('ffmpeg-source', name))), bytes);
  }
  assert.equal(inventory.releaseComplianceApproved, false);
  assert.deepEqual(inventory.runtime.notices.map(row => row.sha256), [hash(f.electron), hash(f.chromium)]);
  assert.deepEqual(JSON.parse(fs.readFileSync(output(f, 'third-party-inventory.provisional.json'))), inventory);
  for (const [id, bytes] of Object.entries(f.existing)) assert.deepEqual(fs.readFileSync(path.join(f.appOutDir, id)), bytes);
  assert.deepEqual(fs.readFileSync(path.join(f.appOutDir, 'LICENSE.electron.txt')), f.electron);
  assert.deepEqual(fs.readFileSync(path.join(f.appOutDir, 'LICENSES.chromium.html')), f.chromium);
});

test('the current Feather supplement is included verbatim in staged notices and originals alongside existing notices', t => {
  const repository = path.resolve(__dirname, '..');
  const reviewed = JSON.parse(fs.readFileSync(path.join(repository, 'compliance/notices-inputs-sqlite13.json')));
  const supplements = reviewed.inputs.filter(entry => entry.id === 'supplemental:feather-mit');
  assert.equal(supplements.length, 1, 'the active Store manifest must select the Feather supplement');
  const [supplement] = supplements;
  const [source] = supplement.sources;
  const feather = fs.readFileSync(path.join(repository, source.path));
  assert.equal(feather.length, 1118);
  assert.equal(hash(feather), '265e5e7218f3502707df75ee9b42b29c35368bde27894bf454040c449301f41c');
  assert.equal(source.startByte, 0);
  assert.equal(source.endByte, feather.length);
  assert.equal(source.sha256, hash(feather));
  assert.equal(supplement.textSha256, hash(feather));
  assert.equal(supplement.kind, 'supplemental');
  assert.match(feather.toString(), /Copyright \(c\) 2013-2023 Cole Bemis/);
  const lucide = reviewed.packages.find(entry => entry.name === 'lucide-react');
  assert.equal(lucide.version, '0.468.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(repository, 'package-lock.json')))
    .packages[lucide.path].version, '0.468.0');
  const isc = reviewed.inputs.find(entry => entry.id === 'notice:node_modules/lucide-react/LICENSE');
  assert.equal(isc.textSha256, '1e7290b35280a048667bbf0ebabac1c7fd52a75300e8b2946ac165715997f2bc');
  assert.equal(isc.sources[0].endByte, 880, 'the original pinned ISC notice remains complete and unchanged');

  const f = fixture(t);
  f.manifest.inputs.push(supplement);
  write(f.root, source.path, feather);
  write(f.root, 'compliance/notices-inputs-sqlite13.json', json(f.manifest));
  const inventory = prepareStoreNotices(f.options);
  const combined = fs.readFileSync(output(f, 'THIRD_PARTY_NOTICES.provisional.txt'));
  assert.ok(combined.includes(feather), 'the full authoritative text must accompany the package');
  assert.ok(combined.includes(f.license), 'the supplement must preserve preexisting notices');
  assert.deepEqual(fs.readFileSync(output(f, 'originals/' + source.path)), feather);
  assert.equal(inventory.counts.supplementalInputs, 1);
  assert.equal(inventory.inputs.find(entry => entry.id === supplement.id).textSha256, hash(feather));
  assert.deepEqual(inventory.pending, [...f.manifest.pending].sort((a, b) => a.id < b.id ? -1 : 1));
  assert.equal(inventory.releaseComplianceApproved, false);
});

test('missing or altered current Feather text fails before notice staging', async t => {
  const repository = path.resolve(__dirname, '..');
  const reviewed = JSON.parse(fs.readFileSync(path.join(repository, 'compliance/notices-inputs-sqlite13.json')));
  const supplement = reviewed.inputs.find(entry => entry.id === 'supplemental:feather-mit');
  assert.ok(supplement);
  for (const altered of [false, true]) {
    await t.test(altered ? 'altered' : 'missing', inner => {
      const f = fixture(inner);
      f.manifest.inputs.push(supplement);
      write(f.root, 'compliance/notices-inputs-sqlite13.json', json(f.manifest));
      if (altered) write(f.root, supplement.sources[0].path, 'Truncated MIT notice');
      assert.throws(() => prepareStoreNotices(f.options), { code: altered ? 'CHANGED_INPUT' : 'MISSING_INPUT' });
      assert.equal(fs.existsSync(output(f, '')), false);
    });
  }
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

test('Store afterPack obtains the AppX identity and version from the pinned builder context', async t => {
  const f = fixture(t);
  const context = {
    appOutDir: f.appOutDir, electronPlatformName: f.release.platform, arch: 1,
    packager: {
      projectDir: f.root, info: { framework: { version: f.release.electronVersion } },
      config: { appx: {
        identityName: f.release.packageName, publisher: f.release.packagePublisher,
        applicationId: f.release.applicationId, setBuildNumber: false
      } },
      appInfo: {
        version: f.release.applicationVersion,
        getVersionInWeirdWindowsForm(useBuildNumber) {
          assert.equal(useBuildNumber, false);
          return f.release.packageVersion;
        }
      }
    }
  };
  const inventory = await storeNoticeHook(context);
  assert.deepEqual(inventory.runtime.ffmpegSource.release, f.release);
});

test('rejects a different AppX name, publisher, application or version and different FFmpeg DLL bytes', t => {
  const f = fixture(t);
  for (const key of ['packageName', 'packagePublisher', 'applicationId', 'applicationVersion', 'packageVersion']) {
    assert.throws(() => prepareStoreNotices({ ...f.options, [key]: 'wrong' }), { code: 'FFMPEG_SOURCE_IDENTITY' }, key);
    assert.equal(fs.existsSync(output(f, '')), false);
  }
  const dll = path.join(f.appOutDir, 'ffmpeg.dll');
  fs.unlinkSync(dll);
  assert.throws(() => prepareStoreNotices(f.options), { code: 'MISSING_INPUT' });
  write(f.appOutDir, 'ffmpeg.dll', 'different candidate binary');
  assert.throws(() => prepareStoreNotices(f.options), { code: 'FFMPEG_SOURCE_IDENTITY' });
  assert.equal(fs.existsSync(output(f, '')), false);
});

test('every locked FFmpeg source delivery file is required and verified before copying', async t => {
  const f = fixture(t);
  for (const [name, bytes] of Object.entries(f.delivery)) {
    await t.test(name, () => {
      const file = path.join(f.deliveryDir, name);
      fs.unlinkSync(path.join(f.root, file));
      assert.throws(() => prepareStoreNotices(f.options),
        error => error.code === 'MISSING_INPUT' && error.message.includes(name));
      assert.equal(fs.existsSync(output(f, '')), false);
      const altered = Buffer.from(bytes);
      altered[0] ^= 1;
      write(f.root, file, altered);
      assert.throws(() => prepareStoreNotices(f.options),
        error => error.code === 'CHANGED_INPUT' && error.message.includes(name));
      assert.equal(fs.existsSync(output(f, '')), false);
      write(f.root, file, bytes);
    });
  }
});

test('rejects a false source-map association and linked FFmpeg input or output folders', async t => {
  await t.test('source map', inner => {
    const f = fixture(inner);
    const wrong = json({ release: { ...f.release, electronVersion: 'wrong' } });
    f.deliveryLock.files['SOURCE-MAP.json'] = { bytes: wrong.length, sha256: hash(wrong) };
    write(f.root, 'compliance/ffmpeg-source-delivery.json', json(f.deliveryLock));
    write(f.root, path.join(f.deliveryDir, 'SOURCE-MAP.json'), wrong);
    assert.throws(() => prepareStoreNotices(f.options), { code: 'FFMPEG_SOURCE_IDENTITY' });
    assert.equal(fs.existsSync(output(f, '')), false);
  });
  await t.test('source directory junction', inner => {
    const f = fixture(inner);
    const directory = path.join(f.root, f.deliveryDir);
    const relocated = path.join(f.root, 'relocated');
    fs.renameSync(directory, relocated);
    fs.symlinkSync(relocated, directory, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => prepareStoreNotices(f.options), { code: 'INVALID_PATH' });
    assert.equal(fs.existsSync(output(f, '')), false);
  });
  await t.test('candidate resources junction', inner => {
    const f = fixture(inner);
    const directory = path.join(f.appOutDir, 'resources');
    const relocated = path.join(f.appOutDir, 'untouched');
    fs.renameSync(directory, relocated);
    fs.symlinkSync(relocated, directory, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => prepareStoreNotices(f.options), { code: 'INVALID_PATH' });
    assert.equal(fs.existsSync(path.join(relocated, 'notices')), false);
  });
});

test('prepackaged preflight reads the staged source set and rejects missing or altered input', t => {
  const f = fixture(t);
  const { verifyStagedStoreFfmpegSource } = storeNoticeHook;
  const options = { root: f.root, appOutDir: f.appOutDir };
  assert.throws(() => verifyStagedStoreFfmpegSource(options), { code: 'MISSING_INPUT' });
  const inventory = prepareStoreNotices(f.options);
  fs.unlinkSync(path.join(f.root, f.deliveryDir, f.archiveName));
  assert.deepEqual(verifyStagedStoreFfmpegSource(options), inventory.runtime.ffmpegSource);
  const staged = output(f, 'ffmpeg-source/' + f.archiveName);
  const changed = Buffer.from(f.delivery[f.archiveName]);
  changed[0] ^= 1;
  fs.writeFileSync(staged, changed);
  assert.throws(() => verifyStagedStoreFfmpegSource(options), { code: 'CHANGED_INPUT' });
  assert.deepEqual(fs.readFileSync(staged), changed);
  fs.unlinkSync(staged);
  assert.throws(() => verifyStagedStoreFfmpegSource(options), { code: 'MISSING_INPUT' });
});
