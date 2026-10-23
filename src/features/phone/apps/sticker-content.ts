import { parseStickerText } from '../stickers.ts';

/** Keep captions while hiding only a valid legacy whole-message marker. */
export function stickerMessageContent(text?: string | null, stickerId?: string | null) {
  const marker = text ? parseStickerText(text) : null;
  const sticker = (stickerId ? parseStickerText(`[[sticker:${stickerId}]]`) : null) ?? marker;
  const caption = marker ? '' : (text ?? '');
  return { text: caption, sticker, imageOnly: Boolean(sticker && !caption.trim()) };
}
