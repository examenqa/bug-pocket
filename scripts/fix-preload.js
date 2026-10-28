/**
 * Preserve the application's existing production preload path.
 *
 * With electron-vite 6 and our explicit CommonJS configuration, the generated
 * preload is index.js. The application's preloadPath() uses that file in dev
 * and prefers index.mjs in production, with an index.js fallback. Keep the
 * historical copy for start/packaged execution; the extension does not turn its
 * contents into ESM in Electron's sandboxed preload loader. Normal startup,
 * real IPC and isolation are verified by test:toolchain-startup in all modes.
 * This is an application compatibility convention, not an unconditional
 * electron-vite rewrite. See docs/vite-toolchain.md for the traced output.
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
