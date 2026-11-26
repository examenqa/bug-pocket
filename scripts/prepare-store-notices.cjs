'use strict';

// Store-only notice preparation and staged source verification. Imports only built-ins and the
// source notice collector; never imports Electron, native addons or builder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectProductionNotices } = require('./generate-third-party-notices.cjs');

// The Store copy carries the application copyright and a prominent runtime
// credit before the dependency notices. The runtime licence is copied below.
const storeNoticeHeader = Buffer.from(
  'Bug Pocket copyright (c) 2026 Examen QA.\n\n' +
  'Bug Pocket uses FFmpeg under the GNU Lesser General Public License, version 2.1 or later.\n' +
  'See electron/LICENSES.chromium.html for the FFmpeg copyright and licence notices.\n' +
  'FFmpeg source and licence: see ffmpeg-source/RECIPIENT.txt or https://bugpocket.app/help.\n\n'
);

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function candidateFile(root, name, label = 'candidate notice') {
  const file = path.join(root, name);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') fail('MISSING_INPUT', 'Missing ' + label + ' input: ' + name);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
    fail('INVALID_INPUT', 'Expected a nonempty regular file for ' + label + ': ' + name);
  }
  return fs.readFileSync(file);
}

function readFfmpegSource(root, appOutDir, identity, staged = false) {
  const manifest = 'compliance/ffmpeg-source-delivery.json';
  const { schemaVersion, release, files } = JSON.parse(candidateFile(root, manifest, 'FFmpeg source lock'));
  const ffmpeg = candidateFile(appOutDir, 'ffmpeg.dll', 'candidate FFmpeg DLL');
  const ffmpegDllSha256 = hash(ffmpeg);
  if (schemaVersion !== 1 || !release ||
      Object.entries({ ...identity, ffmpegDllSha256 }).some(([key, value]) => value == null || release[key] !== value)) {
    fail('FFMPEG_SOURCE_IDENTITY', 'Store package, Electron or alternate ffmpeg.dll does not match ' + manifest);
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(release.packageVersion)) {
    fail('INVALID_INPUT', 'Invalid AppX version in ' + manifest);
  }

  const archiveBase = 'bug-pocket-' + release.packageVersion + '-win-x64-electron-' +
    release.electronVersion + '-ffmpeg-source';
  const archiveName = archiveBase + '.zip';

  const names = [
    archiveName, archiveName + '.sha256', 'SOURCE-MAP.json', 'INVENTORY.json',
    'BUILDING.txt', 'RECIPIENT.txt', 'COPYING.LGPL-2.1.txt', 'OPUS-COPYING.txt', 'OPUS-LICENSE-PLEASE-READ.txt'
  ];
  if (!files || Object.keys(files).length !== names.length || names.some(name => !Object.hasOwn(files, name))) {
    fail('INVALID_INPUT', 'Incomplete FFmpeg source file list in ' + manifest);
  }

  const label = staged ? 'staged FFmpeg source delivery' :
    'FFmpeg source delivery (run python scripts/prepare-store-ffmpeg-source.py)';
  let directory = staged ? appOutDir : root;
  const subdirectories = staged ? ['resources', 'notices', 'ffmpeg-source'] :
    ['release-store', 'ffmpeg-source-delivery', archiveBase];
  for (const segment of subdirectories) {
    directory = path.join(directory, segment);
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!stat) fail('MISSING_INPUT', 'Missing ' + label + ': ' + directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_PATH', 'Invalid FFmpeg source directory: ' + directory);
  }
  const inputs = names.map(name => {
    const bytes = candidateFile(directory, name, label);
    if (bytes.length !== files[name]?.bytes || hash(bytes) !== files[name]?.sha256) {
      fail('CHANGED_INPUT', 'FFmpeg source delivery differs from ' + manifest + ': ' + name);
    }
    return { name, bytes };
  });
  const [archive, checksum, sourceMap] = inputs;
  const documentedRelease = JSON.parse(sourceMap.bytes).release;
  if (checksum.bytes.toString('utf8') !== files[archiveName].sha256 + '  ' + archiveName + '\n' ||
      Object.entries(release).some(([key, value]) => documentedRelease?.[key] !== value)) {
    fail('FFMPEG_SOURCE_IDENTITY', 'FFmpeg source checksum or source map does not match the release lock');
  }
  return {
    inputs,
    inventory: {
      release, path: 'ffmpeg-source/' + archive.name,
      bytes: archive.bytes.length, sha256: files[archive.name].sha256
    }
  };
}

