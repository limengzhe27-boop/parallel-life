/** Small, local image-sticker registry. Unknown ids simply fall back to text. */
export const STICKER_LABELS = {
  smile: '笑脸',
  joy: '笑哭',
  sweat_smile: '苦笑',
  thinking: '思考',
  eyes: '盯',
  blush: '害羞',
  sob: '哭',
  heart: '心',
  thumbsup: '赞',
  ok_hand: '好',
  clap: '鼓掌',
  fire: '火',
  coffee: '咖啡',
  moon: '月亮',
  sun: '太阳',
  cat: '猫',
  dog: '狗',
  tada: '庆祝',
  sparkles: '闪亮',
  broken_heart: '心碎',
} as const;
export type StickerId = keyof typeof STICKER_LABELS;
const STICKER_PATTERN = /^\[\[sticker:([a-z_]+)\]\]$/;
export function parseStickerText(
  text: string,
): { id: StickerId; label: string; src: string } | null {
  const match = STICKER_PATTERN.exec(text.trim());
  const id = match?.[1];
  if (!id || !(id in STICKER_LABELS)) return null;
  return {
    id: id as StickerId,
    label: STICKER_LABELS[id as StickerId],
    src: `/stickers/${id}.svg`,
  };
}
