import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { RandomAccessReader } from 'yauzl';

/** A borrowed descriptor: extraction owns and closes the FileHandle. */
export class BoundedZipReader extends RandomAccessReader {
  constructor(private readonly file: FileHandle, private readonly size: number) {
    super();
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid backup archive file size.');
  }

  private assertRange(position: number, length: number): void {
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length)
      || position < 0 || length < 0 || position > this.size || length > this.size - position) {
      throw new Error('Backup archive read range is unsafe or outside the file.');
    }
  }

  private async readBuffer(buffer: Buffer, offset: number, length: number, position: number): Promise<void> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
      || offset < 0 || length < 0 || offset > buffer.length || length > buffer.length - offset) {
      throw new Error('Backup archive read buffer range is unsafe.');
    }
    // Subtraction checks the whole range without overflowing position + length.
    this.assertRange(position, length);
    let completed = 0;
    while (completed < length) {
      const { bytesRead } = await this.file.read(buffer, offset + completed, length - completed, position + completed);
      if (bytesRead === 0) throw new Error('Backup archive ended before the requested read completed.');
      completed += bytesRead;
    }
  }

  override read(
    buffer: Buffer, offset: number, length: number, position: number,
    callback: (error: Error | null, bytesRead?: number) => void
  ): void {
    // yauzl can request this read inside an fs callback while opening ZIP64.
    // Reject through its callback, never by throwing out of that callback.
    void this.readBuffer(buffer, offset, length, position).then(
      () => callback(null, length), error => callback(error)
    );
  }

  override createReadStream({ start, end }: { start: number; end: number }): Readable {
    // A lazy generator delivers range errors as stream errors. It also guards
    // empty ranges, which the base reader would otherwise accept unchecked.
    return Readable.from(this.chunks(start, end), { objectMode: false });
  }

  private async *chunks(start: number, end: number): AsyncGenerator<Buffer> {
    if (!Number.isSafeInteger(end) || !Number.isSafeInteger(start) || end < start) {
      throw new Error('Backup archive stream range is unsafe.');
    }
    this.assertRange(start, end - start);
    let position = start;
    while (position < end) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, end - position));
      await this.readBuffer(buffer, 0, buffer.length, position);
      position += buffer.length;
      yield buffer;
    }
  }
}
