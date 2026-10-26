import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { removePortraitBackground } from '../src/modules/media/infrastructure/portrait-matting.ts';

test('already transparent portrait preserves RGB, size and alpha without model download', async () => {
  const width = 64,
    height = 80;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 10; y < 70; y++)
    for (let x = 10; x < 54; x++) {
      const i = (y * width + x) * 4;
      raw[i] = 180;
      raw[i + 1] = 70;
      raw[i + 2] = 30;
      raw[i + 3] = 255;
    }
  const input = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const result = await removePortraitBackground(input);
  const m = await sharp(result).metadata();
  assert.equal(m.format, 'png');
  assert.equal(m.width, width);
  assert.equal(m.height, height);
  assert.deepEqual(await sharp(result).ensureAlpha().raw().toBuffer(), raw);
});
test('all-transparent and malformed images cannot be accepted as completed cutouts', async () => {
  const empty = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  await assert.rejects(removePortraitBackground(empty), { code: 'EMPTY_PORTRAIT_IMAGE' });
  await assert.rejects(removePortraitBackground(Buffer.from('not an image')), {
    code: 'INVALID_PORTRAIT_IMAGE',
  });
  await assert.rejects(removePortraitBackground(Buffer.alloc(10_000_001)), {
    code: 'INVALID_PORTRAIT_IMAGE',
  });
});
test('cancelled input does not start image decoding or an inference', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(removePortraitBackground(Buffer.from('not an image'), controller.signal), {
    code: 'CANCELLED',
  });
});
test('oversized pixel and undersized image dimensions are rejected before a model request', async () => {
  const tiny = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#fff' } })
    .png()
    .toBuffer();
  await assert.rejects(removePortraitBackground(tiny), { code: 'INVALID_PORTRAIT_IMAGE' });
  const bomb = await sharp({
    create: { width: 5100, height: 5100, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  await assert.rejects(removePortraitBackground(bomb), { code: 'INVALID_PORTRAIT_IMAGE' });
});
