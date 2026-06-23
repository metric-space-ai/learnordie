type ZipInputEntry = {
  name: string;
  data: Buffer | string;
};

type ZipCentralEntry = {
  nameBuffer: Buffer;
  crc32: number;
  size: number;
  offset: number;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function localFileHeader(entry: ZipCentralEntry, dosTime: number, dosDate: number) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralDirectoryHeader(entry: ZipCentralEntry, dosTime: number, dosDate: number) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(dosTime, 12);
  header.writeUInt16LE(dosDate, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return header;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number) {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralSize, 12);
  header.writeUInt32LE(centralOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

export function createZipArchive(entries: ZipInputEntry[]) {
  const { dosTime, dosDate } = dosDateTime();
  const fileParts: Buffer[] = [];
  const centralEntries: ZipCentralEntry[] = [];
  let offset = 0;

  for (const input of entries) {
    const data = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data, "utf8");
    const name = input.name.replace(/^\/+/, "");
    const entry: ZipCentralEntry = {
      nameBuffer: Buffer.from(name, "utf8"),
      crc32: crc32(data),
      size: data.length,
      offset
    };
    const header = localFileHeader(entry, dosTime, dosDate);
    fileParts.push(header, entry.nameBuffer, data);
    centralEntries.push(entry);
    offset += header.length + entry.nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralParts = centralEntries.flatMap((entry) => {
    const header = centralDirectoryHeader(entry, dosTime, dosDate);
    return [header, entry.nameBuffer];
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  return Buffer.concat([
    ...fileParts,
    ...centralParts,
    endOfCentralDirectory(centralEntries.length, centralSize, centralOffset)
  ]);
}
