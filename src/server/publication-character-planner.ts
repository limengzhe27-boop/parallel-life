import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type { TextModel } from '../modules/ai/application/ports.ts';
import type { TurnPlanner } from '../modules/world/application/ports.ts';
import { WorldTurnPlanner } from '../modules/world/infrastructure/turn-planner.ts';
import {
  readPublicationSocial,
  readPublicationActorModules,
} from '../modules/settings/infrastructure/publication-social-repository.ts';
import { readPresentedActorStory } from '../modules/settings/infrastructure/presented-story-repository.ts';
import { readActorSituation } from '../modules/world/infrastructure/actor-situation-repository.ts';
import { readDirectorObservation } from '../modules/world/infrastructure/director-observation-repository.ts';
import {
  reserveActorContext,
  selectActorPersona,
} from '../modules/world/domain/actor-situation.ts';
/** Only this speaker's saved public posts are supplied, never another character's private source. */
export function publicationCharacterPlanner(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  model: TextModel,
): TurnPlanner {
  const planner = new WorldTurnPlanner(model);
  return {
    async chooseStoryOpportunity(input) {
      if (!input.directorObservation) throw Error('DIRECTOR_SNAPSHOT_REQUIRED');
      const observation = await readDirectorObservation(
        db,
        ownerId,
        worldId,
        input.directorObservation.worldVersion,
        input.storyNow,
      );
      return planner.chooseStoryOpportunity({
        ...input,
        directorObservation: observation,
        recentWorldInputs: observation.recentWorldInputs,
      });
    },
    async propose(input) {
      if (input.context.worldId !== worldId) throw Error('INVALID_STATE');
      const [social, modules, threads, situation] = await Promise.all([
        readPublicationSocial(db, ownerId, worldId),
        readPublicationActorModules(db, ownerId, worldId, input.context.actor.id),
        readPresentedActorStory(
          db,
          ownerId,
          worldId,
          input.context.actor.id,
          input.context.worldVersion,
          input.context.time,
        ),
        readActorSituation(db, ownerId, input.context),
      ]);
      const ownPosts = social.moments
        .filter((m) => m.actorId === input.context.actor.id)
        .slice(0, 4)
        .map(({ text, at }) => ({ text, at }));
      const {
        authoredPosts: _unscoped,
        authoredLifeModules: _unscopedModules,
        presentedStoryThreads: _unscopedThreads,
        actorSituation: _unscopedSituation,
        ...context
      } = input.context;
      const selected = selectActorPersona(
        modules,
        `${input.userText}\n${situation?.opening.direction ?? ''}`,
      );
      const scopedContext = reserveActorContext(
        {
          ...context,
          ...(selected ? { authoredLifeModules: selected } : {}),
          ...(situation ? { actorSituation: situation } : {}),
          ...(threads.length ? { presentedStoryThreads: threads } : {}),
          ...(ownPosts.length ? { authoredPosts: ownPosts } : {}),
        },
        input.userText,
      );
      return planner.propose({ ...input, context: scopedContext });
    },
  };
}
