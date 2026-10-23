import {
  STICKER_CATALOG,
  getSticker,
  type StickerId,
} from '../../modules/world/domain/stickers.ts';
export { SELECTABLE_STICKERS, getSticker } from '../../modules/world/domain/stickers.ts';
export type { StickerId } from '../../modules/world/domain/stickers.ts';
export const STICKER_LABELS = Object.fromEntries(
  STICKER_CATALOG.map(({ id, label }) => [id, label]),
) as Record<StickerId, string>;
const STICKER_PATTERN = /^\[\[sticker:([a-z_]+)\]\]$/;
export function parseStickerText(
  text: string,
): { id: StickerId; label: string; src: string } | null {
  const match = STICKER_PATTERN.exec(text.trim());
  const sticker = match?.[1] ? getSticker(match[1]) : null;
  return sticker ? { id: sticker.id, label: sticker.label, src: sticker.src } : null;
}
