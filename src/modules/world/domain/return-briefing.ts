import type { Appointment, Message } from './types.ts';

/** The shortest real absence that earns a return briefing. */
export const RETURN_BRIEFING_MIN_AWAY_MS = 3 * 60_000;
/** A single return never simulates more than one real day of absence. */
export const RETURN_BRIEFING_MAX_AWAY_MS = 24 * 60 * 60_000;
/** The story-time consequence is capped even when the real absence is longer. */
export const RETURN_BRIEFING_MAX_STORY_MS = 72 * 60 * 60_000;
export const RETURN_BRIEFING_MAX_THREADS = 3;
export const RETURN_BRIEFING_LEASE_MS = 45_000;

export type ReturnBriefingStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ReturnBriefing = {
  id: string;
  worldId: string;
  ownerId: string;
  leftAt: string;
  returnedAt: string;
  gapSeconds: number;
  storyFrom: string;
  storyUntil: string;
  status: ReturnBriefingStatus;
  attempt: number;
  leaseUntil: string | null;
  beatIndex: number;
  messageIds: string[];
  error: string | null;
};
export type ReturnBriefingSummary = {
  id: string;
  awayMinutes: number;
  status: ReturnBriefingStatus;
  messageIds?: string[];
};

export type ReturnThreadKind =
  | 'appointment'
  | 'owed_reply'
  | 'question'
  | 'promise'
  | 'plan';

export type ReturnThread = {
  actorId: string;
  kind: ReturnThreadKind;
  /** Neutral description for the wake cue; never the full private transcript. */
  summary: string;
  sourceId: string;
  at: string;
  priority: number;
};

export type ReturnBriefingWindow = {
  leftAt: string;
  returnedAt: string;
  gapSeconds: number;
  storyFrom: string;
  storyUntil: string;
};

/**
 * The window is computed from the last real presence, never from a background
 * worker. A short absence is already projected by the foreground clock; a paused
 * absence is frozen at its stop anchor and only extended inside this bounded window.
 */
export function planReturnBriefingWindow(input: {
  leftAt: string | null;
  returnedAt: string;
  pausedAt: string | null;
  storyNow: string;
  speed: number;
  paused: boolean;
  minAwayMs?: number;
  maxAwayMs?: number;
  maxStoryMs?: number;
}): ReturnBriefingWindow | null {
  const returnedAt = Date.parse(input.returnedAt);
  const leftAt = input.leftAt ? Date.parse(input.leftAt) : Number.NaN;
  if (!Number.isFinite(returnedAt) || !Number.isFinite(leftAt) || returnedAt <= leftAt) return null;
  const gapMs = returnedAt - leftAt;
  if (gapMs < (input.minAwayMs ?? RETURN_BRIEFING_MIN_AWAY_MS)) return null;
  const storyNow = Date.parse(input.storyNow);
  if (!Number.isFinite(storyNow)) return null;
  const speed = Number.isFinite(input.speed) && input.speed > 0 ? input.speed : 1;
  // A paused world froze at its own stop anchor. Extend only the part that has not
  // already been projected; a live world is already at the return instant.
  let storyUntilMs = storyNow;
  if (input.paused) {
    const pausedAt = input.pausedAt ? Date.parse(input.pausedAt) : returnedAt;
    const unprojectedMs = Math.max(
      0,
      Math.min(
        returnedAt - (Number.isFinite(pausedAt) ? pausedAt : returnedAt),
        input.maxAwayMs ?? RETURN_BRIEFING_MAX_AWAY_MS,
      ),
    );
    storyUntilMs = Math.min(
      storyNow + unprojectedMs * speed,
      storyNow + (input.maxStoryMs ?? RETURN_BRIEFING_MAX_STORY_MS),
    );
  }
  return {
    leftAt: new Date(leftAt).toISOString(),
    returnedAt: new Date(returnedAt).toISOString(),
    gapSeconds: Math.floor(gapMs / 1000),
    storyFrom: new Date(storyNow).toISOString(),
    storyUntil: new Date(Math.max(storyNow, storyUntilMs)).toISOString(),
  };
}

/** Chronological beats inside the window; one per selected thread. */
export function returnBriefingBeats(
  window: Pick<ReturnBriefingWindow, 'storyFrom' | 'storyUntil'>,
  count: number,
): string[] {
  const from = Date.parse(window.storyFrom),
    until = Date.parse(window.storyUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || count <= 0)
    return Array.from({ length: Math.max(0, count) }, () => window.storyUntil);
  return Array.from({ length: count }, (_, index) => {
    const ratio = (index + 1) / (count + 1);
    return new Date(from + Math.round((until - from) * ratio)).toISOString();
  });
}

