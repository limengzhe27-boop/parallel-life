import { DomainError } from '../domain/errors.ts';
import { advanceClock, beatCue, selectSpeaker } from '../domain/clock.ts';
import { buildAgenda, type CommitmentMemory } from '../domain/agenda.ts';
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
  /** The characters who spoke, in order — what the phone can show as "this happened". */
  actors: string[];
};

/**
 * The director's first half: move the world's clock and let a bounded number of beats
 * happen on their own. Every beat reuses the ordinary turn pipeline, so it inherits
 * receipts, projections, outbox and memory — the director has no private write path.
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
    /** Every character's memories in this world, used to build the agenda. */
    worldMemories?: () => Promise<MemoryRecord[]>;
    /** The user's brief for this life; pacing caps beats, focus steers the cast. */
    direction?: () => Promise<WorldDirection>;
    maxBeats?: number;
  },
  session: Session,
  worldId: string,
): Promise<AdvanceResult> {
  const clock = await deps.clock.read(session.userId, worldId);
  const direction = (await deps.direction?.()) ?? EMPTY_DIRECTION;
  /* The user's pacing wins over the caller default; both stay bounded. */
  const advance = advanceClock(clock, deps.now(), {
    maxBeats: deps.maxBeats ?? beatsForPacing(direction.pacing),
  });
  await deps.clock.write(session.userId, worldId, advance.clock);
  const actors: string[] = [];
  const worldMemories = deps.worldMemories ? await deps.worldMemories() : [];
  // Elapsed-time text is clock metadata, not an event-backed memory.
  // Actual turns store their own sourced memories in the normal commit pipeline.
  if (!advance.beats.length) {
    await deps.clock.setStoryTime(session.userId, worldId, advance.clock.storyNow);
    return {
      storyNow: advance.clock.storyNow,
      played: 0,
      folded: advance.folded,
      summary: advance.clock.summary,
      actors,
    };
  }

  for (const beatAt of advance.beats) {
    await deps.clock.setStoryTime(session.userId, worldId, beatAt);
    const world = await deps.worlds.get(session, worldId);
    const atBeat = { ...world, time: beatAt };
    /* Beats are driven by unfinished business, not by a round-robin. */
    const agenda = buildAgenda(atBeat, 5, worldMemories as CommitmentMemory[]);
    const actorId = selectSpeaker(atBeat, actors, agenda, direction.focusActorIds);
    if (!actorId) break;
    const commandId = deps.newId();
    await resolveTurn(
      {
        worlds: deps.worlds,
        planner: deps.planner,
        now: () => beatAt,
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
    await deps.clock.recordBeat(session.userId, worldId, {
      id: deps.newId(),
      commandId,
      plannedFor: beatAt,
      actorId,
      status: 'played',
    });
    actors.push(actorId);
  }
  if (!actors.length) throw new DomainError('INVALID_COMMAND', 'No character could take a beat');
  /* Time always catches up to reality, even though only a few beats were played. */
  await deps.clock.setStoryTime(session.userId, worldId, advance.clock.storyNow);
  return {
    storyNow: advance.clock.storyNow,
    played: actors.length,
    folded: advance.folded,
    summary: advance.clock.summary,
    actors,
  };
}
