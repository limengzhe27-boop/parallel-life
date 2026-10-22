/** Server-authored sticker catalogue. The phone UI owns the matching labels/assets. */
export const STICKER_IDS = [
  'wole',
  'xswl',
  'wuyu',
  'zhende',
  'jiuzhe',
  'bailan',
  'chong',
  'zaima',
  'shuile',
  'e',
  'kun',
  'moyu',
  'jiayou',
  'keyi',
  'juele',
  'hao',
  'zan',
  'a',
  'bie',
  'wanan',
] as const;
export type StickerId = (typeof STICKER_IDS)[number];
export function isStickerId(value: unknown): value is StickerId {
  return typeof value === 'string' && (STICKER_IDS as readonly string[]).includes(value);
}
