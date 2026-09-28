import { DomainError } from './errors.ts';
import type { StoryChoice, TurnCommand, TurnProposal, WorldEffect, Visibility } from './types.ts';

function fail(): never {
  throw new DomainError('INVALID_PROPOSAL');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) return fail();
  return result;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) return fail();
  const result = value.map(id);
  if (new Set(result).size !== result.length) return fail();
  return result;
}
/** Reserve room for server-generated effect suffixes within the entity ID limit. */
export function validateEventId(value: unknown): string {
  const result = id(value);
  if (result.length > 64) return fail();
  return result;
}
function visibility(value: unknown): Visibility {
  const item = record(value);
  if (item.kind === 'owner' || item.kind === 'world') return { kind: item.kind };
  if (item.kind === 'actors') {
    const actorIds = ids(item.actorIds);
    if (!actorIds.length) return fail();
    return { kind: 'actors', actorIds };
  }
  return fail();
}
/** A narrow gate: proposals may only cite a decision the player actually typed. */
export function isExplicitChoice(quote: string, userText: string): boolean {
  const at = userText.indexOf(quote);
  if (at < 0 || quote.length < 4) return false;
  const before = userText.slice(0, at).trimEnd();
  if (before && !/[，。！？；;\n]$/.test(before)) return false;
  if (/^(如果|假如|要是|假设)/.test(userText.trim()) && at > 0) return false;
  if (/^(如果|假如|要是|可能|也许|比如|假设)/.test(quote)) return false;
  if (/^我要(?:你|问|知道|看看)|^我会不会/.test(quote)) return false;
  return /^(我(?:决定|选择|打算|要|会|想先)|那就|咱们(?:就|先)|就按|先把|先去|不如)/.test(quote);
}
/** Explicit privacy requests outrank a model's proposed social drama. */
export function isExplicitlyConfidential(text: string): boolean {
  return /(?:别|不要|不许|不能|千万别)(?:对|跟|和)?[^，。！？\n]{0,12}(?:说|提|讲|透露|告诉)|保密|只有你知道|只告诉你|只(?:跟|对|和)你说|仅限你我|别让[^，。！？\n]{0,12}知道|不要让[^，。！？\n]{0,12}知道|don'?t tell/i.test(
    text,
  );
}
/** A result is only a first-person report about the same decision, not independent proof. */
export function isExplicitChoiceResult(
  quote: string,
  userText: string,
  outcome: 'reported_done' | 'blocked' | 'abandoned',
  choice: StoryChoice,
): boolean {
  const at = userText.indexOf(quote);
  if (at < 0 || quote.length < 5 || !/^我/.test(quote)) return false;
  const before = userText.slice(0, at).trimEnd();
  if (before && !/[，。！？；;\n]$/.test(before)) return false;
  if (/^(如果|假如|要是|假设|比如)/.test(userText.trim()) && at > 0) return false;
  const blocked =
    /还没|没(?:有|能|法)?(?:做完|剪完|拍完|完成|成功)|卡住|受阻|做不到|来不及|失败了|没法|无法|不完/;
  const abandoned = /放弃|不(?:做|剪|拍|去|继续|想)|取消|算了|改主意/;
  const done = /完成了|做完了|剪完了|拍完了|发给|提交了|搞定了|弄好了|办好了|去了|拿到了/;
  if (
    (outcome === 'reported_done' &&
      (!done.test(quote) || blocked.test(quote) || abandoned.test(quote))) ||
    (outcome === 'blocked' && !blocked.test(quote)) ||
    (outcome === 'abandoned' && !abandoned.test(quote))
  )
    return false;
  const bigrams = (value: string) => {
    const found = new Set<string>();
    for (const part of value.match(/[\p{Script=Han}]{2,}|[a-z0-9]{3,}/giu) ?? []) {
      if (/^[a-z0-9]/i.test(part)) {
        found.add(part.toLowerCase());
        continue;
      }
      for (let i = 0; i < part.length - 1; i++) found.add(part.slice(i, i + 2));
    }
    return found;
  };
  const generic = new Set([
    '我决',
    '决定',
    '选择',
    '我打',
    '打算',
    '我会',
    '我要',
    '先把',
    '我把',
    '完成',
    '已经',
    '现在',
    '今天',
    '明天',
    '这件',
    '那个',
    '可以',
    '后来',
    '一下',
    '给你',
    '这次',
    '之前',
    '之后',
  ]);
  const target = bigrams(`${choice.quote} ${choice.intent}`);
  return [...bigrams(quote)].some((part) => target.has(part) && !generic.has(part));
}
export function isoInstant(value: unknown): string {
  const result = text(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    return fail();
  return result;
}
/** Construct allowlisted objects: model output cannot supply owner/version/SQL/etc. */
export function parseProposal(value: unknown): TurnProposal {
  const proposal = record(value);
  if (
    proposal.schemaVersion !== 1 ||
    !Array.isArray(proposal.effects) ||
    proposal.effects.length < 1 ||
    proposal.effects.length > 20
  )
    return fail();
  const effects: WorldEffect[] = proposal.effects.map((raw) => {
    const item = record(raw);
    const effectId = id(item.id);
    switch (item.type) {
      case 'message.received':
        return { type: item.type, id: effectId, actorId: id(item.actorId), text: text(item.text) };
      case 'belief.recorded':
        return { type: item.type, id: effectId, actorId: id(item.actorId), text: text(item.text) };
      case 'information.shared':
        return {
          type: item.type,
          id: effectId,
          recipientActorId: id(item.recipientActorId),
          sourceMessageId: id(item.sourceMessageId),
          quote: text(item.quote, 160).trim(),
        };
      case 'appointment.proposed':
      case 'appointment.created':
        return {
          type: item.type,
          id: effectId,
          title: text(item.title, 200),
          at: isoInstant(item.at),
          participantIds: ids(item.participantIds),
        };
      case 'fact.established':
        return {
          type: item.type,
          id: effectId,
          text: text(item.text),
          visibility: visibility(item.visibility),
        };
      case 'media.requested':
        return {
          type: item.type,
          id: effectId,
          prompt: text(item.prompt, 2000),
          ...(typeof item.title === 'string' && item.title.trim()
            ? { title: text(item.title.trim(), 80) }
            : {}),
        };
      case 'choice.recorded':
        return {
          type: item.type,
          id: effectId,
          quote: text(item.quote, 160).trim(),
          intent: text(item.intent, 120).trim(),
        };
      case 'choice.next_step':
      case 'choice.recovery_step':
        return {
          type: item.type,
          id: effectId,
          choiceId: id(item.choiceId),
          quote: text(item.quote, 160).trim(),
        };
      case 'choice.result_reported':
        if (!['reported_done', 'blocked', 'abandoned'].includes(String(item.outcome)))
          return fail();
        return {
          type: item.type,
          id: effectId,
          choiceId: id(item.choiceId),
          quote: text(item.quote, 160).trim(),
          outcome: item.outcome as 'reported_done' | 'blocked' | 'abandoned',
        };
      default:
        return fail();
    }
  });
  if (new Set(effects.map((effect) => effect.id)).size !== effects.length) return fail();
  return { schemaVersion: 1, effects };
}
export function validateCommand(command: TurnCommand): void {
  try {
    if (command.origin !== undefined && command.origin !== 'director') fail();
    id(command.id);
    id(command.worldId);
    id(command.actorId);
    text(command.text, 4000);
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0) fail();
  } catch {
    throw new DomainError('INVALID_COMMAND');
  }
}
