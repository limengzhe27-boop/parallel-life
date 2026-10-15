import { createHash, randomUUID } from 'node:crypto';
import type { TextModel } from '../modules/ai/application/ports.ts';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type {
  AgentActionResult,
  AgentAttempt,
  AgentBlocker,
  AgentCandidate,
  ActorAgentState,
} from '../modules/world/domain/agent-runtime.ts';
import type { ActorNudge } from '../modules/world/application/agent-runtime-ports.ts';
import type { DirectorSnapshot } from '../modules/world/domain/director-runtime.ts';
import type { AdvanceResult } from '../modules/world/application/advance-world.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import { createAgentScheduleSources } from '../modules/world/application/agent-schedule-collectors.ts';
import { scheduleAgents } from '../modules/world/application/schedule-agents.ts';
import { runNpcAgent } from '../modules/world/application/run-agent.ts';
import { runDirectorAgent } from '../modules/world/application/run-director-agent.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../modules/world/infrastructure/director-agent-model.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldAwarenessRepository } from '../modules/world/infrastructure/world-awareness-repository.ts';
import { readPrivateAgentSnapshot } from '../modules/world/infrastructure/agent-snapshot-repository.ts';
import { NpcAgentModel } from '../modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';

export interface DirectorSnapshotReader {
  read(
    ownerId: string,
    input: {
      worldId: string;
      engineEpoch: number;
      worldVersion: number;
      candidates: AgentCandidate[];
      blockers: AgentBlocker[];
    },
  ): Promise<DirectorSnapshot>;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Stable semantic wake identity, independent of ambient ticks or unrelated messages. */
export function agentWakeCommandId(worldId: string, candidateId: string) {
  const h = hash(['npc-wake-v1', worldId, candidateId]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const quiet = (storyNow: string): AdvanceResult => ({
  storyNow,
  played: 0,
  folded: 0,
  summary: null,
  actors: [],
});

/** The only epoch2 advance composition. A null return alone authorizes the epoch1 entry. */
export function npcAgentAdvanceServices(
  db: PostgresDatabase,
  modelFactory: () => TextModel,
  directorSnapshots: DirectorSnapshotReader,
) {
  const worlds = new PostgresWorldRepository(db),
    attempts = new PostgresAgentRuntimeRepository(db),
    directors = new PostgresDirectorRuntimeRepository(db),
    awareness = new PostgresWorldAwarenessRepository(db);
  return {
    async advanceIfEnabled(ownerId: string, worldId: string): Promise<AdvanceResult | null> {
      const control = await db.transaction(
        ownerId,
        async (sql) =>
          (
            await sql.query(
              `SELECT COALESCE(c.engine_epoch,1) engine_epoch FROM parallel_life.worlds w
         LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
         WHERE w.id=$1 AND w.owner_id=$2`,
              [worldId, ownerId],
            )
          ).rows[0],
      );
      if (!control) throw new DomainError('NOT_FOUND');
      const engineEpoch = Number(control.engine_epoch);
      if (engineEpoch < 2) return null;
      const world = await worlds.get({ userId: ownerId }, worldId),
        now = new Date().toISOString();
      const clock = await new PostgresClockStore(db).read(ownerId, worldId, now);
      const storyAt = new Date(
        Math.max(Date.parse(world.time), Date.parse(projectStoryTime(clock, now))),
      ).toISOString();
      // A cheap check may be quiet. Do not invent folded events or spend a model call offline.
      if (clock.paused) return quiet(storyAt);
      const read = await db.transaction(ownerId, async (sql) => {
        const current = (
          await sql.query('SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            worldId,
            ownerId,
          ])
        ).rows[0];
        if (current?.version !== world.version) throw new DomainError('VERSION_CONFLICT');
        const states = (
          await sql.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
            [worldId, ownerId],
          )
        ).rows.map((r) => r.document as ActorAgentState);
        const actionIds = states.flatMap((s) => s.actions.map((a) => a.id));
        const results = (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND owner_id=$2 AND action_id=ANY($3::text[])',
            [worldId, ownerId, actionIds],
          )
        ).rows.map((r) => r.document as AgentActionResult);
        const prior = (
          await sql.query(
            `SELECT a.id,a.actor_id,a.command_id,a.status,r.document->>'channel' AS channel
               FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts r
               ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
               WHERE a.world_id=$1 AND a.owner_id=$2 ORDER BY a.created_at,a.id`,
            [worldId, ownerId],
          )
        ).rows.map((r) => ({
          id: String(r.id),
          actorId: String(r.actor_id),
          commandId: String(r.command_id),
          status: r.status as AgentAttempt['status'],
          channel: String(r.channel),
        }));
        return { states, results, prior };
      });
      if (
        read.states.length !== world.actors.length ||
        world.actors.some((a) => !read.states.some((s) => s.actorId === a.id))
      )
        throw Object.assign(Error('AGENT_PROJECTION_INCOMPLETE'), {
          code: 'AGENT_PROJECTION_INCOMPLETE',
        });
      // A received, protected result is not an unknown paid call. Resume it
      // before active-attempt blockers, otherwise its owner could never wake.
      const npcModel = new NpcAgentModel({
        complete: (...args) => modelFactory().complete(...args),
      });
      for (const pending of read.prior.filter(
        (a) => a.status === 'response_received' && a.channel === 'private',
      )) {
        const attempt = await attempts.lookup(ownerId, worldId, pending.commandId);
        if (!attempt || attempt.status !== 'response_received') continue;
        const state = read.states.find((a) => a.actorId === attempt.actorId);
        if (
          attempt.expectedWorldVersion !== world.version ||
          state?.revision !== attempt.expectedActorRevision
        ) {
          await attempts.mark(ownerId, attempt, 'stale_discarded');
          pending.status = 'stale_discarded';
          continue;
        }
        const result = await runNpcAgent(
          { attempts, model: npcModel, kernel: new PostgresNpcAgentKernel(db, worlds) },
          ownerId,
          attempt,
          null,
        );
        return presentedResult(result.eventId, attempt.actorId);
      }
      const actors = await Promise.all(
        read.states.map(async (state) => ({
          snapshot: (
            await readPrivateAgentSnapshot(db, ownerId, world, state.actorId, null, storyAt, state)
          ).snapshot,
          trustedResults: read.results.filter((r) => r.actorId === state.actorId),
          appointments: world.appointments.filter((a) => a.participantIds.includes(state.actorId)),
        })),
      );
      const sources = createAgentScheduleSources({
        worldId,
        engineEpoch,
        worldVersion: world.version,
        storyAt,
        actors,
        activeAttempts: read.prior,
        consumedCandidateIds: [],
      }).map((registration) => ({
        ...registration,
        source: {
          async collect(owner: string, id: string) {
            const collection = await registration.source.collect(owner, id);
            const candidates: AgentCandidate[] = [],
              blockers = [...collection.blockers];
            for (const candidate of collection.candidates) {
              const prior = read.prior.find(
                (a) => a.commandId === agentWakeCommandId(worldId, candidate.id),
              );
              if (prior?.status === 'committed') continue;
              // An invalid/stale result is a known failed attempt, not permission to buy a replacement.
              // The blocker names only this semantic candidate, preserving other actors and matters.
              const resourceId = `wake:${candidate.id}`;
              candidates.push({
                ...candidate,
                resourceIds: [...candidate.resourceIds, resourceId],
              });
              if (
                prior &&
                ['invalid_output', 'stale_discarded', 'cancelled_before_send'].includes(
                  prior.status,
                )
              )
                blockers.push({
                  scope: { kind: 'resource', resourceId },
                  reason: 'stale_projection',
                  sourceId: prior.id,
                  reconsiderOn: [],
                });
            }
            return { candidates, blockers };
          },
        },
      }));
      const coordinate = async (candidates: AgentCandidate[], blockers: AgentBlocker[]) => {
        const snapshot = await directorSnapshots.read(ownerId, {
          worldId,
          engineEpoch,
          worldVersion: world.version,
          candidates,
          blockers,
        });
        const commandId = agentWakeCommandId(
          worldId,
          hash(['director-v1', engineEpoch, world.version, candidates.map((c) => c.id).sort()]),
        );
        const previous = await directors.lookup(ownerId, worldId, commandId);
        if (previous?.status === 'committed' && previous.decisionId) {
          const saved = await directors.readDecision(ownerId, worldId, previous.decisionId);
          if (!saved) throw Object.assign(Error('DIRECTOR_RESULT_NOT_FOUND'), { code: 'UNKNOWN' });
          return saved;
        }
        return runDirectorAgent(
          {
            attempts: directors,
            model: new WorldDirectorAgentModel({
              complete: (...args) => modelFactory().complete(...args),
            }),
            parse: parseDirectorDecision,
          },
          ownerId,
          previous ?? {
            id: randomUUID(),
            worldId,
            commandId,
            engineEpoch,
            expectedWorldVersion: world.version,
            inputHash: directorSnapshotInputHash(snapshot),
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 240_000).toISOString(),
          },
          snapshot,
        );
      };
      const observed = await awareness.readDirectorObservedState(ownerId, worldId);
      let coordinated = false;
      const scheduled = await scheduleAgents(
        {
          sources,
          director: {
            async coordinate(input) {
              coordinated = true;
              const decision = await coordinate(input.candidates, input.blockers);
              return {
                candidateIds: decision.selectedCandidateIds,
                deferred: decision.deferred,
                guidance: decision.nudges,
                reason: decision.audit.reason,
              };
            },
          },
        },
        {
          ownerId,
          worldId,
          engineEpoch,
          worldVersion: world.version,
          storyAt,
          actorRevisions: Object.fromEntries(read.states.map((s) => [s.actorId, s.revision])),
          observations: [],
        },
      );
      // A material global change can warrant coordination even without competing candidates.
      // It does not require another director call after every ordinary chat, nor force a message.
      if (!coordinated && observed.needsEvaluation) {
        const decision = await coordinate(
          scheduled.snapshot.candidates.filter(
            (candidate) =>
              !scheduled.blocked.some((blocked) => blocked.candidate.id === candidate.id),
          ),
          scheduled.snapshot.blockers,
        );
        if (!decision.selectedCandidateIds.length) return quiet(storyAt);
        const chosen = decision.selectedCandidateIds[0];
        const selected = scheduled.snapshot.candidates.find((c) => c.id === chosen);
        if (!selected || scheduled.blocked.some((b) => b.candidate.id === chosen))
          throw Object.assign(Error('DIRECTOR_CANDIDATE_CONFLICT'), {
            code: 'DIRECTOR_CANDIDATE_CONFLICT',
          });
        return execute(
          selected,
          decision.nudges.filter((n) => n.candidateId === chosen),
        );
      }
      const selected = scheduled.selected[0];
      return selected ? execute(selected.candidate, selected.guidance) : quiet(storyAt);

      async function execute(
        candidate: AgentCandidate,
        guidance: ActorNudge[],
      ): Promise<AdvanceResult> {
        if (candidate.channel !== 'private' || candidate.threadId !== candidate.actorId)
          throw Object.assign(Error('UNSUPPORTED_AGENT_WAKE_CHANNEL'), {
            code: 'UNSUPPORTED_AGENT_WAKE_CHANNEL',
          });
        const actor = read.states.find((s) => s.actorId === candidate.actorId)!;
        const authorized = actors.find(
          (a) => a.snapshot.state.actorId === candidate.actorId,
        )!.snapshot;
        if (
          candidate.sourceIds.some((id) => !authorized.sources.some((s) => s.id === id)) ||
          guidance.some(
            (n) =>
              n.actorId !== candidate.actorId ||
              n.candidateId !== candidate.id ||
              n.basisSourceIds.some((id) => !candidate.sourceIds.includes(id)),
          )
        )
          throw Object.assign(Error('INPUT_SCOPE_FORBIDDEN'), { code: 'INPUT_SCOPE_FORBIDDEN' });
        const commandId = agentWakeCommandId(worldId, candidate.id);
        const text = JSON.stringify({
          type: 'npc_own_condition_ready',
          candidateId: candidate.id,
          source: candidate.source,
          actionId: candidate.actionId,
          basisSourceIds: candidate.sourceIds,
          nudges: guidance.map((n) => ({ kind: n.kind, basisSourceIds: n.basisSourceIds })),
        });
        const { receipt } = await attempts.accept(ownerId, {
          id: randomUUID(),
          worldId,
          commandId,
          inputHash: hash([worldId, candidate.actorId, candidate.id, text]),
          channel: 'private',
          threadId: candidate.actorId,
          recipientActorId: candidate.actorId,
          expectedWorldVersion: world.version,
          receivedAt: new Date().toISOString(),
          storyAt,
          origin: 'wake',
          text,
        });
        const prior = await attempts.lookup(ownerId, worldId, commandId);
        const snapshot =
          prior?.status === 'response_received'
            ? null
            : (
                await readPrivateAgentSnapshot(
                  db,
                  ownerId,
                  world,
                  candidate.actorId,
                  receipt,
                  storyAt,
                  actor,
                )
              ).snapshot;
        const result = await runNpcAgent(
          {
            attempts,
            model: npcModel,
            kernel: new PostgresNpcAgentKernel(db, worlds),
          },
          ownerId,
          prior ?? {
            id: randomUUID(),
            worldId,
            actorId: candidate.actorId,
            commandId,
            inputReceiptId: receipt.id,
            engineEpoch,
            expectedWorldVersion: world.version,
            expectedActorRevision: actor.revision,
            inputHash: receipt.inputHash,
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 240_000).toISOString(),
          },
          snapshot,
        );
        // Real quiet/plan outcomes still execute and persist, but never pretend a new message exists.
        return presentedResult(result.eventId, candidate.actorId);
      }
      async function presentedResult(eventId: string, actorId: string): Promise<AdvanceResult> {
        const presented = await db.transaction(ownerId, async (sql) =>
          Number(
            (
              await sql.query(
                "SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND document->>'sourceEventId'=$4",
                [worldId, ownerId, actorId, eventId],
              )
            ).rows[0].n,
          ),
        );
        return {
          ...quiet(storyAt),
          played: presented ? 1 : 0,
          actors: presented ? [actorId] : [],
        };
      }
    },
  };
}
