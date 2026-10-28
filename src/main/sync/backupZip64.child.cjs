const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const archivePaths = new Set([config.archive, config.validArchive].map(file => path.resolve(file)));
const captured = [];
let phase = 'startup';

// Test-only instrumentation is installed before production modules load. The
// descriptor is observed at the actual filesystem open, then checked with fstat
// after rejection. Rename/delete sharing alone would not prove Windows closure.
const originalOpen = fs.open;
fs.open = function(file, flags, ...args) {
  const callback = args.pop();
  return originalOpen.call(this, file, flags, ...args, (error, fd) => {
    if (!error && archivePaths.has(path.resolve(String(file)))) captured.push({ phase, fd });
    callback(error, fd);
  });
};
const originalPromiseOpen = fsPromises.open;
fsPromises.open = async function(file, ...args) {
  const handle = await originalPromiseOpen.call(this, file, ...args);
  if (archivePaths.has(path.resolve(String(file)))) captured.push({ phase, fd: handle.fd });
  return handle;
};
syncBuiltinESMExports();
require('tsx/cjs');
const { restoreBackupArchive } = require('./backupService.ts');
const { extractBackupArchive } = require('./backupExtraction.ts');
const { operationBarrier } = require('../OperationBarrier.ts');

function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function hashesUnchanged() {
  for (const [file, expected] of Object.entries(config.before)) assert.equal(hash(file), expected, `Preserve ${file}`);
}
function idle() {
  assert.equal(operationBarrier.isInMaintenance, false, 'production maintenance mode must exit');
  assert.equal(operationBarrier.activeCount, 0, 'production operation must leave the barrier');
}
function descriptorsClosed() {
  const descriptors = captured.filter(record => record.phase === phase);
  assert.ok(descriptors.length > 0, 'instrumentation must observe an actual archive descriptor');
  for (const { fd } of descriptors) assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
}
function noPrivateStaging() {
  assert.equal(fs.readdirSync(config.live).some(name => name.startsWith('.staging_restore-')), false);
}

// Deliberately no uncaughtException/unhandledRejection hooks and no forced
// success exit. An exception escaping the parser must crash this child and fail
// the parent test; the only watchdog lives in the test parent.
(async () => {
  const result = { normalRejection: false, extractionRejected: false, descriptorsClosed: false, liveUnchanged: false, barrierIdle: false, nextOperation: false, validZip64Restore: false };
  let beforeCommit = 0;
  phase = 'restore-reject';
  try {
    await restoreBackupArchive(config.archive, config.live, { beforeCommit: () => { beforeCommit++; } });
    assert.fail('Malformed ZIP64 restore unexpectedly succeeded');
  } catch (error) {
    assert.match(error.message, new RegExp(config.expectedError, 'i'));
    assert.doesNotMatch(error.message, /missing manifest|not a database|SQLite integrity/i);
    result.error = { name: error.name, code: error.code ?? null, message: error.message };
    result.normalRejection = true;
    console.log('NORMAL_REJECTION');
  }
  assert.equal(beforeCommit, 0);
  descriptorsClosed();
  hashesUnchanged();
  noPrivateStaging();
  idle();
  result.liveUnchanged = true;
  result.barrierIdle = true;
  assert.equal(await operationBarrier.acquire(async () => 'next operation succeeded'), 'next operation succeeded');
  idle();
  result.nextOperation = true;

  phase = 'extract-reject';
  const staging = path.join(config.root, 'direct-staging');
  fs.mkdirSync(staging);
  try {
    await extractBackupArchive(config.archive, staging);
    assert.fail('Malformed ZIP64 extraction unexpectedly succeeded');
  } catch (error) {
    assert.match(error.message, new RegExp(config.expectedError, 'i'));
    result.extractionRejected = true;
  }
  descriptorsClosed();
  assert.deepEqual(fs.readdirSync(staging), [], 'malformed metadata must not write file outputs');
  fs.rmSync(staging, { recursive: true });

  phase = 'valid-restore';
  await restoreBackupArchive(config.validArchive, config.live, { beforeCommit: () => { beforeCommit++; } });
  assert.equal(beforeCommit, 1);
  assert.equal(hash(path.join(config.live, 'local.sqlite')), config.validLocalHash);
  for (const file of config.preserveAfterValid) assert.equal(hash(file), config.before[file]);
  descriptorsClosed();
  noPrivateStaging();
  idle();
  result.validZip64Restore = true;
  result.descriptorsClosed = true;
  result.captured = captured;
  const renamed = config.archive + '.closed';
  fs.renameSync(config.archive, renamed);
  fs.renameSync(renamed, config.archive);
  console.log('ZIP64_RESULT ' + JSON.stringify(result));
})().catch(error => {
  console.error('ZIP64_CHILD_ASSERTION_FAILED', error);
  process.exitCode = 1;
});