const PROMISE = /(?:晚点|回头|等我|待会|等会儿|明天|后天|有结果|再告诉|再联系|忙完|下班后)/;
const QUESTION = /[?？]/;

function threadPriority(kind: ReturnThreadKind): number {
  switch (kind) {
    case 'appointment':
      return 0;
    case 'owed_reply':
      return 1;
    case 'question':
      return 2;
    case 'promise':
      return 3;
    case 'plan':
      return 4;
  }
}

function neutralSummary(kind: ReturnThreadKind, detail: string): string {
  switch (kind) {
    case 'appointment':
      return `你们有一个已经确认的约定：${detail}`;
    case 'owed_reply':
      return detail
        ? `玩家最后一条是：「${detail}」，你还没有回`
        : '玩家最后一条消息之后，你还没有回';
    case 'question':
      return detail
        ? `你之前问过：「${detail}」，还没有得到回答`
        : '你之前问过一件事，还没有得到回答';
    case 'promise':
      return detail
        ? `你最后一条是：「${detail}」，之后还没有下文`
        : '你之前说过会再联系，之后还没有下文';
    case 'plan':
      return `你手上还有一步没有走完：${detail}`;
  }
}

const excerpt = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 80);

/**
 * Deterministic, source-backed selection. AI still writes the message, but the
 * runtime chooses only matters that already exist in committed state.
 */
export function selectReturnThreads(input: {
  messages: readonly Message[];
  appointments: readonly Appointment[];
  states: readonly {
    actorId: string;
    plans: readonly {
      id: string;
      summary: string;
      status: string;
      nextActionId: string | null;
    }[];
    questions?: readonly {
      id: string;
      channel: string;
      threadId: string;
      text: string;
      askedAt: string;
      status: string;
    }[];
  }[];
  window: Pick<ReturnBriefingWindow, 'storyFrom' | 'storyUntil'>;
  limit?: number;
}): ReturnThread[] {
  const from = Date.parse(input.window.storyFrom),
    until = Date.parse(input.window.storyUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until)) return [];
  const byActor = new Map<string, Message[]>();
  for (const message of input.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const list = byActor.get(message.actorId) ?? [];
    list.push(message);
    byActor.set(message.actorId, list);
  }
  for (const list of byActor.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const candidates: ReturnThread[] = [];
  const push = (thread: Omit<ReturnThread, 'priority'>) =>
    candidates.push({ ...thread, priority: threadPriority(thread.kind) });

  for (const [actorId, messages] of byActor) {
    const last = messages.at(-1);
    if (!last) continue;
    if (last.role === 'user')
      push({
        actorId,
        kind: 'owed_reply',
        summary: neutralSummary('owed_reply', excerpt(last.text)),
        sourceId: last.id,
        at: last.at,
      });
    else if (PROMISE.test(last.text) || QUESTION.test(last.text))
      push({
        actorId,
        kind: 'promise',
        summary: neutralSummary('promise', excerpt(last.text)),
        sourceId: last.id,
        at: last.at,
      });
  }
  for (const appointment of input.appointments) {
    if (appointment.status !== 'confirmed') continue;
    const at = Date.parse(appointment.at);
    if (!Number.isFinite(at) || at < from || at > until) continue;
    for (const actorId of appointment.participantIds)
      push({
        actorId,
        kind: 'appointment',
        summary: neutralSummary('appointment', appointment.title),
        sourceId: appointment.id,
        at: appointment.at,
      });
  }
  for (const state of input.states) {
    for (const question of state.questions ?? []) {
      if (question.status !== 'open' || question.channel !== 'private') continue;
      if (question.threadId !== state.actorId) continue;
      const at = Date.parse(question.askedAt);
      if (!Number.isFinite(at) || at > until) continue;
      push({
        actorId: state.actorId,
        kind: 'question',
        summary: neutralSummary('question', excerpt(question.text)),
        sourceId: question.id,
        at: question.askedAt,
      });
    }
    for (const plan of state.plans) {
      if (plan.status !== 'active' || !plan.nextActionId) continue;
      push({
        actorId: state.actorId,
        kind: 'plan',
        summary: neutralSummary('plan', plan.summary),
        sourceId: plan.nextActionId,
        at: input.window.storyUntil,
      });
    }
  }
  const limit = Math.max(0, input.limit ?? RETURN_BRIEFING_MAX_THREADS);
  const seen = new Set<string>();
  return candidates
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Date.parse(b.at) - Date.parse(a.at) ||
        a.actorId.localeCompare(b.actorId),
    )
    .filter((thread) => {
      if (seen.has(thread.actorId)) return false;
      seen.add(thread.actorId);
      return true;
    })
    .slice(0, limit);
}
