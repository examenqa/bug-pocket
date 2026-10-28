const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const { createServer: createTcpServer } = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

// Only synthetic files are served. The embedded launch-editor code runs in a VM
// whose filesystem and child_process operations are inert recording doubles:
// no editor is launched, and no UNC path ever reaches the Windows filesystem.
const root = path.resolve(__dirname, '..');
const records = [];
const record = (check, details) => { records.push({ check, ...details }); console.log(`PASS ${check}`); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function freePort() {
  // Vite treats numeric 0 as its default port instead of asking the OS for an
  // ephemeral port. Choose a real free port so independent dev checks can run.
  const reservation = createTcpServer();
  await new Promise((resolveListen, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = reservation.address().port;
  await new Promise((resolveClose, reject) => reservation.close(error => error ? reject(error) : resolveClose()));
  return port;
}

function request(port, requestPath, headers = {}, headersOnly = false) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path: requestPath, headers }, res => {
      if (headersOnly) {
        resolve({ status: res.statusCode, headers: res.headers, body: '' });
        res.destroy();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.setTimeout(10_000, () => req.destroy(new Error(`Timed out: ${requestPath}`)));
    req.on('error', reject);
    req.end();
  });
}

function bundledEditorChecks(viteRoot) {
  const chunks = path.join(viteRoot, 'dist/node/chunks');
  const candidates = fs.readdirSync(chunks).filter(name => name.endsWith('.js'))
    .map(name => ({ file: path.join(chunks, name), source: fs.readFileSync(path.join(chunks, name), 'utf8') }))
    .filter(({ source }) => source.includes('function launchEditor(file, specifiedEditor, onErrorCallback)'));
  assert.equal(candidates.length, 1, 'Locate exactly one actual Vite-bundled launch-editor implementation');
  const { file, source } = candidates[0];
  const start = source.lastIndexOf('const os = require$$2;', source.indexOf('var getArgs = function getArgumentsForFile'));
  const endMarker = 'var launchEditor_1 = launchEditor;';
  const end = source.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end > start, 'Review bundled editor extraction if Vite changes its bundle structure');
  const editorSource = source.slice(start, end);

  function loadEditor(platform, pathModule, release = 'synthetic-Windows') {
    const io = { exists: [], commands: [], errors: [] };
    const child = () => ({ on() {}, kill() {} });
    const context = vm.createContext({
      require$$2: { release: () => release },
      require$$0$2: pathModule,
      require$$0$5: require('node:url'),
      require$$0$4: { existsSync(fileName) { io.exists.push(fileName); return true; } },
      require$$2$1: {
        exec(command, options) { io.commands.push({ command, options }); return child(); },
        spawn(editor, args, options) { io.commands.push({ editor, args, options }); return child(); }
      },
      picocolorsExports: { red: value => value },
      guessExports: editor => [editor],
      process: { platform, env: {}, cwd: () => root },
      console: { log() {} }
    });
    vm.runInContext(`${editorSource}\nglobalThis.testEditor = { launchEditor, parseFile: parseFile$1, getArgs, constructWindowsLaunchCommand: constructWindowsLaunchCommand$1 };`, context, { filename: file });
    return { api: context.testEditor, io };
  }

  const { api, io } = loadEditor('win32', path.win32);
  const error = (fileName, message) => io.errors.push({ fileName, message });
  api.launchEditor('C:\\synthetic\\normal file.ts:2:3', 'code.cmd', error);
  assert.equal(io.commands.length, 1, 'Positive control: benign path reaches the mocked editor');
  assert.match(io.commands[0].command, /normal file\.ts:2:3/);
  io.commands.length = io.exists.length = io.errors.length = 0;

  for (const untrusted of ['\\\\exa70.invalid\\share\\sentinel.ts', '//exa70.invalid/share/sentinel.ts', '\\\\?\\UNC\\exa70.invalid\\share\\sentinel.ts']) {
    api.launchEditor(untrusted, 'code.cmd', error);
  }
  assert.equal(io.exists.length, 0, 'UNC inputs must be rejected before existsSync (no SMB/NTLM attempt)');
  assert.equal(io.commands.length, 0);
  assert.equal(io.errors.length, 3);
  record('GHSA-v6wh-96g9-6wx3 bundled UNC pre-filesystem rejection', { cases: 3, filesystemCalls: 0, editorCommands: 0, method: 'actual bundled code with inert filesystem/child_process doubles' });

  io.errors.length = 0;
  for (const untrusted of ['C:\\synthetic\\file%EXA70_BENIGN%.ts', 'C:\\synthetic\\file%CMDCMDLINE:~-38%.ts', 'C:\\synthetic\\file.ts:stream\nbenign', 'C:\\synthetic\\file.ts:stream\rbenign']) {
    api.launchEditor(untrusted, 'code.cmd', error);
  }
  assert.equal(io.commands.length, 0);
  assert.equal(io.errors.length, 4);
  assert.ok(io.errors.every(({ message }) => /containing.*(?:%|line break)/.test(message)));
  record('GHSA-698v-4r3x-3vcv bundled percent and newline command rejection', { cases: 4, editorCommands: 0, realShellExecuted: false });

  io.commands.length = io.exists.length = io.errors.length = 0;
  const bypass = 'C:\\synthetic\\missing%EXA70_BENIGN%\\..:1:1';
  const parsed = api.parseFile(bypass);
  assert.equal(parsed.fileName, 'C:\\synthetic');
  assert.equal(parsed.lineNumber, '1');
  api.launchEditor(bypass, 'code.cmd', error);
  assert.deepEqual(io.exists, ['C:\\synthetic']);
  assert.equal(io.commands.length, 1);
  assert.ok(!io.commands[0].command.includes('%') && !io.commands[0].command.includes('missing'));
  record('GHSA-587h-7wmj-h5pm bundled suffix removal then canonicalization', { existsSyncArgument: io.exists[0], editorReceivedAttackerSegment: false, note: 'Existing parent directory may open; unnormalized attacker component never reaches editor command' });

  for (const editor of ['vim', 'gvim', 'emacs', 'notepad++']) {
    for (const flagName of ['+EXA70_BENIGN', '-EXA70_BENIGN']) {
      const args = api.getArgs(editor, flagName);
      assert.ok(path.win32.isAbsolute(args[0]), 'Windows editor filename must be absolute rather than CLI-shaped');
      assert.ok(!/^[+-]/.test(args[0]));
    }
  }
  const wsl = loadEditor('linux', path.posix, '4.4.0-Microsoft');
  for (const flagName of ['+EXA70_BENIGN', '-EXA70_BENIGN']) {
    const args = wsl.api.getArgs('vim', `/mnt/c/project/${flagName}`);
    assert.ok(args[0].startsWith('./'), 'WSL-relative filename must retain explicit ./ prefix');
  }
  record('GHSA-r825-w8mm-5pxw bundled editor flag disambiguation', { windowsCases: 8, simulatedWslCases: 2, realWslExecuted: false });

  assert.match(source, /config\.safeModulePaths\.add\(cleanUrl\(resolvedId\)\)/, 'Non-Windows safe paths must use resolved filesystem ID');
  assert.doesNotMatch(source, /safeModulePaths\.add\(fsPathFromUrl\(url\)\)/);
  record('GHSA-rq7h-c2jc-7f22 source fix and platform boundary', { disposition: 'Patched resolvedId registration present; official advisory excludes Windows host', nonWindowsRuntimeReproduction: false });
  return { file: path.relative(root, file).replaceAll('\\', '/'), sha256: sha256(source), editorSectionSha256: sha256(editorSource) };
}

