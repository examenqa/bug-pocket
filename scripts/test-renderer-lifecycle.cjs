const { buildSync } = require('esbuild');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = mkdtempSync(join(tmpdir(), 'bug-pocket-renderer-lifecycle-'));
try {
  buildSync({ entryPoints: ['src/renderer/src/hooks/draftLifecycle.renderer-test.tsx'], bundle: true, outfile: join(directory, 'test.js'), platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
  writeFileSync(join(directory, 'test.html'), '<!doctype html><html><body><script src="test.js"></script></body></html>');
  writeFileSync(join(directory, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', require('node:path').join(__dirname, 'userData'));
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await window.loadFile(require('node:path').join(__dirname, 'test.html'));
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const result = await window.webContents.executeJavaScript('window.phase1Result');
        if (result) {
          result.passed.forEach(name => console.log('PASS ' + name));
          if (result.error) console.error(result.error);
          app.exit(result.error ? 1 : 0); return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      console.error('Renderer lifecycle test timed out'); app.exit(1);
    }).catch(error => { console.error(error); app.exit(1); });
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [join(directory, 'main.cjs')], { env, stdio: 'inherit', windowsHide: true, timeout: 60000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + require('node:path').sep)) throw new Error('Unexpected test directory');
  rmSync(directory, { recursive: true, force: true });
}
