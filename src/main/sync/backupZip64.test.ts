import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { zip64DirectoryFixture, zip64Fixture } from './backupZipFixtures.test-helper';

const uint64Max = 0xffffffffffffffffn;
const unsafeInteger = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
const safeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function sqlite(file: string, value: string): Buffer {
  const db = new Database(file);
  try {
    db.exec('CREATE TABLE sentinel(value TEXT NOT NULL)');
    db.prepare('INSERT INTO sentinel VALUES (?)').run(value);
  } finally { db.close(); }
  return readFileSync(file);
}

interface MalformedCase { name: string; mutate(bytes: Buffer): void; expectedError: string }
const rangeError = 'read|range|bound|offset|EOF|end of file';
const malformedCases: MalformedCase[] = [
  ...[
    ['uint64 maximum', uint64Max], ['unsafe integer', unsafeInteger], ['safe integer plus record overflow', safeInteger]
  ].map(([name, offset]) => ({
    name: `locator ${name}`, expectedError: rangeError,
    mutate: (bytes: Buffer) => { bytes.writeBigUInt64LE(offset as bigint, bytes.length - 34); }
  })),
  {
    name: 'locator fixed record crosses file boundary', expectedError: rangeError,
    mutate: bytes => { bytes.writeBigUInt64LE(BigInt(bytes.length - 55), bytes.length - 34); }
  },
  ...[
    ['uint64 maximum', uint64Max], ['safe integer plus record overflow', safeInteger]
  ].map(([name, offset]) => ({
    name: `central directory offset ${name}`, expectedError: rangeError,
    mutate: (bytes: Buffer) => {
      const end64 = Number(bytes.readBigUInt64LE(bytes.length - 34));
      bytes.writeBigUInt64LE(offset as bigint, end64 + 48);
    }
  })),
  {
    name: 'central directory fixed record crosses file boundary', expectedError: rangeError,
    mutate: bytes => {
      const end64 = Number(bytes.readBigUInt64LE(bytes.length - 34));
      bytes.writeBigUInt64LE(BigInt(bytes.length - 20), end64 + 48);
    }
  },
  {
    name: 'local header unsafe ZIP64 offset', expectedError: 'offset|size|integer',
    mutate: bytes => {
      const end64 = Number(bytes.readBigUInt64LE(bytes.length - 34));
      const central = Number(bytes.readBigUInt64LE(end64 + 48));
      const extra = central + 46 + bytes.readUInt16LE(central + 28);
      bytes.writeBigUInt64LE(uint64Max, extra + 20);
    }
  },
  {
    name: 'local fixed header crosses file boundary', expectedError: rangeError,
    mutate: bytes => {
      const end64 = Number(bytes.readBigUInt64LE(bytes.length - 34));
      const central = Number(bytes.readBigUInt64LE(end64 + 48));
      const extra = central + 46 + bytes.readUInt16LE(central + 28);
      bytes.writeBigUInt64LE(BigInt(bytes.length - 29), extra + 20);
    }
  },
  {
    name: 'compressed ZIP64 size is unsafe', expectedError: 'size|integer|range|bound',
    mutate: bytes => {
      const end64 = Number(bytes.readBigUInt64LE(bytes.length - 34));
      const central = Number(bytes.readBigUInt64LE(end64 + 48));
      const centralExtra = central + 46 + bytes.readUInt16LE(central + 28);
      const localExtra = 30 + bytes.readUInt16LE(26);
      bytes.writeBigUInt64LE(uint64Max, centralExtra + 12);
      bytes.writeBigUInt64LE(uint64Max, localExtra + 12);
    }
  },
  {
    name: 'compressed span plus header overflows safe integer', expectedError: 'size|integer|range|bound',
    mutate: bytes => {
      const end64 = Number(bytes.readBigUInt64LE(bytes.length - 34));
      const central = Number(bytes.readBigUInt64LE(end64 + 48));
      const centralExtra = central + 46 + bytes.readUInt16LE(central + 28);
      const localExtra = 30 + bytes.readUInt16LE(26);
      bytes.writeBigUInt64LE(safeInteger, centralExtra + 12);
      bytes.writeBigUInt64LE(safeInteger, localExtra + 12);
    }
  }
];

for (const scenario of malformedCases) {
  test(`malformed ZIP64 ${scenario.name}: ordinary rejection, cleanup and next restore`, () => {
    const evidenceRoot = join(process.cwd(), 'reports', 'exa-67-zip64');
    mkdirSync(evidenceRoot, { recursive: true });
    const root = mkdtempSync(join(evidenceRoot, 'fixture-'));
    try {
      const live = join(root, 'live');
      const source = join(root, 'source');
      mkdirSync(live); mkdirSync(source);
      const local = join(live, 'local.sqlite');
      const workspace = join(live, 'ws_test.sqlite');
      const attachment = join(live, 'attachment-canary.png');
      const outside = join(root, 'outside-canary.txt');
      sqlite(local, 'old local'); sqlite(workspace, 'old workspace');
      writeFileSync(attachment, 'DISPOSABLE ATTACHMENT');
      writeFileSync(outside, 'OUTSIDE STAGING MUST SURVIVE');
      const before = Object.fromEntries([local, workspace, attachment, outside].map(file => [file, digest(readFileSync(file))]));
      const archive = join(root, 'malformed.zip');
      const bytes = zip64Fixture('local.sqlite', Buffer.from('data'));
      assert.equal(bytes.length, 250);
      scenario.mutate(bytes);
      writeFileSync(archive, bytes);
      const validArchive = join(root, 'valid-zip64.bugpocket');
      const validLocal = sqlite(join(source, 'local.sqlite'), 'new local after ZIP64');
      writeFileSync(validArchive, zip64DirectoryFixture([
        { name: 'local.sqlite', bytes: validLocal },
        { name: 'manifest.json', bytes: JSON.stringify({ format_version: 2, databases: { local_db: 'local.sqlite', workspace_db: null, current_workspace_id: null }, archived_attachments: [] }) }
      ]));
      const config = join(root, 'config.json');
      writeFileSync(config, JSON.stringify({ root, live, archive, validArchive, before, validLocalHash: digest(validLocal), preserveAfterValid: [workspace, attachment, outside], expectedError: scenario.expectedError }));
      const child = spawnSync(process.execPath, [join(process.cwd(), 'src', 'main', 'sync', 'backupZip64.child.cjs'), config], {
        encoding: 'utf8', windowsHide: true,
        // Harness-only watchdog. Production parser/restore has no timeout or
        // global exception handler hiding an escaped asynchronous exception.
        timeout: 15_000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      });
      assert.ifError(child.error);
      assert.equal(child.status, 0, `Child must reject normally and exit naturally. stderr:\n${child.stderr}\nstdout:\n${child.stdout}`);
      assert.match(child.stdout, /NORMAL_REJECTION/);
      const marker = child.stdout.split(/\r?\n/).find(line => line.startsWith('ZIP64_RESULT '));
      assert.ok(marker, 'child must complete every cleanup, descriptor and retry assertion');
      const result = JSON.parse(marker.slice('ZIP64_RESULT '.length));
      for (const field of ['normalRejection', 'extractionRejected', 'descriptorsClosed', 'liveUnchanged', 'barrierIdle', 'nextOperation', 'validZip64Restore']) assert.equal(result[field], true, field);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
