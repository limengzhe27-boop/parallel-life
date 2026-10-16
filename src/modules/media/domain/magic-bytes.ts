/**
 * AUD-16: 图像文件头魔数 (Magic Bytes) 严格校验
 * 在提交给图像解码库之前，在内存头部快速校验文件魔数，
 * 拦截伪造扩展名的可执行脚本、SVG/HTML XSS 文件或畸形数据包。
 */

export function isValidImageMagicBytes(buffer: Buffer | Uint8Array): boolean {
  if (!buffer || buffer.length < 12) return false;

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }

  // 3. WebP: 52 49 46 46 (RIFF) .... 57 45 42 50 (WEBP)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }

  return false;
}

/**
 * Checks magic bytes for image formats (JPEG, PNG, WebP) or video format (MP4 ftyp).
 */
export function isValidMediaMagicBytes(buffer: Buffer | Uint8Array): {
  valid: boolean;
  type?: 'image' | 'video';
  mimeType?: string;
} {
  if (isValidImageMagicBytes(buffer)) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return { valid: true, type: 'image', mimeType: 'image/jpeg' };
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return { valid: true, type: 'image', mimeType: 'image/png' };
    return { valid: true, type: 'image', mimeType: 'image/webp' };
  }

  // 4. MP4 Video: bytes 4-7 are 'ftyp' (0x66, 0x74, 0x79, 0x70)
  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return { valid: true, type: 'video', mimeType: 'video/mp4' };
  }

  return { valid: false };
}