function prepareStoreNotices({
  root, appOutDir, electronVersion, platform, architecture,
  packageName, packagePublisher, applicationId, applicationVersion, packageVersion
}) {
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
  const result = collectProductionNotices({ root, manifestPath: 'compliance/notices-inputs-sqlite13.json' });
  const ffmpegSource = readFfmpegSource(root, appOutDir, {
    electronVersion, platform, architecture,
    packageName, packagePublisher, applicationId, applicationVersion, packageVersion
  });
  const resources = path.join(appOutDir, 'resources');
  const stat = fs.lstatSync(resources);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('INVALID_PATH', 'Candidate resources must be a regular directory');
  const destination = path.join(resources, 'notices');
  // Validate all inputs before creating resources; never overwrite prior notices.
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'THIRD_PARTY_NOTICES.provisional.txt'),
    Buffer.concat([storeNoticeHeader, result.notices]), { flag: 'wx' });
  const inventory = {
    ...result.inventory,
    runtime: {
      selectedElectronVersion: selected, platform, architecture,
      expectedAlternateFFmpegAsset: `ffmpeg-v${selected}-${platform}-${architecture}.zip`,
      artifactVerification: 'pending',
      ffmpegSource: ffmpegSource.inventory,
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
  const sourceDirectory = path.join(destination, 'ffmpeg-source');
  fs.mkdirSync(sourceDirectory);
  for (const { name, bytes } of ffmpegSource.inputs) {
    fs.writeFileSync(path.join(sourceDirectory, name), bytes, { flag: 'wx' });
  }
  return inventory;
}

module.exports = async function storeNoticeHook(context) {
  const { packager } = context;
  const appx = packager.config.appx;
  return prepareStoreNotices({
    packageName: appx.identityName,
    packagePublisher: appx.publisher,
    applicationId: appx.applicationId,
    applicationVersion: packager.appInfo.version,
    packageVersion: packager.appInfo.getVersionInWeirdWindowsForm(appx.setBuildNumber === true),
    root: context.packager.projectDir,
    appOutDir: context.appOutDir,
    electronVersion: context.packager.info.framework.version,
    platform: context.electronPlatformName,
    // Pinned builder-util Arch.x64 = 1. No builder module is loaded by this hook.
    architecture: context.arch === 1 ? 'x64' : 'unsupported'
  });
};
module.exports.prepareStoreNotices = prepareStoreNotices;

function verifyStagedStoreFfmpegSource({ root, appOutDir }) {
  const stat = fs.lstatSync(appOutDir, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    fail('INVALID_PATH', 'Expected a regular prepackaged application directory: ' + appOutDir);
  }
  const metadata = JSON.parse(candidateFile(root, 'package.json', 'project metadata'));
  const electronVersion = metadata.devDependencies?.electron;
  if (!/^\d+\.\d+\.\d+$/.test(electronVersion || '')) fail('INVALID_INPUT', 'Expected a pinned Electron version');
  return readFfmpegSource(root, appOutDir, { electronVersion, platform: 'win32', architecture: 'x64' }, true).inventory;
}

module.exports.verifyStagedStoreFfmpegSource = verifyStagedStoreFfmpegSource;

if (require.main === module) {
  const [option, candidate, ...extra] = process.argv.slice(2);
  if (option !== '--verify-staged' || !candidate || extra.length !== 0) {
    console.error('Usage: node scripts/prepare-store-notices.cjs --verify-staged <unpacked-application-directory>');
    process.exitCode = 2;
  } else {
    try {
      const receipt = verifyStagedStoreFfmpegSource({
        root: path.resolve(__dirname, '..'), appOutDir: path.resolve(candidate)
      });
      console.log(JSON.stringify(receipt));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