async function serverChecks(vite, fixture) {
  const project = path.join(fixture, 'project');
  const outside = path.join(fixture, 'outside.map');
  fs.mkdirSync(project, { recursive: true });
  const sentinel = 'EXA70_SYNTHETIC_DENIED_FILE';
  const map = { version: 3, file: 'x.js', sources: ['sentinel.ts'], sourcesContent: ['EXA70_SYNTHETIC_OUTSIDE_MAP'], names: [], mappings: '' };
  fs.writeFileSync(outside, JSON.stringify(map));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'exa70-benign-fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(project, 'index.html'), '<div id="app">EXA70_SYNTHETIC_PUBLIC</div><script type="module" src="/main.js"></script>');
  fs.writeFileSync(path.join(project, 'main.js'), 'export const synthetic = "EXA70_SYNTHETIC_PUBLIC";');
  const dependency = path.join(project, 'node_modules/exa70-fixture');
  fs.mkdirSync(dependency, { recursive: true });
  fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'exa70-fixture', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(dependency, 'index.js'), 'module.exports = "EXA70_SYNTHETIC_DEPENDENCY";');
  fs.writeFileSync(path.join(project, '.env'), `${sentinel}\n`);
  fs.writeFileSync(path.join(project, 'tls.pem'), `${sentinel}\n`);
  fs.writeFileSync(path.join(project, 'fixture~1.txt'), `${sentinel}\n`);
  const server = await vite.createServer({
    configFile: false, root: project, logLevel: 'silent', appType: 'mpa',
    server: { host: '127.0.0.1', port: await freePort(), strictPort: true, fs: { strict: true, allow: [project] }, watch: null },
    optimizeDeps: { noDiscovery: true, include: ['exa70-fixture'] }
  });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    const positive = await request(port, '/main.js');
    assert.equal(positive.status, 200, `Benign main.js must load from canonical fixture ${project}; response headers=${JSON.stringify(positive.headers)}, body=${positive.body.slice(0, 1200)}`);
    assert.ok(positive.body.includes('EXA70_SYNTHETIC_PUBLIC'));
    const remote = await request(port, '/main.js', { Origin: 'https://exa70-origin.invalid' });
    assert.notEqual(remote.headers['access-control-allow-origin'], '*');
    assert.notEqual(remote.headers['access-control-allow-origin'], 'https://exa70-origin.invalid');
    const rebound = await request(port, '/main.js', { Host: 'exa70-rebinding.invalid' });
    assert.equal(rebound.status, 403);
    record('Vite cross-origin response and DNS-rebinding controls', { remoteOriginAccessControl: remote.headers['access-control-allow-origin'] ?? null, unapprovedHostStatus: rebound.status, loopbackAloneIsNotDisposition: true });

    for (const requestPath of ['/.env?raw', '/.env::$DATA?raw', '/tls.pem::$DATA?raw', '/fixture~1.txt?raw', '/.env::$DATA', '/tls.pem::$DATA']) {
      const response = await request(port, requestPath);
      assert.ok([403, 404].includes(response.status), `Expected access denied for ${requestPath}, got ${response.status}`);
      assert.ok(!response.body.includes(sentinel), `Synthetic denied bytes leaked through ${requestPath}`);
    }
    record('GHSA-fx2h-pf6j-xcff Windows ADS and tilde alternate-path rejection', { deniedRequests: 6, realNtfsShortAliasGeneration: false, note: 'Existing tilde fixture checks unconditional short-path rejection without depending on volume 8.3 settings' });

    const slash = value => value.replaceAll('\\', '/');
    const outsideRequest = `/@fs/${slash(outside)}`;
    const direct = await request(port, outsideRequest);
    assert.equal(direct.status, 403);
    // The optimized-deps loader awaits its processing promise. Finish the real
    // synthetic prebundle before adding the map fixture, so a slow optimizer
    // cannot replace the cache directory while this check is reading it.
    const optimized = await request(port, '/node_modules/.vite/deps/exa70-fixture.js');
    assert.equal(optimized.status, 200);
    assert.ok(optimized.body.includes('EXA70_SYNTHETIC_DEPENDENCY'));
    const cache = path.join(project, 'node_modules/.vite/deps');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'fixture.js.map'), JSON.stringify({ ...map, sourcesContent: ['EXA70_SYNTHETIC_ALLOWED_MAP'] }));
    const prefix = '/node_modules/.vite/deps/';
    assert.ok(server.environments.client.depsOptimizer?.isOptimizedDepUrl(`${prefix}fixture.js.map`), 'Exercise the actual optimized-dependency sourcemap branch');
    const allowed = await request(port, `${prefix}fixture.js.map`);
    assert.equal(allowed.status, 200);
    assert.ok(allowed.body.includes('EXA70_SYNTHETIC_ALLOWED_MAP'));
    const traversalStatuses = [];
    for (const requestPath of [`${prefix}../../../../outside.map`, `${prefix}..%5c..%5c..%5c..%5coutside.map`]) {
      const response = await request(port, requestPath);
      assert.ok(!response.body.includes('EXA70_SYNTHETIC_OUTSIDE_MAP'), 'Optimized dependency traversal leaked the synthetic outside map');
      assert.ok([403, 404].includes(response.status), `Expected denial for optimized map traversal ${requestPath}, got ${response.status}: ${response.body.slice(0, 300)}`);
      traversalStatuses.push(response.status);
    }
    // decodeURI deliberately preserves encoded '/' so this is a nonexistent
    // literal filename within the cache. Vite returns its documented empty map.
    const encodedSlash = await request(port, `${prefix}..%2f..%2f..%2f..%2foutside.map`);
    assert.equal(encodedSlash.status, 200);
    assert.deepEqual(JSON.parse(encodedSlash.body).sourcesContent, []);
    assert.ok(!encodedSlash.body.includes('EXA70_SYNTHETIC_OUTSIDE_MAP'));
    record('GHSA-4w7w-66w2-5vf9 optimized sourcemap traversal', { directOutsideStatus: direct.status, legitimateOptimizedMapStatus: allowed.status, traversalStatuses, encodedSlashResult: 'Empty dummy map, no synthetic outside content' });

    // Exercise the actual public API with the advisory's custom-middleware URL;
    // no attacker server or payload script is needed to inspect generated src.
    const custom = await server.transformIndexHtml('//exa70-origin.invalid/payload.js?/../../package.json', '<script type="module">document.body.dataset.exa70="benign"</script>');
    const moduleSources = [...custom.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
    assert.ok(moduleSources.length >= 2, 'Vite client and inline module proxy should both be present');
    for (const src of moduleSources) {
      assert.ok(!src.startsWith('//') && !/^https?:/i.test(src), `Scheme-relative/external module src generated: ${src}`);
      assert.equal(new URL(src, `http://127.0.0.1:${port}`).origin, `http://127.0.0.1:${port}`);
    }
    record('GHSA-9jrq-w75r-8gcw custom HTML transform module origin', { moduleSources, browserPayloadExecuted: false, assertion: 'Every generated module URL resolves to the local origin' });
  } finally {
    await server.close();
  }
}

