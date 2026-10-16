/** Bounded, browser-only ZIP text import. Never fetches, writes files, or executes document content. */
const limits = {
  input: 50 * 1024 * 1024,
  entries: 512,
  documents: 64,
  single: 2 * 1024 * 1024,
  total: 4 * 1024 * 1024,
};
type ZipCode =
  | 'INVALID_ZIP'
  | 'ZIP_LIMIT'
  | 'ZIP_UNSUPPORTED'
  | 'ZIP_PATH'
  | 'ZIP_UTF8'
  | 'ZIP_CRC'
  | 'ZIP_BROWSER'
  | 'ZIP_DATA'
  | 'ZIP_EMPTY';
class PublisherZipError extends Error {
  readonly code: ZipCode;
  constructor(code: ZipCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PublisherZipError';
  }
}
function fail(code: ZipCode, message: string): never {
  throw new PublisherZipError(code, message);
}
const invalid = (): never =>
  fail('INVALID_ZIP', 'ZIP 文件不完整或目录与文件记录不一致，请重新导出。');
const unsupported = () =>
  fail(
    'ZIP_UNSUPPORTED',
    '仅支持未加密的普通单盘 ZIP（stored/deflate）；请重新导出，不使用 ZIP64 或分卷。',
  );
const exceeded = () =>
  fail(
    'ZIP_LIMIT',
    'ZIP 超过导入上限：50 MB 压缩包、512 个附件、64 份文稿、单篇正文 2 MB、正文合计 4 MB。正文会按整理容量分批，照片附件不在此导入。',
  );
