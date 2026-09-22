import { DomainError } from './errors.ts';
import type { WorldEffect } from './types.ts';

/** Applies both during orchestration and at the final domain commit boundary. */
export function validateCharacterEffects(actorId: string, effects: WorldEffect[]): void {
  if (!effects.some(effect => effect.type === 'message.received')) {
    throw new DomainError('INVALID_PROPOSAL', 'A character turn requires a reply');
  }
  for (const effect of effects) {
    if (effect.type === 'message.received' && effect.actorId !== actorId) throw new DomainError('INVALID_PROPOSAL', 'Character cannot speak for another actor');
    if (effect.type === 'fact.established' && (effect.visibility.kind !== 'actors' || effect.visibility.actorIds.length !== 1 || effect.visibility.actorIds[0] !== actorId)) throw new DomainError('INVALID_PROPOSAL', 'Character cannot publish world facts');
    if (effect.type === 'appointment.created' && (effect.participantIds.length !== 1 || effect.participantIds[0] !== actorId)) throw new DomainError('INVALID_PROPOSAL', 'Character cannot schedule for other actors');
  }
}