async function esbuildChecks(vitePackage, fixture) {
  const viteRequire = createRequire(vitePackage);
  const esbuildPath = viteRequire.resolve('esbuild');
  const esbuild = viteRequire('esbuild');
  const publicDir = path.join(fixture, 'esbuild-public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'entry.js'), 'console.log("EXA70_SYNTHETIC_ESBUILD");');
  const context = await esbuild.context({ entryPoints: [path.join(publicDir, 'entry.js')], outfile: path.join(publicDir, 'app.js'), logLevel: 'silent' });
  try {
    await context.watch();
    const server = await context.serve({ host: '127.0.0.1', port: 0, servedir: publicDir });
    const positive = await request(server.port, '/app.js');
    assert.equal(positive.status, 200);
    assert.ok(positive.body.includes('EXA70_SYNTHETIC_ESBUILD'));
    const origin = { Origin: 'https://exa70-origin.invalid' };
    const script = await request(server.port, '/app.js', origin);
    const sse = await request(server.port, '/esbuild', { ...origin, Accept: 'text/event-stream' }, true);
    assert.equal(sse.status, 200, 'Exercise a live esbuild SSE endpoint, not a fallback 404');
    assert.match(sse.headers['content-type'], /text\/event-stream/);
    for (const response of [script, sse]) {
      assert.notEqual(response.headers['access-control-allow-origin'], '*');
      assert.notEqual(response.headers['access-control-allow-origin'], origin.Origin);
    }
    record('GHSA-67mh-4wv8-2f99 actual esbuild serve response and SSE CORS', { esbuildVersion: esbuild.version, resolvedModule: path.relative(root, esbuildPath).replaceAll('\\', '/'), normalStatus: positive.status, crossOriginScriptStatus: script.status, crossOriginSseStatus: sse.status, wildcardAccessControl: false });
  } finally {
    await context.dispose();
    esbuild.stop();
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'Run these Windows-specific checks on Windows');
  const vitePackage = require.resolve('vite/package.json');
  const viteRoot = path.dirname(vitePackage);
  const vite = await import(pathToFileURL(path.join(viteRoot, 'dist/node/index.js')).href);
  const bundledSource = bundledEditorChecks(viteRoot);
  // Windows hosted runners may expose %TEMP% through a RUNNER~1 short alias.
  // Vite correctly rejects all tilde paths, including aliases in an allowed
  // root. Expand the existing temp directory to its native canonical spelling;
  // keep every Vite filesystem protection enabled for the synthetic fixtures.
  const requestedTemp = os.tmpdir();
  const canonicalTemp = fs.realpathSync.native(requestedTemp);
  const fixture = fs.mkdtempSync(path.join(canonicalTemp, 'bug-pocket-exa70-security-'));
  console.log(`Security fixture isolation ${JSON.stringify({ requestedTemp, canonicalTemp, fixture })}`);
  try {
    await serverChecks(vite, fixture);
    await esbuildChecks(vitePackage, fixture);
  } finally {
    // fixture is created by mkdtemp directly under the canonical temp parent.
    assert.equal(path.dirname(fixture), canonicalTemp);
    assert.equal(fs.realpathSync.native(path.dirname(fixture)), canonicalTemp);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ date: new Date().toISOString(), platform: process.platform, hostNode: process.version, vite: require(vitePackage).version, fixturePaths: { requestedTemp, canonicalTemp, fixture }, bundledSource, checks: records, limitations: ['No real editor, command payload, SMB connection, NTLM authentication or WSL runtime was executed', 'No denied-secret-file 8.3 aliases generated; explicit tilde-path rejection checked here and actual temporary-root alias normalization exercised separately', 'Non-Windows GHSA-rq7h runtime reproduction remains unexecuted; fixed source is inspected', 'HTTP header and transformed URL checks establish server controls; no malicious website or exploit payload was executed'] }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
