import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync,
  readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { createBackupStagingDirectory, extractBackupArchive, type ExtractionLimits } from './backupExtraction';
import { fixtureCrc32, zip64Fixture, zipFixture, type ZipFixtureEntry } from './backupZipFixtures.test-helper';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'bug-pocket-zip-security-'));
  const staging = join(root, 'staging');
  mkdirSync(staging);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, staging, archive: join(root, 'fixture.bugpocket') };
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function archiveCanBeRemoved(archive: string): void {
  const renamed = archive + '.closed';
  renameSync(archive, renamed);
  const descriptor = openSync(renamed, 'r+');
  closeSync(descriptor);
  rmSync(renamed);
}

async function rejectInventory(t: TestContext, entries: ZipFixtureEntry[], limits?: Partial<ExtractionLimits>) {
  const paths = fixture(t);
  const canary = join(paths.root, 'outside-canary.txt');
  writeFileSync(canary, 'OUTSIDE STAGING MUST SURVIVE');
  const before = sha256(canary);
  // A benign first entry proves validation covers the complete inventory before
  // the extractor starts creating output files.
  writeFileSync(paths.archive, zipFixture([{ name: 'first.txt', bytes: 'must not be written' }, ...entries]));
  await assert.rejects(extractBackupArchive(paths.archive, paths.staging, { limits }));
  assert.deepEqual(readdirSync(paths.staging), [], 'preflight rejection must not create any output');
  assert.equal(sha256(canary), before);
  archiveCanBeRemoved(paths.archive);
}

test('stored, deflated and descriptor ZIPs preserve bytes, names and directory records', async (t) => {
  for (const method of [0, 8]) {
    for (const descriptor of [false, true]) {
      await t.test(`method ${method}, descriptor ${descriptor}`, async (t) => {
        const paths = fixture(t);
        const bytes = Buffer.from('SQLite and attachment bytes '.repeat(500));
        writeFileSync(paths.archive, zipFixture([
          { name: 'attachments/', bytes: '', mode: 0o40755 },
          { name: 'attachments\\image.png', bytes, method, descriptor },
          { name: 'manifest.json', bytes: '{"format_version":2}', method, descriptor },
          { name: 'windows.txt', bytes: 'DOS-origin regular file', mode: 0, platform: 0 }
        ]));
        const inventory = await extractBackupArchive(paths.archive, paths.staging);
        assert.deepEqual([...inventory].sort(), ['attachments', 'attachments/image.png', 'manifest.json', 'windows.txt']);
        assert.deepEqual(readFileSync(join(paths.staging, 'attachments', 'image.png')), bytes);
        assert.equal(readFileSync(join(paths.staging, 'windows.txt'), 'utf8'), 'DOS-origin regular file');
        archiveCanBeRemoved(paths.archive);
      });
    }
  }
});

test('ZIP64 records retain compatibility with large-archive exporters', async (t) => {
  const paths = fixture(t);
  const bytes = Buffer.from('small fixture using ZIP64 records');
  writeFileSync(paths.archive, zip64Fixture('local.sqlite', bytes));
  assert.deepEqual([...await extractBackupArchive(paths.archive, paths.staging)], ['local.sqlite']);
  assert.deepEqual(readFileSync(join(paths.staging, 'local.sqlite')), bytes);
  archiveCanBeRemoved(paths.archive);
});

test('CP437 and central Unicode Path records preserve legacy ZIP filenames', async (t) => {
  const cp437 = Buffer.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]);
  const rawName = Buffer.from('unicode.txt');
  const unicodeName = Buffer.from('café.txt');
  const unicodeExtra = Buffer.alloc(9 + unicodeName.length);
  unicodeExtra.writeUInt16LE(0x7075);
  unicodeExtra.writeUInt16LE(5 + unicodeName.length, 2);
  unicodeExtra[4] = 1;
  unicodeExtra.writeUInt32LE(fixtureCrc32(rawName), 5);
  unicodeName.copy(unicodeExtra, 9);
  for (const [label, entry] of [
    ['CP437', { name: 'café.txt', rawName: cp437, flags: 0 }],
    ['central Unicode Path extra', { name: 'café.txt', rawName, flags: 0, centralExtra: unicodeExtra }]
  ] as Array<[string, ZipFixtureEntry]>) {
    await t.test(label, async (t) => {
      const paths = fixture(t);
      writeFileSync(paths.archive, zipFixture([{ ...entry, bytes: 'legacy bytes' }]));
      assert.deepEqual([...await extractBackupArchive(paths.archive, paths.staging)], ['café.txt']);
      assert.equal(readFileSync(join(paths.staging, 'café.txt'), 'utf8'), 'legacy bytes');
      archiveCanBeRemoved(paths.archive);
    });
  }
});

