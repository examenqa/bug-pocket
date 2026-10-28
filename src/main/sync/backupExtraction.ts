import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open as openOutput, readdir, realpath, rmdir, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import { BoundedZipReader } from './backupArchiveReader';

export interface ExtractionLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxManifestBytes: number;
  maxArchiveBytes: number;
  maxMetadataBytes: number;
  maxDepth: number;
  maxPathBytes: number;
}

// These are restore resource ceilings, not archive-format limits. Byte ceilings
// apply to both advertised sizes and bytes actually produced by decompression.
export const DEFAULT_EXTRACTION_LIMITS: Readonly<ExtractionLimits> = Object.freeze({
  maxEntries: 10_000,
  maxFileBytes: 2 * 1024 ** 3,
  maxTotalBytes: 8 * 1024 ** 3,
  maxManifestBytes: 4 * 1024 ** 2,
  maxArchiveBytes: 10 * 1024 ** 3,
  maxMetadataBytes: 16 * 1024 ** 2,
  maxDepth: 16,
  maxPathBytes: 1024
});

interface ExtractionOptions {
  limits?: Partial<ExtractionLimits>;
  signal?: AbortSignal;
}

interface PlannedEntry {
  entry: yauzl.Entry;
  path: string;
  directory: boolean;
  maxBytes: number;
}

type DirectoryIdentities = Map<string, BigIntStats>;

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Backup extraction was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

async function assertDirectory(path: string, identities: DirectoryIdentities): Promise<void> {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Backup staging contains an unsafe directory: '${path}'.`);
  // Windows realpath expands legitimate 8.3 names (for example RUNNER~1).
  // Compare filesystem identities, while checking every lexical ancestor for
  // links, rather than treating a different spelling as proof of redirection.
  const physical = await lstat(await realpath(path), { bigint: true });
  if (!physical.isDirectory() || physical.isSymbolicLink() || !sameFile(stat, physical)) {
    throw new Error(`Backup staging directory resolves through a link: '${path}'.`);
  }
  const previous = identities.get(path);
  if (previous && !sameFile(previous, stat)) throw new Error(`Backup staging directory changed: '${path}'.`);
  identities.set(path, stat);
}

async function assertDirectoryAncestors(path: string, identities: DirectoryIdentities): Promise<void> {
  const ancestors: string[] = [];
  let current = resolve(path);
  for (;;) {
    ancestors.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const ancestor of ancestors.reverse()) await assertDirectory(ancestor, identities);
}

export async function createBackupStagingDirectory(userDataPath: string): Promise<string> {
  const root = resolve(userDataPath);
  const identities: DirectoryIdentities = new Map();
  await assertDirectoryAncestors(root, identities);
  const staging = await mkdtemp(join(root, '.staging_restore-'));
  let created: BigIntStats | undefined;
  try {
    created = await lstat(staging, { bigint: true });
    await assertDirectoryAncestors(staging, identities);
    return staging;
  } catch (error) {
    try {
      await assertDirectoryAncestors(root, identities);
      const current = await lstat(staging, { bigint: true });
      if (created?.isDirectory() && !created.isSymbolicLink() && current.isDirectory()
        && !current.isSymbolicLink() && sameFile(created, current)) {
        // Empty-only removal cannot recurse into injected content or a link.
        await rmdir(staging);
      }
    } catch { /* A changed ancestor, identity or nonempty directory must be left alone. */ }
    throw error;
  }
}

function validatedLimits(overrides?: Partial<ExtractionLimits>): ExtractionLimits {
  const limits = { ...DEFAULT_EXTRACTION_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    const minimum = key === 'maxEntries' || key === 'maxDepth' || key === 'maxPathBytes' ? 1 : 0;
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid backup extraction limit '${key}'.`);
  }
  return limits;
}

function windowsIdentity(path: string): string {
  return path.normalize('NFKC').toLowerCase();
}

