/** Small, local image-sticker registry. Unknown ids simply fall back to text. */
export const STICKER_LABELS = {
  wole: '我裂开了',
  xswl: '笑死我了',
  wuyu: '无语',
  zhende: '真的假的',
  jiuzhe: '就这？',
  bailan: '摆烂',
  chong: '冲！',
  zaima: '在吗',
  shuile: '睡了',
  e: '饿了',
  kun: '困',
  moyu: '摸鱼中',
  jiayou: '加油',
  keyi: '可以',
  juele: '绝了',
  hao: '好',
  zan: '赞',
  a: '啊？',
  bie: '别',
  wanan: '晚安',
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
