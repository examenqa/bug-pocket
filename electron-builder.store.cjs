// Store-only configuration for the pinned electron-builder 26.18.1.
// Do not load this file or run the builder in the regular account.
// package.json's default NSIS configuration and version remain unchanged.
const { closeSync, existsSync, openSync, readSync, statSync } = require('node:fs');
const { join } = require('node:path');
const base = require('./package.json').build;

// Explicit provisional declarations for the first Windows 10 22H2/x64 trial.
// These are not measured compatibility results or the lowest supported OS.
// MaxVersionTested is a compatibility declaration, not an installation ceiling.
// Review both values against later Windows/API and installed-QA evidence.
const windowsRequirements = {
  minVersion: '10.0.19045.0',
  maxVersionTested: '10.0.19045.0'
};

const requiredArtwork = [
  ['StoreLogo.png', 50, 50],
  ['Square150x150Logo.png', 150, 150],
  ['Square44x44Logo.png', 44, 44],
  ['Wide310x150Logo.png', 310, 150]
];

function requireStoreInputs() {
  const missing = [];
  for (const field of ['minVersion', 'maxVersionTested']) {
    const value = windowsRequirements[field];
    if (typeof value !== 'string' || !/^10\.0\.\d+\.\d+$/.test(value)) {
      missing.push(`Windows ${field}`);
    }
  }

  for (const [name, width, height] of requiredArtwork) {
    let descriptor;
    try {
      descriptor = openSync(join(__dirname, 'build', 'appx', name), 'r');
      const header = Buffer.alloc(24);
      const count = readSync(descriptor, header, 0, header.length, 0);
      const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      if (count !== header.length ||
          !header.subarray(0, 8).equals(pngSignature) ||
          header.toString('ascii', 12, 16) !== 'IHDR' ||
          header.readUInt32BE(16) !== width ||
          header.readUInt32BE(20) !== height) {
        missing.push(`${name} (${width}x${height} PNG)`);
      }
    } catch {
      missing.push(`${name} (${width}x${height} PNG)`);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  if (!existsSync(join(__dirname, 'build', 'appx-startup.xml'))) {
    missing.push('build/appx-startup.xml');
  }
  const bridgePath = join(__dirname, 'native', 'store-startup', 'build', 'Release', 'bug_pocket_store_startup.node');
  if (!existsSync(bridgePath) || !statSync(bridgePath).isFile() || statSync(bridgePath).size === 0) {
    missing.push('Store startup native bridge (authorised QA compilation and acceptance pending)');
  }
  if (missing.length !== 0) {
    throw new Error(
      'Store packaging prerequisites remain unresolved: ' + missing.join('; ') +
      '. See docs/store-appx-packaging.txt. Do not use builder defaults or sample artwork.'
    );
  }
}

// A config-load guard also covers --prepackaged, which bypasses beforePack.
// It reads only these fixed local build inputs; no hooks, tools or network run here.
// Header/dimension checks are not a full PNG decoder or artwork/Windows acceptance.
requireStoreInputs();

module.exports = {
  ...base,
  extraMetadata: {
    ...base.extraMetadata,
    version: '1.1.0'
  },
  directories: {
    ...base.directories,
    output: 'release-store'
  },
  // This bridge is Store-only and remains outside ASAR. Preserve the existing
  // SQLite unpack/rebuild rules, resources, preload repair and afterPack hook.
  extraResources: [
    ...(base.extraResources || []),
    {
      from: 'native/store-startup/build/Release/bug_pocket_store_startup.node',
      to: 'store-startup/bug_pocket_store_startup.node'
    }
  ],
  win: {
    ...base.win,
    target: [{ target: 'appx', arch: ['x64'] }],
    artifactName: 'Bug-Pocket-Store-${version}-${arch}.${ext}'
  },
  appx: {
    identityName: 'ExamenQA.BugPocket',
    publisher: 'CN=8D9BF560-2073-427E-9DB1-92BB6AB1F379',
    publisherDisplayName: 'Examen QA',
    displayName: 'Bug Pocket',
    applicationId: 'BugPocket',
    languages: ['en-US'],
    capabilities: ['runFullTrust'],
    setBuildNumber: false,
    addAutoLaunchExtension: false,
    customExtensionsPath: 'build/appx-startup.xml',
    ...windowsRequirements
  }
};