function safeName(raw: string, limits: ExtractionLimits): { path: string; directory: boolean } {
  const normalized = raw.replace(/\\/g, '/');
  const directory = normalized.endsWith('/');
  const path = directory ? normalized.slice(0, -1) : normalized;
  const parts = path.split('/');
  if (!path || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
    || Buffer.byteLength(normalized, 'utf8') > limits.maxPathBytes || parts.length > limits.maxDepth) {
    throw new Error(`Backup archive contains an unsafe path or exceeds path limits: '${raw}'.`);
  }
  for (const part of parts) {
    const canonical = part.normalize('NFKC');
    const device = canonical.split('.')[0].replace(/[ .]+$/g, '');
    if (!part || canonical === '.' || canonical === '..' || /[\\/<>:"|?*\x00-\x1f\x7f]/.test(canonical)
      // NTFS can generate short names only after creating the long entry. The
      // managed backup names never need tilde-digit components; refusing them
      // keeps possible 8.3 aliases out of the inventory before any entry writes.
      || /~[0-9]/.test(canonical) || /[ .]$/.test(canonical) || Buffer.byteLength(part, 'utf8') > 255
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)$/i.test(device)) {
      throw new Error(`Backup archive contains an unsafe Windows path: '${raw}'.`);
    }
  }
  return { path: parts.join('/'), directory };
}

function planEntry(
  entry: yauzl.Entry,
  limits: ExtractionLimits,
  names: Map<string, { path: string; directory: boolean; explicit: boolean }>
): PlannedEntry {
  const { path, directory } = safeName(entry.fileName, limits);
  const type = (entry.externalFileAttributes >>> 16) & 0xf000;
  if (type !== 0 && type !== 0x8000 && type !== 0x4000) {
    throw new Error(`Backup archive contains a symbolic link or special file: '${entry.fileName}'.`);
  }
  if ((type === 0x4000 && !directory) || (type === 0x8000 && directory)
    || ((entry.externalFileAttributes & 0x10) !== 0 && !directory)
    || (entry.externalFileAttributes & (0x400 | 0x08)) !== 0) {
    throw new Error(`Backup archive contains conflicting or unsupported entry attributes: '${entry.fileName}'.`);
  }
  if ((entry.generalPurposeBitFlag & (0x01 | 0x40 | 0x2000)) !== 0) throw new Error('Encrypted backup entries are not supported.');
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error('Unsupported backup compression method.');
  for (const value of [entry.compressedSize, entry.uncompressedSize, entry.relativeOffsetOfLocalHeader]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Backup archive contains an invalid entry size or offset.');
  }
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const itemPath = parts.slice(0, index).join('/');
    const last = index === parts.length;
    const itemDirectory = !last || directory;
    const identity = windowsIdentity(itemPath);
    const previous = names.get(identity);
    if (previous) {
      if (previous.path !== itemPath) throw new Error(`Backup archive contains a Windows path alias: '${path}'.`);
      if (!previous.directory || !itemDirectory) throw new Error(`Backup archive contains a duplicate or conflicting file: '${path}'.`);
      if (last && previous.explicit) throw new Error(`Backup archive contains a duplicate entry: '${path}'.`);
      if (last) previous.explicit = true;
    } else {
      names.set(identity, { path: itemPath, directory: itemDirectory, explicit: last });
    }
  }
  const manifest = /^(manifest|backup-manifest)\.json$/.test(windowsIdentity(path));
  const maxBytes = directory ? 0 : Math.min(limits.maxFileBytes, manifest ? limits.maxManifestBytes : limits.maxFileBytes);
  if (entry.uncompressedSize > maxBytes) throw new Error(`Backup archive entry exceeds its size limit: '${path}'.`);
  return { entry, path, directory, maxBytes };
}

function zip64Sizes(header: yauzl.LocalFileHeader): { compressed: number; uncompressed: number } {
  let compressed = header.compressedSize;
  let uncompressed = header.uncompressedSize;
  if (compressed !== 0xffffffff && uncompressed !== 0xffffffff) return { compressed, uncompressed };
  const extra = yauzl.parseExtraFields(header.extraField).find(field => field.id === 1)?.data;
  if (!extra) throw new Error('Backup archive local header is missing ZIP64 sizes.');
  let cursor = 0;
  const readSize = (): number => {
    if (cursor + 8 > extra.length) throw new Error('Backup archive contains truncated ZIP64 sizes.');
    const value = extra.readBigUInt64LE(cursor);
    cursor += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Backup archive ZIP64 size is too large.');
    return Number(value);
  };
  if (uncompressed === 0xffffffff) uncompressed = readSize();
  if (compressed === 0xffffffff) compressed = readSize();
  return { compressed, uncompressed };
}

