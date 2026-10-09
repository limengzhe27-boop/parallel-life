import type { ModelMessage } from './ports.ts';
import { isValidImageMagicBytes } from '../../media/domain/magic-bytes.ts';
export const MODEL_IMAGE_LIMIT = 2;
export const MODEL_IMAGE_BYTE_LIMIT = 256 * 1024;
/** Text and binary budgets are separate, before any upstream side effect. */
export function modelRequestMessages(messages: ModelMessage[]) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 100)
    throw Error('INVALID_CONFIG');
  let textLength = 0,
    imageCount = 0;
  return messages.map((message) => {
    if (
      !message ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    )
      throw Error('INVALID_CONFIG');
    textLength += message.content.length;
    if (textLength > 64000) throw Error('INVALID_CONFIG');
    if (message.images === undefined) return { role: message.role, content: message.content };
    if (message.role !== 'user' || !Array.isArray(message.images) || !message.images.length)
      throw Error('INVALID_CONFIG');
    const images = message.images.map((image) => {
      imageCount++;
      if (
        imageCount > MODEL_IMAGE_LIMIT ||
        !image ||
        !['image/webp', 'image/png', 'image/jpeg'].includes(image.mimeType) ||
        image.detail !== 'low' ||
        typeof image.base64 !== 'string' ||
        image.base64.length > 4 * Math.ceil(MODEL_IMAGE_BYTE_LIMIT / 3) ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(image.base64)
      )
        throw Error('INVALID_CONFIG');
      const binary = Uint8Array.from(atob(image.base64), (character) => character.charCodeAt(0));
      if (binary.length > MODEL_IMAGE_BYTE_LIMIT || !isValidImageMagicBytes(binary))
        throw Error('INVALID_CONFIG');
      const actual =
        binary[0] === 0xff ? 'image/jpeg' : binary[0] === 0x89 ? 'image/png' : 'image/webp';
      if (actual !== image.mimeType) throw Error('INVALID_CONFIG');
      return {
        type: 'image_url' as const,
        image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: image.detail },
      };
    });
    return {
      role: message.role,
      content: [{ type: 'text' as const, text: message.content }, ...images],
    };
  });
}