test('an explicit directory following an implicit parent is accepted', async (t) => {
  const paths = fixture(t);
  writeFileSync(paths.archive, zipFixture([
    { name: 'attachments/image.png', bytes: 'image bytes' },
    { name: 'attachments/', bytes: '', mode: 0o40755 }
  ]));
  const names = await extractBackupArchive(paths.archive, paths.staging);
  assert.deepEqual([...names].sort(), ['attachments', 'attachments/image.png']);
  assert.equal(readFileSync(join(paths.staging, 'attachments', 'image.png'), 'utf8'), 'image bytes');
});

test('highly compressible legitimate bytes remain compatible within explicit budgets', async (t) => {
  const paths = fixture(t);
  const bytes = Buffer.alloc(1024 * 1024);
  writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes, method: 8 }]));
  await extractBackupArchive(paths.archive, paths.staging, { limits: { maxFileBytes: bytes.length, maxTotalBytes: bytes.length } });
  assert.deepEqual(readFileSync(join(paths.staging, 'local.sqlite')), bytes);
});

test('both advisory patterns are refused before a link or duplicate file can be written', async (t) => {
  for (const platform of [0, 3]) {
    for (const duplicate of [false, true]) {
      for (const absolute of [false, true]) {
        await t.test(`origin ${platform}, duplicate ${duplicate}, absolute ${absolute}`, async (t) => {
          const paths = fixture(t);
          const canary = join(paths.root, 'canary.txt');
          writeFileSync(canary, 'UNCHANGED');
          const before = sha256(canary);
          const entries: ZipFixtureEntry[] = [
            { name: 'first.txt', bytes: 'must not be written' },
            { name: 'link.txt', bytes: absolute ? canary : '../canary.txt', mode: 0o120777, platform }
          ];
          if (duplicate) entries.push({ name: 'link.txt', bytes: 'WRITE THROUGH' });
          writeFileSync(paths.archive, zipFixture(entries));
          await assert.rejects(extractBackupArchive(paths.archive, paths.staging));
          assert.equal(sha256(canary), before);
          assert.deepEqual(readdirSync(paths.staging), []);
          archiveCanBeRemoved(paths.archive);
        });
      }
    }
  }
});

test('special Unix entry types and symlink child traversal never create output', async (t) => {
  for (const mode of [0o010644, 0o020644, 0o060644, 0o120777, 0o140644]) {
    await t.test(`mode ${mode.toString(8)}`, t => rejectInventory(t, [{ name: 'special', mode }]));
  }
  await t.test('directory link followed by child', t => rejectInventory(t, [
    { name: 'linked', bytes: '../outside', mode: 0o120777 }, { name: 'linked/child.txt' }
  ]));
  for (const [label, entry] of [
    ['DOS reparse bit', { name: 'reparse', attributes: 0x400 }],
    ['DOS volume bit', { name: 'volume', attributes: 0x08 }],
    ['DOS directory without trailing slash', { name: 'directory', attributes: 0x10, bytes: '' }],
    ['Unix directory without trailing slash', { name: 'directory', mode: 0o40755, bytes: '' }],
    ['regular-file mode with trailing slash', { name: 'file/', mode: 0o100644, bytes: '' }]
  ] as Array<[string, ZipFixtureEntry]>) {
    await t.test(label, t => rejectInventory(t, [entry]));
  }
});

