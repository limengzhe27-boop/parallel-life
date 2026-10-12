import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractZipEntries } from '../src/features/publisher/publisher-zip.ts';

type Spec = {
  name: string;
  data?: string | Uint8Array;
  method?: number;
  flags?: number;
  descriptor?: 'signed' | 'unsigned';
  extra?: Uint8Array;
};
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function archive(specs: Spec[], comment = '') {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  const localOffsets: number[] = [],
    dataOffsets: number[] = [];
  let position = 0;
  for (const spec of specs) {
    const name = Buffer.from(spec.name),
      data = typeof spec.data === 'string' ? Buffer.from(spec.data) : Buffer.from(spec.data ?? []);
    const method = spec.method ?? 0,
      compressed = method === 8 ? deflateRawSync(data) : data;
    const flags = (spec.flags ?? 0x0800) | (spec.descriptor ? 8 : 0);
    const extra = Buffer.from(spec.extra ?? []),
      crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!spec.descriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(data.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const descriptor = Buffer.alloc(spec.descriptor === 'signed' ? 16 : spec.descriptor ? 12 : 0);
    if (spec.descriptor) {
      const start = spec.descriptor === 'signed' ? 4 : 0;
      if (start) descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, start);
      descriptor.writeUInt32LE(compressed.length, start + 4);
      descriptor.writeUInt32LE(data.length, start + 8);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(position, 42);
    localOffsets.push(position);
    dataOffsets.push(position + 30 + name.length + extra.length);
    const record = Buffer.concat([local, name, extra, compressed, descriptor]);
    locals.push(record);
    centrals.push(Buffer.concat([central, name, extra]));
    position += record.length;
  }
  const centralOffsets: number[] = [];
  let centralPosition = position;
  for (const c of centrals) {
    centralOffsets.push(centralPosition);
    centralPosition += c.length;
  }
  const end = Buffer.alloc(22),
    commentBytes = Buffer.from(comment);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(specs.length, 8);
  end.writeUInt16LE(specs.length, 10);
  end.writeUInt32LE(centralPosition - position, 12);
  end.writeUInt32LE(position, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return {
    bytes: Buffer.concat([...locals, ...centrals, end, commentBytes]),
    localOffsets,
    dataOffsets,
    centralOffsets,
    eocd: centralPosition,
  };
}
const one = () => archive([{ name: '稿件.md', data: '# 一个世界\n不预先决定玩家的人生。' }]);
async function rejects(bytes: Uint8Array | ArrayBuffer, code: string) {
  await assert.rejects(
    extractZipEntries(bytes),
    (error: unknown) => error instanceof Error && (error as Error & { code: string }).code === code,
  );
}
function changeSize(a: ReturnType<typeof archive>, i: number, size: number) {
  a.bytes.writeUInt32LE(size, a.centralOffsets[i]! + 24);
  a.bytes.writeUInt32LE(size, a.localOffsets[i]! + 22);
}

test('stored ZIP preserves UTF-8 names, multi-line text and inert markup', async () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const a = archive([
    { name: '世界/设定.md', data: '# 世界\n第二行\n<script>throw new Error("never")</script>' },
    { name: '人物.markdown', data: '甲' },
    { name: '任务.txt', data: '' },
  ]);
  assert.deepEqual(await extractZipEntries(a.bytes), [
    {
      filename: '世界/设定.md',
      content: '# 世界\n第二行\n<script>throw new Error("never")</script>',
    },
    { filename: '人物.markdown', content: '甲' },
    { filename: '任务.txt', content: '' },
  ]);
});
test('deflate streams UTF-8 across chunks and accepts an ArrayBuffer', async () => {
  const data = '中文🙂\n'.repeat(10000);
  const a = archive([{ name: '演员.md', data, method: 8, flags: 0x0802 }]);
  const input = Uint8Array.from(a.bytes).buffer;
  assert.deepEqual(await extractZipEntries(input), [{ filename: '演员.md', content: data }]);
});
for (const descriptor of ['signed', 'unsigned'] as const) {
  test('deflate verifies ' + descriptor + ' data descriptor', async () => {
    const a = archive(
      [{ name: '导入.md', data: '自然对话', method: 8, descriptor }],
      '合法目录注释',
    );
    assert.deepEqual(await extractZipEntries(a.bytes), [
      { filename: '导入.md', content: '自然对话' },
    ]);
    const end = a.centralOffsets[0]! - (descriptor === 'signed' ? 16 : 12);
    a.bytes.writeUInt32LE(7, end + (descriptor === 'signed' ? 8 : 4));
    await rejects(a.bytes, 'INVALID_ZIP');
  });
}
test('offset Uint8Array input is isolated and respected', async () => {
  const a = one();
  const padded = Buffer.concat([Buffer.from('prefix'), a.bytes, Buffer.from('suffix')]);
  assert.equal(
    (await extractZipEntries(padded.subarray(6, 6 + a.bytes.length)))[0]!.filename,
    '稿件.md',
  );
});
test('directories, macOS metadata and attachments are filtered without executing or expanding them', async () => {
  const a = archive([
    { name: '__MACOSX/' },
    { name: '__MACOSX/._演员.md', data: new Uint8Array([0xff]) },
    { name: '.DS_Store', data: 'metadata' },
    { name: 'folder/._ignored.txt', data: 'fork' },
    { name: '图片/large.jpg', data: new Uint8Array(200 * 1024) },
    { name: 'page.html', data: '<script>throw 1</script>' },
    { name: 'node.md', data: '# 可读文稿' },
  ]);
  assert.deepEqual(await extractZipEntries(a.bytes), [
    { filename: 'node.md', content: '# 可读文稿' },
  ]);
});
test('a ZIP with no importable documents reports an honest empty error', async () => {
  await rejects(
    archive([{ name: '.DS_Store' }, { name: 'image.png', data: 'image' }]).bytes,
    'ZIP_EMPTY',
  );
  await rejects(archive([]).bytes, 'ZIP_EMPTY');
});
test('unflagged ASCII ordinary ZIP remains supported', async () => {
  assert.equal(
    (await extractZipEntries(archive([{ name: 'a.md', data: 'plain', flags: 0 }]).bytes))[0]!
      .content,
    'plain',
  );
});
test('input size is checked before attempting to parse invalid content', async () => {
  await rejects(new Uint8Array(5 * 1024 * 1024 + 1), 'ZIP_LIMIT');
});
test('all entries including skipped attachments count toward the entry limit', async () => {
  await rejects(
    archive(Array.from({ length: 129 }, (_, i) => ({ name: i + '.png' }))).bytes,
    'ZIP_LIMIT',
  );
});
test('document count is bounded independently of bytes', async () => {
  await rejects(
    archive(Array.from({ length: 33 }, (_, i) => ({ name: i + '.md', data: '' }))).bytes,
    'ZIP_LIMIT',
  );
});
test('single document declaration is checked before decompression', async () => {
  const a = archive([{ name: 'a.md', data: 'x', method: 8 }]);
  changeSize(a, 0, 128 * 1024 + 1);
  await rejects(a.bytes, 'ZIP_LIMIT');
});
test('cumulative declaration is bounded even when each document is valid', async () => {
  const a = archive(
    Array.from({ length: 5 }, (_, i) => ({ name: i + '.md', data: 'x', method: 8 })),
  );
  for (let i = 0; i < 5; i++) changeSize(a, i, 128 * 1024);
  await rejects(a.bytes, 'ZIP_LIMIT');
});
test('exact expanded budget succeeds for four 128KiB documents', async () => {
  const data = 'x'.repeat(128 * 1024);
  const result = await extractZipEntries(
    archive(Array.from({ length: 4 }, (_, i) => ({ name: i + '.md', data, method: 8 }))).bytes,
  );
  assert.equal(result.length, 4);
  assert.ok(result.every((file) => file.content === data));
});
test('a compressed bomb lying about the expanded size is rejected while reading', async () => {
  const a = archive([{ name: 'bomb.md', data: 'x'.repeat(1024 * 1024), method: 8 }]);
  changeSize(a, 0, 1);
  await rejects(a.bytes, 'ZIP_DATA');
});
test('a larger declared size cannot repair short output', async () => {
  const a = archive([{ name: 'small.md', data: 'x', method: 8 }]);
  changeSize(a, 0, 20);
  await rejects(a.bytes, 'ZIP_DATA');
});
for (const cut of [0, 1, 21, 38, -1]) {
  test('truncated archive at ' + cut + ' never returns partial import', async () => {
    const a = one();
    await rejects(a.bytes.subarray(0, cut === -1 ? a.bytes.length - 1 : cut), 'INVALID_ZIP');
  });
}
test('trailing bytes and a wrong comment length are not silently ignored', async () => {
  const a = one();
  await rejects(Buffer.concat([a.bytes, Buffer.from('junk')]), 'INVALID_ZIP');
  a.bytes.writeUInt16LE(1, a.eocd + 20);
  await rejects(a.bytes, 'INVALID_ZIP');
});
for (const field of [4, 6, 8]) {
  test('multi-disk or mismatched disk entry count is refused: ' + field, async () => {
    const a = one();
    a.bytes.writeUInt16LE(field === 8 ? 2 : 1, a.eocd + field);
    await rejects(a.bytes, 'ZIP_UNSUPPORTED');
  });
}
test('entry disk, ZIP64 sentinel, version and explicit extra field are refused', async () => {
  for (const mutate of [
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt16LE(1, a.centralOffsets[0]! + 34),
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt16LE(0xffff, a.eocd + 10),
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt32LE(0xffffffff, a.centralOffsets[0]! + 24),
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt16LE(45, a.centralOffsets[0]! + 6),
  ]) {
    const a = one();
    mutate(a);
    await rejects(a.bytes, 'ZIP_UNSUPPORTED');
  }
  await rejects(
    archive([{ name: 'a.md', extra: new Uint8Array([1, 0, 0, 0]) }]).bytes,
    'ZIP_UNSUPPORTED',
  );
});
for (const flags of [1, 0x10, 0x40, 0x1000, 0x2000]) {
  test('encrypted or unsupported flags cannot be skipped: ' + flags, async () => {
    await rejects(archive([{ name: 'a.md', flags }]).bytes, 'ZIP_UNSUPPORTED');
    await rejects(
      archive([{ name: 'image.png', flags }, { name: 'a.md' }]).bytes,
      'ZIP_UNSUPPORTED',
    );
  });
}
test('unsupported methods, stored compression flags and symlinks are refused', async () => {
  await rejects(archive([{ name: 'a.md', method: 99 }]).bytes, 'ZIP_UNSUPPORTED');
  await rejects(archive([{ name: 'a.md', flags: 2 }]).bytes, 'ZIP_UNSUPPORTED');
  const a = one();
  a.bytes.writeUInt32LE(0xa0000000, a.centralOffsets[0]! + 38);
  await rejects(a.bytes, 'ZIP_UNSUPPORTED');
});
for (const name of [
  '../a.md',
  '/a.md',
  'a/../b.md',
  'a\\b.md',
  'C:/a.md',
  'a//b.md',
  './a.md',
  'a/\0b.md',
]) {
  test('unsafe path is refused: ' + JSON.stringify(name), async () => {
    await rejects(archive([{ name }]).bytes, 'ZIP_PATH');
  });
}
test('duplicate normalized or case-insensitive paths are refused', async () => {
  for (const pair of [
    ['A.md', 'a.md'],
    ['é.md', 'e\u0301.md'],
    ['a.md', 'a.md'],
  ]) {
    await rejects(archive(pair.map((name) => ({ name }))).bytes, 'ZIP_PATH');
  }
});
test('bad UTF-8 names and document data get friendly errors', async () => {
  const a = archive([{ name: 'a.md' }]);
  a.bytes[a.localOffsets[0]! + 30] = 0xff;
  a.bytes[a.centralOffsets[0]! + 46] = 0xff;
  await rejects(a.bytes, 'ZIP_UTF8');
  await rejects(archive([{ name: 'a.md', data: new Uint8Array([0xc3, 0x28]) }]).bytes, 'ZIP_UTF8');
});
test('actual CRC detects tampering even when local and central CRC agree', async () => {
  const a = one();
  a.bytes[a.dataOffsets[0]!]! ^= 1;
  await rejects(a.bytes, 'ZIP_CRC');
  const b = one();
  b.bytes.writeUInt32LE(42, b.localOffsets[0]! + 14);
  b.bytes.writeUInt32LE(42, b.centralOffsets[0]! + 16);
  await rejects(b.bytes, 'ZIP_CRC');
});
test('central and local disagreement is never normalized', async () => {
  for (const mutate of [
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt16LE(8, a.localOffsets[0]! + 8),
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt32LE(0, a.localOffsets[0]! + 14),
    (a: ReturnType<typeof archive>) => {
      a.bytes[a.localOffsets[0]! + 30] = 65;
    },
  ]) {
    const a = one();
    mutate(a);
    await rejects(a.bytes, 'INVALID_ZIP');
  }
});
test('out-of-bounds and malformed records reject the whole archive', async () => {
  for (const mutate of [
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt32LE(a.bytes.length + 1, a.eocd + 16),
    (a: ReturnType<typeof archive>) =>
      a.bytes.writeUInt32LE(a.bytes.length + 1, a.centralOffsets[0]! + 42),
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt16LE(0xffff, a.centralOffsets[0]! + 28),
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt32LE(0, a.centralOffsets[0]!),
    (a: ReturnType<typeof archive>) => a.bytes.writeUInt32LE(0, a.localOffsets[0]!),
  ]) {
    const a = one();
    mutate(a);
    await rejects(a.bytes, 'INVALID_ZIP');
  }
  await rejects(
    archive([{ name: 'a.md', extra: new Uint8Array([2, 0, 8, 0]) }]).bytes,
    'INVALID_ZIP',
  );
});
test('overlapping records and self-extracting prefixes are refused', async () => {
  const a = archive([
    { name: 'a.md', data: 'a', method: 8 },
    { name: 'b.md', data: 'b' },
  ]);
  const newSize = a.centralOffsets[0]! - a.dataOffsets[0]!;
  a.bytes.writeUInt32LE(newSize, a.localOffsets[0]! + 18);
  a.bytes.writeUInt32LE(newSize, a.centralOffsets[0]! + 20);
  await rejects(a.bytes, 'INVALID_ZIP');
  const b = one(),
    prefix = Buffer.from('MZ!');
  const bytes = Buffer.concat([prefix, b.bytes]);
  bytes.writeUInt32LE(b.centralOffsets[0]! + prefix.length, b.eocd + prefix.length + 16);
  bytes.writeUInt32LE(prefix.length, b.centralOffsets[0]! + prefix.length + 42);
  await rejects(bytes, 'INVALID_ZIP');
});
test('invalid compressed data is rejected, never replaced with a fake document', async () => {
  const a = archive([{ name: 'a.md', data: 'something', method: 8 }]);
  a.bytes.fill(0xff, a.dataOffsets[0]!, a.centralOffsets[0]!);
  await rejects(a.bytes, 'ZIP_DATA');
});
test('unsupported browser decompression gives an actionable fallback', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream')!;
  try {
    Object.defineProperty(globalThis, 'DecompressionStream', { ...descriptor, value: undefined });
    await rejects(archive([{ name: 'a.md', data: 'a', method: 8 }]).bytes, 'ZIP_BROWSER');
    assert.equal((await extractZipEntries(one().bytes)).length, 1);
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', descriptor);
  }
});

test('an unsigned descriptor CRC resembling a signature is still parsed as a checksum', async () => {
  const a = archive([{ name: 'a.md', data: 'a', method: 8, descriptor: 'unsigned' }]);
  a.bytes.writeUInt32LE(0x08074b50, a.centralOffsets[0]! + 16);
  a.bytes.writeUInt32LE(0x08074b50, a.centralOffsets[0]! - 12);
  // The descriptor is structurally valid; the actual content CRC must still reject.
  await rejects(a.bytes, 'ZIP_CRC');
});
test('actual stream overflow cancels the reader rather than collecting a full document', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream')!;
  let cancelled = 0;
  try {
    class OversizedStream {
      readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(128 * 1024 + 1));
        },
        cancel() {
          cancelled++;
        },
      });
      writable = new WritableStream();
    }
    Object.defineProperty(globalThis, 'DecompressionStream', {
      ...descriptor,
      value: OversizedStream,
    });
    const a = archive([{ name: 'a.md', data: 'a', method: 8 }]);
    await rejects(a.bytes, 'ZIP_LIMIT');
    assert.equal(cancelled, 1);
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', descriptor);
  }
});
