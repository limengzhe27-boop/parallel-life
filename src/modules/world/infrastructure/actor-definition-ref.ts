import { createHash } from 'node:crypto';
import type { WorldState } from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';
export function actorDefinitionRef(
  world: Pick<WorldState, 'id' | 'actors'>,
  actorId: string,
): string {
  const actor = world.actors.find((a) => a.id === actorId);
  if (!actor) throw new DomainError('INVALID_COMMAND');
  return createHash('sha256')
    .update(JSON.stringify([world.id, actor.id, actor.persona, actor.relationship]))
    .digest('hex');
}
