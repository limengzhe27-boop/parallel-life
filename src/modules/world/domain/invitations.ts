import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';
import type { WorldState } from './types.ts';

export type InvitationCommand = {
  commandId: string;
  worldId: string;
  id: string;
  expectedVersion: number;
  operation: 'accept' | 'cancel' | 'reschedule';
  at?: string;
};
export type InvitationEvent = {
  schemaVersion: 1;
  type: 'invitation.responded';
  id: string;
  worldId: string;
  version: number;
  commandId: string;
  occurredAt: string;
  storyTime: string;
  data: InvitationCommand;
};

/** Explicit owner action only. A proposal never confirms itself. */
export function applyInvitationEvent(current: WorldState, event: InvitationEvent): WorldState {
  const command = event.data;
  try {
    for (const id of [event.id, event.commandId, event.worldId]) validateEventId(id);
    isoInstant(event.occurredAt);
    isoInstant(event.storyTime);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(command.id)) throw new Error('Invalid id');
    if (command.at !== undefined) isoInstant(command.at);
    if (
      event.schemaVersion !== 1 ||
      event.type !== 'invitation.responded' ||
      event.commandId !== command.commandId ||
      event.worldId !== command.worldId ||
      !Number.isSafeInteger(command.expectedVersion) ||
      command.expectedVersion < 0 ||
      !['accept', 'cancel', 'reschedule'].includes(command.operation) ||
      (command.operation === 'reschedule') !== (command.at !== undefined)
    )
      throw new Error('Invalid invitation action');
  } catch {
    throw new DomainError('INVALID_COMMAND');
  }
  if (
    current.time !== event.storyTime ||
    current.id !== command.worldId ||
    current.version !== command.expectedVersion ||
    event.version !== current.version + 1
  )
    throw new DomainError('VERSION_CONFLICT');
  const invitation = current.appointments.find((a) => a.id === command.id);
  if (!invitation) throw new DomainError('NOT_FOUND');
  // Legacy records have unknown consent. They must not become confirmed through this API.
  if (
    !invitation.status ||
    invitation.status === 'cancelled' ||
    (command.operation === 'accept' && invitation.status !== 'proposed')
  )
    throw new DomainError('INVALID_COMMAND');
  if (
    (command.operation === 'accept' && invitation.at < current.time) ||
    (command.at !== undefined && command.at < current.time)
  )
    throw new DomainError('INVALID_COMMAND');
  const next = structuredClone(current);
  const target = next.appointments.find((a) => a.id === command.id)!;
  if (command.operation === 'accept') target.status = 'confirmed';
  if (command.operation === 'cancel') target.status = 'cancelled';
  // A changed time needs renewed agreement; do not claim other participants accepted it.
  if (command.operation === 'reschedule') {
    target.at = command.at!;
    target.status = 'proposed';
  }
  next.version = event.version;
  return next;
}
