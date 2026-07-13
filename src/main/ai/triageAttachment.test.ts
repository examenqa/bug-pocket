const triageAttachmentTest: typeof import('node:test') = require('node:test');
const triageAttachmentAssert: typeof import('node:assert/strict') = require('node:assert/strict');
const { mkdirSync, writeFileSync, rmSync }: typeof import('node:fs') = require('node:fs');
const { resolve: resolvePath }: typeof import('node:path') = require('node:path');
const {
  resolveVerifiedTriageAttachmentPath
}: typeof import('./triageAttachment') = require('./triageAttachment.ts');

triageAttachmentTest('AI triage rejects arbitrary renderer path text as an attachment ID', () => {
  let databaseRead = false;
  const database = {
    getAttachment: () => {
      databaseRead = true;
      return null;
    }
  } as unknown as import('../database').BugPocketDatabase;

  triageAttachmentAssert.throws(
    () => resolveVerifiedTriageAttachmentPath(database, { attachment_id: '../../../Windows/System32/config/SAM' }),
    /attachment ID is invalid/i
  );
  triageAttachmentAssert.equal(databaseRead, false);
});

triageAttachmentTest('AI triage resolves a verified attachment record inside the main process', () => {
  const filePath = resolvePath('.unit-test-data', 'triage-attachment.png');
  mkdirSync(resolvePath('.unit-test-data'), { recursive: true });
  writeFileSync(filePath, Buffer.from('test-image'));
  const database = {
    getAttachment: (id: number) => id === 17
      ? { id, content_hash: 'a1'.repeat(32), file_extension: '.png' }
      : null,
    resolveAttachmentPath: () => filePath
  } as unknown as import('../database').BugPocketDatabase;

  try {
    triageAttachmentAssert.equal(
      resolveVerifiedTriageAttachmentPath(database, { attachment_id: '17' }),
      filePath
    );
  } finally {
    rmSync(resolvePath('.unit-test-data'), { recursive: true, force: true });
  }
});
