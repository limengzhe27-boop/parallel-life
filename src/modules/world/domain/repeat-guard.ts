import type { AgentStatement } from './agent-runtime.ts';

/**
 * A proactive turn (wake, opening beat, return catch-up) has no player reply to
 * work from. When the NPC's most recent line is still unanswered, the model
 * rewrites the same request instead of staying quiet. This guard drops those
 * second asks at the commit boundary. It never touches a player turn or an
 * NPC-to-NPC coordination turn.
 */
export type RepeatGuardObservation = {
  sourceId: string;
  text: string;
  kind: string;
  speaker?: { kind: 'player' } | { kind: 'actor'; actorId: string };
  storyAt?: string;
};

export type RepeatGuardInput = {
  origin: 'player' | 'wake' | 'coordination';
  storyAt: string;
  actorId: string;
  observations: readonly RepeatGuardObservation[];
};

/** A rewrite only counts while the earlier line is still fresh and unanswered. */
const REPEAT_WINDOW_MS = 30 * 60_000;
/** Near-verbatim copies (only punctuation or filler changed). */
const NEAR_DUPLICATE_RATIO = 0.6;
/** Same-shaped rewrite of the same line. */
const PARAPHRASE_RATIO = 0.35;
/** A deferred offer only needs to be about the same thing as the earlier ask. */
const DEFERRED_OFFER_RATIO = 0.08;
const DEFERRED_OFFER = /(?:再发|发你|发照片|再告诉|再说)/;

const STOP_CHARS = new Set(
  '你我他她它的了吗呢吧啊么是在就都也还和与个这那不想要会能可哦呀嘛着过很太又再才把被给对从到说'
    .split(''),
);
const ASK_MARK = /(?:吗|呢|好不好|行不行|要不要|能不能|有没有|可不可以)/;
const FUTURE_ANNOUNCEMENT =
  /(?:等你有空|等你有时间|等你有回应|不着急|回头再|之后再|下次再|有空再|等会儿再|改天再)/;

type LineKind = 'ask' | 'announce' | 'other';

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''（）《》…—\-.,!?;:"'()\[\]<>~/\\~～]/g, '');
}

/** Content characters, one by one: paraphrase keeps the words, not the spacing. */
export function contentChars(text: string): Set<string> {
  return new Set([...normalize(text)].filter((char) => !STOP_CHARS.has(char)));
}

export function similarity(a: string, b: string): number {
  const left = contentChars(a);
  const right = contentChars(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const char of left) if (right.has(char)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Two-character phrases survive a rewrite that changes the sentence shape. */
export function contentBigrams(text: string): Set<string> {
  const value = normalize(text);
  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);
    if (STOP_CHARS.has(pair[0]!) || STOP_CHARS.has(pair[1]!)) continue;
    grams.add(pair);
  }
  return grams;
}

export function sharedBigrams(a: string, b: string): number {
  const left = contentBigrams(a);
  const right = contentBigrams(b);
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared;
}

function lineKind(text: string, requestsPlayerReply?: boolean): LineKind {
  if (requestsPlayerReply) return 'ask';
  if (ASK_MARK.test(text) || /[？?]\s*$/.test(text)) return 'ask';
  if (FUTURE_ANNOUNCEMENT.test(text)) return 'announce';
  return 'other';
}

const at = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

type OwnLine = { text: string; at: number | null; index: number; kind: LineKind };

function ownRecentLines(input: RepeatGuardInput, now: number): OwnLine[] {
  const lines: OwnLine[] = [];
  input.observations.forEach((observation, index) => {
    if (observation.kind !== 'speech') return;
    if (observation.speaker?.kind !== 'actor') return;
    if (observation.speaker.actorId !== input.actorId) return;
    if (!observation.text.trim()) return;
    const time = at(observation.storyAt);
    if (time !== null && now - time > REPEAT_WINDOW_MS) return;
    lines.push({ text: observation.text, at: time, index, kind: lineKind(observation.text) });
  });
  return lines.sort((left, right) => (left.at ?? 0) - (right.at ?? 0) || left.index - right.index);
}

/**
 * The player has written after the NPC's most recent line, so it is answered.
 * Speech observations carry no story time in the snapshot, so their order is the
 * fallback: a later player line means the conversation already moved on.
 */
function answeredSince(input: RepeatGuardInput, line: OwnLine, now: number): boolean {
  return input.observations.some((observation, index) => {
    if (observation.speaker?.kind !== 'player') return false;
    const time = at(observation.storyAt);
    if (time !== null && line.at !== null) return time > line.at && time <= now;
    return index > line.index;
  });
}

function isRepeat(statement: AgentStatement, own: readonly OwnLine[]): boolean {
  const text = statement.text.trim();
  if (!text) return false;
  const kind = lineKind(text, statement.requestsPlayerReply);
  return own.slice(-3).some((line) => {
    const ratio = similarity(text, line.text);
    if (line.kind === kind && ratio >= PARAPHRASE_RATIO) return true;
    if (ratio >= NEAR_DUPLICATE_RATIO) return true;
    // Same two concrete phrases (转账/孩子/时间) mean the same matter came back
    // up, even when the sentences around them are rebuilt.
    if (sharedBigrams(text, line.text) >= (line.kind === kind ? 2 : 3)) return true;
    // "Photo is ready, I'll send it when you are free" only defers the same
    // invitation the player has not answered yet.
    return (
      kind === 'announce' &&
      line.kind !== 'other' &&
      DEFERRED_OFFER.test(text) &&
      similarity(text, line.text) >= DEFERRED_OFFER_RATIO
    );
  });
}

/**
 * Remove proactive statements that only restate an unanswered ask. Returns the
 * same array when nothing is dropped so callers can cheaply detect a no-op.
 */
export function suppressRepeatedStatements(
  input: RepeatGuardInput,
  statements: readonly AgentStatement[],
): readonly AgentStatement[] {
  if (input.origin === 'player') return statements;
  const now = at(input.storyAt);
  if (now === null) return statements;
  const own = ownRecentLines(input, now);
  if (!own.length) return statements;
  // The player has already spoken after the NPC's last line: this is a normal
  // reply turn and the guard has nothing to protect.
  if (answeredSince(input, own.at(-1)!, now)) return statements;
  const kept = statements.filter((statement) => !isRepeat(statement, own));
  return kept.length === statements.length ? statements : kept;
}
