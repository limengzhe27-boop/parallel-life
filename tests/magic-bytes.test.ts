import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidImageMagicBytes } from '../src/modules/media/domain/magic-bytes.ts';

describe('AUD-16 图像素材文件头魔数校验', () => {
  it('识别合法 JPEG 魔数 (FF D8 FF)', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    assert.equal(isValidImageMagicBytes(jpeg), true);
  });

  it('识别合法 PNG 魔数 (89 50 4E 47 0D 0A 1A 0A)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    assert.equal(isValidImageMagicBytes(png), true);
  });

  it('识别合法 WebP 魔数 (RIFF....WEBP)', () => {
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // length
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    assert.equal(isValidImageMagicBytes(webp), true);
  });

  it('拦截伪装成图片的 HTML / JavaScript / 恶意文本', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    assert.equal(isValidImageMagicBytes(html), false);

    const bash = Buffer.from('#!/bin/bash\necho dangerous\n');
    assert.equal(isValidImageMagicBytes(bash), false);

    const emptyOrTooShort = Buffer.from([0xff, 0xd8]);
    assert.equal(isValidImageMagicBytes(emptyOrTooShort), false);
  });
});
