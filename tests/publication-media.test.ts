import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLICATION_IMAGE_MAX_BYTES,
  PUBLICATION_VIDEO_MAX_BYTES,
  SupabasePublicationMediaStore,
  publicationMediaKind,
  publicationMediaMagic,
} from '../src/modules/settings/infrastructure/publication-media-repository.ts';

test('publication media only accepts bounded browser-readable images and MP4', () => {
  assert.deepEqual(publicationMediaKind('video/mp4', PUBLICATION_VIDEO_MAX_BYTES), {
    kind: 'video',
    mimeType: 'video/mp4',
    extension: 'mp4',
  });
  assert.equal(publicationMediaKind('image/png', PUBLICATION_IMAGE_MAX_BYTES).kind, 'image');
  assert.throws(() => publicationMediaKind('video/quicktime', 100));
  assert.throws(() => publicationMediaKind('video/mp4', PUBLICATION_VIDEO_MAX_BYTES + 1));
  assert.throws(() => publicationMediaKind('image/png', PUBLICATION_IMAGE_MAX_BYTES + 1));
  assert.throws(() => publicationMediaKind('video/mp4', 0));
  const mp4 = Buffer.alloc(24);
  mp4.writeUInt32BE(24, 0);
  mp4.write('ftypisom', 4, 'ascii');
  assert.equal(publicationMediaMagic('video/mp4', mp4), true);
  mp4.write('qt  ', 8, 'ascii');
  assert.equal(publicationMediaMagic('video/mp4', mp4), false);
  assert.equal(publicationMediaMagic('video/mp4', Buffer.from('fake mp4')), false);
  assert.equal(publicationMediaMagic('image/jpeg', Buffer.from([0xff, 0xd8, 0xff])), true);
  assert.equal(
    publicationMediaMagic('image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    true,
  );
  assert.equal(publicationMediaMagic('image/webp', Buffer.from('RIFFxxxxWEBP')), true);
});

test('private Storage signed upload/read URLs are pinned to the configured bucket and object', async () => {
  const before = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  const key = `works/${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}/${'b'.repeat(8)}-${'b'.repeat(4)}-${'b'.repeat(4)}-${'b'.repeat(4)}-${'b'.repeat(12)}.mp4`;
  const mp4 = Buffer.alloc(24);
  mp4.writeUInt32BE(24, 0);
  mp4.write('ftypisom', 4, 'ascii');
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.includes('/object/upload/sign/')) {
      return Response.json({
        url: `/object/upload/sign/publication-media/${key}?token=upload-token`,
      });
    }
    if (url.includes('/object/info/')) {
      return Response.json({ size: 24, content_type: 'video/mp4' });
    }
    if (url.includes('/object/authenticated/')) {
      return new Response(new Uint8Array(mp4), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-23/24' },
      });
    }
    if (url.includes('/object/sign/')) {
      return Response.json({ signedURL: `/object/sign/publication-media/${key}?token=read-token` });
    }
    throw Error('unexpected storage operation');
  };
  try {
    const storage = new SupabasePublicationMediaStore({
      url: 'https://private.example.supabase.co',
      serviceRoleKey: 'server-secret',
    });
    const upload = await storage.signUpload(key);
    assert.equal(
      upload.uploadUrl,
      `https://private.example.supabase.co/storage/v1/object/upload/sign/publication-media/${key}?token=upload-token`,
    );
    assert.equal(upload.uploadToken, 'upload-token');
    const inspected = await storage.inspect(key);
    assert.equal(inspected.byteLength, 24);
    assert.equal(publicationMediaMagic('video/mp4', inspected.header), true);
    assert.equal(
      await storage.signRead(key),
      `https://private.example.supabase.co/storage/v1/object/sign/publication-media/${key}?token=read-token`,
    );
    assert.deepEqual(
      calls.map((call) => call.method),
      ['POST', 'GET', 'GET', 'POST'],
    );
  } finally {
    globalThis.fetch = before;
  }
});
