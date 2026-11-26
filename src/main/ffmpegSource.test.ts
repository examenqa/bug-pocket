import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import delivery from '../../compliance/ffmpeg-source-delivery.json';
import { copyBundledFfmpegSource, findBundledFfmpegSource } from './ffmpegSource';

test('copies only bundled FFmpeg files from Store notices to a new selected subfolder', async t => {
  const temp = resolve(tmpdir());
  const root = await mkdtemp(join(temp, 'bug-pocket-ffmpeg-source-'));
  t.after(async () => {
    assert.equal(dirname(root), temp);
    assert.ok(basename(root).startsWith('bug-pocket-ffmpeg-source-'));
    await rm(root, { recursive: true, force: true });
  });
  const resources = join(root, 'resources');
  const downloads = join(root, 'Downloads');
  const folder = join(resources, 'notices', 'ffmpeg-source');
  assert.equal(findBundledFfmpegSource(resources), null);
  await mkdir(folder, { recursive: true });
  await mkdir(downloads);
  await writeFile(join(downloads, 'existing.txt'), 'untouched');
  await writeFile(join(folder, 'unrelated.txt'), 'never export this file');
  for (const [name, expected] of Object.entries(delivery.files)) {
    await writeFile(join(folder, name), Buffer.alloc(expected.bytes));
  }
  assert.equal(findBundledFfmpegSource(resources), folder);
  const saved = await copyBundledFfmpegSource(folder, downloads);
  assert.equal(dirname(saved), downloads);
  assert.ok(basename(saved).startsWith('Bug Pocket FFmpeg source - '));
  assert.deepEqual((await readdir(saved)).sort(), Object.keys(delivery.files).sort());
  for (const name of Object.keys(delivery.files)) {
    assert.deepEqual(await readFile(join(saved, name)), await readFile(join(folder, name)));
  }
  assert.equal(await readFile(join(downloads, 'existing.txt'), 'utf8'), 'untouched');

  const recipient = join(folder, 'RECIPIENT.txt');
  await unlink(recipient);
  assert.equal(findBundledFfmpegSource(resources), null);
  await assert.rejects(copyBundledFfmpegSource(folder, downloads));
  assert.deepEqual((await readdir(downloads)).sort(), [basename(saved), 'existing.txt'].sort());
  await writeFile(recipient, 'wrong size');
  assert.equal(findBundledFfmpegSource(resources), null);
  const linked = join(root, 'linked');
  await mkdir(join(linked, 'notices'), { recursive: true });
  await symlink(folder, join(linked, 'notices', 'ffmpeg-source'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(findBundledFfmpegSource(linked), null);
});