test('duplicates and Windows or Unicode aliases are rejected across the whole inventory', async (t) => {
  const collisions: Array<[string, string]> = [
    ['local.sqlite', 'local.sqlite'],
    ['manifest.json', 'manifest.json'],
    ['attachments/', 'attachments/'],
    ['local.sqlite', 'LOCAL.SQLITE'],
    ['attachments/image.png', 'attachments\\image.png'],
    ['long-filename.txt', 'LONG-F~1.TXT'],
    ['café.txt', 'café.txt'],
    ['K.txt', '\u212a.txt'],
    ['safe.txt', '\uff53\uff41\uff46\uff45.txt']
  ];
  for (const [first, second] of collisions) {
    await t.test(`${first} + ${second}`, t => rejectInventory(t, [first, second].map(name =>
      name.endsWith('/') ? { name, bytes: '', mode: 0o40755 } : { name }
    )));
  }
});

test('file and directory ancestors cannot collide in either archive order', async (t) => {
  const collisions: ZipFixtureEntry[][] = [
    [{ name: 'attachments' }, { name: 'attachments/image.png' }],
    [{ name: 'attachments/image.png' }, { name: 'attachments' }],
    [{ name: 'attachments/' , bytes: '', mode: 0o40755 }, { name: 'attachments' }],
    [{ name: 'Folder/a.txt' }, { name: 'folder/b.txt' }]
  ];
  for (const [index, entries] of collisions.entries()) {
    await t.test(`collision ${index + 1}`, t => rejectInventory(t, entries));
  }
});

test('unsafe paths, ADS, devices and Win32 ambiguous names fail before output writes', async (t) => {
  const names = [
    '../outside-canary.txt', '..\\outside-canary.txt', '/absolute.txt', '\\absolute.txt',
    '//server/share/file.txt', '\\\\server\\share\\file.txt', 'C:/fixture.txt', 'C:fixture.txt',
    'double//name.txt', 'dot/./name.txt', 'null\0name.txt', 'local.sqlite:payload', 'nested/file:payload',
    'CON', 'con.txt', 'NUL', 'AUX.png', 'PRN', 'COM1.log', 'LPT9', 'COM\u00b9.txt',
    'trailing.', 'trailing ', 'nested./file.txt', 'nested /file.txt',
    'LONG-F~1.TXT', 'attachments/IMAGE~2.PNG', 'SHORT~12.TXT',
    '\uff0e\uff0e/outside-canary.txt', 'nested/\uff1apayload', 'bad<name.txt', 'bad|name.txt'
  ];
  for (const name of names) await t.test(JSON.stringify(name), t => rejectInventory(t, [{ name }]));
});

test('local-header disagreements, encryption and unsupported compression reject the complete inventory', async (t) => {
  const malformed: Array<[string, ZipFixtureEntry]> = [
    ['different local name', { name: 'safe.txt', localName: '../escape.txt' }],
    ['different local method', { name: 'safe.txt', method: 8, localMethod: 0 }],
    ['different local flags', { name: 'safe.txt', localFlags: 0 }],
    ['encrypted', { name: 'secret.txt', flags: 0x801 }],
    ['unsupported method', { name: 'unsupported.txt', method: 12 }]
  ];
  for (const [name, entry] of malformed) await t.test(name, t => rejectInventory(t, [entry]));
});

test('truncated and invalid ZIP structures reject and release the archive', async (t) => {
  const valid = zipFixture([{ name: 'safe.txt' }]);
  const brokenSignature = Buffer.from(valid);
  brokenSignature.writeUInt32LE(0x12345678, 0);
  for (const [name, bytes] of [
    ['not a ZIP', Buffer.from('not a ZIP')],
    ['truncated end record', valid.subarray(0, valid.length - 8)],
    ['invalid local signature', brokenSignature]
  ] as const) {
    await t.test(name, async (t) => {
      const paths = fixture(t);
      writeFileSync(paths.archive, bytes);
      await assert.rejects(extractBackupArchive(paths.archive, paths.staging));
      assert.deepEqual(readdirSync(paths.staging), []);
      archiveCanBeRemoved(paths.archive);
    });
  }
});

