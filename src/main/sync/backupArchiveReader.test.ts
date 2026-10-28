import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BoundedZipReader } from './backupArchiveReader';

function unreadableFile() {
  let ioCalls = 0;
  const file = { read: async () => { ioCalls++; throw new Error('Invalid range reached filesystem I/O'); } } as unknown as FileHandle;
  return { file, ioCalls: () => ioCalls };
}

test('invalid metadata read arguments reject asynchronously before filesystem I/O', async t => {
  const cases: Array<[string, number, number, number, number?]> = [
    ['negative position', 0, 1, -1], ['fractional position', 0, 1, 0.5],
    ['NaN position', 0, 1, NaN], ['infinite position', 0, 1, Infinity],
    ['unsafe integer position', 0, 1, 2 ** 53], ['uint64 rounded position', 0, 1, Number(0xffffffffffffffffn)],
    ['beyond file', 0, 1, 8], ['empty range beyond file', 0, 0, 9],
    ['range crosses file boundary', 0, 2, 7],
    ['unsafe length', 0, 2 ** 53, 0], ['negative length', 0, -1, 0],
    ['fractional length', 0, 0.5, 0], ['NaN length', 0, NaN, 0], ['infinite length', 0, Infinity, 0],
    ['negative buffer offset', -1, 1, 0], ['unsafe buffer offset', 2 ** 53, 1, 0],
    ['fractional buffer offset', 0.5, 1, 0], ['NaN buffer offset', NaN, 1, 0],
    ['infinite buffer offset', Infinity, 1, 0], ['buffer overflow', 7, 2, 0],
    ['empty buffer range beyond end', 9, 0, 0],
    ['position plus length would overflow', 0, 4, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]
  ];
  for (const [name, offset, length, position, size = 8] of cases) await t.test(name, async () => {
    const f = unreadableFile();
    const reader = new BoundedZipReader(f.file, size);
    let synchronous = true;
    const rejection = new Promise<Error>((resolve, reject) => {
      assert.doesNotThrow(() => reader.read(Buffer.alloc(8), offset, length, position, error => {
        try {
          assert.equal(synchronous, false, 'Malformed reads must use the parser callback asynchronously');
          assert.ok(error instanceof Error);
          resolve(error);
        } catch (failure) { reject(failure); }
      }));
    });
    synchronous = false;
    assert.match((await rejection).message, /range.*unsafe|unsafe.*range|outside/i);
    assert.equal(f.ioCalls(), 0);
  });
});

test('invalid streamed ranges reject through the stream before filesystem I/O', async t => {
  const cases: Array<[string, number, number, number?]> = [
    ['negative start', -1, 1], ['fractional start', 0.5, 1], ['NaN start', NaN, 1],
    ['unsafe start', 2 ** 53, 2 ** 53], ['infinite empty range', Infinity, Infinity],
    ['NaN end', 0, NaN], ['infinite end', 0, Infinity], ['fractional end', 0, 1.5],
    ['unsafe end', 0, 2 ** 53], ['reversed range', 3, 2],
    ['end beyond file', 0, 9], ['empty range beyond file', 9, 9],
    ['subtraction would overflow', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
  ];
  for (const [name, start, end, size = 8] of cases) await t.test(name, async () => {
    const f = unreadableFile();
    const reader = new BoundedZipReader(f.file, size);
    const result = async () => {
      const stream = reader.createReadStream({ start, end });
      for await (const _ of stream) assert.fail('Invalid stream emitted data');
    };
    await assert.rejects(result(), /range.*unsafe|unsafe.*range|outside/i);
    assert.equal(f.ioCalls(), 0);
  });
});

test('exact file/buffer boundaries and empty EOF ranges remain valid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bug-pocket-bounded-reader-'));
  const filename = join(directory, 'input');
  await writeFile(filename, '12345678');
  const file = await open(filename, 'r');
  try {
    const reader = new BoundedZipReader(file, 8);
    const buffer = Buffer.alloc(10, '.');
    await new Promise<void>((resolve, reject) => reader.read(buffer, 1, 8, 0, error => error ? reject(error) : resolve()));
    assert.equal(buffer.toString(), '.12345678.');
    await new Promise<void>((resolve, reject) => reader.read(buffer, 10, 0, 8, error => error ? reject(error) : resolve()));
    const chunks: Buffer[] = [];
    for await (const chunk of reader.createReadStream({ start: 0, end: 8 })) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '12345678');
    for await (const _ of reader.createReadStream({ start: 8, end: 8 })) assert.fail('Empty EOF range emitted bytes');
  } finally { await file.close(); await rm(directory, { recursive: true, force: true }); }
});

test('truncation after the size snapshot rejects incomplete metadata and streamed reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bug-pocket-truncated-reader-'));
  const filename = join(directory, 'input');
  await writeFile(filename, '12345678');
  const file = await open(filename, 'r');
  try {
    const reader = new BoundedZipReader(file, 8);
    await writeFile(filename, '1234');
    await assert.rejects(new Promise<void>((resolve, reject) => reader.read(Buffer.alloc(8), 0, 8, 0, error => error ? reject(error) : resolve())), /ended before/);
    await assert.rejects(async () => {
      for await (const _ of reader.createReadStream({ start: 0, end: 8 })) {}
    }, /ended before/);
  } finally { await file.close(); await rm(directory, { recursive: true, force: true }); }
});
