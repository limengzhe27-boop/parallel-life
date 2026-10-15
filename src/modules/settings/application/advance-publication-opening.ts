import { DomainError } from '../../world/domain/errors.ts';
import { projectStoryTime } from '../../world/domain/clock.ts';
import { parseProposal } from '../../world/domain/validation.ts';
import { resolveTurn } from '../../world/application/resolve-turn.ts';
import type { ClockStore, TurnPlanner, WorldRepository } from '../../world/application/ports.ts';
import type { WorldState } from '../../world/domain/types.ts';
import type { MemoryRecord } from '../../memory/domain/types.ts';
import type {
  OpeningBrief,
  OpeningSource,
  PublicationOpeningPort,
} from './publication-opening-ports.ts';

type Dependencies = {
  opening: PublicationOpeningPort;
  worlds: WorldRepository;
  planner: TurnPlanner;
  planOpening(source: OpeningSource, world: WorldState): Promise<OpeningBrief[]>;
  clock: Pick<ClockStore, 'withAdvanceLock' | 'read'>;
  memories?: (actorId: string) => Promise<{ records: MemoryRecord[]; blockedSources: Set<string> }>;
  now(): string;
  newId(): string;
};
/** A bounded opening step: one director OR one independently scoped actor, never a paid loop. */
export async function advancePublicationOpening(
  deps: Dependencies,
  ownerId: string,
  worldId: string,
  automatic = true,
  explicitRetry = false,
) {
  return deps.clock.withAdvanceLock(worldId, async () => {
    const clock = await deps.clock.read(ownerId, worldId);
    const quiet = () => ({
      handled: true,
      result: {
        storyNow: projectStoryTime(clock, deps.now()),
        played: 0,
        folded: 0,
        summary: null,
        actors: [] as string[],
      },
    });
    let snapshot = await deps.opening.read(ownerId, worldId);
    if (!snapshot.source || snapshot.phase === 'none' || snapshot.phase === 'complete')
      return { handled: false, result: null };
    if (automatic && clock.paused) return quiet();
    if (explicitRetry) {
      await deps.opening.retry(ownerId, worldId);
      snapshot = await deps.opening.read(ownerId, worldId);
      if (!snapshot.source || snapshot.phase === 'complete')
        return { handled: false, result: null };
    }
    const source = snapshot.source;
    if (snapshot.phase === 'unplanned' || (explicitRetry && snapshot.phase === 'planning')) {
      const commandId = snapshot.phase === 'unplanned' ? deps.newId() : snapshot.planCommandId!;
      if (
        snapshot.phase === 'unplanned' &&
        !(await deps.opening.beginPlan(ownerId, worldId, commandId))
      )
        return quiet();
      try {
        const world = await deps.worlds.get({ userId: ownerId }, worldId);
        await deps.opening.savePlan(
          ownerId,
          worldId,
          commandId,
          await deps.planOpening(source, world),
        );
        return quiet();
      } catch (error) {
        await deps.opening.failPlan(ownerId, worldId, commandId).catch(() => {});
        throw error;
      }
    }
    if (snapshot.phase !== 'ready') return quiet();
    const next = await deps.opening.claimNext(ownerId, worldId);
    if (!next) return quiet();
    if (next.expectedVersion === null) throw new DomainError('INVALID_COMMAND');
    try {
      const recalled = deps.memories
        ? await deps.memories(next.actorId)
        : { records: [], blockedSources: new Set<string>() };
      const turn = await resolveTurn(
        {
          worlds: deps.worlds,
          now: deps.now,
          newId: deps.newId,
          storyNow: (real) => projectStoryTime(clock, real),
          memories: async () => recalled,
          planner: {
            prepareContext: deps.planner.prepareContext
              ? (context, blockedSources) => deps.planner.prepareContext!(context, blockedSources)
              : undefined,
            async propose(input) {
              let context = input.context;
              if (
                context.actor.id !== next.actorId ||
                context.worldId !== worldId ||
                context.worldVersion !== next.expectedVersion
              )
                throw new DomainError('INVALID_PROPOSAL');
              context = {
                ...context,
                possibleRecipients: context.possibleRecipients?.map(
                  ({ id, name, relationship, socialTie }) => ({
                    id,
                    name,
                    relationship,
                    socialTie,
                  }),
                ),
                storyEvent: { title: '本人的开场来信' },
              };
              const proposal = parseProposal(
                await deps.planner.propose({
                  context,
                  userText:
                    '这是你本人此刻的一条手机开场来信，只参考你自己可见的经历和下面属于你的简报。不要重复已有历史原话，不替玩家或他人行动、同意或发言，不暴露幕后说明。先承接本人最新真实对话和已明确的决定，已回应或拒绝的事情不要重发催问；简报仅为联系意图，不证明其中事情已经发生。自然简短地提出本人想说的事情；仅本人message.received，不生成看法记录、日历、图片或成果。\n' +
                    next.brief,
                }),
              );
              if (proposal.effects.some((e) => e.type !== 'message.received'))
                throw new DomainError('INVALID_PROPOSAL');
              return proposal;
            },
          },
        },
        { userId: ownerId },
        {
          id: next.commandId,
          worldId,
          expectedVersion: next.expectedVersion,
          actorId: next.actorId,
          origin: 'director',
          text: `演绎已授权开场 ${source.nodeKey}。`,
        },
      );
      if (!(await deps.opening.finishDelivery(ownerId, worldId, next.actorId, next.commandId)))
        throw new DomainError('INVALID_PROPOSAL');
      return {
        handled: true,
        result: {
          storyNow: turn.state.time,
          played: 1,
          folded: 0,
          summary: null,
          actors: [next.actorId],
        },
      };
    } catch (error) {
      if (
        await deps.opening
          .finishDelivery(ownerId, worldId, next.actorId, next.commandId)
          .catch(() => false)
      ) {
        const world = await deps.worlds.get({ userId: ownerId }, worldId);
        return {
          handled: true,
          result: {
            storyNow: world.time,
            played: 1,
            folded: 0,
            summary: null,
            actors: [next.actorId],
          },
        };
      }
      await deps.opening
        .failDelivery(ownerId, worldId, next.actorId, next.commandId)
        .catch(() => {});
      throw error;
    }
  });
}
