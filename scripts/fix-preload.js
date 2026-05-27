/**
 * Post-build fix for electron-vite v2.3.x
 *
 * electron-vite always rewrites preload references in the main bundle to
 * use `index.mjs`, but when the preload is built with `format: 'cjs'`, rollup
 * outputs `index.js` (its default CJS filename). This creates a file-not-found
 * mismatch at runtime. This script copies index.js -> index.mjs so Electron
 * finds the file at the path the main bundle expects. The content is still
 * CommonJS, which works fine in Electron's preload sandbox context.
 */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../out/preload/index.js');
const dest = path.resolve(__dirname, '../out/preload/index.mjs');

if (!fs.existsSync(src)) {
  console.error('[fix-preload] ERROR: out/preload/index.js not found. Run the build first.');
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log('[fix-preload] Copied out/preload/index.js -> out/preload/index.mjs');
