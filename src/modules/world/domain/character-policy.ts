import { DomainError } from './errors.ts';
import type { WorldEffect } from './types.ts';

/** Applies both during orchestration and at the final domain commit boundary. */
export function validateCharacterEffects(
  actorId: string,
  effects: WorldEffect[],
  allowLegacyReplay = false,
  origin?: 'director',
  allowCommittedReply = false,
): void {
  if (!allowCommittedReply && !effects.some((effect) => effect.type === 'message.received')) {
    throw new DomainError('INVALID_PROPOSAL', 'A character turn requires a reply');
  }
  if (effects.filter((effect) => effect.type === 'matter.proposed').length > 1)
    throw new DomainError(
      'INVALID_PROPOSAL',
      'At most one grounded matter may be proposed per beat',
    );
  for (const effect of effects) {
    if (
      (effect.type === 'matter.created' || effect.type === 'matter.proposed') &&
      origin !== 'director'
    )
      throw new DomainError('INVALID_PROPOSAL', 'Only a director beat can propose a world matter');
    if (
      effect.type === 'matter.updated' &&
      (origin === 'director' ||
        effect.evidence.kind !== 'user_report' ||
        effect.assertion === 'world_verified')
    )
      throw new DomainError(
        'INVALID_PROPOSAL',
        'A character reply cannot verify or complete world actions',
      );

    if (effect.type === 'information.shared' && origin !== 'director')
      throw new DomainError('INVALID_PROPOSAL', 'Only a director beat can carry a disclosure');
    if (
      !allowLegacyReplay &&
      (effect.type === 'fact.established' || effect.type === 'appointment.created')
    )
      throw new DomainError(
        'INVALID_PROPOSAL',
        'Character may only record beliefs and propose invitations',
      );
    if (effect.type === 'belief.recorded' && effect.actorId !== actorId)
      throw new DomainError(
        'INVALID_PROPOSAL',
        'Character cannot attribute beliefs to another actor',
      );
    if (effect.type === 'message.received' && effect.actorId !== actorId)
      throw new DomainError('INVALID_PROPOSAL', 'Character cannot speak for another actor');
    if (
      effect.type === 'fact.established' &&
      (effect.visibility.kind !== 'actors' ||
        effect.visibility.actorIds.length !== 1 ||
        effect.visibility.actorIds[0] !== actorId)
    )
      throw new DomainError('INVALID_PROPOSAL', 'Character cannot publish world facts');
    if (
      (effect.type === 'appointment.created' || effect.type === 'appointment.proposed') &&
      (effect.participantIds.length !== 1 || effect.participantIds[0] !== actorId)
    )
      throw new DomainError('INVALID_PROPOSAL', 'Character cannot schedule for other actors');
  }
}
