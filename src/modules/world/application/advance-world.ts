import { followupAgenda, type DeliveredBeat } from '../domain/return-followups.ts';
import { unsupportedReturnClaim } from '../domain/return-message-policy.ts';
import { parseProposal } from '../domain/validation.ts';
import { actorContext } from './actor-context.ts';
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
    const delivered: DeliveredBeat[] = [];
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
        const committedWorld = await deps.worlds.get(session, worldId);
        const version = Math.max(
          0,
          ...committedWorld.messages
            .filter((m) => m.actorId === previouslyCommitted && m.at === beatAt)
            .map((m) => m.sourceVersion ?? 0),
        );
        delivered.push({
          actorId: previouslyCommitted,
          at: beatAt,
          version: version || committedWorld.version,
        });
        continue;
      }
      const world = await deps.worlds.get(session, worldId);
      const atBeat = {
        ...world,
        time: new Date(Math.max(Date.parse(world.time), Date.parse(beatAt))).toISOString(),
      };
      const agenda = followupAgenda(
        atBeat,
        eligibleAgenda(buildAgenda(atBeat, 20, worldMemories as CommitmentMemory[]), recentActors),
        beatAt,
        delivered,
      ).slice(0, 5);
      const actorId =
        ('actorId' in plan ? plan.actorId : null) ??
        selectSpeaker(atBeat, [], agenda, direction.focusActorIds);
      // An early sampled day may be quiet while a later sampled day is old
      // enough for a real follow-up. Inspect the remaining bounded slots.
      if (!actorId) continue;
      const recalled = deps.memories
        ? await deps.memories(actorId)
        : { records: [] as MemoryRecord[], blockedSources: new Set<string>() };
      // Stage directions must obey the same source/visibility rules as the actual NPC context.
      const visible = actorContext(atBeat, actorId, '', recalled.records, recalled.blockedSources);
      const cueState = {
        ...atBeat,
        facts: visible.facts,
        messages: visible.messages,
        appointments: visible.appointments,
        choices: visible.choices,
      };
      const visibleMemories = worldMemories.filter(
        (m) =>
          m.scopeType === 'character' &&
          m.characterId === actorId &&
          !recalled.blockedSources.has(m.id) &&
          !m.sourceIds.some((id) => recalled.blockedSources.has(id)),
      );
      const rebuilt = buildAgenda(cueState, 20, visibleMemories);
      const cueAgenda = agenda.filter((thread) => {
        if (thread.actorId !== actorId) return false;
        if (thread.kind.startsWith('choice_'))
          return visible.choices?.some((c) => c.id === thread.sourceId) ?? false;
        if (thread.kind.startsWith('appointment_') || thread.kind === 'proposed_appointment')
          return visible.appointments.some((a) => a.id === thread.basisId);
        // The receiving NPC sees the sourced disclosure fact, not the sender's private transcript.
        if (thread.kind === 'disclosure_followup')
          return visible.facts.some(
            (f) =>
              f.disclosure &&
              f.believedByActorId === actorId &&
              thread.detail.includes(f.disclosure.quote),
          );
        if (thread.kind === 'departure_inquiry')
          return visible.facts.some(
            (f) =>
              f.visibility.kind === 'actors' &&
              f.visibility.actorIds.includes(actorId) &&
              (f.id === thread.basisId || f.text.includes('亲眼看到主角离开了')),
          );
        return rebuilt.some(
          (t) => t.actorId === actorId && t.kind === thread.kind && t.detail === thread.detail,
        );
      });
      // Explicit manual recovery must retain an older saved attempt's actor/command even
      // when the old agenda no longer exists; automatic selection never gets this exception.
      if (!cueAgenda.length && !('actorId' in plan)) continue;
      const started = await deps.clock.beginAttempt(
        session.userId,
        worldId,
        { commandId, plannedFor: beatAt, actorId },
        !deps.automatic,
      );
      if (!started)
        throw new DomainError('VERSION_CONFLICT', '上次导演来信结果不确定，请在导演面板手动继续');
      let committedVersion: number;
      try {
        const committed = await resolveTurn(
          {
            worlds: deps.worlds,
            planner: {
              async propose(input) {
                const proposal = parseProposal(await deps.planner.propose(input));
                if (
                  proposal.effects.some(
                    (effect) =>
                      effect.type === 'media.requested' ||
                      (effect.type === 'message.received' &&
                        unsupportedReturnClaim(cueState, actorId, effect.text)),
                  )
                )
                  throw new DomainError(
                    'INVALID_PROPOSAL',
                    'Return messages require established outcomes and do not launch image jobs',
                  );
                return proposal;
              },
            },
            now: deps.now,
            storyNow: () => beatAt,
            newId: deps.newId,
            ...(deps.memories ? { memories: async () => recalled } : {}),
          },
          session,
          {
            id: commandId,
            origin: 'director',
            worldId,
            actorId,
            text: beatCue(cueState, actorId, cueAgenda, direction),
            expectedVersion: world.version,
          },
        );
        committedVersion = committed.state.version;
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
      delivered.push({ actorId, at: beatAt, version: committedVersion });
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