test('declared entry, file, total, manifest, path and depth budgets reject before writes', async (t) => {
  const limits: Array<[string, Partial<ExtractionLimits>, ZipFixtureEntry[]]> = [
    ['entries', { maxEntries: 1 }, [{ name: 'second.txt' }]],
    ['archive bytes', { maxArchiveBytes: 1 }, [{ name: 'second.txt', bytes: '' }]],
    ['metadata bytes', { maxMetadataBytes: 100 }, [{ name: 'second.txt', bytes: '' }]],
    ['file bytes', { maxFileBytes: 30 }, [{ name: 'large.txt', bytes: Buffer.alloc(31) }]],
    ['total bytes', { maxTotalBytes: 25 }, [{ name: 'second.txt', bytes: Buffer.alloc(20) }]],
    ['manifest bytes', { maxManifestBytes: 3 }, [{ name: 'manifest.json', bytes: '1234' }]],
    ['legacy manifest bytes', { maxManifestBytes: 3 }, [{ name: 'backup-manifest.json', bytes: '1234' }]],
    ['casefold manifest bytes', { maxManifestBytes: 3 }, [{ name: 'MANIFEST.JSON', bytes: '1234' }]],
    ['path bytes', { maxPathBytes: 15 }, [{ name: 'attachments/long-image.png' }]],
    ['depth', { maxDepth: 2 }, [{ name: 'one/two/three.txt' }]]
  ];
  for (const [name, limit, entries] of limits) await t.test(name, t => rejectInventory(t, entries, limit));
});

test('large central comments count against metadata budgets even with empty file data', async (t) => {
  await rejectInventory(t, [{ name: 'empty.txt', bytes: '', centralComment: Buffer.alloc(2048, 65) }], { maxMetadataBytes: 1024 });
});

test('byte budgets allow exact boundaries, including empty entries', async (t) => {
  const paths = fixture(t);
  writeFileSync(paths.archive, zipFixture([{ name: 'empty.txt', bytes: '' }, { name: 'data.txt', bytes: '1234' }]));
  await extractBackupArchive(paths.archive, paths.staging, { limits: { maxEntries: 2, maxFileBytes: 4, maxTotalBytes: 4 } });
  assert.equal(statSync(join(paths.staging, 'empty.txt')).size, 0);
  assert.equal(readFileSync(join(paths.staging, 'data.txt'), 'utf8'), '1234');
});

test('invalid numeric limits fail before creating any output', async (t) => {
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await t.test(String(value), async (t) => {
      const paths = fixture(t);
      writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes: '' }]));
      await assert.rejects(extractBackupArchive(paths.archive, paths.staging, { limits: { maxTotalBytes: value } }), /limit/i);
      assert.deepEqual(readdirSync(paths.staging), []);
      archiveCanBeRemoved(paths.archive);
    });
  }
});

test('inflated bytes cannot exceed a forged declared size and all handles close on stream error', async (t) => {
  const paths = fixture(t);
  const bytes = Buffer.alloc(128 * 1024, 65);
  writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes, method: 8, declaredSize: 4 }]));
  await assert.rejects(extractBackupArchive(paths.archive, paths.staging, { limits: { maxFileBytes: 64, maxTotalBytes: 64 } }));
  const output = join(paths.staging, 'local.sqlite');
  if (existsSync(output)) assert.ok(statSync(output).size <= 64, 'oversized decoded chunks must not be written');
  archiveCanBeRemoved(paths.archive);
  rmSync(paths.staging, { recursive: true });
  mkdirSync(paths.staging);
  assert.deepEqual(readdirSync(paths.staging), []);
});

test('corrupt decompressed bytes fail ZIP CRC verification and release output handles', async (t) => {
  const paths = fixture(t);
  writeFileSync(paths.archive, zipFixture([{ name: 'manifest.json', bytes: '{"modified":true}', crc: 0 }]));
  await assert.rejects(extractBackupArchive(paths.archive, paths.staging));
  archiveCanBeRemoved(paths.archive);
  rmSync(paths.staging, { recursive: true });
  mkdirSync(paths.staging);
  assert.deepEqual(readdirSync(paths.staging), []);
});

test('nonempty staging and preexisting output are refused without overwriting contents', async (t) => {
  const paths = fixture(t);
  const output = join(paths.staging, 'local.sqlite');
  writeFileSync(output, 'PREEXISTING OUTPUT');
  writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes: 'REPLACEMENT' }]));
  await assert.rejects(extractBackupArchive(paths.archive, paths.staging));
  assert.equal(readFileSync(output, 'utf8'), 'PREEXISTING OUTPUT');
  archiveCanBeRemoved(paths.archive);
});

