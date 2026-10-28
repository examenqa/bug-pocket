import { deflateRawSync } from 'node:zlib';

export interface ZipFixtureEntry {
  name: string;
  rawName?: Buffer;
  bytes?: Buffer | string;
  mode?: number;
  platform?: number;
  attributes?: number;
  method?: number;
  flags?: number;
  localName?: string;
  localMethod?: number;
  localFlags?: number;
  declaredSize?: number;
  crc?: number;
  descriptor?: boolean;
  localExtra?: Buffer;
  centralExtra?: Buffer;
  centralComment?: Buffer;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function fixtureCrc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// Build real ZIP records directly so malformed names, headers and duplicate entries
// reach the reader unchanged instead of being repaired by a general ZIP writer.
export function zipFixture(entries: ZipFixtureEntry[]): Buffer {
  const records: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = entry.rawName ?? Buffer.from(entry.name);
    const localName = entry.localName == null ? name : Buffer.from(entry.localName);
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const centralComment = entry.centralComment ?? Buffer.alloc(0);
    const bytes = Buffer.from(entry.bytes ?? 'fixture');
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(bytes) : bytes;
    const flags = entry.flags ?? (0x800 | (entry.descriptor ? 8 : 0));
    const crc = entry.crc ?? fixtureCrc32(bytes);
    const declaredSize = entry.declaredSize ?? bytes.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.localFlags ?? flags, 6);
    local.writeUInt16LE(entry.localMethod ?? method, 8);
    if (!entry.descriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(declaredSize, 22);
    }
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(((entry.platform ?? 3) << 8) | 20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(declaredSize, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(centralExtra.length, 30);
    directory.writeUInt16LE(centralComment.length, 32);
    directory.writeUInt32LE(entry.attributes ?? (((entry.mode ?? 0o100644) << 16) >>> 0), 38);
    directory.writeUInt32LE(offset, 42);
    const descriptor = entry.descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (entry.descriptor) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(declaredSize, 12);
    }
    records.push(local, localName, localExtra, compressed, descriptor);
    central.push(directory, name, centralExtra, centralComment);
    offset += local.length + localName.length + localExtra.length + compressed.length + descriptor.length;
  }
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, directoryBytes, end]);
}

export function zip64Fixture(name: string, bytes: Buffer): Buffer {
  const encodedName = Buffer.from(name);
  const crc = fixtureCrc32(bytes);
  const localExtra = Buffer.alloc(20);
  localExtra.writeUInt16LE(1);
  localExtra.writeUInt16LE(16, 2);
  localExtra.writeBigUInt64LE(BigInt(bytes.length), 4);
  localExtra.writeBigUInt64LE(BigInt(bytes.length), 12);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(45, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(0xffffffff, 18);
  local.writeUInt32LE(0xffffffff, 22);
  local.writeUInt16LE(encodedName.length, 26);
  local.writeUInt16LE(localExtra.length, 28);
  const localBytes = Buffer.concat([local, encodedName, localExtra, bytes]);
  const centralExtra = Buffer.alloc(28);
  centralExtra.writeUInt16LE(1);
  centralExtra.writeUInt16LE(24, 2);
  centralExtra.writeBigUInt64LE(BigInt(bytes.length), 4);
  centralExtra.writeBigUInt64LE(BigInt(bytes.length), 12);
  centralExtra.writeBigUInt64LE(0n, 20);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE((3 << 8) | 45, 4);
  central.writeUInt16LE(45, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt16LE(encodedName.length, 28);
  central.writeUInt16LE(centralExtra.length, 30);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(0xffffffff, 42);
  const centralBytes = Buffer.concat([central, encodedName, centralExtra]);
  const end64 = Buffer.alloc(56);
  end64.writeUInt32LE(0x06064b50);
  end64.writeBigUInt64LE(44n, 4);
  end64.writeUInt16LE(45, 12);
  end64.writeUInt16LE(45, 14);
  end64.writeBigUInt64LE(1n, 24);
  end64.writeBigUInt64LE(1n, 32);
  end64.writeBigUInt64LE(BigInt(centralBytes.length), 40);
  end64.writeBigUInt64LE(BigInt(localBytes.length), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50);
  locator.writeBigUInt64LE(BigInt(localBytes.length + centralBytes.length), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([localBytes, centralBytes, end64, locator, end]);
}

// A multi-entry archive with a ZIP64 directory envelope. Local records keep
// their ordinary small sizes; the ZIP64 EOCD and locator are real binary records.
export function zip64DirectoryFixture(entries: ZipFixtureEntry[]): Buffer {
  const ordinary = zipFixture(entries);
  const endOffset = ordinary.length - 22;
  const centralSize = ordinary.readUInt32LE(endOffset + 12);
  const centralOffset = ordinary.readUInt32LE(endOffset + 16);
  const end64 = Buffer.alloc(56);
  end64.writeUInt32LE(0x06064b50);
  end64.writeBigUInt64LE(44n, 4);
  end64.writeUInt16LE(45, 12);
  end64.writeUInt16LE(45, 14);
  end64.writeBigUInt64LE(BigInt(entries.length), 24);
  end64.writeBigUInt64LE(BigInt(entries.length), 32);
  end64.writeBigUInt64LE(BigInt(centralSize), 40);
  end64.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50);
  locator.writeBigUInt64LE(BigInt(endOffset), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([ordinary.subarray(0, endOffset), end64, locator, end]);
}
