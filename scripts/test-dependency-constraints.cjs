const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = resolve(__dirname, '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const lock = readJson(resolve(root, 'package-lock.json'));
const manifest = readJson(resolve(root, 'package.json'));
const braceVersions = new Map([[3, '1.1.21'], [5, '2.1.7'], [9, '2.1.7'], [10, '5.0.12']]);

function matchFunction(module) {
  const match = typeof module === 'function' ? module : module.minimatch ?? module.default;
  assert.equal(typeof match, 'function', 'minimatch must expose a callable matcher');
  return match;
}

function verifyPatterns(module, label) {
  const match = matchFunction(module);
  for (const [file, pattern, expected] of [
    ['a', 'a', true],
    ['a', '{a,b}', true],
    ['c', '{a,b}', false],
    ['file2.txt', 'file{1..3}.txt', true],
    ['file4.txt', 'file{1..3}.txt', false],
    ['x/b2.txt', 'x/{a,b}{1,2}.txt', true]
  ]) {
    assert.equal(match(file, pattern), expected, `${label}: ${file} against ${pattern}`);
  }
}

function packageName(location) {
  return location.split('node_modules/').at(-1);
}

function verifyLockChurn(baselinePath) {
  const baseline = readJson(resolve(baselinePath));
  const versionChanges = new Set(['brace-expansion', 'yauzl', '@types/yauzl']);
  const additions = new Set(['brace-expansion', 'balanced-match', 'concat-map']);
  const removals = new Set(['brace-expansion', 'extract-zip', 'fd-slicer', 'buffer-crc32']);
  const flagChanges = new Set(['@types/node', 'undici-types', 'debug', 'get-stream', 'ms']);
  const changed = [];

  const expectedRoot = structuredClone(baseline.packages['']);
  delete expectedRoot.dependencies['extract-zip'];
  expectedRoot.dependencies.yauzl = '3.4.0';
  expectedRoot.devDependencies['@types/yauzl'] = '3.4.0';
  assert.deepEqual(lock.packages[''], expectedRoot, 'unexpected root dependency changes');

  for (const location of new Set([...Object.keys(baseline.packages), ...Object.keys(lock.packages)])) {
    if (!location) continue;
    const before = baseline.packages[location];
    const after = lock.packages[location];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const name = packageName(location);
    if (!before) {
      assert.ok(additions.has(name), `unrelated lockfile addition: ${location}`);
    } else if (!after) {
      assert.ok(removals.has(name), `unrelated lockfile removal: ${location}`);
    } else if (!versionChanges.has(name)) {
      const comparableBefore = { ...before };
      const comparableAfter = { ...after };
      if (flagChanges.has(name)) {
        for (const flag of ['dev', 'optional', 'devOptional']) {
          delete comparableBefore[flag];
          delete comparableAfter[flag];
        }
      }
      assert.deepEqual(comparableAfter, comparableBefore, `unrelated lockfile change: ${location}`);
    }
    changed.push(`${location}: ${before?.version ?? 'absent'} -> ${after?.version ?? 'absent'}`);
  }
  console.log(`Scoped lockfile comparison passed (${changed.length} changed package records).`);
  changed.forEach((line) => console.log(`  ${line}`));
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--baseline-lock'),
    'usage: node scripts/test-dependency-constraints.cjs [--baseline-lock path]');
  assert.equal(manifest.dependencies.yauzl, '3.4.0');
  assert.equal(manifest.devDependencies['@types/yauzl'], '3.4.0');
  assert.equal(manifest.dependencies['extract-zip'], undefined);
  assert.equal(manifest.overrides['brace-expansion'], undefined, 'a global brace override breaks older minimatch APIs');
  assert.ok(!Object.keys(lock.packages).some((location) => packageName(location) === 'extract-zip'),
    'the unpatched extract-zip package must not remain in the dependency tree');

  const minimatchEntries = Object.entries(lock.packages)
    .filter(([location]) => /(?:^|\/)node_modules\/minimatch$/.test(location));
  assert.ok(minimatchEntries.length > 0, 'the lockfile must contain minimatch consumers');
  const seenMajors = new Set();
  for (const [location, entry] of minimatchEntries) {
    const packagePath = resolve(root, location, 'package.json');
    assert.ok(existsSync(packagePath), `missing installed dependency ${location}; run npm ci first`);
    const installed = readJson(packagePath);
    assert.equal(installed.version, entry.version, `${location} differs from the lockfile`);
    const major = Number(installed.version.split('.')[0]);
    const expectedBrace = braceVersions.get(major);
    assert.ok(expectedBrace, `review brace compatibility for new minimatch major ${major}`);
    assert.equal(manifest.overrides[`minimatch@${major}`]?.['brace-expansion'], expectedBrace);
    seenMajors.add(major);

    const requireFromPackage = createRequire(packagePath);
    const bracePackagePath = requireFromPackage.resolve('brace-expansion/package.json');
    const brace = readJson(bracePackagePath);
    assert.equal(brace.version, expectedBrace, `${location} resolved an incompatible brace version`);
    const braceLocation = dirname(bracePackagePath).slice(root.length + 1).replaceAll('\\', '/');
    assert.equal(lock.packages[braceLocation]?.version, brace.version, 'installed brace differs from the lockfile');
    verifyPatterns(requireFromPackage('./'), `${location} CommonJS`);
    const modulePath = installed.module
      ? resolve(dirname(packagePath), installed.module)
      : requireFromPackage.resolve('./');
    verifyPatterns(await import(pathToFileURL(modulePath).href), `${location} import`);
    console.log(`${location}@${installed.version} -> brace-expansion@${brace.version}: CommonJS/import patterns passed`);
  }
  assert.deepEqual([...seenMajors].sort((a, b) => a - b), [...braceVersions.keys()],
    'review the compatibility matrix when the installed minimatch majors change');
  if (args.length) verifyLockChurn(args[1]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