test('each restore receives a distinct fresh staging directory under its requested data root', async (t) => {
  const paths = fixture(t);
  const first = await createBackupStagingDirectory(paths.root);
  const second = await createBackupStagingDirectory(paths.root);
  assert.notEqual(first, second);
  for (const staging of [first, second]) {
    assert.equal(dirname(staging), paths.root);
    assert.ok(lstatSync(staging).isDirectory());
    assert.equal(lstatSync(staging).isSymbolicLink(), false);
    assert.deepEqual(readdirSync(staging), []);
  }
});

function windowsPathAliases(directory: string): { shortPath: string; longPath: string } {
  // Pass the fixture path through the child environment, never through generated
  // shell code. GetShortPathName exercises a real filesystem alias, not a mock.
  const script = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
using System.Text;
public static class BackupFixtureShortPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetShortPathName(string path, StringBuilder result, uint capacity);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetLongPathName(string path, StringBuilder result, uint capacity);
}
'@
$buffer = [System.Text.StringBuilder]::new(32768)
$length = [BackupFixtureShortPath]::GetShortPathName($env:BUG_POCKET_SHORT_PATH_FIXTURE, $buffer, [uint32]$buffer.Capacity)
if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw 'GetShortPathName failed for disposable fixture.' }
$longBuffer = [System.Text.StringBuilder]::new(32768)
$longLength = [BackupFixtureShortPath]::GetLongPathName($buffer.ToString(), $longBuffer, [uint32]$longBuffer.Capacity)
if ($longLength -eq 0 -or $longLength -ge $longBuffer.Capacity) { throw 'GetLongPathName failed for disposable fixture.' }
$aliases = [pscustomobject]@{ shortPath = $buffer.ToString(); longPath = $longBuffer.ToString() } | ConvertTo-Json -Compress
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($aliases)
`;
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, BUG_POCKET_SHORT_PATH_FIXTURE: directory }
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `GetShortPathName fixture helper failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim()) as { shortPath: string; longPath: string };
}

test('Windows 8.3 aliases permit extraction while linked roots remain refused', { skip: process.platform !== 'win32' }, async (t) => {
  const paths = fixture(t);
  const longRoot = join(paths.root, 'Backup extraction directory with a long name');
  mkdirSync(longRoot);
  const aliases = windowsPathAliases(longRoot);
  const shortRoot = aliases.shortPath;
  if (shortRoot.toLowerCase() === aliases.longPath.toLowerCase()) {
    t.skip('This filesystem supplies no 8.3 alias for the generated directory or its existing ancestors.');
    return;
  }
  assert.equal(lstatSync(shortRoot).isSymbolicLink(), false);
  writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes: 'bytes through a legitimate alias' }]));

  await t.test('new private staging under a short alias', async () => {
    const staging = await createBackupStagingDirectory(shortRoot);
    const visibleFromLongPath = join(longRoot, basename(staging));
    assert.ok(lstatSync(visibleFromLongPath).isDirectory());
    await extractBackupArchive(paths.archive, staging);
    assert.equal(readFileSync(join(staging, 'local.sqlite'), 'utf8'), 'bytes through a legitimate alias');
    assert.equal(readFileSync(join(visibleFromLongPath, 'local.sqlite'), 'utf8'), 'bytes through a legitimate alias');
  });

  await t.test('existing empty staging with a short ancestor', async () => {
    const staging = join(shortRoot, 'existing-staging');
    mkdirSync(staging);
    await extractBackupArchive(paths.archive, staging);
    assert.equal(readFileSync(join(staging, 'local.sqlite'), 'utf8'), 'bytes through a legitimate alias');
  });

  await t.test('junction below the same short alias is refused', async (t) => {
    const outside = join(paths.root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'canary.txt'), 'UNCHANGED');
    const linked = join(shortRoot, 'linked-root');
    if (!createLinkOrSkip(t, outside, linked, 'junction')) return;
    await assert.rejects(createBackupStagingDirectory(linked));
    await assert.rejects(extractBackupArchive(paths.archive, linked));
    assert.deepEqual(readdirSync(outside), ['canary.txt']);
    assert.equal(readFileSync(join(outside, 'canary.txt'), 'utf8'), 'UNCHANGED');
  });
  archiveCanBeRemoved(paths.archive);
});

