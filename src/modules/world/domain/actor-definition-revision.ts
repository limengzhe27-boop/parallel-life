import type { WorldState, Actor } from './types.ts';
import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';
export type ActorDefinitionRevisedEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type: 'actor.definition_revised';
  data: {
    actorId: string;
    previousDefinitionRef: string;
    definitionRef: string;
    persona: string;
    reason: string;
    actorRevisionBefore: number;
    actorRevisionAfter: number;
  };
};
/** Structural proof only; callers authenticate committed command and prior definition separately. */
export function validActorDefinitionRevision(value: unknown): value is ActorDefinitionRevisedEvent {
  const e = value as ActorDefinitionRevisedEvent | null,
    d = e?.data;
  if (
    !e ||
    e.schemaVersion !== 1 ||
    e.type !== 'actor.definition_revised' ||
    !d ||
    !Number.isSafeInteger(e.version) ||
    e.version < 1 ||
    !e.worldId ||
    !d.actorId ||
    !/^[a-f0-9]{64}$/.test(d.previousDefinitionRef) ||
    !/^[a-f0-9]{64}$/.test(d.definitionRef) ||
    d.previousDefinitionRef === d.definitionRef ||
    typeof d.persona !== 'string' ||
    d.persona.length > 120000 ||
    typeof d.reason !== 'string' ||
    !d.reason.trim() ||
    d.reason.length > 2000 ||
    !Number.isSafeInteger(d.actorRevisionBefore) ||
    d.actorRevisionBefore < 0 ||
    d.actorRevisionAfter !== d.actorRevisionBefore + 1
  )
    return false;
  try {
    validateEventId(e.id);
    validateEventId(e.commandId);
    isoInstant(e.occurredAt);
    isoInstant(e.storyAt);
    const p = JSON.parse(d.persona);
    return (
      !!p &&
      typeof p === 'object' &&
      !Array.isArray(p) &&
      !!p.modules &&
      typeof p.modules === 'object' &&
      !Array.isArray(p.modules) &&
      Object.keys(p.modules).length > 0 &&
      Object.entries(p.modules).every(
        ([k, v]) =>
          ['lifeContext', 'traits', 'drives', 'behavior', 'relationships'].includes(k) &&
          typeof v === 'string' &&
          v.length > 0 &&
          v.length <= 16384,
      )
    );
  } catch {
    return false;
  }
}
export function revisedActor(
  worldId: string,
  actor: Actor,
  event: ActorDefinitionRevisedEvent,
): Actor {
  if (
    !validActorDefinitionRevision(event) ||
    event.worldId !== worldId ||
    actor.id !== event.data.actorId
  )
    throw new DomainError('INVALID_PROPOSAL');
  const next = { ...actor, persona: event.data.persona };
  return next;
}
export function applyActorDefinitionRevision(
  world: WorldState,
  event: ActorDefinitionRevisedEvent,
): WorldState {
  if (event.worldId !== world.id || event.version !== world.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  const actor = world.actors.find((a) => a.id === event.data.actorId);
  if (!actor || Date.parse(event.storyAt) < Date.parse(world.time))
    throw new DomainError('INVALID_PROPOSAL');
  const next = revisedActor(world.id, actor, event);
  return {
    ...world,
    version: event.version,
    time: event.storyAt,
    actors: world.actors.map((a) => (a.id === actor.id ? next : a)),
  };
}
