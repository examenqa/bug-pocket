import { app } from 'electron';
import { basename, join } from 'node:path';

export function getAssetPath(filename: string): string {
  if (!filename || basename(filename) !== filename || filename.includes('\0')) {
    throw new Error(`Invalid packaged asset filename: ${filename}`);
  }

  return app.isPackaged
    ? join(process.resourcesPath, 'assets', filename)
    : join(__dirname, '../../assets', filename);
}
