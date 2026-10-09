import type { WorldEvent, WorldState, OutboxJob } from './types.ts';
import { applyEvent } from './reducer.ts';
import { applyInvitationEvent, type InvitationEvent } from './invitations.ts';
import { applyNoteEvent, type NoteEvent } from './notes.ts';
import {
  applyGroupWorldEvent,
  isGroupEvent,
  reduceGroupEvent,
  type GroupEvent,
} from './group-runtime.ts';
import type { GroupConversation, GroupMessage } from './experience-rules.ts';
import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';
type SceneWorldEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type:
    | 'scene.entered'
    | 'scene.input_recorded'
    | 'scene.opened'
    | 'scene.action_resolved'
    | 'scene.reaction_recorded'
    | 'scene.view_changed'
    | 'scene.left';
  data: unknown;
};
/** Stored event union is separate from the existing private-turn command contract. */
export type WorldHistoryEvent =
  WorldEvent | InvitationEvent | NoteEvent | GroupEvent | SceneWorldEvent;
export function applyWorldHistoryEvent(
  current: WorldState,
  event: WorldHistoryEvent,
): { state: WorldState; jobs: OutboxJob[] } {
  if (event.worldId !== current.id || event.version !== current.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  if (event.schemaVersion !== 1) throw new DomainError('INVALID_PROPOSAL');
  validateEventId(event.id);
  validateEventId(event.commandId);
  isoInstant(event.occurredAt);
  if (isGroupEvent(event)) return { state: applyGroupWorldEvent(current, event), jobs: [] };
  if (event.type === 'turn.resolved') return applyEvent(current, event);
  if (event.type === 'invitation.responded') {
    isoInstant(event.storyTime);
    if (Date.parse(event.storyTime) < Date.parse(current.time))
      throw new DomainError('INVALID_COMMAND');
    return { state: applyInvitationEvent({ ...current, time: event.storyTime }, event), jobs: [] };
  }
  if (event.type === 'note.saved') return { state: applyNoteEvent(current, event), jobs: [] };
  if (
    [
      'scene.entered',
      'scene.input_recorded',
      'scene.opened',
      'scene.action_resolved',
      'scene.reaction_recorded',
      'scene.view_changed',
      'scene.left',
    ].includes(event.type)
  ) {
    const scene = event as SceneWorldEvent;
    isoInstant(scene.storyAt);
    if (Date.parse(scene.storyAt) < Date.parse(current.time))
      throw new DomainError('INVALID_COMMAND');
    // Scene-specific projections stay in their repository; these events only change World version/time.
    return { state: { ...current, version: scene.version, time: scene.storyAt }, jobs: [] };
  }
  throw new DomainError('INVALID_PROPOSAL', 'Unsupported historical event');
}
/** Rebuilds historical World and group projections for reads/branch preparation; never executes jobs. */
export function replayWorldHistory(
  initial: WorldState,
  events: WorldHistoryEvent[],
  throughVersion = Infinity,
) {
  let world = structuredClone(initial);
  const groups = new Map<string, GroupConversation>();
  const messages: GroupMessage[] = [];
  const sources: { id: string; version: number; ownerId: string; worldId: string }[] = [];
  for (const event of events) {
    if (event.version > throughVersion) break;
    const next = applyWorldHistoryEvent(world, event).state;
    sources.push({
      id: event.id,
      version: event.version,
      ownerId: world.ownerId,
      worldId: world.id,
    });
    if (isGroupEvent(event)) {
      const result = reduceGroupEvent(
        { world: next, events: sources },
        groups.get(event.data.groupId),
        event,
      );
      groups.set(result.group.id, result.group);
      messages.push(...result.messages);
    }
    world = next;
  }
  return { world, groups: [...groups.values()], messages };
}
