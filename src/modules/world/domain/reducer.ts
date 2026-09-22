import { DomainError } from './errors.ts';
import { parseProposal, isoInstant, validateCommand, validateEventId } from './validation.ts';
import { validateCharacterEffects } from './character-policy.ts';
import type { WorldState, WorldEvent, OutboxJob } from './types.ts';

/** Pure reducer. All effects validate before the caller commits anything. */
export function applyEvent(current: WorldState, event: WorldEvent): { state: WorldState; jobs: OutboxJob[] } {
  if (event.worldId !== current.id || event.version !== current.version + 1) throw new DomainError('VERSION_CONFLICT');
  if (event.schemaVersion !== 1 || event.type !== 'turn.resolved') throw new DomainError('INVALID_PROPOSAL');
  isoInstant(event.occurredAt);
  validateEventId(event.id);
  validateCommand({ id: event.commandId, worldId: event.worldId, expectedVersion: current.version, actorId: event.data.actorId, text: event.data.userText });
  const actorIds = new Set(current.actors.map(actor => actor.id));
  if (!actorIds.has(event.data.actorId)) throw new DomainError('INVALID_COMMAND');
  const effects = parseProposal({ schemaVersion: 1, effects: event.data.effects }).effects;
  validateCharacterEffects(event.data.actorId, effects);
  const state = structuredClone(current);
  const usedIds = new Set([...state.facts, ...state.messages, ...state.appointments, ...state.mediaRequests].map(item => item.id));
  const jobs: OutboxJob[] = [];
  const userMessageId = `${event.id}_user`;
  if (usedIds.has(userMessageId)) throw new DomainError('INVALID_PROPOSAL');
  usedIds.add(userMessageId);
  state.messages.push({ id: userMessageId, actorId: event.data.actorId, role: 'user', text: event.data.userText, at: current.time, sourceEventId: event.id });
  for (const effect of effects) {
    if (usedIds.has(effect.id)) throw new DomainError('INVALID_PROPOSAL', 'Duplicate effect ID');
    usedIds.add(effect.id);
    const sourceEventId = event.id;
    switch (effect.type) {
      case 'message.received':
        if (!actorIds.has(effect.actorId)) throw new DomainError('INVALID_PROPOSAL', 'Unknown actor');
        state.messages.push({ id: effect.id, actorId: effect.actorId, role: 'assistant', text: effect.text, at: current.time, sourceEventId });
        break;
      case 'appointment.created':
        if (effect.participantIds.some(id => !actorIds.has(id)) || effect.at < current.time) throw new DomainError('INVALID_PROPOSAL', 'Invalid appointment');
        state.appointments.push({ id: effect.id, title: effect.title, at: effect.at, participantIds: effect.participantIds, sourceEventId });
        break;
      case 'fact.established':
        if (effect.visibility.kind === 'actors' && effect.visibility.actorIds.some(id => !actorIds.has(id))) throw new DomainError('INVALID_PROPOSAL', 'Unknown fact audience');
        state.facts.push({ id: effect.id, text: effect.text, visibility: effect.visibility, sourceEventId });
        break;
      case 'media.requested':
        state.mediaRequests.push({ id: effect.id, prompt: effect.prompt, status: 'pending', sourceEventId });
        jobs.push({ id: `${event.id}_${effect.id}`, eventId: event.id, worldId: state.id, type: 'image.generate', requestId: effect.id, prompt: effect.prompt });
    }
  }
  state.version = event.version;
  return { state, jobs };
}
