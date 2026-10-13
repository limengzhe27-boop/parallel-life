import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type { TextModel } from '../modules/ai/application/ports.ts';
import type { TurnPlanner } from '../modules/world/application/ports.ts';
import { WorldTurnPlanner } from '../modules/world/infrastructure/turn-planner.ts';
import { readPublicationSocial } from '../modules/settings/infrastructure/publication-social-repository.ts';
/** Only this speaker's saved public posts are supplied, never another character's private source. */
export function publicationCharacterPlanner(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  model: TextModel,
): TurnPlanner {
  const planner = new WorldTurnPlanner(model);
  return {
    chooseStoryOpportunity: (input) => planner.chooseStoryOpportunity(input),
    async propose(input) {
      if (input.context.worldId !== worldId) throw Error('INVALID_STATE');
      const social = await readPublicationSocial(db, ownerId, worldId);
      const ownPosts = social.moments
        .filter((m) => m.actorId === input.context.actor.id)
        .slice(0, 4)
        .map(({ text, at }) => ({ text, at }));
      return planner.propose({
        ...input,
        context: { ...input.context, ...(ownPosts.length ? { authoredPosts: ownPosts } : {}) },
      });
    },
  };
}
