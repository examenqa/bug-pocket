'use strict';

// Provisional source-input collection only. Never loads package/application code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REQUIRED_PENDING = Object.freeze([
  'artwork', 'electron-chromium', 'ffmpeg', 'final-artifact', 'lucide-feather', 'native-bare', 'native-sqlite'
]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const noticeName = /^(licen[cs]e|copying|notice|copyright(?:notice)?|authors)([._-]|$)/i;
const sourceName = /\.(?:[cm]?js|ts|c|h|cpp)$/i;
const nativeName = /\.(?:node|bare|dll|exe)$/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function ensure(condition, message) {
  if (!condition) fail('INVALID_MANIFEST', message);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonical(value[key])]));
  }
  return value;
}
function relativeId(value) {
  if (typeof value !== 'string' || !value || /[\\:\x00-\x1f\x7f]/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..') ||
      path.posix.isAbsolute(value)) {
    fail('INVALID_PATH', 'Expected a contained, portable relative file identifier');
  }
  return value;
}
function hashValue(value) {
  ensure(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Expected a reviewed SHA-256');
}
function assertUnique(rows, key, label) {
  ensure(Array.isArray(rows), label + ' must be an array');
  const values = rows.map(row => row && row[key]);
  ensure(values.every(value => typeof value === 'string' && value.length > 0) &&
    new Set(values).size === values.length, label + ' requires unique ' + key);
}
function readContext(root) {
  const realRoot = fs.realpathSync(root);
  const cache = new Map();
  function contained(id, directory = false) {
    relativeId(id);
    let current = realRoot;
    for (const part of id.split('/')) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') fail('MISSING_INPUT', 'Missing input: ' + id);
        throw error;
      }
      if (stat.isSymbolicLink()) fail('INVALID_PATH', 'Linked inputs are not accepted: ' + id);
    }
    const relative = path.relative(realRoot, fs.realpathSync(current));
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      fail('INVALID_PATH', 'Input leaves repository: ' + id);
    }
    if (directory ? !fs.statSync(current).isDirectory() : !fs.statSync(current).isFile()) {
      fail('INVALID_PATH', 'Unexpected input type: ' + id);
    }
    return current;
  }
  function read(id) {
    if (!cache.has(id)) cache.set(id, fs.readFileSync(contained(id)));
    return cache.get(id);
  }
  function directoryCandidate(id) {
    relativeId(id);
    let current = realRoot;
    for (const part of id.split('/')) {
      current = path.join(current, part);
      let entry;
      try { entry = fs.lstatSync(current); }
      catch (error) {
        if (error.code === 'ENOENT') return false;
        if (error.code === 'ENOTDIR') fail('INVALID_PATH', 'Non-directory dependency candidate: ' + id);
        throw error;
      }
      if (entry.isSymbolicLink()) fail('INVALID_PATH', 'Linked dependency candidate: ' + id);
      if (!entry.isDirectory()) fail('INVALID_PATH', 'Non-directory dependency candidate: ' + id);
    }
    return true;
  }
  function checked(id, expectedHash) {
    hashValue(expectedHash);
    const bytes = read(id);
    if (sha256(bytes) !== expectedHash) fail('CHANGED_INPUT', 'Changed reviewed input: ' + id);
    return bytes;
  }
  function json(id, expectedHash) {
    try { return JSON.parse((expectedHash ? checked(id, expectedHash) : read(id)).toString('utf8')); }
    catch (error) {
      if (error.code) throw error;
      fail('INVALID_INPUT', 'Invalid JSON input: ' + id);
    }
  }
  return { root: realRoot, contained, directoryCandidate, read, checked, json };
}
function validateManifest(manifest) {
  ensure(manifest.schemaVersion === 1 && manifest.status === 'provisional' &&
    manifest.releaseComplianceApproved === false, 'Collector accepts provisional inputs only');
  hashValue(manifest.packageJsonSha256);
  hashValue(manifest.packageLockSha256);
  assertUnique(manifest.packages, 'path', 'packages');
  assertUnique(manifest.inputs, 'id', 'inputs');
  assertUnique(manifest.pending, 'id', 'pending');
  assertUnique(manifest.nativeFiles, 'path', 'nativeFiles');
  for (const id of REQUIRED_PENDING) {
    ensure(manifest.pending.some(entry => entry.id === id), 'Required pending disposition missing: ' + id);
  }
  for (const entry of manifest.pending) {
    ensure(entry.status === 'pending' && typeof entry.reason === 'string' && entry.reason.trim(),
      'Pending dispositions cannot be approved by this collector');
  }
  for (const entry of manifest.packages) {
    relativeId(entry.path);
    ensure(entry.path.startsWith('node_modules/') && typeof entry.name === 'string' &&
      typeof entry.version === 'string', 'Invalid reviewed package identity');
    hashValue(entry.metadataSha256);
  }
  for (const entry of manifest.inputs) {
    ensure(['notice', 'copyright-excerpt', 'supplemental'].includes(entry.kind), 'Unknown input kind');
    ensure(Array.isArray(entry.sources) && entry.sources.length > 0, 'Input sources are required');
    hashValue(entry.textSha256);
    if (entry.packagePath !== undefined) relativeId(entry.packagePath);
    for (const source of entry.sources) {
      relativeId(source.path);
      hashValue(source.sha256);
      ensure(Number.isSafeInteger(source.startByte) && Number.isSafeInteger(source.endByte) &&
        source.startByte >= 0 && source.endByte > source.startByte, 'Invalid reviewed byte range');
    }
  }
  for (const entry of manifest.nativeFiles) {
    relativeId(entry.path);
    hashValue(entry.sha256);
    ensure(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0, 'Invalid native input size');
  }
  const discovery = manifest.discovery || {};
  ensure(discovery.sourceHeaderScanBytes === undefined || discovery.sourceHeaderScanBytes === 12000,
    'Header discovery is bounded to the reviewed first 12000 bytes');
  ensure(!discovery.excludeSourcePaths || discovery.excludeSourcePaths.length === 0,
    'Source discovery exclusions require a collector change and review');
}
function resolvePackage(lock, from, name, context) {
  // Reconcile package-directory candidates, not application/dependency execution.
  ensure(typeof name === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name),
    'Invalid dependency name');
  const candidates = [];
  let base = from;
  while (true) {
    // Match package-root ancestry, including scoped parents; never add node_modules/node_modules.
    if (path.posix.basename(base) !== 'node_modules') {
      const candidate = (base ? base + '/' : '') + 'node_modules/' + name;
      relativeId(candidate);
      candidates.push(candidate);
    }
    if (!base) break;
    const parent = path.posix.dirname(base);
    base = parent === '.' ? '' : parent;
  }
  const reviewed = candidates.find(candidate => Object.hasOwn(lock.packages, candidate));
  for (const candidate of candidates) {
    const installed = context.directoryCandidate(candidate);
    if (installed) {
      if (candidate !== reviewed) {
        fail('UNEXPECTED_INPUT', 'Unreviewed installed dependency candidate: ' + candidate);
      }
      return candidate;
    }
    if (candidate === reviewed) {
      fail('MISSING_INPUT', 'Missing reviewed dependency candidate: ' + candidate);
    }
  }
  return null;
}
function closureFor(packageJson, lock, context) {
  ensure(lock.packages && typeof lock.packages === 'object', 'A packages-based npm lockfile is required');
  const reachable = new Set();
  const pending = [];
  const edges = [];
  const add = (from, dependencies, optionalDependencies = {}) => {
    for (const name of Object.keys({ ...dependencies, ...optionalDependencies }).sort(compare)) {
      const target = resolvePackage(lock, from, name, context);
      if (!target) {
        if (Object.hasOwn(optionalDependencies, name)) continue;
        fail('MISSING_INPUT', 'Unresolved dependency: ' + (from || '<application>') + ' -> ' + name);
      }
      edges.push({ from: from || '<application>', name, to: target });
      pending.push(target);
    }
  };
  add('', packageJson.dependencies || {}, packageJson.optionalDependencies || {});
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    relativeId(id);
    reachable.add(id);
    const entry = lock.packages[id];
    ensure(!entry.link, 'Linked lockfile packages require separate review');
    add(id, entry.dependencies || {}, entry.optionalDependencies || {});
  }
  const nonDev = Object.keys(lock.packages).filter(id => id && !lock.packages[id].dev).sort(compare);
  const paths = [...reachable].sort(compare);
  if (JSON.stringify(paths) !== JSON.stringify(nonDev)) {
    fail('UNEXPECTED_INPUT', 'Production closure and non-dev lock entries differ; review required');
  }
  return { paths, edges: edges.sort((a, b) => compare(a.from + ':' + a.name, b.from + ':' + b.name)) };
}
function headerExcerpts(bytes) {
  const top = bytes.subarray(0, 12000).toString('utf8');
  const blocks = top.match(/\/\*[\s\S]*?\*\/|(?:^|\n)(?:\/\/[^\n]*(?:\n|$))+/g) || [];
  return blocks.map(text => text.trim()).filter(text =>
    !text.startsWith('//# sourceMappingURL=') &&
    /copyright|@license|\(c\)|spdx-license-identifier/i.test(text));
}
function walkPackage(context, packagePath, callback) {
  const directory = context.contained(packagePath, true);
  function walk(current, id) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      const child = id + '/' + entry.name;
      const stat = fs.lstatSync(path.join(current, entry.name));
      if (stat.isSymbolicLink()) fail('INVALID_PATH', 'Linked package content requires review: ' + child);
      if (entry.name === 'node_modules') {
        if (!stat.isDirectory()) fail('INVALID_PATH', 'Non-directory nested node_modules: ' + child);
        continue; // Declared edges reconcile physical packages; unrelated dev packages are not production.
      }
      if (stat.isDirectory()) walk(path.join(current, entry.name), child);
      else if (stat.isFile()) callback(child, entry.name);
      else fail('INVALID_PATH', 'Non-file package content requires review: ' + child);
    }
  }
  walk(directory, packagePath);
}
function collectNotices({ root, manifestPath }) {
  const context = readContext(root);
  const manifestFile = path.resolve(root, manifestPath);
  const manifestId = path.relative(context.root, manifestFile).split(path.sep).join('/');
  const manifest = context.json(manifestId);
  validateManifest(manifest);
  const packageJson = context.json('package.json', manifest.packageJsonSha256);
  const lock = context.json('package-lock.json', manifest.packageLockSha256);
  const closure = closureFor(packageJson, lock, context);
  const packages = [...manifest.packages].sort((a, b) => compare(a.path, b.path));
  if (JSON.stringify(packages.map(entry => entry.path)) !== JSON.stringify(closure.paths)) {
    fail('UNEXPECTED_INPUT', 'Reviewed package set differs from the active dependency closure');
  }
  const inventoryPackages = packages.map(entry => {
    const metadata = context.json(entry.path + '/package.json', entry.metadataSha256);
    if (metadata.name !== entry.name || metadata.version !== entry.version ||
        lock.packages[entry.path].version !== entry.version) {
      fail('CHANGED_INPUT', 'Changed package identity: ' + entry.path);
    }
    return { ...entry, manifestLicense: metadata.license ?? null,
      parents: closure.edges.filter(edge => edge.to === entry.path).map(edge => ({ from: edge.from, name: edge.name })) };
  });
  const inputs = [...manifest.inputs].sort((a, b) => compare(a.id, b.id)).map(entry => ({
    ...entry, sources: [...entry.sources].sort((a, b) =>
      compare(a.path, b.path) || a.startByte - b.startByte || a.endByte - b.endByte)
  }));
  const selections = new Map();
  const knownNotices = new Set();
  const knownHeaders = new Set();
  for (const entry of inputs) {
    let first;
    for (const source of entry.sources) {
      const bytes = context.checked(source.path, source.sha256);
      if (source.endByte > bytes.length) fail('CHANGED_INPUT', 'Reviewed range exceeds input: ' + source.path);
      const standaloneNotice = noticeName.test(path.posix.basename(source.path)) &&
        !/\.(?:[cm]?js|map|ts)$/i.test(source.path);
      if (standaloneNotice && (source.startByte !== 0 || source.endByte !== bytes.length)) {
        fail('INVALID_MANIFEST', 'Standalone license/notice files must be preserved in full: ' + source.path);
      }
      const selected = bytes.subarray(source.startByte, source.endByte);
      if (sha256(selected) !== entry.textSha256) fail('CHANGED_INPUT', 'Changed reviewed text: ' + entry.id);
      if (first && !first.equals(selected)) fail('CHANGED_INPUT', 'Conflicting reviewed text: ' + entry.id);
      first = selected;
      if (entry.kind === 'notice' && noticeName.test(path.posix.basename(source.path)) &&
          !/\.(?:[cm]?js|map|ts)$/i.test(source.path)) knownNotices.add(source.path);
      if (entry.kind === 'copyright-excerpt') knownHeaders.add(source.path + ':' + entry.textSha256);
    }
    // Reject invalid UTF-8 instead of replacing bytes in a license document.
    try { new TextDecoder('utf-8', { fatal: true }).decode(first); }
    catch { fail('INVALID_INPUT', 'Notice input is not UTF-8: ' + entry.id); }
    selections.set(entry.id, first);
  }
  const nativeFiles = [...manifest.nativeFiles].sort((a, b) => compare(a.path, b.path));
  const expectedNative = new Map(nativeFiles.map(entry => [entry.path, entry]));
  const observedNotices = new Set();
  const observedHeaders = new Set();
  const observedNative = new Set();
  for (const entry of packages) {
    walkPackage(context, entry.path, (id, basename) => {
      if (noticeName.test(basename) && !/\.(?:[cm]?js|map|ts)$/i.test(basename)) {
        observedNotices.add(id);
        if (!knownNotices.has(id)) fail('UNEXPECTED_INPUT', 'Unreviewed notice input: ' + id);
      }
      if (sourceName.test(basename)) {
        for (const text of headerExcerpts(context.read(id))) {
          const key = id + ':' + sha256(Buffer.from(text));
          observedHeaders.add(key);
          if (!knownHeaders.has(key)) fail('UNEXPECTED_INPUT', 'Unreviewed source copyright input: ' + id);
        }
      }
      if (nativeName.test(basename)) {
        observedNative.add(id);
        const expected = expectedNative.get(id);
        if (!expected) fail('UNEXPECTED_INPUT', 'Unreviewed native payload: ' + id);
        const bytes = context.checked(id, expected.sha256);
        if (bytes.length !== expected.bytes) fail('CHANGED_INPUT', 'Changed native input size: ' + id);
      }
    });
  }
  for (const id of knownNotices) {
    if (!observedNotices.has(id)) fail('INVALID_MANIFEST', 'Notice is outside reviewed package discovery: ' + id);
  }
  for (const id of knownHeaders) {
    if (!observedHeaders.has(id)) fail('INVALID_MANIFEST', 'Copyright input is outside reviewed header discovery: ' + id);
  }
  for (const id of expectedNative.keys()) {
    if (!observedNative.has(id)) fail('MISSING_INPUT', 'Missing native payload: ' + id);
  }
  const pending = [...manifest.pending].sort((a, b) => compare(a.id, b.id)).map(entry => ({ ...entry }));
  const counts = {
    packages: packages.length,
    noticeInputs: inputs.filter(entry => entry.kind === 'notice').length,
    copyrightExcerpts: inputs.filter(entry => entry.kind === 'copyright-excerpt').length,
    copyrightSourceOccurrences: inputs.filter(entry => entry.kind === 'copyright-excerpt')
      .reduce((sum, entry) => sum + entry.sources.length, 0),
    supplementalInputs: inputs.filter(entry => entry.kind === 'supplemental').length,
    nativeFiles: nativeFiles.length
  };
  const differences = [];
  for (const key of ['packages', 'noticeInputs', 'copyrightExcerpts']) {
    if (manifest.diagnosisCounts && counts[key] !== manifest.diagnosisCounts[key]) {
      differences.push({ count: key, diagnosis: manifest.diagnosisCounts[key], collected: counts[key] });
    }
  }
  const inventory = canonical({
    schemaVersion: 1, status: 'provisional', releaseComplianceApproved: false,
    scope: 'Reviewed source inputs and prospective package closure; no packaged runtime or legal acceptance.',
    packageJsonSha256: manifest.packageJsonSha256, packageLockSha256: manifest.packageLockSha256,
    counts, diagnosisCounts: manifest.diagnosisCounts || null,
    reconciliation: { differences, supplementalReason: manifest.reconciliation?.supplementalReason || null },
    discovery: { sourceHeaderScanBytes: 12000, note: 'Bounded source-header discovery is not full artifact/bundle license analysis.' },
    packages: inventoryPackages, inputs, nativeFiles, pending,
    sourceSnapshots: [...(manifest.sourceSnapshots || [])].sort((a, b) =>
      compare(a.path || a.id || JSON.stringify(canonical(a)), b.path || b.id || JSON.stringify(canonical(b))))
  });
  const chunks = [Buffer.from('BUG POCKET — PROVISIONAL THIRD-PARTY NOTICES\n' +
    'Reviewed input collection only. NOT RELEASE COMPLIANCE APPROVAL.\n' +
    'Actual bundled/native/runtime/FFmpeg/artwork and Store acceptance remain pending.\n\n' +
    pending.map(entry => 'PENDING ' + entry.id + ': ' + entry.reason).join('\n') + '\n')];
  for (const entry of inputs) {
    const first = entry.sources[0];
    chunks.push(Buffer.from('\n' + '='.repeat(78) + '\n' + entry.id + '\nKind: ' + entry.kind +
      '\nSource: ' + first.path + '\nSource SHA-256: ' + first.sha256 +
      '\nReviewed text SHA-256: ' + entry.textSha256 +
      '\nAll source occurrences/ranges/hashes: third-party-inventory.provisional.json (' +
      entry.sources.length + ')\n' + (entry.disposition ? entry.disposition + '\n' : '') + '\n'));
    chunks.push(selections.get(entry.id));
    chunks.push(Buffer.from('\n'));
  }
  return { notices: Buffer.concat(chunks), inventory };
}
function writeOutputs(outputDirectory, result, root) {
  const destination = path.resolve(outputDirectory);
  // CLI intentionally needs a fresh external directory: never overwrite inputs or earlier evidence.
  const parent = fs.realpathSync(path.dirname(destination));
  const actual = path.join(parent, path.basename(destination));
  const relative = path.relative(fs.realpathSync(root), actual);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('INVALID_PATH', 'Output must be outside the source repository');
  }
  fs.mkdirSync(actual); // EEXIST deliberately preserves previous outputs.
  fs.writeFileSync(path.join(actual, 'THIRD_PARTY_NOTICES.provisional.txt'), result.notices, { flag: 'wx' });
  fs.writeFileSync(path.join(actual, 'third-party-inventory.provisional.json'),
    JSON.stringify(result.inventory, null, 2) + '\n', { flag: 'wx' });
}
function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!['--root', '--manifest', '--out'].includes(flag) || !argv[index + 1] || options[flag]) {
      fail('INVALID_ARGUMENT', 'Usage: node scripts/generate-third-party-notices.cjs --root ROOT --manifest RELATIVE_JSON --out NEW_EXTERNAL_DIRECTORY');
    }
    options[flag] = argv[index + 1];
  }
  if (!options['--root'] || !options['--manifest'] || !options['--out']) {
    fail('INVALID_ARGUMENT', 'Explicit --root, --manifest and --out are required');
  }
  const result = collectNotices({ root: options['--root'], manifestPath: options['--manifest'] });
  writeOutputs(options['--out'], result, options['--root']);
  console.log(JSON.stringify({ status: result.inventory.status, releaseComplianceApproved: false,
    counts: result.inventory.counts, pendingDispositions: result.inventory.pending.length,
    noticesSha256: sha256(result.notices),
    inventorySha256: sha256(Buffer.from(JSON.stringify(result.inventory, null, 2) + '\n')) }, null, 2));
}
module.exports = { collectNotices, writeOutputs };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error((error.code || 'COLLECTION_FAILED') + ': ' + error.message); process.exitCode = 1; }
}