function utf8(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('ZIP_UTF8', 'ZIP 文件名称或文稿不是有效 UTF-8，请以 UTF-8 重新导出。');
  }
}
function safePath(name: string) {
  const path = name.normalize('NFC');
  const segments = path.endsWith('/') ? path.slice(0, -1).split('/') : path.split('/');
  if (
    !path ||
    path.length > 512 ||
    /[\\:\u0000-\u001f\u007f]/u.test(path) ||
    path.startsWith('/') ||
    segments.some((part) => !part || part === '.' || part === '..')
  )
    fail('ZIP_PATH', 'ZIP 含不安全或重复的文件路径，请重新导出。');
  return path;
}
function ignored(name: string) {
  const segments = name.split('/');
  return (
    name.endsWith('/') ||
    segments.some((part) => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'))
  );
}
// Standard CRC-32, updated over actual output rather than trusting ZIP header values.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function updateCrc(crc: number, bytes: Uint8Array) {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return crc >>> 0;
}
type Entry = {
  filename: string;
  method: number;
  size: number;
  crc: number;
  start: number;
  end: number;
  document: boolean;
};
async function readDocument(bytes: Uint8Array<ArrayBuffer>, entry: Entry, remaining: number) {
  const compressed = bytes.subarray(entry.start, entry.end);
  let stream: ReadableStream<Uint8Array>;
  if (entry.method === 0) {
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(compressed);
        controller.close();
      },
    });
  } else {
    let decompressor: DecompressionStream;
    try {
      decompressor = new DecompressionStream('deflate-raw');
    } catch {
      return fail(
        'ZIP_BROWSER',
        '当前浏览器不支持 ZIP 解压，请解压后选择 UTF-8 Markdown 文件导入。',
      );
    }
    let position = 0;
    stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        if (position === compressed.length) {
          controller.close();
          return;
        }
        const end = Math.min(position + 16 * 1024, compressed.length);
        controller.enqueue(compressed.subarray(position, end));
        position = end;
      },
    }).pipeThrough(decompressor);
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = [];
  let length = 0,
    crc = 0xffffffff,
    completed = false;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > limits.single || length > remaining) exceeded();
      if (length > entry.size) fail('ZIP_DATA', 'ZIP 文稿展开大小与目录记录不一致，请重新导出。');
      crc = updateCrc(crc, item.value);
      try {
        parts.push(decoder.decode(item.value, { stream: true }));
      } catch {
        fail('ZIP_UTF8', 'ZIP 文稿不是有效 UTF-8，请以 UTF-8 重新导出。');
      }
    }
    if (length !== entry.size) fail('ZIP_DATA', 'ZIP 文稿展开大小与目录记录不一致，请重新导出。');
    if ((crc ^ 0xffffffff) >>> 0 !== entry.crc)
      fail('ZIP_CRC', 'ZIP 文稿校验失败，文件可能已损坏，请重新导出。');
    try {
      parts.push(decoder.decode());
    } catch {
      fail('ZIP_UTF8', 'ZIP 文稿不是有效 UTF-8，请以 UTF-8 重新导出。');
    }
    completed = true;
    return parts.join('');
  } catch (error) {
    if (error instanceof PublisherZipError) throw error;
    return fail('ZIP_DATA', 'ZIP 压缩数据损坏，无法读取文稿，请重新导出。');
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Non-document attachments and macOS metadata are skipped; all directory/local records are validated. */
export async function extractZipEntries(
  buffer: ArrayBuffer | Uint8Array,
): Promise<Array<{ filename: string; content: string }>> {
  if (!(buffer instanceof ArrayBuffer) && !(buffer instanceof Uint8Array)) invalid();
  if (buffer.byteLength > limits.input) exceeded();
  // Own a bounded snapshot; subarray input offsets are respected and caller mutations cannot change validation.
  const bytes =
    buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  const need = (offset: number, size: number, end = bytes.length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > end) invalid();
  };
  const u16 = (at: number) => {
    need(at, 2);
    return view.getUint16(at, true);
  };
  const u32 = (at: number) => {
    need(at, 4);
    return view.getUint32(at, true);
  };
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) invalid();
  const count = u16(eocd + 10),
    cdSize = u32(eocd + 12),
    cdOffset = u32(eocd + 16);
  if (
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff ||
    (eocd >= 20 && u32(eocd - 20) === 0x07064b50)
  )
    unsupported();
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 || u16(eocd + 8) !== count) unsupported();
  if (count > limits.entries) exceeded();
  need(cdOffset, cdSize, eocd);
  if (cdOffset + cdSize !== eocd) invalid();
  const extra = (offset: number, size: number) => {
    const end = offset + size;
    need(offset, size);
    while (offset < end) {
      need(offset, 4, end);
      const id = u16(offset),
        length = u16(offset + 2);
      if (id === 0x0001 || id === 0x9901) unsupported();
      need(offset + 4, length, end);
      offset += 4 + length;
    }
  };
  let cursor = cdOffset,
    documents = 0,
    expanded = 0;
  const names = new Set<string>();
  const entries: Entry[] = [],
    spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) {
    need(cursor, 46, eocd);
    if (u32(cursor) !== 0x02014b50) invalid();
    const version = u16(cursor + 6),
      flags = u16(cursor + 8),
      method = u16(cursor + 10);
    const crc = u32(cursor + 16),
      compressedSize = u32(cursor + 20),
      size = u32(cursor + 24);
    const nameLength = u16(cursor + 28),
      extraLength = u16(cursor + 30),
      commentLength = u16(cursor + 32);
    const local = u32(cursor + 42);
    if (
      version >= 45 ||
      size === 0xffffffff ||
      compressedSize === 0xffffffff ||
      local === 0xffffffff ||
      u16(cursor + 34) !== 0 ||
      flags & ~0x080e ||
      (method !== 0 && method !== 8) ||
      (method === 0 && flags & 6) ||
      ((u32(cursor + 38) >>> 16) & 0xf000) === 0xa000
    )
      unsupported();
    need(cursor + 46, nameLength + extraLength + commentLength, eocd);
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const filename = safePath(utf8(rawName));
    const collisionKey = filename.toLowerCase();
    if (names.has(collisionKey)) fail('ZIP_PATH', 'ZIP 含不安全或重复的文件路径，请重新导出。');
    names.add(collisionKey);
    extra(cursor + 46 + nameLength, extraLength);
    need(local, 30, cdOffset);
    if (
      u32(local) !== 0x04034b50 ||
      u16(local + 4) !== version ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method
    )
      invalid();
    const localNameLength = u16(local + 26),
      localExtraLength = u16(local + 28);
    need(local + 30, localNameLength + localExtraLength, cdOffset);
    const localName = bytes.subarray(local + 30, local + 30 + localNameLength);
    if (
      localName.length !== rawName.length ||
      localName.some((byte, index) => byte !== rawName[index])
    )
      invalid();
    extra(local + 30 + localNameLength, localExtraLength);
    const descriptor = Boolean(flags & 8);
    for (const [field, expected] of [
      [14, crc],
      [18, compressedSize],
      [22, size],
    ] as const) {
      const actual = u32(local + field);
      if (descriptor ? actual !== 0 && actual !== expected : actual !== expected) invalid();
    }
    const start = local + 30 + localNameLength + localExtraLength,
      end = start + compressedSize;
    need(start, compressedSize, cdOffset);
    let recordEnd = end;
    if (descriptor) {
      // With or without the optional signature; never scan outside this file's data.
      need(end, 12, cdOffset);
      const candidates = u32(end) === 0x08074b50 ? [end + 4, end] : [end];
      const at = candidates.find(
        (offset) =>
          offset + 12 <= cdOffset &&
          u32(offset) === crc &&
          u32(offset + 4) === compressedSize &&
          u32(offset + 8) === size,
      );
      if (at === undefined) return invalid();
      recordEnd = at + 12;
    }
    if (method === 0 && compressedSize !== size) invalid();
    if (filename.endsWith('/') && size !== 0) invalid();
    const document = !ignored(filename) && /\.(?:md|markdown|txt)$/iu.test(filename);
    if (document) {
      documents++;
      expanded += size;
      if (documents > limits.documents || size > limits.single || expanded > limits.total)
        exceeded();
    }
    spans.push({ start: local, end: recordEnd });
    entries.push({ filename, method, size, crc, start, end, document });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== eocd) invalid();
  // Refuse overlaps, hidden/unindexed payloads and self-extracting prefixes. No bytes are executable.
  spans.sort((a, b) => a.start - b.start);
  let end = 0;
  for (const span of spans) {
    if (span.start !== end) invalid();
    end = span.end;
  }
  if (end !== cdOffset) invalid();
  if (!documents)
    fail(
      'ZIP_EMPTY',
      'ZIP 中没有可导入的 UTF-8 .md、.markdown 或 .txt 文稿（附件和 macOS 杂项不导入）。',
    );
  const result: Array<{ filename: string; content: string }> = [];
  let total = 0;
  for (const entry of entries) {
    if (!entry.document) continue;
    const content = await readDocument(bytes, entry, limits.total - total);
    total += entry.size;
    result.push({ filename: entry.filename, content });
  }
  return result;
}