function createLinkOrSkip(t: TestContext, target: string, link: string, type: 'file' | 'dir' | 'junction'): boolean {
  try {
    symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip(`Creating ${type} links requires Windows symlink permission; ZIP symlink-entry rejection tests still run.`);
      return false;
    }
    throw error;
  }
}

test('preexisting symlink output, staging links and linked ancestors cannot redirect extraction', async (t) => {
  for (const type of ['dir', ...(process.platform === 'win32' ? ['junction'] : [])] as Array<'dir' | 'junction'>) {
    for (const position of ['staging', 'ancestor']) {
      await t.test(`${type} ${position}`, async (t) => {
        const paths = fixture(t);
        const outside = join(paths.root, 'outside');
        mkdirSync(outside);
        const canary = join(outside, 'canary.txt');
        writeFileSync(canary, 'UNCHANGED');
        rmSync(paths.staging, { recursive: true });
        const link = paths.staging;
        if (!createLinkOrSkip(t, outside, link, type)) return;
        const suppliedStaging = position === 'ancestor' ? join(link, 'nested') : link;
        if (position === 'ancestor') mkdirSync(suppliedStaging);
        writeFileSync(paths.archive, zipFixture([{ name: 'canary.txt', bytes: 'REPLACED' }]));
        await assert.rejects(extractBackupArchive(paths.archive, suppliedStaging));
        assert.equal(readFileSync(canary, 'utf8'), 'UNCHANGED');
        if (position === 'ancestor') assert.deepEqual(readdirSync(join(outside, 'nested')), []);
        archiveCanBeRemoved(paths.archive);
      });
    }
  }
  await t.test('file symlink output', async (t) => {
    const paths = fixture(t);
    const canary = join(paths.root, 'outside.txt');
    writeFileSync(canary, 'UNCHANGED');
    if (!createLinkOrSkip(t, canary, join(paths.staging, 'local.sqlite'), 'file')) return;
    writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes: 'REPLACED' }]));
    await assert.rejects(extractBackupArchive(paths.archive, paths.staging));
    assert.equal(readFileSync(canary, 'utf8'), 'UNCHANGED');
    assert.ok(lstatSync(join(paths.staging, 'local.sqlite')).isSymbolicLink());
    archiveCanBeRemoved(paths.archive);
  });
});

test('staging creation rejects a linked data root before creating directories through it', async (t) => {
  const paths = fixture(t);
  const outside = join(paths.root, 'outside');
  const linked = join(paths.root, 'linked-data');
  mkdirSync(outside);
  if (!createLinkOrSkip(t, outside, linked, process.platform === 'win32' ? 'junction' : 'dir')) return;
  await assert.rejects(createBackupStagingDirectory(linked));
  assert.deepEqual(readdirSync(outside), []);
});

test('an already cancelled restore creates no output and releases the archive', async (t) => {
  const paths = fixture(t);
  writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes: 'untouched' }]));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(extractBackupArchive(paths.archive, paths.staging, { signal: controller.signal }));
  assert.deepEqual(readdirSync(paths.staging), []);
  archiveCanBeRemoved(paths.archive);
});

test('cancellation during a real file stream closes handles so caller cleanup and retry work', async (t) => {
  const paths = fixture(t);
  const bytes = Buffer.alloc(16 * 1024 * 1024, 0x5a);
  writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes }]));
  const controller = new AbortController();
  const output = join(paths.staging, 'local.sqlite');
  let observedBytes = false;
  const watcher = setInterval(() => {
    if (existsSync(output) && statSync(output).size > 0) {
      observedBytes = true;
      controller.abort();
    }
  }, 1);
  try {
    await assert.rejects(extractBackupArchive(paths.archive, paths.staging, { signal: controller.signal }));
  } finally {
    clearInterval(watcher);
  }
  assert.ok(observedBytes, 'abort must interrupt a started output stream');
  archiveCanBeRemoved(paths.archive);
  rmSync(paths.staging, { recursive: true });
  mkdirSync(paths.staging);
  writeFileSync(paths.archive, zipFixture([{ name: 'local.sqlite', bytes: 'retry succeeded' }]));
  await extractBackupArchive(paths.archive, paths.staging);
  assert.equal(readFileSync(output, 'utf8'), 'retry succeeded');
  archiveCanBeRemoved(paths.archive);
});
