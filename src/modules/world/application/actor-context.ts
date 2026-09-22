import { DomainError } from '../domain/errors.ts';
import type { WorldState } from '../domain/types.ts';
import type { ActorContext } from './ports.ts';

export function actorContext(state: WorldState, actorId: string): ActorContext {
  const actor = state.actors.find(item => item.id === actorId);
  if (!actor) throw new DomainError('INVALID_COMMAND');
  return structuredClone({
    worldId: state.id, worldVersion: state.version, time: state.time, actor,
    facts: state.facts.filter(fact => fact.visibility.kind === 'world' || (fact.visibility.kind === 'actors' && fact.visibility.actorIds.includes(actorId))),
    messages: state.messages.filter(message => message.actorId === actorId).slice(-30),
    appointments: state.appointments.filter(item => item.participantIds.includes(actorId)),
  });
}
