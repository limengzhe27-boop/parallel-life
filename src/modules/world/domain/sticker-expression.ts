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

/**
 * A narrow removal guard, never an automatic sticker: if the NPC's own sentence
 * is comfort/apology/serious complaint, a catalog image whose description is
 * mocking, negative or self-pitying must not be attached. The text always stays.
 */
const sensitiveStatement = /(委屈|难过|难受|伤心|想哭|哭了|安慰|抱抱|别难过|心疼|不开心|认真(?:地)?(?:跟|和)?你?说|别.*损|投诉|生气|对不起|抱歉)/;
const harshSticker = /(自嘲|调侃|挑衅|无语|不赞同|冒犯|疲惫|崩溃|怀疑|生气|嘲笑|不想努力|求情|哭泣|眼泪|难过|委屈)/;
export function stickerFitsStatement(text: string, stickerId: string): boolean {
  const sticker = getSticker(stickerId);
  if (!sticker || !text.trim() || !sensitiveStatement.test(text)) return true;
  return !harshSticker.test(sticker.description);
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
