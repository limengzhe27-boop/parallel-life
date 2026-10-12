import { DomainError } from './errors.ts';
import { projectStoryTime, type WorldClock } from './clock.ts';
import { isoInstant, validateEventId } from './validation.ts';
import { validateSpace } from './space.ts';
import type { WorldState } from './types.ts';

export type AppointmentWaitInput = {
  commandId: string;
  expectedVersion: number;
  invitationId: string;
};
export type AppointmentWaitCommand = AppointmentWaitInput & { worldId: string };
export type AppointmentWaitEvent = {
  schemaVersion: 1;
  type: 'appointment.waited';
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  data: {
    invitationId: string;
    invitationResponseVersion: number | null;
    placeId: string;
    fromStoryAt: string;
    toStoryAt: string;
  };
};
export type AppointmentWaitReceipt = {
  status: 'committed';
  commandId: string;
  worldId: string;
  version: number;
  sourceEventId: string;
  invitationId: string;
  placeId: string;
  fromStoryAt: string;
  storyNow: string;
  waitedMinutes: number;
};
export const appointmentWaitMessages = {
  PAUSED: '这段人生已暂停，请先恢复。',
  UNCONFIRMED: '请先确认这个邀约，再等到约定时间。',
  ALREADY_DUE: '约定时间已经到了，请查看最新日程并进入现场。',
  NOT_AT_PLACE: '请先前往这个约定的地点，抵达后再等待。',
  ACTIVE_SCENE: '请先明确离开当前现场，再等待下一次约定。',
  EARLIER_APPOINTMENT: '更早还有一个未过去的已确认约定，请先处理它。',
} as const;
export class AppointmentWaitError extends DomainError {
  readonly reason: keyof typeof appointmentWaitMessages;
  constructor(reason: keyof typeof appointmentWaitMessages) {
    super('INVALID_COMMAND', appointmentWaitMessages[reason]);
    this.reason = reason;
  }
}
/** Authored UTC instants may omit milliseconds; stored runtime events use the existing canonical format. */
export function canonicalWaitInstant(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new DomainError('INVALID_COMMAND');
  const canonical = new Date(value).toISOString();
  if (canonical.slice(0, 10) !== value.slice(0, 10)) throw new DomainError('INVALID_COMMAND');
  return isoInstant(canonical);
}
function invitationAtPlace(world: WorldState, id: string) {
  const venues = world.space?.places.filter((p) => p.appointmentIds.includes(id)) ?? [];
  if (venues.length !== 1 || venues[0]!.id !== world.space?.currentPlaceId)
    throw new AppointmentWaitError('NOT_AT_PLACE');
  return venues[0]!;
}
function target(world: WorldState, id: string, fromStoryAt: string) {
  const found = world.appointments.filter((a) => a.id === id);
  if (found.length !== 1) throw new DomainError('NOT_FOUND');
  const invitation = found[0]!;
  if (invitation.status !== 'confirmed') throw new AppointmentWaitError('UNCONFIRMED');
  const toStoryAt = canonicalWaitInstant(invitation.at);
  if (Date.parse(toStoryAt) <= Date.parse(fromStoryAt))
    throw new AppointmentWaitError('ALREADY_DUE');
  if (!world.space) throw new AppointmentWaitError('NOT_AT_PLACE');
  validateSpace(world.space);
  const place = invitationAtPlace(world, id);
  for (const other of world.appointments) {
    if (other.id === id || other.status !== 'confirmed') continue;
    const at = Date.parse(canonicalWaitInstant(other.at));
    if (at < Date.parse(fromStoryAt) || at >= Date.parse(toStoryAt)) continue;
    const venues = world.space.places.filter((p) => p.appointmentIds.includes(other.id));
    // Unknown/ambiguous venues cannot be assumed to coincide with the current venue.
    if (venues.length !== 1 || venues[0]!.id !== place.id)
      throw new AppointmentWaitError('EARLIER_APPOINTMENT');
  }
  return {
    invitationId: id,
    invitationResponseVersion: invitation.responseVersion ?? null,
    placeId: place.id,
    fromStoryAt,
    toStoryAt,
  };
}
export function planAppointmentWait(
  world: WorldState,
  command: AppointmentWaitCommand,
  context: { clock: WorldClock; realNow: string; currentSceneId?: string | null },
): AppointmentWaitEvent['data'] {
  if (world.schemaVersion !== 1) throw new DomainError('INVALID_COMMAND');
  validateEventId(command.commandId);
  validateEventId(command.worldId);
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(command.invitationId) ||
    !Number.isSafeInteger(command.expectedVersion) ||
    command.expectedVersion < 0
  )
    throw new DomainError('INVALID_COMMAND');
  if (command.worldId !== world.id || command.expectedVersion !== world.version)
    throw new DomainError('VERSION_CONFLICT');
  isoInstant(context.realNow);
  if (context.clock.paused) throw new AppointmentWaitError('PAUSED');
  if (context.currentSceneId != null) throw new AppointmentWaitError('ACTIVE_SCENE');
  const fromStoryAt = new Date(
    Math.max(
      Date.parse(canonicalWaitInstant(world.time)),
      Date.parse(projectStoryTime(context.clock, context.realNow)),
    ),
  ).toISOString();
  return target(world, command.invitationId, isoInstant(fromStoryAt));
}
/** The wait is a player action with its own event; it is never a journey, invitation response or scene attendance. */
export function applyAppointmentWaitEvent(
  current: WorldState,
  event: AppointmentWaitEvent,
): WorldState {
  if (event.worldId !== current.id || event.version !== current.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  if (
    event.schemaVersion !== 1 ||
    event.type !== 'appointment.waited' ||
    !Number.isSafeInteger(event.version)
  )
    throw new DomainError('INVALID_COMMAND');
  validateEventId(event.id);
  validateEventId(event.commandId);
  isoInstant(event.occurredAt);
  isoInstant(event.storyAt);
  isoInstant(event.data.fromStoryAt);
  isoInstant(event.data.toStoryAt);
  if (
    Date.parse(event.data.fromStoryAt) < Date.parse(current.time) ||
    event.storyAt !== event.data.toStoryAt
  )
    throw new DomainError('INVALID_COMMAND');
  const planned = target(current, event.data.invitationId, event.data.fromStoryAt);
  if (
    planned.toStoryAt !== event.storyAt ||
    planned.placeId !== event.data.placeId ||
    planned.invitationResponseVersion !== event.data.invitationResponseVersion
  )
    throw new DomainError('INVALID_COMMAND');
  return { ...structuredClone(current), version: event.version, time: event.storyAt };
}
export function appointmentWaitReceipt(event: AppointmentWaitEvent): AppointmentWaitReceipt {
  return {
    status: 'committed',
    commandId: event.commandId,
    worldId: event.worldId,
    version: event.version,
    sourceEventId: event.id,
    invitationId: event.data.invitationId,
    placeId: event.data.placeId,
    fromStoryAt: event.data.fromStoryAt,
    storyNow: event.storyAt,
    waitedMinutes: (Date.parse(event.storyAt) - Date.parse(event.data.fromStoryAt)) / 60000,
  };
}
