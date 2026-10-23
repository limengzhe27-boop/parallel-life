import { getSticker, isStickerId } from './stickers.ts';
/** A player turn that carries only a shared sticker, with no typed caption. */
export function isStickerOnlyMessage(text: string): boolean {
  const match = /^\[\[sticker:([a-z_]+)\]\]$/.exec(text.trim());
  return !!match?.[1] && isStickerId(match[1]);
}
/** Unknown decoration cannot erase independent text. Keep statement positions stable. */
export function normalizeStickerStatement(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const statement = value as Record<string, unknown>;
  if (
    !('stickerId' in statement) ||
    statement.stickerId == null ||
    isStickerId(statement.stickerId)
  )
    return value;
  const { stickerId: _invalid, ...rest } = statement;
  return rest;
}

export function stickerMessageMeaning(text: string, stickerId?: string): string {
  const marker = /^\[\[sticker:([a-z_]+)\]\]$/.exec(text.trim());
  const sticker = getSticker(stickerId ?? marker?.[1] ?? '');
  if (!sticker) return text;
  const caption = marker ? '' : text.trim();
  return [caption, '[表情：' + sticker.label + '；' + sticker.description + ']']
    .filter(Boolean)
    .join(' ');
}
