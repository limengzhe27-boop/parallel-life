import { DomainError } from '../domain/errors.ts';
import { advanceClock, beatCue, selectSpeaker } from '../domain/clock.ts';
import { buildAgenda, eligibleAgenda, type CommitmentMemory } from '../domain/agenda.ts';
import { beatsForPacing, EMPTY_DIRECTION, type WorldDirection } from '../domain/direction.ts';
import type { Session } from '../domain/types.ts';
import type { MemoryRecord } from '../../memory/domain/types.ts';
import type { ClockStore, TurnPlanner, WorldRepository } from './ports.ts';
import { resolveTurn } from './resolve-turn.ts';

export type AdvanceResult = {
  storyNow: string;
  played: number;
  folded: number;
  summary: string | null;
  actors: string[];
};

/**
 * The director acts only on unfinished business. A single world lock covers model work;
 * the clock is finalized only after the turn receipt exists. After a crash, stable beat
 * IDs reconcile committed turns without paying for the same model call again.
 */
export async function advanceWorld(
  deps: {
    clock: ClockStore;
    worlds: WorldRepository;
    planner: TurnPlanner;
    now: () => string;
    newId: () => string;
    memories?: (
      actorId: string,
    ) => Promise<{ records: MemoryRecord[]; blockedSources: Set<string> }>;
    worldMemories?: () => Promise<MemoryRecord[]>;
    direction?: () => Promise<WorldDirection>;
    maxBeats?: number;
    automatic?: boolean;
  },
  session: Session,
  worldId: string,
): Promise<AdvanceResult> {
  return deps.clock.withAdvanceLock(worldId, async () => {
    const clock = await deps.clock.read(session.userId, worldId);
    await deps.clock.ensureAnchor(session.userId, worldId, clock);
    if (deps.automatic && (await deps.clock.hasUnresolvedAttempt(session.userId, worldId)))
      throw new DomainError('VERSION_CONFLICT', '上次导演来信结果不确定，请在导演面板手动继续');
    const direction = (await deps.direction?.()) ?? EMPTY_DIRECTION;
    const advance = advanceClock(clock, deps.now(), {
      maxBeats: deps.maxBeats ?? beatsForPacing(direction.pacing),
    });
    const pending = (await deps.clock.pendingAttempt?.(session.userId, worldId)) ?? null;
    const plans = pending
      ? [
          { at: pending.plannedFor, commandId: pending.commandId, actorId: pending.actorId },
          ...advance.beats
            .filter((at) => at !== pending.plannedFor && at > pending.plannedFor)
            .slice(0, Math.max(0, advance.beats.length - 1))
            .map((at) => ({ at, commandId: deps.clock.beatCommandId(worldId, at) })),
        ]
      : advance.beats.map((at) => ({ at, commandId: deps.clock.beatCommandId(worldId, at) }));
    const actors: string[] = [];
    const worldMemories = deps.worldMemories ? await deps.worldMemories() : [];

    for (const plan of plans) {
      const beatAt = plan.at;
      const recentSince = new Date(Date.parse(beatAt) - 12 * 60 * 60_000).toISOString();
      const recentActors = new Set(
        await deps.clock.recentActors(session.userId, worldId, recentSince),
      );
      const commandId = plan.commandId;
      const previouslyCommitted = await deps.clock.committedBeat(
        session.userId,
        worldId,
        commandId,
      );
      if (previouslyCommitted) {
        await deps.clock.markAttempt(session.userId, worldId, commandId, 'committed');
        await deps.clock.recordBeat(session.userId, worldId, {
          id: deps.newId(),
          commandId,
          plannedFor: beatAt,
          actorId: previouslyCommitted,
          status: 'played',
        });
        actors.push(previouslyCommitted);
        continue;
      }
      const world = await deps.worlds.get(session, worldId);
      const atBeat = {
        ...world,
        time: new Date(Math.max(Date.parse(world.time), Date.parse(beatAt))).toISOString(),
      };
      const agenda = eligibleAgenda(
        buildAgenda(atBeat, 20, worldMemories as CommitmentMemory[]),
        recentActors,
      ).slice(0, 5);
      const actorId =
        ('actorId' in plan ? plan.actorId : null) ??
        selectSpeaker(atBeat, actors, agenda, direction.focusActorIds);
      // An early sampled day may be quiet while a later sampled day is old
      // enough for a real follow-up. Inspect the remaining bounded slots.
      if (!actorId) continue;
      const started = await deps.clock.beginAttempt(
        session.userId,
        worldId,
        { commandId, plannedFor: beatAt, actorId },
        !deps.automatic,
      );
      if (!started)
        throw new DomainError('VERSION_CONFLICT', '上次导演来信结果不确定，请在导演面板手动继续');
      try {
        await resolveTurn(
          {
            worlds: deps.worlds,
            planner: deps.planner,
            now: deps.now,
            storyNow: () => beatAt,
            newId: deps.newId,
            ...(deps.memories ? { memories: deps.memories } : {}),
          },
          session,
          {
            id: commandId,
            origin: 'director',
            worldId,
            actorId,
            text: beatCue(atBeat, actorId, agenda, direction),
            expectedVersion: world.version,
          },
        );
      } catch (error) {
        await deps.clock.markAttempt(session.userId, worldId, commandId, 'unknown').catch(() => {});
        throw error;
      }
      await deps.clock.markAttempt(session.userId, worldId, commandId, 'committed');
      await deps.clock.recordBeat(session.userId, worldId, {
        id: deps.newId(),
        commandId,
        plannedFor: beatAt,
        actorId,
        status: 'played',
      });
      actors.push(actorId);
    }

    const unused = Math.max(0, advance.beats.length - actors.length);
    const finished = {
      ...advance.clock,
      missedBeats: advance.clock.missedBeats + unused,
      // An empty phone is allowed to stay quiet; elapsed time is not a fabricated event.
      summary: actors.length ? advance.clock.summary : null,
    };
    await deps.clock.finishAdvance(session.userId, worldId, finished);
    return {
      storyNow: finished.storyNow,
      played: actors.length,
      folded: advance.folded + unused,
      summary: finished.summary,
      actors,
    };
  });
}
