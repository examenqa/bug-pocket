import { constants, lstatSync } from 'node:fs';
import { copyFile, mkdtemp, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import delivery from '../../compliance/ffmpeg-source-delivery.json';

export function findBundledFfmpegSource(resourcesPath: string): string | null {
  const notices = join(resourcesPath, 'notices');
  const directory = join(notices, 'ffmpeg-source');
  for (const parent of [notices, directory]) {
    if (!lstatSync(parent, { throwIfNoEntry: false })?.isDirectory()) return null;
  }
  for (const [name, expected] of Object.entries(delivery.files)) {
    const file = lstatSync(join(directory, name), { throwIfNoEntry: false });
    if (!file?.isFile() || file.size !== expected.bytes) return null;
  }
  return directory;
}

export async function copyBundledFfmpegSource(source: string, destination: string): Promise<string> {
  const folder = await mkdtemp(join(destination, 'Bug Pocket FFmpeg source - '));
  const copied: string[] = [];
  try {
    for (const name of Object.keys(delivery.files)) {
      const output = join(folder, name);
      await copyFile(join(source, name), output, constants.COPYFILE_EXCL);
      copied.push(output);
    }
    return folder;
  } catch (error) {
    await Promise.allSettled(copied.map(output => unlink(output)));
    await rmdir(folder).catch(() => {});
    throw error;
  }
}
