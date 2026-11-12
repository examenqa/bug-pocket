'use strict';

// Store-only future afterPack preparation. Imports only built-ins and the
// source notice collector; never imports Electron, native addons or builder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectProductionNotices } = require('./generate-third-party-notices.cjs');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function candidateFile(root, name) {
  const file = path.join(root, name);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') fail('MISSING_INPUT', 'Missing candidate notice input: ' + name);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
    fail('INVALID_INPUT', 'Candidate notice must be a nonempty regular file: ' + name);
  }
  return fs.readFileSync(file);
}

function prepareStoreNotices({ root, appOutDir, electronVersion, platform, architecture }) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const selected = metadata.devDependencies?.electron;
  if (platform !== 'win32' || architecture !== 'x64' || !/^\d+\.\d+\.\d+$/.test(selected || '') ||
      electronVersion !== selected) {
    fail('INVALID_INPUT', 'Store notices require the pinned Electron version and win32/x64 candidate');
  }
  // Builder 26.18.1 has already retained/renamed these files from THIS candidate.
  // Never fall back to node_modules/electron or a previously installed runtime.
  const runtimeFiles = ['LICENSE.electron.txt', 'LICENSES.chromium.html'].map(name => ({
    name, bytes: candidateFile(appOutDir, name)
  }));
  const result = collectProductionNotices({ root, manifestPath: 'compliance/notices-inputs.json' });
  const resources = path.join(appOutDir, 'resources');
  const stat = fs.lstatSync(resources);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('INVALID_PATH', 'Candidate resources must be a regular directory');
  const destination = path.join(resources, 'notices');
  // Validate all inputs before creating resources; never overwrite prior notices.
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'THIRD_PARTY_NOTICES.provisional.txt'), result.notices, { flag: 'wx' });
  const inventory = {
    ...result.inventory,
    runtime: {
      selectedElectronVersion: selected, platform, architecture,
      expectedAlternateFFmpegAsset: `ffmpeg-v${selected}-${platform}-${architecture}.zip`,
      artifactVerification: 'pending',
      notices: runtimeFiles.map(({ name, bytes }) => ({
        source: name, packagedPath: 'electron/' + name, bytes: bytes.length, sha256: hash(bytes)
      }))
    }
  };
  fs.writeFileSync(path.join(destination, 'third-party-inventory.provisional.json'),
    JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
  fs.mkdirSync(path.join(destination, 'electron'));
  for (const { name, bytes } of runtimeFiles) {
    fs.writeFileSync(path.join(destination, 'electron', name), bytes, { flag: 'wx' });
  }
  for (const original of result.originals) {
    const target = path.join(destination, 'originals', original.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, original.bytes, { flag: 'wx' });
  }
  return inventory;
}

module.exports = async function storeNoticeHook(context) {
  return prepareStoreNotices({
    root: context.packager.projectDir,
    appOutDir: context.appOutDir,
    electronVersion: context.packager.info.framework.version,
    platform: context.electronPlatformName,
    // Pinned builder-util Arch.x64 = 1. No builder module is loaded by this hook.
    architecture: context.arch === 1 ? 'x64' : 'unsupported'
  });
};
module.exports.prepareStoreNotices = prepareStoreNotices;
