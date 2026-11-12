'use strict';

// Synthetic host-only fixtures. No installed application/dependency module is loaded.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectNotices, collectProductionNotices, writeOutputs } = require('./generate-third-party-notices.cjs');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const pendingIds = ['native-bare', 'native-sqlite', 'electron-chromium', 'ffmpeg', 'artwork', 'final-artifact', 'lucide-feather'];
const license = Buffer.from('MIT License\r\n\r\nCopyright (c) Synthetic Fixture Authors\r\n\r\nPermission is hereby granted, free of charge, to any person obtaining a copy\r\nof this software and associated documentation files (the "Software"), to deal\r\nin the Software without restriction, including without limitation the rights\r\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\r\ncopies of the Software, and to permit persons to whom the Software is\r\nfurnished to do so, subject to the following conditions:\r\n\r\nThe above copyright notice and this permission notice shall be included in all\r\ncopies or substantial portions of the Software.\r\n\r\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\r\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\r\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\r\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\r\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\r\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\r\nSOFTWARE.\r\n');

function write(root, relative, bytes) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

function fixture(t, options = {}) {
  const base = path.resolve(process.env.NOTICE_TEST_TMPDIR || os.tmpdir());
  const repository = path.resolve(__dirname, '..');
  assert.ok(base !== repository && !base.startsWith(repository + path.sep), 'fixtures must be outside the repository');
  fs.mkdirSync(base, { recursive: true });
  const envelope = fs.mkdtempSync(path.join(base, 'bug-pocket-notices-test-'));
  const root = path.join(envelope, 'root');
  fs.mkdirSync(root);
  t.after(() => {
    const resolved = path.resolve(envelope);
    assert.ok(resolved.startsWith(base + path.sep) && path.basename(resolved).startsWith('bug-pocket-notices-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const records = options.packages || [{ path: 'node_modules/alpha', name: 'alpha', version: '1.0.0' }];
  const dependencies = options.dependencies || Object.fromEntries(records.filter((entry) => entry.path.split('/node_modules/').length === 1).map((entry) => [entry.name, entry.version]));
  const application = { name: 'synthetic-notice-fixture', version: '1.0.0', dependencies };
  const lock = { name: application.name, version: application.version, lockfileVersion: 3, packages: { '': application } };
  const manifest = {
    schemaVersion: 1,
    status: 'provisional',
    releaseComplianceApproved: false,
    packageJsonSha256: '',
    packageLockSha256: '',
    packages: [],
    inputs: [],
    nativeFiles: [],
    pending: pendingIds.map((id) => ({ id, status: 'pending', reason: `Unresolved synthetic ${id} evidence.` })),
  };
  for (const record of records) {
    const metadata = { name: record.name, version: record.version, license: 'MIT', main: 'index.js', ...(record.dependencies ? { dependencies: record.dependencies } : {}) };
    const metadataBytes = json(metadata);
    write(root, `${record.path}/package.json`, metadataBytes);
    write(root, `${record.path}/index.js`, 'throw new Error("DEPENDENCY CODE MUST NEVER EXECUTE");\n');
    lock.packages[record.path] = { name: record.name, version: record.version, license: 'MIT', ...(record.dependencies ? { dependencies: record.dependencies } : {}) };
    manifest.packages.push({ path: record.path, name: record.name, version: record.version, metadataSha256: hash(metadataBytes) });
    const noticePath = `${record.path}/LICENSE`;
    write(root, noticePath, license);
    manifest.inputs.push({ id: 'notice-' + record.path.replace(/[^a-zA-Z0-9_-]/g, '-'), kind: 'notice', packagePath: record.path, sources: [{ path: noticePath, sha256: hash(license), startByte: 0, endByte: license.length }], textSha256: hash(license) });
  }
  const applicationBytes = json(application);
  const lockBytes = json(lock);
  write(root, 'package.json', applicationBytes);
  write(root, 'package-lock.json', lockBytes);
  manifest.packageJsonSha256 = hash(applicationBytes);
  manifest.packageLockSha256 = hash(lockBytes);
  const manifestPath = path.join(root, 'compliance', 'notice-inputs.json');
  const save = () => write(root, 'compliance/notice-inputs.json', json(manifest));
  save();
  return { root, envelope, manifestPath, manifest, save };
}

const run = (f) => collectNotices({ root: f.root, manifestPath: f.manifestPath });
const sorted = (values) => [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function rejectsCollection(f, code) {
  await assert.rejects(async () => run(f), (error) => {
    assert.ok(error instanceof Error);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

test('collects metadata and complete notice bytes without loading package entrypoints', async (t) => {
  const f = fixture(t);
  const result = await run(f);
  assert.ok(Buffer.isBuffer(result.notices));
  assert.ok(result.notices.includes(license), 'the complete CRLF license text must survive verbatim');
  assert.deepEqual(result.inventory.packages.map((entry) => [entry.path, entry.version]), [['node_modules/alpha', '1.0.0']]);
  assert.equal(result.inventory.status, 'provisional');
  assert.equal(result.inventory.releaseComplianceApproved, false);
});

test('keeps two physical nested versions of the same dependency distinct', async (t) => {
  const f = fixture(t, {
    packages: [
      { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0', dependencies: { shared: '1.0.0' } },
      { path: 'node_modules/beta', name: 'beta', version: '1.0.0', dependencies: { shared: '2.0.0' } },
      { path: 'node_modules/shared', name: 'shared', version: '1.0.0' },
      { path: 'node_modules/beta/node_modules/shared', name: 'shared', version: '2.0.0' },
    ],
    dependencies: { alpha: '1.0.0', beta: '1.0.0' },
  });
  const result = await run(f);
  assert.deepEqual(result.inventory.packages.filter((entry) => entry.name === 'shared').map((entry) => [entry.path, entry.version]).sort(), [
    ['node_modules/beta/node_modules/shared', '2.0.0'],
    ['node_modules/shared', '1.0.0'],
  ]);
});

test('preserves the complete reviewed README-embedded MIT section', async (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'node_modules/alpha/LICENSE'));
  const prefix = Buffer.from('# alpha\r\n\r\nUsage is not a notice.\r\n\r\n');
  const section = Buffer.concat([Buffer.from('## License\r\n\r\n'), license]);
  const readme = Buffer.concat([prefix, section]);
  write(f.root, 'node_modules/alpha/README.md', readme);
  f.manifest.inputs[0] = { id: 'alpha-readme-license', kind: 'notice', packagePath: 'node_modules/alpha', sources: [{ path: 'node_modules/alpha/README.md', sha256: hash(readme), startByte: prefix.length, endByte: readme.length }], textSha256: hash(section) };
  f.save();
  const result = await run(f);
  assert.ok(result.notices.includes(section));
  assert.ok(!result.notices.includes(prefix));
});

test('preserves reviewed copyright excerpts and verifies their complete source hash', async (t) => {
  const f = fixture(t);
  const excerpt = Buffer.from('/*! Copyright (c) Synthetic bundled library authors. MIT. */');
  const source = Buffer.concat([excerpt, Buffer.from('\nmodule.exports = 1;\n')]);
  write(f.root, 'node_modules/alpha/bundled.js', source);
  write(f.root, 'node_modules/alpha/bundled-copy.js', source);
  f.manifest.inputs.push({ id: 'bundled-copyright', kind: 'copyright-excerpt', packagePath: 'node_modules/alpha', sources: [{ path: 'node_modules/alpha/bundled.js', sha256: hash(source), startByte: 0, endByte: excerpt.length }, { path: 'node_modules/alpha/bundled-copy.js', sha256: hash(source), startByte: 0, endByte: excerpt.length }], textSha256: hash(excerpt) });
  f.save();
  assert.ok((await run(f)).notices.includes(excerpt));
  write(f.root, 'node_modules/alpha/bundled-copy.js', Buffer.concat([source, Buffer.from('// unrelated bytes changed\n')]));
  await rejectsCollection(f, 'CHANGED_INPUT');
});

test('rejects a missing reviewed license input', async (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'node_modules/alpha/LICENSE'));
  await rejectsCollection(f, 'MISSING_INPUT');
});

test('rejects changed license bytes without silently accepting the new text', async (t) => {
  const f = fixture(t);
  write(f.root, 'node_modules/alpha/LICENSE', Buffer.concat([license, Buffer.from('New unreviewed terms.\n')]));
  await rejectsCollection(f, 'CHANGED_INPUT');
});

test('rejects an unexpected notice file until its text has been reviewed', async (t) => {
  const f = fixture(t);
  write(f.root, 'node_modules/alpha/NOTICE', 'Unexpected third-party attribution.\n');
  await rejectsCollection(f, 'UNEXPECTED_INPUT');
});

test('rejects installed package version or metadata drift', async (t) => {
  const f = fixture(t);
  write(f.root, 'node_modules/alpha/package.json', json({ name: 'alpha', version: '2.0.0', license: 'MIT', main: 'index.js' }));
  await rejectsCollection(f);
});

test('rejects application/lock dependency drift rather than approving a new closure', async (t) => {
  const f = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(f.root, 'package-lock.json'), 'utf8'));
  lock.packages[''].dependencies.extra = '1.0.0';
  lock.packages['node_modules/extra'] = { name: 'extra', version: '1.0.0', license: 'MIT' };
  write(f.root, 'package-lock.json', json(lock));
  await rejectsCollection(f);
});

test('rejects traversal, absolute paths and noncanonical path separators', async (t) => {
  const paths = ['../outside-license.txt', '/outside-license.txt', 'C:/outside-license.txt', 'node_modules\\alpha\\LICENSE', 'node_modules/alpha/../LICENSE', 'node_modules/alpha//LICENSE'];
  for (const relative of paths) {
    await t.test(relative, async (inner) => {
      const f = fixture(inner);
      write(f.envelope, 'outside-license.txt', license);
      f.manifest.inputs[0].sources[0].path = relative;
      f.save();
      await rejectsCollection(f, 'INVALID_PATH');
    });
  }
});

test('rejects a directory junction/symlink that escapes the fixture root', async (t) => {
  const f = fixture(t);
  const outside = path.join(f.envelope, 'outside');
  write(outside, 'LICENSE', license);
  const link = path.join(f.root, 'node_modules/alpha/external');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  f.manifest.inputs[0].sources[0].path = 'node_modules/alpha/external/LICENSE';
  f.save();
  await rejectsCollection(f, 'INVALID_PATH');
});

test('does not depend on manifest ordering or machine-specific fixture paths', async (t) => {
  const settings = { packages: [{ path: 'node_modules/zeta', name: 'zeta', version: '1.0.0' }, { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0' }] };
  const first = fixture(t, settings);
  const second = fixture(t, settings);
  second.manifest.packages.reverse();
  second.manifest.inputs.reverse();
  second.manifest.pending.reverse();
  second.save();
  const a = await run(first);
  const b = await run(second);
  assert.deepEqual(a.notices, b.notices);
  assert.equal(JSON.stringify(a.inventory), JSON.stringify(b.inventory));
  const serialized = JSON.stringify(a.inventory);
  assert.ok(!serialized.includes(first.root) && !serialized.includes(second.root));
  assert.ok(!serialized.includes('generatedAt') && !serialized.includes('timestamp'));
  assert.deepEqual(a.inventory.packages.map((entry) => entry.path), ['node_modules/alpha', 'node_modules/zeta']);
});

test('preserves all unresolved dispositions in both notices and inventory', async (t) => {
  const f = fixture(t);
  f.manifest.pending.find((entry) => entry.id === 'artwork').reason = 'The owner has not supplied the original artwork rights chain.';
  f.save();
  const result = await run(f);
  assert.deepEqual(result.inventory.pending, sorted(f.manifest.pending));
  for (const entry of f.manifest.pending) assert.ok(result.notices.includes(Buffer.from(entry.reason)));
  assert.equal(result.inventory.releaseComplianceApproved, false);
});

test('rejects an approved pending entry or a missing required pending disposition', async (t) => {
  const approved = fixture(t);
  approved.manifest.pending.find((entry) => entry.id === 'ffmpeg').status = 'approved';
  approved.save();
  await rejectsCollection(approved, 'INVALID_MANIFEST');
  const omitted = fixture(t);
  omitted.manifest.pending = omitted.manifest.pending.filter((entry) => entry.id !== 'native-bare');
  omitted.save();
  await rejectsCollection(omitted, 'INVALID_MANIFEST');
});

test('cannot turn successful provisional collection into release compliance approval', async (t) => {
  const f = fixture(t);
  f.manifest.releaseComplianceApproved = true;
  f.save();
  await rejectsCollection(f, 'INVALID_MANIFEST');
});

test('records synthetic native bytes while keeping their provenance pending', async (t) => {
  const f = fixture(t);
  const bytes = Buffer.from([0, 1, 2, 3, 4]);
  const relative = 'node_modules/alpha/prebuilds/win32-x64/alpha.bare';
  write(f.root, relative, bytes);
  f.manifest.nativeFiles.push({ path: relative, sha256: hash(bytes), bytes: bytes.length });
  f.save();
  const result = await run(f);
  assert.ok(result.inventory.nativeFiles.some((entry) => entry.path === relative && entry.sha256 === hash(bytes)));
  assert.equal(result.inventory.pending.find((entry) => entry.id === 'native-bare').status, 'pending');
});



test('cannot truncate a standalone license even when the excerpt hash is updated', async (t) => {
  const f = fixture(t);
  const truncated = license.subarray(0, license.indexOf(Buffer.from('Permission is hereby granted')));
  f.manifest.inputs[0].sources[0].endByte = truncated.length;
  f.manifest.inputs[0].textSha256 = hash(truncated);
  f.save();
  await rejectsCollection(f, 'INVALID_MANIFEST');
});

test('rejects newly discovered unreviewed source copyright headers', async (t) => {
  const f = fixture(t);
  write(f.root, 'node_modules/alpha/new-bundled-library.js', '/*! Copyright (c) New Unreviewed Library Authors. MIT. */\nmodule.exports = 1;\n');
  await rejectsCollection(f, 'UNEXPECTED_INPUT');
});

test('rejects newly discovered unreviewed native payloads', async (t) => {
  const f = fixture(t);
  write(f.root, 'node_modules/alpha/prebuilds/win32-x64/unreviewed.bare', Buffer.from([0, 1, 2]));
  await rejectsCollection(f, 'UNEXPECTED_INPUT');
});

test('cannot write provisional outputs within the source root', async (t) => {
  const f = fixture(t);
  const result = await run(f);
  const output = path.join(f.root, 'generated-notices');
  assert.throws(() => writeOutputs(output, result, f.root), { code: 'INVALID_PATH' });
  assert.equal(fs.existsSync(output), false);
});

test('cannot write outputs through a junction/symlink parent into the source root', async (t) => {
  const f = fixture(t);
  const result = await run(f);
  const alias = path.join(f.envelope, 'source-alias');
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => writeOutputs(path.join(alias, 'generated-notices'), result, f.root), { code: 'INVALID_PATH' });
  assert.equal(fs.existsSync(path.join(f.root, 'generated-notices')), false);
});

test('preserves an existing external output directory and its original files', async (t) => {
  const f = fixture(t);
  const result = await run(f);
  const output = path.join(f.envelope, 'existing-evidence');
  const sentinel = Buffer.from('Original evidence must remain byte-identical.\r\n');
  write(output, 'sentinel.txt', sentinel);
  assert.throws(() => writeOutputs(output, result, f.root), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(path.join(output, 'sentinel.txt')), sentinel);
  assert.deepEqual(fs.readdirSync(output), ['sentinel.txt']);
});


// Correction regressions use independent expected identities, never a production export.
function hoistedFixture(t, dependencyName = 'shared') {
  return fixture(t, {
    packages: [
      { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0', dependencies: { [dependencyName]: '1.0.0' } },
      { path: 'node_modules/' + dependencyName, name: dependencyName, version: '1.0.0' },
    ],
    dependencies: { alpha: '1.0.0' },
  });
}

async function rejectsWithPath(f, code, relative) {
  await assert.rejects(async () => run(f), (error) => {
    assert.equal(error.code, code);
    assert.ok(error.message.includes(relative), 'failure must identify the offending filesystem candidate: ' + error.message);
    return true;
  });
}

test('correction: rejects unlisted nearer installed shadows containing NOTICE and native inputs', async (t) => {
  for (const name of ['shared', '@scope/shared']) {
    await t.test(name, async (inner) => {
      const f = hoistedFixture(inner, name);
      const candidate = 'node_modules/alpha/node_modules/' + name;
      write(f.root, candidate + '/package.json', json({ name, version: '99.0.0', main: 'index.js' }));
      write(f.root, candidate + '/index.js', 'throw new Error("UNREVIEWED SHADOW CODE MUST NOT EXECUTE");\n');
      write(f.root, candidate + '/NOTICE', 'Unreviewed shadow notice.\n');
      write(f.root, candidate + '/prebuilds/win32-x64/shadow.bare', Buffer.from([3, 1, 4, 1, 5]));
      await rejectsWithPath(f, 'UNEXPECTED_INPUT', candidate);
    });
  }
});

test('correction: rejects nested node_modules junctions on declared production edges', async (t) => {
  const f = hoistedFixture(t);
  const outside = path.join(f.envelope, 'linked-dependency-tree');
  write(outside, 'shared/package.json', json({ name: 'shared', version: '99.0.0' }));
  write(outside, 'shared/NOTICE', 'Unreviewed linked shadow notice.\n');
  write(outside, 'shared/prebuilds/win32-x64/shadow.bare', Buffer.from([2, 7, 1, 8]));
  const relative = 'node_modules/alpha/node_modules';
  fs.symlinkSync(outside, path.join(f.root, relative), process.platform === 'win32' ? 'junction' : 'dir');
  await rejectsWithPath(f, 'INVALID_PATH', relative);
});

test('correction: checks links before skipping unrelated nested node_modules subtrees', async (t) => {
  const f = fixture(t);
  const outside = path.join(f.envelope, 'unused-linked-tree');
  write(outside, 'unrelated/NOTICE', 'Still an invalid linked subtree.\n');
  const relative = 'node_modules/alpha/vendor/node_modules';
  fs.mkdirSync(path.dirname(path.join(f.root, relative)), { recursive: true });
  fs.symlinkSync(outside, path.join(f.root, relative), process.platform === 'win32' ? 'junction' : 'dir');
  await rejectsWithPath(f, 'INVALID_PATH', relative);
});

test('correction: checks directory type before skipping nested node_modules', async (t) => {
  const f = fixture(t);
  const relative = 'node_modules/alpha/vendor/node_modules';
  write(f.root, relative, 'A regular file cannot be a node_modules directory.\n');
  await rejectsWithPath(f, 'INVALID_PATH', relative);
});

test('correction: rejects a nearer dependency candidate with an invalid entry type', async (t) => {
  const f = hoistedFixture(t);
  const relative = 'node_modules/alpha/node_modules/shared';
  write(f.root, relative, 'A package candidate is a regular file, not a directory.\n');
  await rejectsWithPath(f, 'INVALID_PATH', relative);
});

test('correction: preserves valid hoisting, scoped packages and reviewed nested versions', async (t) => {
  const layouts = [
    {
      name: 'ordinary hoisting',
      packages: [
        { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0', dependencies: { shared: '1.0.0' } },
        { path: 'node_modules/shared', name: 'shared', version: '1.0.0' },
      ],
      dependencies: { alpha: '1.0.0' },
    },
    {
      name: 'scoped hoisting',
      packages: [
        { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0', dependencies: { '@scope/shared': '1.0.0' } },
        { path: 'node_modules/@scope/shared', name: '@scope/shared', version: '1.0.0' },
      ],
      dependencies: { alpha: '1.0.0' },
    },
    {
      name: 'reviewed nested scoped version',
      packages: [
        { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0', dependencies: { '@scope/shared': '2.0.0' } },
        { path: 'node_modules/@scope/shared', name: '@scope/shared', version: '1.0.0' },
        { path: 'node_modules/alpha/node_modules/@scope/shared', name: '@scope/shared', version: '2.0.0' },
      ],
      dependencies: { alpha: '1.0.0', '@scope/shared': '1.0.0' },
    },
    {
      name: 'nested dependency uses its reviewed ancestor-scoped sibling',
      packages: [
        { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0', dependencies: { beta: '1.0.0' } },
        { path: 'node_modules/alpha/node_modules/beta', name: 'beta', version: '1.0.0', dependencies: { '@scope/shared': '1.0.0' } },
        { path: 'node_modules/alpha/node_modules/@scope/shared', name: '@scope/shared', version: '1.0.0' },
      ],
      dependencies: { alpha: '1.0.0' },
    },
  ];
  for (const layout of layouts) {
    await t.test(layout.name, async (inner) => {
      const f = fixture(inner, layout);
      const result = await run(f);
      assert.deepEqual(result.inventory.packages.map((entry) => [entry.path, entry.version]).sort(),
        layout.packages.map((entry) => [entry.path, entry.version]).sort());
      assert.equal(result.inventory.status, 'provisional');
      assert.equal(result.inventory.releaseComplianceApproved, false);
    });
  }
});

test('correction: unrelated installed development dependencies do not become production inputs', async (t) => {
  const f = fixture(t);
  const app = JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'), 'utf8'));
  app.devDependencies = { 'development-only': '1.0.0' };
  const lock = JSON.parse(fs.readFileSync(path.join(f.root, 'package-lock.json'), 'utf8'));
  lock.packages[''].devDependencies = app.devDependencies;
  lock.packages['node_modules/development-only'] = { name: 'development-only', version: '1.0.0', dev: true };
  const appBytes = json(app), lockBytes = json(lock);
  write(f.root, 'package.json', appBytes);
  write(f.root, 'package-lock.json', lockBytes);
  f.manifest.packageJsonSha256 = hash(appBytes);
  f.manifest.packageLockSha256 = hash(lockBytes);
  write(f.root, 'node_modules/development-only/package.json', json({ name: 'development-only', version: '1.0.0' }));
  write(f.root, 'node_modules/development-only/index.js', 'throw new Error("DEVELOPMENT CODE MUST NEVER EXECUTE");\n');
  write(f.root, 'node_modules/development-only/NOTICE', 'Unrelated installed development notice.\n');
  write(f.root, 'node_modules/development-only/prebuilds/win32-x64/dev.bare', Buffer.from([1, 6, 1, 8]));
  f.save();
  const result = await run(f);
  assert.deepEqual(result.inventory.packages.map((entry) => entry.path), ['node_modules/alpha']);
  assert.equal(result.inventory.nativeFiles.length, 0);
});

test('correction: independently requires each of the seven pending dispositions', async (t) => {
  const independentlyExpected = [
    'artwork', 'electron-chromium', 'ffmpeg', 'final-artifact',
    'lucide-feather', 'native-bare', 'native-sqlite',
  ];
  for (const id of independentlyExpected) {
    await t.test(id, async (inner) => {
      const f = fixture(inner);
      assert.equal(f.manifest.pending.filter((entry) => entry.id === id).length, 1,
        'fixture must initially include the independently expected disposition');
      f.manifest.pending = f.manifest.pending.filter((entry) => entry.id !== id);
      f.save();
      await assert.rejects(async () => run(f), (error) => {
        assert.equal(error.code, 'INVALID_MANIFEST');
        assert.equal(error.message, 'Required pending disposition missing: ' + id);
        return true;
      });
    });
  }
});

const production = (f) => collectProductionNotices({ root: f.root, manifestPath: f.manifestPath });

test('production notices records current and reviewed root hashes without refreshing historical evidence', (t) => {
  const f = fixture(t);
  const reviewed = fs.readFileSync(f.manifestPath);
  const app = JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'), 'utf8'));
  app.devDependencies = { electron: '99.1.2' };
  const lock = JSON.parse(fs.readFileSync(path.join(f.root, 'package-lock.json'), 'utf8'));
  lock.packages[''].devDependencies = app.devDependencies;
  lock.packages['node_modules/electron'] = { version: '99.1.2', dev: true };
  write(f.root, 'package.json', json(app));
  write(f.root, 'package-lock.json', json(lock));
  const result = production(f);
  assert.equal(result.inventory.collectionMode, 'production-notices');
  assert.deepEqual(result.inventory.rootMetadata, [
    { path: 'package.json', reviewedSha256: f.manifest.packageJsonSha256,
      actualSha256: hash(json(app)), differsFromReviewed: true },
    { path: 'package-lock.json', reviewedSha256: f.manifest.packageLockSha256,
      actualSha256: hash(json(lock)), differsFromReviewed: true }
  ]);
  assert.deepEqual(fs.readFileSync(f.manifestPath), reviewed);
  assert.throws(() => run(f), { code: 'CHANGED_INPUT' }, 'forensic collection retains its strict root pins');
});

test('production notices requires original notice text for every production package', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'node_modules/alpha/LICENSE'));
  f.manifest.inputs = [];
  f.save();
  assert.throws(() => production(f), (error) => error.code === 'MISSING_INPUT' &&
    error.message.includes('node_modules/alpha'));
});

test('production notices associates nested versions in text and inventory using the longest package root', (t) => {
  const f = fixture(t, {
    packages: [
      { path: 'node_modules/alpha', name: 'alpha', version: '1.0.0', dependencies: { shared: '2.0.0' } },
      { path: 'node_modules/shared', name: 'shared', version: '1.0.0' },
      { path: 'node_modules/alpha/node_modules/shared', name: 'shared', version: '2.0.0' }
    ],
    dependencies: { alpha: '1.0.0', shared: '1.0.0' }
  });
  const result = production(f);
  for (const record of f.manifest.packages) {
    const input = result.inventory.inputs.find(entry => entry.packagePath === record.path);
    assert.deepEqual(input.packages, [{ name: record.name, path: record.path, version: record.version }]);
    assert.ok(result.notices.includes(Buffer.from(`${record.name}@${record.version} [${record.path}]`)));
  }
  assert.equal(result.inventory.packages.length, 3);
});

test('production notices rejects locked or installed version changes despite allowing root metadata drift', (t) => {
  const locked = fixture(t);
  const lock = JSON.parse(fs.readFileSync(path.join(locked.root, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/alpha'].version = '2.0.0';
  write(locked.root, 'package-lock.json', json(lock));
  assert.throws(() => production(locked), { code: 'CHANGED_INPUT' });
  const installed = fixture(t);
  write(installed.root, 'node_modules/alpha/package.json', json({ name: 'alpha', version: '2.0.0', license: 'MIT' }));
  assert.throws(() => production(installed), { code: 'CHANGED_INPUT' });
});

test('production notices excludes only the historical Electron npm wrapper and preserves other supplements', (t) => {
  const f = fixture(t);
  f.manifest.inputs.push({ id: 'supplemental:electron-npm-wrapper', kind: 'supplemental',
    sources: [{ path: 'node_modules/electron/LICENSE', sha256: hash(license), startByte: 0, endByte: license.length }],
    textSha256: hash(license) });
  const supplement = Buffer.from('Original supplemental source notice.\r\n');
  write(f.root, 'compliance/notice-sources/original-NOTICE.txt', supplement);
  f.manifest.inputs.push({ id: 'supplemental:original', kind: 'supplemental',
    sources: [{ path: 'compliance/notice-sources/original-NOTICE.txt', sha256: hash(supplement), startByte: 0, endByte: supplement.length }],
    textSha256: hash(supplement) });
  f.save();
  const result = production(f);
  assert.deepEqual(result.inventory.inputs.map(entry => entry.id), [f.manifest.inputs[0].id, 'supplemental:original']);
  assert.ok(result.notices.includes(supplement));
  assert.ok(!result.notices.includes(Buffer.from('supplemental:electron-npm-wrapper')));
  assert.deepEqual(result.inventory.excludedInputs.map(entry => entry.id), ['supplemental:electron-npm-wrapper']);
  assert.throws(() => run(f), { code: 'MISSING_INPUT' });
});

test('production notices returns deduplicated whole original files without changing bytes or copying surrounding source', (t) => {
  const f = fixture(t);
  const excerpt = Buffer.from('/*! Copyright (c) Synthetic bundled authors. MIT. */');
  const source = Buffer.concat([excerpt, Buffer.from('\r\nthrow new Error("SOURCE MUST NOT EXECUTE");\r\n')]);
  write(f.root, 'node_modules/alpha/bundled.js', source);
  f.manifest.inputs.push({ id: 'bundled-copyright', kind: 'copyright-excerpt',
    sources: [{ path: 'node_modules/alpha/bundled.js', sha256: hash(source), startByte: 0, endByte: excerpt.length }],
    textSha256: hash(excerpt) });
  f.manifest.inputs.push({ ...f.manifest.inputs[0], id: 'supplemental:same-original', kind: 'supplemental' });
  f.save();
  const result = production(f);
  assert.deepEqual(result.originals, [{ path: 'node_modules/alpha/LICENSE', bytes: license }]);
  assert.deepEqual(result.inventory.originals, [{ path: 'node_modules/alpha/LICENSE', bytes: license.length, sha256: hash(license) }]);
  assert.ok(result.notices.includes(excerpt));
  assert.ok(!result.notices.includes(Buffer.from('throw new Error')));
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'node_modules/alpha/bundled.js')), source);
});

test('production notices preserves a reviewed README license section without shipping the surrounding README', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'node_modules/alpha/LICENSE'));
  const prefix = Buffer.from('# Fixture usage\r\n\r\n');
  const readme = Buffer.concat([prefix, license]);
  write(f.root, 'node_modules/alpha/README.md', readme);
  f.manifest.inputs[0].sources = [{ path: 'node_modules/alpha/README.md', sha256: hash(readme), startByte: prefix.length, endByte: readme.length }];
  f.save();
  const result = production(f);
  assert.ok(result.notices.includes(license));
  assert.ok(!result.notices.includes(prefix));
  assert.deepEqual(result.originals, []);
});

test('production notices does not require or hash native payloads and keeps provenance pending', (t) => {
  const f = fixture(t);
  const relative = 'node_modules/alpha/prebuilds/win32-x64/alpha.node';
  const old = Buffer.from([1, 2, 3]);
  f.manifest.nativeFiles.push({ path: relative, sha256: hash(old), bytes: old.length });
  f.save();
  const missing = production(f);
  assert.deepEqual(missing.inventory.nativeFiles, []);
  assert.equal(missing.inventory.pending.find(entry => entry.id === 'native-sqlite').status, 'pending');
  assert.match(missing.inventory.nativePayloadVerification, /not-performed/);
  assert.throws(() => run(f), { code: 'MISSING_INPUT' });
  write(f.root, relative, Buffer.from([9, 8, 7, 6]));
  assert.deepEqual(production(f).notices, missing.notices);
  assert.throws(() => run(f), { code: 'CHANGED_INPUT' });
});

test('production notices fails clearly when an original required file is missing', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'node_modules/alpha/LICENSE'));
  assert.throws(() => production(f), (error) => error.code === 'MISSING_INPUT' &&
    error.message.includes('node_modules/alpha/LICENSE'));
});

test('production notices rejects production closure drift and unreviewed original notice text', (t) => {
  const changed = fixture(t);
  const app = JSON.parse(fs.readFileSync(path.join(changed.root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(changed.root, 'package-lock.json'), 'utf8'));
  app.dependencies.beta = '1.0.0';
  lock.packages['node_modules/beta'] = { name: 'beta', version: '1.0.0' };
  write(changed.root, 'package.json', json(app));
  write(changed.root, 'package-lock.json', json(lock));
  write(changed.root, 'node_modules/beta/package.json', json({ name: 'beta', version: '1.0.0' }));
  assert.throws(() => production(changed), { code: 'UNEXPECTED_INPUT' });
  const unexpected = fixture(t);
  write(unexpected.root, 'node_modules/alpha/NOTICE', 'Unreviewed original attribution.\n');
  assert.throws(() => production(unexpected), { code: 'UNEXPECTED_INPUT' });
});
