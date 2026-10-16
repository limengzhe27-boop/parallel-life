import { DomainError } from './errors.ts';
import { canonicalWaitInstant } from './appointment-wait.ts';
import { projectStoryTime, type WorldClock } from './clock.ts';
import type { WorldState } from './types.ts';
import { validateEventId } from './validation.ts';

export type StoryWaitTarget = 'next_appointment' | 'morning' | 'short';
export type StoryWaitInput = {
  commandId: string;
  expectedVersion: number;
  clientId: string;
  sequence: number;
  target: StoryWaitTarget;
};
export type StoryWaitStop = {
  reason: 'target' | 'appointment' | 'story_boundary' | 'opening' | 'message';
  label?: string;
};
/** Only trusted, already-validated server sources may provide these boundaries. */
export type StoryWaitBoundary = { at: string; reason: 'story_boundary'; label?: string };
export type StoryWaitContext = {
  clock: WorldClock & { managed?: boolean; activeUntil?: string | null };
  realNow: string;
  activeScene: boolean;
  inflight: boolean;
  openingPending: boolean;
  importantMessage: boolean;
  boundaries: readonly StoryWaitBoundary[];
};
export type StoryWaitEvent = {
  schemaVersion: 1;
  type: 'story.waited';
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  data: {
    target: StoryWaitTarget;
    fromStoryAt: string;
    targetAt: string;
    stoppedBy: StoryWaitStop;
  };
};
export type StoryWaitReceipt = {
  status: 'committed';
  commandId: string;
  worldId: string;
  version: number;
  sourceEventId: string;
  fromStoryAt: string;
  storyNow: string;
  targetAt: string;
  stoppedBy: StoryWaitStop;
};
export class StoryWaitError extends DomainError {
  readonly reason: 'NO_APPOINTMENT' | 'ACTIVE_SCENE' | 'INFLIGHT';
  constructor(reason: StoryWaitError['reason']) {
    super(
      'INVALID_COMMAND',
      {
        NO_APPOINTMENT: '还没有接下来已确认的约定。',
        ACTIVE_SCENE: '请先离开当前现场，再选择等待。',
        INFLIGHT: '这段人生还有操作待核对，请先处理后再等待。',
      }[reason],
    );
    this.reason = reason;
  }
}
const minute = 60_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const targets = ['next_appointment', 'morning', 'short'];
export function validateStoryWaitInput(input: StoryWaitInput) {
  if (
    !input ||
    !uuid.test(input.commandId) ||
    !uuid.test(input.clientId) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 0 ||
    !targets.includes(input.target)
  )
    throw new DomainError('INVALID_COMMAND');
}
function appointmentStops(world: WorldState, from: number) {
  return world.appointments
    .filter((a) => a.status === 'confirmed')
    .map((a) => ({
      at: Date.parse(canonicalWaitInstant(a.at)),
      label: a.title,
    }))
    .filter((a) => a.at > from)
    .sort((a, b) => a.at - b.at);
}
function targetTime(world: WorldState, from: string, target: StoryWaitTarget) {
  const start = Date.parse(from);
  if (target === 'short') return new Date(start + 30 * minute).toISOString();
  if (target === 'morning') {
    // World local calendar, UTC+08, never host/browser timezone or real calendar date.
    const localDay = Math.floor((start + 8 * 60 * minute) / (24 * 60 * minute));
    return new Date((localDay + 1) * 24 * 60 * minute).toISOString();
  }
  const next = appointmentStops(world, start)[0];
  if (!next) throw new StoryWaitError('NO_APPOINTMENT');
  return new Date(Math.max(start, next.at - 10 * minute)).toISOString();
}
export function storyWaitFrom(
  world: WorldState,
  context: Pick<StoryWaitContext, 'clock' | 'realNow'>,
) {
  const realNow = canonicalWaitInstant(context.realNow);
  const until =
    context.clock.managed && context.clock.activeUntil
      ? canonicalWaitInstant(context.clock.activeUntil)
      : realNow;
  const boundedNow = Date.parse(until) < Date.parse(realNow) ? until : realNow;
  return new Date(
    Math.max(
      Date.parse(canonicalWaitInstant(world.time)),
      Date.parse(projectStoryTime(context.clock, boundedNow)),
    ),
  ).toISOString();
}
function publicLabel(value: string | undefined) {
  return typeof value === 'string' && value.trim() && value.length <= 160 ? value : undefined;
}
export function planStoryWait(world: WorldState, input: StoryWaitInput, context: StoryWaitContext) {
  validateStoryWaitInput(input);
  if (world.schemaVersion !== 1 || world.version !== input.expectedVersion)
    throw new DomainError('VERSION_CONFLICT');
  if (context.activeScene) throw new StoryWaitError('ACTIVE_SCENE');
  if (context.inflight) throw new StoryWaitError('INFLIGHT');
  const fromStoryAt = storyWaitFrom(world, context);
  const targetAt = targetTime(world, fromStoryAt, input.target);
  const from = Date.parse(fromStoryAt);
  let storyNow = targetAt;
  let stoppedBy: StoryWaitStop = { reason: 'target' };
  if (context.importantMessage)
    return {
      fromStoryAt,
      targetAt,
      storyNow: fromStoryAt,
      stoppedBy: { reason: 'message' as const },
    };
  if (context.openingPending)
    return {
      fromStoryAt,
      targetAt,
      storyNow: fromStoryAt,
      stoppedBy: { reason: 'opening' as const },
    };
  const stops = [
    ...appointmentStops(world, from).map((a) => ({
      at: new Date(Math.max(from, a.at - 10 * minute)).toISOString(),
      reason: 'appointment' as const,
      label: publicLabel(a.label),
    })),
    ...context.boundaries.map((b) => ({
      at: canonicalWaitInstant(b.at),
      reason: b.reason,
      label: publicLabel(b.label),
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const stop of stops) {
    const at = Math.max(from, Date.parse(stop.at));
    if (at <= Date.parse(targetAt)) {
      storyNow = new Date(at).toISOString();
      stoppedBy = { reason: stop.reason, ...(stop.label ? { label: stop.label } : {}) };
      break;
    }
  }
  return { fromStoryAt, targetAt, storyNow, stoppedBy };
}
/** Replay changes time/version only, never location, appointments, messages or authored material. */
export function applyStoryWaitEvent(world: WorldState, event: StoryWaitEvent): WorldState {
  if (event.worldId !== world.id || event.version !== world.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  validateEventId(event.id);
  validateEventId(event.commandId);
  if (
    event.schemaVersion !== 1 ||
    event.type !== 'story.waited' ||
    !Number.isSafeInteger(event.version) ||
    !targets.includes(event.data.target)
  )
    throw new DomainError('INVALID_COMMAND');
  canonicalWaitInstant(event.occurredAt);
  const from = canonicalWaitInstant(event.data.fromStoryAt);
  const to = canonicalWaitInstant(event.storyAt);
  const target = canonicalWaitInstant(event.data.targetAt);
  if (
    Date.parse(from) < Date.parse(world.time) ||
    Date.parse(to) < Date.parse(from) ||
    Date.parse(to) > Date.parse(target) ||
    target !== targetTime(world, from, event.data.target) ||
    !['target', 'appointment', 'story_boundary', 'opening', 'message'].includes(
      event.data.stoppedBy.reason,
    ) ||
    (event.data.stoppedBy.reason === 'target' && to !== target) ||
    (['opening', 'message'].includes(event.data.stoppedBy.reason) && to !== from) ||
    (event.data.stoppedBy.label !== undefined &&
      publicLabel(event.data.stoppedBy.label) !== event.data.stoppedBy.label)
  )
    throw new DomainError('INVALID_COMMAND');
  return { ...structuredClone(world), version: event.version, time: to };
}
export function storyWaitReceipt(event: StoryWaitEvent): StoryWaitReceipt {
  return {
    status: 'committed',
    commandId: event.commandId,
    worldId: event.worldId,
    version: event.version,
    sourceEventId: event.id,
    fromStoryAt: event.data.fromStoryAt,
    storyNow: event.storyAt,
    targetAt: event.data.targetAt,
    stoppedBy: structuredClone(event.data.stoppedBy),
  };
}