async function validateLocalHeader(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<void> {
  const local = await zip.readLocalFileHeaderPromise(entry);
  if (!local.fileName.equals(entry.fileNameRaw) || local.compressionMethod !== entry.compressionMethod
    || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag) {
    throw new Error(`Backup archive local and central headers disagree: '${entry.fileName}'.`);
  }
  const fields = yauzl.parseExtraFields(local.extraField);
  if (fields.some(field => field.id === 0x7075)
    && yauzl.getFileNameLowLevel(local.generalPurposeBitFlag, local.fileName, fields, false) !== entry.fileName) {
    throw new Error(`Backup archive local and central names disagree: '${entry.fileName}'.`);
  }
  const sizes = zip64Sizes(local);
  const descriptor = (entry.generalPurposeBitFlag & 8) !== 0;
  if ((local.crc32 !== entry.crc32 && !(descriptor && local.crc32 === 0))
    || (sizes.compressed !== entry.compressedSize && !(descriptor && sizes.compressed === 0))
    || (sizes.uncompressed !== entry.uncompressedSize && !(descriptor && sizes.uncompressed === 0))
    || !Number.isSafeInteger(local.fileDataStart + entry.compressedSize)
    || local.fileDataStart + entry.compressedSize > zip.fileSize) {
    throw new Error(`Backup archive local and central sizes or CRC disagree: '${entry.fileName}'.`);
  }
}

async function ensureDirectory(path: string, identities: DirectoryIdentities): Promise<void> {
  if (!identities.has(path)) {
    await assertDirectoryAncestors(dirname(path), identities);
    // No recursive mkdir: an unexpected pre-existing component must fail closed.
    await mkdir(path, { mode: 0o700 });
  }
  await assertDirectoryAncestors(path, identities);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

async function writeChunk(output: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await output.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error('Backup extraction could not complete a file write.');
    offset += bytesWritten;
  }
}

/**
 * Extract into a caller-owned, fresh private directory. The caller removes that
 * directory on failure. Path rechecks and descriptor identities detect changes,
 * but Node's path APIs cannot atomically exclude a same-account actor replacing
 * ancestor directories between those checks and a filesystem operation.
 */
export async function extractBackupArchive(
  backupPath: string,
  stagingPath: string,
  options: ExtractionOptions = {}
): Promise<Set<string>> {
  const limits = validatedLimits(options.limits);
  const root = resolve(stagingPath);
  const identities: DirectoryIdentities = new Map();
  aborted(options.signal);
  await assertDirectoryAncestors(root, identities);
  if ((await readdir(root)).length) throw new Error('Backup staging directory must be empty.');
  const input = await openOutput(backupPath, 'r');
  let zip: yauzl.ZipFile | undefined;
  let currentSource: Readable | undefined;
  let archiveError: Error | undefined;
  let closing = false;
  let failure: unknown;
  let finishClose: (error?: Error) => void = () => {};
  const closed = new Promise<Error | undefined>(resolveClosed => { finishClose = resolveClosed; });
  try {
    aborted(options.signal);
    const inputStat = await input.stat();
    if (!inputStat.isFile() || !Number.isSafeInteger(inputStat.size) || inputStat.size < 0
      || inputStat.size > limits.maxArchiveBytes) throw new Error('Backup archive exceeds its input size limit or is not a regular file.');
    const reader = new BoundedZipReader(input, inputStat.size);
    zip = await yauzl.fromRandomAccessReaderPromise(reader, inputStat.size, {
      autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: false
    });
    zip.once('close', () => finishClose());
    zip.on('error', (error: Error) => {
      archiveError = error;
      currentSource?.destroy(error);
      if (closing) finishClose(error);
    });
    aborted(options.signal);
    if (!Number.isSafeInteger(zip.fileSize) || zip.fileSize > limits.maxArchiveBytes) throw new Error('Backup archive exceeds its input size limit.');
    if (!Number.isSafeInteger(zip.entryCount) || zip.entryCount > limits.maxEntries) throw new Error('Backup archive exceeds its entry count limit.');
    const names = new Map<string, { path: string; directory: boolean; explicit: boolean }>();
    const planned: PlannedEntry[] = [];
    let declaredTotal = 0;
    let metadataBytes = 0;
    for await (const entry of zip.eachEntry()) {
      aborted(options.signal);
      if (planned.length >= limits.maxEntries) throw new Error('Backup archive exceeds its entry count limit.');
      metadataBytes += 46 + entry.fileNameRaw.length + entry.extraFieldRaw.length + entry.fileCommentRaw.length;
      if (metadataBytes > limits.maxMetadataBytes) throw new Error('Backup archive exceeds its metadata size limit.');
      const plan = planEntry(entry, limits, names);
      declaredTotal += entry.uncompressedSize;
      if (!Number.isSafeInteger(declaredTotal) || declaredTotal > limits.maxTotalBytes) throw new Error('Backup archive exceeds its total size limit.');
      await validateLocalHeader(zip, entry);
      planned.push(plan);
    }
    if (archiveError) throw archiveError;
    let actualTotal = 0;
    for (const plan of planned) {
      aborted(options.signal);
      if (archiveError) throw archiveError;
      await assertDirectoryAncestors(root, identities);
      const parts = plan.path.split('/');
      const parentCount = plan.directory ? parts.length : parts.length - 1;
      for (let index = 1; index <= parentCount; index++) await ensureDirectory(join(root, ...parts.slice(0, index)), identities);
      const target = join(root, ...parts);
      let output: FileHandle | undefined;
      let writtenIdentity: BigIntStats | undefined;
      try {
        if (!plan.directory) {
          await assertDirectoryAncestors(dirname(target), identities);
          aborted(options.signal);
          output = await openOutput(target, 'wx', 0o600);
          writtenIdentity = await output.stat({ bigint: true });
          const namedIdentity = await lstat(target, { bigint: true });
          if (!writtenIdentity.isFile() || !namedIdentity.isFile() || namedIdentity.isSymbolicLink()
            || !sameFile(writtenIdentity, namedIdentity) || writtenIdentity.nlink !== 1n) throw new Error('Backup output changed during exclusive creation.');
          await assertDirectoryAncestors(dirname(target), identities);
        }
        aborted(options.signal);
        currentSource = await zip.openReadStreamPromise(plan.entry);
        let actualBytes = 0;
        let crc = 0xffffffff;
        const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          actualBytes += chunk.length;
          actualTotal += chunk.length;
          if (actualBytes > plan.maxBytes || actualBytes > plan.entry.uncompressedSize || actualTotal > limits.maxTotalBytes) {
            callback(new Error(`Backup archive exceeds actual byte limits: '${plan.path}'.`));
            return;
          }
          for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
          callback(null, chunk);
        } });
        const sink = new Writable({ write(chunk: Buffer, _encoding, callback) {
          if (!output) { callback(); return; }
          void writeChunk(output, chunk).then(() => callback(), callback);
        } });
        await pipeline(currentSource, meter, sink, { signal: options.signal });
        currentSource = undefined;
        if (actualBytes !== plan.entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== plan.entry.crc32) {
          throw new Error(`Backup archive entry failed size or CRC integrity verification: '${plan.path}'.`);
        }
        if (output && writtenIdentity) {
          await assertDirectoryAncestors(dirname(target), identities);
          const namedIdentity = await lstat(target, { bigint: true });
          const descriptorIdentity = await output.stat({ bigint: true });
          if (!namedIdentity.isFile() || namedIdentity.isSymbolicLink() || !sameFile(namedIdentity, writtenIdentity)
            || !sameFile(descriptorIdentity, writtenIdentity) || descriptorIdentity.nlink !== 1n) {
            throw new Error('Backup output changed while writing.');
          }
        }
      } finally {
        currentSource?.destroy();
        currentSource = undefined;
        await output?.close();
      }
    }
    aborted(options.signal);
    if (archiveError) throw archiveError;
    await assertDirectoryAncestors(root, identities);
    return new Set(planned.map(plan => plan.path));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (zip) {
        closing = true;
        zip.close();
        const closeError = await closed;
        if (closeError && !failure) throw closeError;
      }
    } finally {
      // The reader borrows this handle even when opening the ZIP rejects.
      // FileHandle.close also waits for any in-flight handle reads to finish.
      await input.close();
    }
  }
}
