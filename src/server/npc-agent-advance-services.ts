import { readAgentObservationScheduleCandidatesInTransaction } from '../modules/world/infrastructure/agent-observation-schedule-read.ts';
import { independentObservationWork } from '../modules/world/domain/independent-observation-work.ts';
import { agentWakeRecovery } from '../modules/world/domain/agent-wake-recovery.ts';
import type { AdvanceWorkRef } from '../modules/world/domain/advance-operation.ts';
import {
  readOwnAgendaReviewWorkInTransaction,
  ownAgendaReviewInputText,
  DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
  type OwnAgendaRuntimeConfig,
  type OwnAgendaReviewWork,
} from '../modules/world/infrastructure/own-agenda-review-authority.ts';
import { admitDirectorCandidates } from '../modules/world/application/director-candidate-admission.ts';
import { canConsiderAuthoredEvent } from '../modules/world/domain/director-runtime.ts';
import {
  claimAgentAdvanceBatch,
  releaseAgentAdvanceBatch,
} from '../modules/world/infrastructure/agent-advance-batch-lease.ts';
import {
  ActorAdvanceBlocked,
  AgentAdvanceDeferred,
  actorAdvanceFailureScope,
  agentAdvanceBatchPolicy,
  runAgentAdvanceBatch,
  type AgentAdvanceBatchContext,
  type AgentAdvanceBatchPolicy,
} from '../modules/world/application/agent-advance-batch.ts';
import {
  agendaInitializeInputText,
  readAgendaInitializeGrantsInTransaction,
} from '../modules/world/infrastructure/actor-agenda-initialization-repository.ts';
import { requireDirectorTrialRetrySource } from '../modules/world/infrastructure/director-trial-recovery.ts';
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
import type {
  DirectorSnapshot,
  DirectorDecision,
} from '../modules/world/domain/director-runtime.ts';
import type { AdvanceResult } from '../modules/world/application/advance-world.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import { createAgentScheduleSources } from '../modules/world/application/agent-schedule-collectors.ts';
import {
  scheduleAgents,
  agentScopeBlocks,
  type RegisteredAgentCandidateSource,
} from '../modules/world/application/schedule-agents.ts';
import { runNpcAgent } from '../modules/world/application/run-agent.ts';
import { commitDueAgentArrival } from '../modules/world/infrastructure/agent-arrival-continuation.ts';
import {
  runDirectorAgent,
  recoverDirectorAgent,
} from '../modules/world/application/run-director-agent.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
  directorCoordinationFrameHash,
} from '../modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../modules/world/infrastructure/director-agent-model.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../modules/world/infrastructure/clock-repository.ts';
import { PostgresPlanReviewRepository } from '../modules/world/infrastructure/plan-review-repository.ts';
import { PostgresDirectorReviewRepository } from '../modules/world/infrastructure/director-review-repository.ts';
import {
  directorReviewDue,
  emptyDirectorRecoveryDue,
  emptyDirectorReviewDue,
} from '../modules/world/domain/director-review.ts';
import { PostgresWorldAwarenessRepository } from '../modules/world/infrastructure/world-awareness-repository.ts';
import { readPrivateAgentSnapshot } from '../modules/world/infrastructure/agent-snapshot-repository.ts';
import { NpcAgentModel } from '../modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';
import { readDirectorNarrativeWakeInTransaction } from '../modules/world/infrastructure/narrative-wake-repository.ts';
import { dispatchPendingAgentEpisode } from './npc-agent-episode-dispatch.ts';
import type { PublicOpeningStatus } from '../contracts/publication-opening.ts';
import type { PublicWorldStory } from '../contracts/world-story.ts';
import { readAgentPhoneEntryProbe } from '../modules/world/infrastructure/agent-phone-entry-probe.ts';

/** New-engine public reads never reconcile the legacy author-progress store. */
export async function readNpcAgentStoryProgressIfEnabled(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
): Promise<PublicWorldStory | null> {
  return db.transaction(ownerId, async (sql) => {
    const row = (
      await sql.query(
        `SELECT COALESCE(c.engine_epoch,1) epoch FROM parallel_life.worlds w
      LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
      WHERE w.id=$1 AND w.owner_id=$2`,
        [worldId, ownerId],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    if (Number(row.epoch) < 2) return null;
    const source = (
      await sql.query('SELECT parallel_life.publication_story_source($1) source', [worldId])
    ).rows[0]?.source;
    // The shared-episode store currently admits proposed drafts only. Those
    // are never projected as presented events or completed player choices.
    return {
      runtime: 'agents',
      currentStageKeys: [],
      totalNodes: source?.nodes?.length ?? 0,
      presented: [],
      pending: null,
    };
  });
}

/** Read-only legacy-envelope status; no old plan/batch initialization in an Agent world. */
export async function readNpcAgentOpeningStatusIfEnabled(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
): Promise<PublicOpeningStatus | null> {
  return db.transaction(ownerId, async (sql) => {
    const row = (
      await sql.query(
        `SELECT w.state,w.version,COALESCE(c.engine_epoch,1) epoch FROM parallel_life.worlds w
      LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
      WHERE w.id=$1 AND w.owner_id=$2 FOR SHARE OF w`,
        [worldId, ownerId],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    if (Number(row.epoch) < 2) return null;
    const source = (
      await sql.query('SELECT parallel_life.publication_story_source($1) source', [worldId])
    ).rows[0]?.source;
    // Until authored opening candidates are connected, keep their pending state
    // honest. Runtime metadata bypasses only the old delivery engine, not the story.
    return {
      runtime: 'agents',
      phase: source?.openingEventKey ? 'unplanned' : 'none',
      total: 0,
      delivered: 0,
      retryable: false,
      continuation: await readAgentPhoneEntryProbe(sql, ownerId, {
        worldId,
        engineEpoch: Number(row.epoch),
        worldVersion: row.version,
        storyAt: row.state.time,
      }),
    };
  });
}

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
  batchOptions: Partial<AgentAdvanceBatchPolicy> = {},
  agendaConfig: OwnAgendaRuntimeConfig = DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
) {
  const worlds = new PostgresWorldRepository(db),
    attempts = new PostgresAgentRuntimeRepository(db, agendaConfig),
    directors = new PostgresDirectorRuntimeRepository(db),
    planReviewRepository = new PostgresPlanReviewRepository(db),
    directorReviewRepository = new PostgresDirectorReviewRepository(db),
    awareness = new PostgresWorldAwarenessRepository(db);
  const policy = agentAdvanceBatchPolicy(batchOptions);
  const service = {
    async advanceOne(
      ownerId: string,
      worldId: string,
      retryDirectorAttemptId?: string,
      batch?: AgentAdvanceBatchContext,
      options?: { forceDirectorReview?: boolean },
    ): Promise<AdvanceResult | null> {
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
      if (engineEpoch < 2) {
        if (retryDirectorAttemptId) throw new DomainError('INVALID_COMMAND');
        return null;
      }
      const retryCommandId = retryDirectorAttemptId
        ? await requireDirectorTrialRetrySource(
            db,
            ownerId,
            worldId,
            retryDirectorAttemptId,
            engineEpoch,
          )
        : null;
      if (retryCommandId) {
        const previous = await directors.lookup(ownerId, worldId, retryCommandId);
        if (previous?.status === 'committed')
          return quiet((await worlds.get({ userId: ownerId }, worldId)).time);
        if (
          previous &&
          ['invalid_output', 'stale_discarded', 'unknown_after_send', 'request_sent'].includes(
            previous.status,
          )
        )
          throw new DomainError(
            'INVALID_COMMAND',
            '请先核对这次重新生成的结果，不能再次发送同一请求。',
          );
      }
      const world = await worlds.get({ userId: ownerId }, worldId),
        now = new Date().toISOString();
      const clock = await new PostgresClockStore(db).read(ownerId, worldId, now);
      const storyAt = new Date(
        Math.max(Date.parse(world.time), Date.parse(projectStoryTime(clock, now))),
      ).toISOString();
      // A cheap check may be quiet. Do not invent folded events or spend a model call offline.
      if (clock.paused) {
        if (retryCommandId) throw new DomainError('INVALID_COMMAND', '请先开始试演。');
        return quiet(storyAt);
      }
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
            `SELECT a.id,a.actor_id,a.command_id,a.status,a.sent_at,a.response_hash,(a.response IS NOT NULL) AS has_response,(a.event_id IS NOT NULL) AS has_event,a.expected_world_version,a.expected_actor_revision,a.engine_epoch,r.document->>'channel' AS channel,r.document->>'origin' AS origin,r.document->>'text' AS input_text
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
          paid: r.sent_at !== null || r.response_hash !== null,
          sent: r.sent_at !== null,
          hasResponse: r.has_response || r.response_hash !== null,
          hasEvent: r.has_event,
          expectedWorldVersion: Number(r.expected_world_version),
          expectedActorRevision: Number(r.expected_actor_revision),
          engineEpoch: Number(r.engine_epoch),
          wakeCandidateId: (() => {
            if (r.origin !== 'wake') return undefined;
            try {
              const input = JSON.parse(r.input_text);
              return input.type === 'npc_own_condition_ready' &&
                typeof input.candidateId === 'string'
                ? input.candidateId
                : undefined;
            } catch {
              return undefined;
            }
          })(),
        }));
        const agendaInitializeGrants = await readAgendaInitializeGrantsInTransaction(sql, ownerId, {
          worldId,
          engineEpoch,
          worldVersion: world.version,
        });
        return { states, results, prior, agendaInitializeGrants };
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
        complete: (...args) => {
          batch?.modelStarted();
          return modelFactory().complete(...args);
        },
      });
      for (const pending of (retryCommandId ? [] : read.prior).filter(
        (a) =>
          a.status === 'response_received' &&
          a.channel === 'private' &&
          !batch?.handledActorIds.has(a.actorId),
      )) {
        const attempt = await attempts.lookup(ownerId, worldId, pending.commandId);
        if (!attempt || attempt.status !== 'response_received') continue;
        // Reuse the original paid response and let the unified commit admission
        // distinguish unrelated appends from changed actor/action dependencies.
        try {
          await batch?.trackWork?.({ kind: 'npc', commandId: attempt.commandId });
          batch?.actorStarted(attempt.actorId);
          const result = await runNpcAgent(
            { attempts, model: npcModel, kernel: new PostgresNpcAgentKernel(db, worlds) },
            ownerId,
            attempt,
            null,
          );
          return presentedResult(
            result.eventId,
            attempt.actorId,
            result.state.projectedWorldVersion,
          );
        } catch (error) {
          const recovered = await attempts.lookup(ownerId, worldId, pending.commandId);
          if (recovered?.id === attempt.id && recovered.status === 'stale_discarded') {
            pending.status = 'stale_discarded';
            continue;
          }
          // Retain a received paid result until the business focus permits presentation.
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            ['EPISODE_DELIVERY_DEFERRED', 'NPC_DELIVERY_DEFERRED'].includes(String(error.code))
          )
            continue;
          throw error;
        }
      }
      // A protected private response deferred by business attention still owns
      // its exact world read frame. Do not discard that paid response by committing
      // unrelated work before source/read-set rebasing is available.
      if (read.prior.some((a) => a.channel === 'private' && a.status === 'response_received'))
        return quiet(storyAt);
      // Physical continuation belongs to the same execution boundary, never to a new paid NPC turn.
      // Protected received replies are recovered first; a completed arrival refreshes the real phone.
      const arrival = retryCommandId
        ? { status: 'none' as const }
        : await commitDueAgentArrival(db, ownerId, {
            worldId,
            engineEpoch,
            expectedWorldVersion: world.version,
          });
      if (arrival.status === 'arrived')
        return { ...quiet(arrival.storyAt), changed: true, worldVersion: arrival.worldVersion };
      const afterContinuation = await new PostgresClockStore(db).read(ownerId, worldId);
      if (afterContinuation.paused) return quiet(afterContinuation.storyNow);
      // A concurrently superseded *known* Director proposal is not a reason to
      // buy it again or abandon the opening. Revalidate its future handoff with
      // current author eligibility before fallback empty-agenda work.
      if (!retryCommandId) {
        const hasKnown = await db.transaction(
          ownerId,
          async (sql) =>
            !!(
              await sql.query(
                `SELECT 1 FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2
             AND engine_epoch=$3 AND status IN ('stale_discarded','response_received')
             AND response_hash IS NOT NULL LIMIT 1`,
                [worldId, ownerId, engineEpoch],
              )
            ).rowCount,
        );
        if (hasKnown) {
          const current = await directorSnapshots.read(ownerId, {
            worldId,
            engineEpoch,
            worldVersion: world.version,
            candidates: [],
            blockers: [],
          });
          const recovered = await directors.revalidateKnownHandoff(ownerId, current);
          if (recovered) {
            // The durable arrangement is now available to every participant.
            // The original dispatcher still asks each NPC to decide for itself.
            const result = await dispatchPendingAgentEpisode(
              db,
              npcModel,
              ownerId,
              world,
              engineEpoch,
              storyAt,
              batch,
            );
            return result ?? { ...quiet(storyAt), changed: true, worldVersion: world.version };
          }
        }
      }
      const delivery = retryCommandId
        ? null
        : await dispatchPendingAgentEpisode(
            db,
            npcModel,
            ownerId,
            world,
            engineEpoch,
            storyAt,
            batch,
          );
      if (delivery) return delivery;
      let deferredInitializationCandidateIds: string[] = [];
      let directorDeliveryDeferred = false;
      const coordinate = async (
        candidates: AgentCandidate[],
        blockers: AgentBlocker[],
        admission: 'normal' | 'wake' | 'recovery' = 'normal',
        freshCommand?: string,
      ): Promise<DirectorDecision | null> => {
        // A batch can dispatch several participants from its saved arrangement.
        // Their own commits do not justify purchasing another global arrangement
        // inside this same request; new coordination remains eligible next check.
        if (batch && !batch.beginDirectorAssessment()) return null;
        // Admit a bounded work slot before expensive context preparation. The slot
        // is released on every no-call/recovery/failure path; later steps cannot
        // starve this already admitted first assessment by consuming its read time.
        const reservation = batch?.reserveModel();
        try {
          let snapshot = await directorSnapshots.read(ownerId, {
            worldId,
            engineEpoch,
            worldVersion: world.version,
            candidates,
            blockers,
          });
          const openingKey = snapshot.authoredMaterials?.openingEventKey;
          const admissionScope = admitDirectorCandidates({
            current: snapshot,
            pending: await directors.readPendingFrame(ownerId, worldId),
            qualifiedOpeningAtBootstrap:
              snapshot.evaluationCause?.kind === 'bootstrap' &&
              !!openingKey &&
              canConsiderAuthoredEvent(snapshot, openingKey),
            explicitRetry: !!retryCommandId,
          });
          deferredInitializationCandidateIds = admissionScope.deferredInitializationIds;
          if (
            deferredInitializationCandidateIds.length ||
            admissionScope.candidates.some((c, i) => c.id !== snapshot.candidates[i]?.id)
          )
            snapshot = await directorSnapshots.read(ownerId, {
              worldId,
              engineEpoch,
              worldVersion: world.version,
              candidates: admissionScope.candidates,
              blockers,
            });
          if (retryCommandId && (snapshot.conversationWithoutTarget || snapshot.focus.length))
            throw new DomainError('INVALID_COMMAND', '请先结束当前交谈，再重新编排。');
          const pendingFrame = await directors.readPendingFrame(ownerId, worldId);
          if (pendingFrame) {
            const pendingCommand = await db.transaction(
              ownerId,
              async (sql) =>
                (
                  await sql.query(
                    `SELECT command_id FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send') ORDER BY created_at LIMIT 1`,
                    [worldId, ownerId],
                  )
                ).rows[0]?.command_id,
            );
            if (pendingCommand)
              await batch?.trackWork?.({ kind: 'director', commandId: String(pendingCommand) });
          }
          const recovery = await recoverDirectorAgent(
            { attempts: directors, parse: parseDirectorDecision },
            ownerId,
            snapshot,
          );
          if (recovery.status === 'recovered') return recovery.decision;
          if (recovery.status === 'blocked')
            throw Object.assign(Error('DIRECTOR_ATTEMPT_PENDING'), {
              code: recovery.attempt.status === 'unknown_after_send' ? 'UNKNOWN' : 'BUSY',
              directorCoordinationPending: true,
            });
          if (recovery.status === 'stale' && recovery.reason === 'lease_expired')
            throw Object.assign(Error('DIRECTOR_KNOWN_RESULT_EXPIRED'), {
              code: 'VERSION_CONFLICT',
              directorCoordinationPending: true,
            });
          // Recovery may consume the only reason to enter. Never turn an expired or
          // vanished semantic wake into a fresh paid global decision.
          if (
            !retryCommandId &&
            (admission === 'recovery' || (admission === 'wake' && !snapshot.evaluationCause))
          )
            return null;
          let identity = snapshot.evaluationCause?.id ?? directorCoordinationFrameHash(snapshot);
          if (!snapshot.evaluationCause) {
            const unsent = await directors.readUnsentFrameAttempts(ownerId, snapshot);
            if (unsent.length) identity = hash(['director-unsent-frame-v1', identity, unsent]);
          }
          const commandId =
            retryCommandId ??
            agentWakeCommandId(
              worldId,
              freshCommand ? `${identity}:fresh:${freshCommand}` : identity,
            );
          await batch?.trackWork?.({ kind: 'director', commandId });
          const previous = await directors.lookup(ownerId, worldId, commandId);
          // A durable known-invalid director result is not retry permission. Its
          // own coordination remains fenced; unrelated preselected work may continue.
          if (previous?.status === 'invalid_output')
            throw Object.assign(Error('DIRECTOR_KNOWN_INVALID_RESULT'), {
              code: 'INVALID_STATE',
              directorKnownInvalid: true,
            });
          if (previous?.status === 'committed' && previous.decisionId) {
            const saved = await directors.readDecision(ownerId, worldId, previous.decisionId);
            if (!saved)
              throw Object.assign(Error('DIRECTOR_RESULT_NOT_FOUND'), { code: 'UNKNOWN' });
            return saved;
          }
          const recovering = previous?.status === 'response_received';
          if (batch && !recovering && !reservation) return null;
          return await runDirectorAgent(
            {
              attempts: directors,
              model: new WorldDirectorAgentModel({
                complete: (...args) => {
                  batch?.modelStarted();
                  return modelFactory().complete(...args);
                },
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
        } finally {
          reservation?.release();
        }
      };
      const wake = await db.transaction(ownerId, (sql) =>
        readDirectorNarrativeWakeInTransaction(sql, ownerId, {
          worldId,
          engineEpoch,
          worldVersion: world.version,
          storyAt,
        }),
      );
      // Establish the global opening before hydrating every character's private context.
      // This uses the same Director authority, payment fence and commit path.
      if (
        !retryCommandId &&
        !wake.hasPendingDirector &&
        (wake.cause?.kind === 'bootstrap' || wake.cause?.kind === 'opening_context')
      ) {
        const decision = await coordinate([], [], 'wake');
        if (
          decision?.openingContext?.disposition === 'confirm' &&
          decision.openingContext.premises.length
        )
          return { ...quiet(storyAt), changed: true, worldVersion: world.version + 1 };
        if (decision?.opportunities.length)
          return (
            (await dispatchPendingAgentEpisode(
              db,
              npcModel,
              ownerId,
              world,
              engineEpoch,
              storyAt,
              batch,
            )) ?? quiet(storyAt)
          );
      }
      const pendingObservations = await db.transaction(ownerId, (sql) =>
        readAgentObservationScheduleCandidatesInTransaction(
          sql,
          ownerId,
          { worldId, engineEpoch, worldVersion: world.version, storyAt },
          [...(batch?.handledActorIds ?? [])],
        ),
      );
      const independentPacket = pendingObservations.find(
        (candidate) =>
          !candidate.requiresCoordination &&
          candidate.channel === 'private' &&
          candidate.threadId === candidate.actorId &&
          candidate.resourceIds.length === 0,
      );
      // This selects whose context to load, not whose action is approved. The
      // original collectors, blockers, source checks and kernel still decide.
      const statesToRead =
        independentPacket && !wake.hasPendingDirector
          ? read.states.filter((state) => state.actorId === independentPacket.actorId)
          : read.states;
      const actors = await Promise.all(
        statesToRead.map(async (state) => ({
          snapshot: (
            await readPrivateAgentSnapshot(db, ownerId, world, state.actorId, null, storyAt, state)
          ).snapshot,
          trustedResults: read.results.filter((r) => r.actorId === state.actorId),
          appointments: world.appointments.filter((a) => a.participantIds.includes(state.actorId)),
        })),
      );
      const planReviewStates = new Map(
        (
          await Promise.all(
            actors.map(async (actor) => {
              const planIds = actor.snapshot.state.plans
                .filter(
                  (plan) =>
                    !plan.nextActionId &&
                    !plan.triggers.length &&
                    ['active', 'waiting', 'blocked'].includes(plan.status),
                )
                .map((plan) => plan.id);
              return planReviewRepository.read(
                ownerId,
                worldId,
                actor.snapshot.state.actorId,
                planIds,
              );
            }),
          )
        ).flatMap((reviews) => [...reviews]),
      );
      const agendaReviews = new Map<string, OwnAgendaReviewWork>();
      const candidateCommand = (candidate: AgentCandidate) => {
        const agenda = agendaReviews.get(candidate.id)?.commandId;
        if (agenda) return { commandId: agenda };
        const base = agentWakeCommandId(worldId, candidate.id);
        const prior = [...read.prior]
          .reverse()
          .find(
            (a) =>
              a.actorId === candidate.actorId &&
              (a.commandId === base || a.wakeCandidateId === candidate.id),
          );
        if (!prior) return { commandId: base };
        // Grant-owned initialization/review keeps its dedicated authority and identity.
        if (prior.wakeCandidateId !== candidate.id) return { commandId: prior.commandId };
        const actor = read.states.find((a) => a.actorId === candidate.actorId);
        if (!actor) throw new DomainError('INVALID_COMMAND');
        const recovery = agentWakeRecovery(prior, {
          worldVersion: world.version,
          actorRevision: actor.revision,
          engineEpoch,
        });
        return recovery.kind === 'keep'
          ? { commandId: recovery.commandId }
          : {
              commandId: agentWakeCommandId(
                worldId,
                hash([candidate.actorId, candidate.id, recovery.identity]),
              ),
              zeroSendRecoveryOfAttemptId: recovery.previousAttemptId,
            };
      };
      const commandForCandidate = (candidate: AgentCandidate) =>
        candidateCommand(candidate).commandId;
      // A committed Director opportunity creates one pending episode request. Deliver
      // it before a new review so an interrupted manual/HTTP request cannot orphan it.
      if (!retryCommandId) {
        const pendingEpisode = await dispatchPendingAgentEpisode(
          db,
          npcModel,
          ownerId,
          world,
          engineEpoch,
          storyAt,
          batch,
        );
        if (pendingEpisode) return pendingEpisode;
      }
      const registrations = createAgentScheduleSources({
        worldId,
        engineEpoch,
        worldVersion: world.version,
        storyAt,
        actors,
        activeAttempts: read.prior,
        consumedCandidateIds: [],
        agendaInitializeGrants: read.agendaInitializeGrants,
        planReviews: planReviewStates,
        lastAssistantAtByActor: Object.fromEntries(
          world.messages
            .filter((message) => message.role === 'assistant' && message.actorId)
            .map((message) => [message.actorId!, message.at]),
        ),
      });
      const originalCandidates = new Map<string, AgentCandidate>();
      const wrap = (
        registration: RegisteredAgentCandidateSource,
      ): RegisteredAgentCandidateSource => ({
        ...registration,
        source: {
          async collect(owner: string, id: string) {
            const collection = await registration.source.collect(owner, id);
            const candidates: AgentCandidate[] = [],
              blockers = [...collection.blockers];
            for (const candidate of collection.candidates) {
              if (batch?.handledActorIds.has(candidate.actorId)) continue;
              const prior = read.prior.find((a) => a.commandId === commandForCandidate(candidate));
              if (prior?.status === 'committed') continue;
              // An invalid/stale result is a known failed attempt, not permission to buy a replacement.
              // The blocker names only this semantic candidate, preserving other actors and matters.
              const resourceId = `wake:${candidate.id}`;
              originalCandidates.set(candidate.id, candidate);
              candidates.push({
                ...candidate,
                resourceIds: [...candidate.resourceIds, resourceId],
              });
              if (
                prior &&
                (['invalid_output', 'stale_discarded'].includes(prior.status) ||
                  (prior.status === 'cancelled_before_send' && prior.paid))
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
      });
      const sources = registrations.map(wrap);
      const existingCollections = await Promise.all(
        sources.map((s) => s.source.collect(ownerId, worldId)),
      );
      const allBlockers = existingCollections.flatMap((c) => c.blockers);
      const priorityActors = new Set(
        existingCollections
          .flatMap((c) => c.candidates)
          .filter((c) => !allBlockers.some((b) => agentScopeBlocks(b.scope, c)))
          .map((c) => c.actorId),
      );
      for (const actor of actors) {
        const actorId = actor.snapshot.state.actorId;
        if (
          batch?.handledActorIds.has(actorId) ||
          actor.snapshot.state.revision === 0 ||
          priorityActors.has(actorId)
        )
          continue;
        const work = await db.transaction(ownerId, (sql) =>
          readOwnAgendaReviewWorkInTransaction(sql, ownerId, {
            worldId,
            actorId,
            worldVersion: world.version,
            config: agendaConfig,
            hasPriorityWork: priorityActors.has(actorId),
            snapshot: actor.snapshot,
          }),
        );
        if (!work) continue;
        agendaReviews.set(work.candidate.id, work);
        sources.push(
          wrap({
            id: `agenda_review:${actorId}`,
            failureScope: { kind: 'actor', actorId },
            source: {
              async collect() {
                return { candidates: [work.candidate], blockers: [] };
              },
            },
          }),
        );
      }
      const observed = await awareness.readDirectorObservedState(ownerId, worldId);
      // A response still being produced or ready to commit owns its read frame.
      // A terminal unknown without a saved response fences that Director call,
      // not every independently qualified actor in the world.
      const directorFrameProtected =
        wake.hasPendingDirector &&
        (await db.transaction(
          ownerId,
          async (sql) =>
            !!(
              await sql.query(
                `SELECT 1 FROM parallel_life.director_runtime_attempts
           WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3
           AND (status IN ('reserved','request_sent','response_received')
             OR (status='unknown_after_send' AND response IS NOT NULL)) LIMIT 1`,
                [worldId, ownerId, engineEpoch],
              )
            ).rowCount,
        ));
      const independentActorWork = (eligible: readonly AgentCandidate[]) =>
        !retryCommandId && !directorFrameProtected
          ? (eligible.find(
              (candidate) =>
                !candidate.requiresCoordination &&
                candidate.channel === 'private' &&
                candidate.threadId === candidate.actorId &&
                candidate.resourceIds.length === 1 &&
                candidate.resourceIds[0] === `wake:${candidate.id}`,
            ) ?? null)
          : null;
      // Only the unique per-candidate execution fence may be stripped for this shape check.
      // Real shared resources, original eligibility/blockers and the kernel remain authoritative.
      const independentObservation = (eligible: readonly AgentCandidate[]) => {
        if (retryCommandId || directorFrameProtected) return null;
        const original = independentObservationWork(
          eligible.flatMap((candidate) => {
            const raw = originalCandidates.get(candidate.id);
            return raw &&
              candidate.resourceIds.length === 1 &&
              candidate.resourceIds[0] === `wake:${candidate.id}`
              ? [raw]
              : [];
          }),
        );
        return original ? eligible.find((candidate) => candidate.id === original.id)! : null;
      };
      let coordinationFailure: unknown;
      let coordinated = false,
        coordinatedOpportunity = false,
        contextConfirmed = false;
      const scheduled = await scheduleAgents(
        {
          sources,
          director: {
            async coordinate(input) {
              coordinated = true;
              const ownObservation = independentObservation(input.candidates);
              if (ownObservation)
                return {
                  candidateIds: [ownObservation.id],
                  deferred: input.candidates
                    .filter((c) => c.id !== ownObservation.id)
                    .map((c) => ({
                      candidateId: c.id,
                      reason: '先由人物评估本人尚未处理的合法观察，其他候选保留。',
                    })),
                  guidance: [],
                  reason: '无共享资源的本人收件由本人独立决策，不额外购买全局审批。',
                };
              // Continue original eligible actor work even while a different
              // Director call is unknown. Never rerun that paid call or borrow its intent.
              const independent = wake.hasPendingDirector
                ? independentActorWork(input.candidates)
                : null;
              if (independent)
                return {
                  candidateIds: [independent.id],
                  guidance: [],
                  deferred: input.candidates
                    .filter((c) => c.id !== independent.id)
                    .map((c) => ({
                      candidateId: c.id,
                      reason: '其他人物工作保留，后续按新快照核对。',
                    })),
                  reason: '独立人物工作不依赖尚未确认的导演结果。',
                };
              let decision: DirectorDecision | null;
              try {
                decision = await coordinate(input.candidates, input.blockers);
              } catch (error) {
                if ((error as { code?: unknown })?.code !== 'DIRECTOR_DELIVERY_DEFERRED') {
                  coordinationFailure = error;
                  throw error;
                }
                directorDeliveryDeferred = true;
                batch?.yieldAfterStep();
                return {
                  candidateIds: [],
                  deferred: input.candidates.map((candidate) => ({
                    candidateId: candidate.id,
                    reason: '当前互动已暂缓，等待恢复后重新核对。',
                  })),
                  guidance: [],
                  reason: '当前世界或互动已暂缓。',
                };
              }
              if (!decision)
                return {
                  candidateIds: [],
                  deferred: input.candidates.map((candidate) => ({
                    candidateId: candidate.id,
                    reason: '本批已完成全局协调，下一次检查继续核对。',
                  })),
                  guidance: [],
                  reason: '批次协调边界，未消费人物或事件。',
                };
              contextConfirmed =
                decision.openingContext?.disposition === 'confirm' &&
                !!decision.openingContext.premises.length;
              coordinatedOpportunity = decision.opportunities.length > 0;
              return {
                candidateIds: decision.selectedCandidateIds,
                deferred: [
                  ...decision.deferred,
                  ...deferredInitializationCandidateIds.map((candidateId) => ({
                    candidateId,
                    reason: '先核对合格作者开场，空议程初始化保留为后备。',
                  })),
                ],
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
          selectAllIndependent: true,
        },
      );
      if (!scheduled.selected.length)
        console.info(
          JSON.stringify({
            scope: 'advance-schedule-quiet',
            worldId,
            reason: scheduled.reason,
            candidates: scheduled.snapshot.candidates.map((candidate) => ({
              id: candidate.id,
              actorId: candidate.actorId,
              source: candidate.source,
            })),
            blocked: scheduled.blocked.map((item) => ({
              id: item.candidate.id,
              actorId: item.candidate.actorId,
              blockers: item.blockers.map((blocker) => blocker.reason),
            })),
            failures: scheduled.sourceFailures,
          }),
        );
      const directorReview = await directorReviewRepository.read(ownerId, worldId);
      // Director cadence is real-time metadata; story time can lag real time and must not freeze it.
      const directorNow = new Date().toISOString();
      const forceDirectorReview = options?.forceDirectorReview === true;
      const forceNonce = forceDirectorReview ? randomUUID() : undefined;
      const directorDue = forceDirectorReview || directorReviewDue(directorReview, directorNow);
      // An explicit owner review must reach the Director even when a local actor
      // candidate exists; the Director can still decline or defer that opportunity.
      const emptyDirectorDue = forceDirectorReview
        ? !retryCommandId && !batch?.handledActorIds.size
        : emptyDirectorReviewDue({
            state: directorReview,
            storyAt: directorNow,
            selectedCount: scheduled.selected.length,
            retry: !!retryCommandId,
            handledActorCount: batch?.handledActorIds.size ?? 0,
          });
      const emptyDirectorRecovery =
        !emptyDirectorDue &&
        emptyDirectorRecoveryDue({
          state: directorReview,
          selectedCount: scheduled.selected.length,
          retry: !!retryCommandId,
          handledActorCount: batch?.handledActorIds.size ?? 0,
        });
      if (!scheduled.selected.length) {
        console.info(
          JSON.stringify({
            scope: 'director-review-state',
            worldId,
            lastStatus: directorReview?.lastStatus ?? null,
            lastReviewedAt: directorReview?.lastReviewedAt ?? null,
            nextReviewAt: directorReview?.nextReviewAt ?? null,
            due: directorDue,
            recovery: emptyDirectorRecovery,
            scheduledReason: scheduled.reason,
          }),
        );
      }
      // Selection may fail closed, but infrastructure failure is not a quiet decision.
      // Preserve the original cause on the operation so recovery can query it.
      if (
        scheduled.reason === 'coordination_failed' &&
        coordinationFailure &&
        !(coordinationFailure as { directorCoordinationPending?: boolean })
          .directorCoordinationPending &&
        !(coordinationFailure as { directorKnownInvalid?: boolean }).directorKnownInvalid
      )
        throw coordinationFailure;
      // The paid Director response still owns this read frame. Unrelated fallback
      // writes would invalidate it before attention permits recovery.
      if (directorDeliveryDeferred) return quiet(storyAt);
      if (contextConfirmed) {
        // Return the changed frame; the original bounded batch reloads before any NPC runs.
        return { ...quiet(storyAt), changed: true, worldVersion: world.version + 1 };
      }
      if (coordinatedOpportunity)
        return (
          (await dispatchPendingAgentEpisode(
            db,
            npcModel,
            ownerId,
            world,
            engineEpoch,
            storyAt,
            batch,
          )) ?? quiet(storyAt)
        );
      const ownObservation = independentObservation(scheduled.selected.map((s) => s.candidate));
      if (ownObservation) return execute(ownObservation, []);
      // A material global change can warrant coordination even without competing candidates.
      // It does not require another director call after every ordinary chat, nor force a message.
      if (
        !coordinated &&
        (retryCommandId ||
          emptyDirectorDue ||
          emptyDirectorRecovery ||
          wake.cause ||
          (wake.hasPendingDirector && !wake.deferred) ||
          (scheduled.selected.length > 0 && observed.needsEvaluation))
      ) {
        let decision: DirectorDecision | null;
        try {
          decision = await coordinate(
            scheduled.snapshot.candidates.filter(
              (candidate) =>
                !scheduled.blocked.some((blocked) => blocked.candidate.id === candidate.id),
            ),
            scheduled.snapshot.blockers,
            emptyDirectorRecovery
              ? 'recovery'
              : emptyDirectorDue || observed.needsEvaluation
                ? 'normal'
                : wake.cause
                  ? 'wake'
                  : 'recovery',
            forceNonce ??
              (directorReview?.lastStatus === 'stale_discarded'
                ? directorReview.lastReviewedAt
                : undefined),
          );
        } catch (error) {
          if ((error as { code?: unknown })?.code === 'DIRECTOR_DELIVERY_DEFERRED') {
            batch?.yieldAfterStep();
            return quiet(storyAt);
          }
          // A director has only proposed, never executed, changes. Its pending
          // paid result fences further coordination, not a separately qualified
          // actor-only action with no competing actor or shared-resource choice.
          const independent = scheduled.selected[0];
          if (
            ((error as { directorCoordinationPending?: boolean }).directorCoordinationPending ||
              (error as { directorKnownInvalid?: boolean }).directorKnownInvalid ||
              (error as { code?: unknown })?.code === 'INVALID_DIRECTOR_PROPOSAL') &&
            independent &&
            !independent.candidate.requiresCoordination
          )
            return execute(independent.candidate, independent.guidance);
          throw error;
        }
        if (
          decision?.openingContext?.disposition === 'confirm' &&
          decision.openingContext.premises.length
        ) {
          // The next bounded batch step reloads the just-committed world and inbox.
          return { ...quiet(storyAt), changed: true, worldVersion: world.version + 1 };
        }
        if (decision?.opportunities.length) {
          // A saved event handoff precedes optional empty-agenda initialization,
          // even if the same Director decision also selected those candidates.
          return (
            (await dispatchPendingAgentEpisode(
              db,
              npcModel,
              ownerId,
              world,
              engineEpoch,
              storyAt,
              batch,
            )) ?? quiet(storyAt)
          );
        }
        if (!decision || !decision.selectedCandidateIds.length) {
          // A new opportunity owns this turn's delivery budget. Do not consume
          // an unrelated actor candidate or execute its now potentially old read.
          const delivery = await dispatchPendingAgentEpisode(
            db,
            npcModel,
            ownerId,
            world,
            engineEpoch,
            storyAt,
            batch,
          );
          if (delivery) return delivery;
          if (decision?.opportunities.length) return quiet(storyAt);
          // Global quiet only settles that global assessment. The original
          // scheduler already established this actor's independent eligibility;
          // execute keeps the same command and rechecks the original kernel gates.
          const independent = scheduled.selected[0];
          return independent && !independent.candidate.requiresCoordination
            ? execute(independent.candidate, independent.guidance)
            : quiet(storyAt);
        }
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
      return selected
        ? execute(selected.candidate, selected.guidance)
        : ((await dispatchPendingAgentEpisode(
            db,
            npcModel,
            ownerId,
            world,
            engineEpoch,
            storyAt,
            batch,
          )) ?? quiet(storyAt));

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
        const originalCandidate = originalCandidates.get(candidate.id);
        if (originalCandidate?.planReview) {
          await planReviewRepository.schedule(
            ownerId,
            worldId,
            candidate.actorId,
            originalCandidate.planReview.planId,
            storyAt,
          );
        }
        const existing = await attempts.lookup(ownerId, worldId, commandForCandidate(candidate));
        const recovering = existing?.status === 'response_received';
        const reservation = recovering ? undefined : batch?.reserveModel();
        if (batch && !recovering && !reservation) return quiet(storyAt);
        try {
          batch?.actorStarted(candidate.actorId);
          const commandIdentity = candidateCommand(candidate);
          const commandId = commandIdentity.commandId;
          await batch?.trackWork?.({ kind: 'npc', commandId });
          const initialization =
            candidate.source === 'agenda_initialize'
              ? read.agendaInitializeGrants.find(
                  (g) => g.candidateId === candidate.id && g.actorId === candidate.actorId,
                )
              : undefined;
          if (candidate.source === 'agenda_initialize' && !initialization)
            throw new DomainError('INVALID_COMMAND');
          const agendaReview =
            candidate.source === 'agenda_review' ? agendaReviews.get(candidate.id) : undefined;
          if (candidate.source === 'agenda_review' && !agendaReview)
            throw new DomainError('INVALID_COMMAND');
          const text = agendaReview
            ? ownAgendaReviewInputText(agendaReview.grant)
            : initialization
              ? agendaInitializeInputText(initialization)
              : JSON.stringify({
                  type: 'npc_own_condition_ready',
                  ...(commandIdentity.zeroSendRecoveryOfAttemptId
                    ? { zeroSendRecoveryOfAttemptId: commandIdentity.zeroSendRecoveryOfAttemptId }
                    : {}),
                  candidateId: candidate.id,
                  source: candidate.source,
                  actionId: candidate.actionId,
                  basisSourceIds: candidate.sourceIds,
                  ...(candidate.wakeCue || candidate.source === 'actor_local'
                    ? { wakeCue: candidate.wakeCue || candidate.reason }
                    : {}),
                  ...(candidate.planReview ? { planReview: candidate.planReview } : {}),
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
          let result;
          try {
            result = await runNpcAgent(
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
          } catch (error) {
            if ((error as { code?: unknown })?.code === 'OWN_AGENDA_BUDGET_WAIT')
              return quiet(storyAt);
            if ((error as { code?: unknown })?.code === 'NPC_DELIVERY_DEFERRED')
              return quiet(storyAt);
            // A player private reply took ownership while this automatic turn was in
            // flight. Stop this batch cleanly; the player turn will commit its reply.
            if ((error as { code?: unknown })?.code === 'SUPERSEDED_BY_USER_INTERRUPT') {
              batch?.yieldAfterStep();
              return quiet(storyAt);
            }
            if (batch) {
              const failed = await attempts.lookup(ownerId, worldId, commandId);
              if (
                failed?.actorId === candidate.actorId &&
                failed.status === 'cancelled_before_send' &&
                (error as { code?: unknown })?.code === 'NPC_AGENT_SNAPSHOT_LIMIT'
              ) {
                const unsent = await db.transaction(
                  ownerId,
                  async (sql) =>
                    !!(
                      await sql.query(
                        `SELECT 1 FROM parallel_life.agent_attempts
                    WHERE id=$1 AND world_id=$2 AND owner_id=$3
                      AND status='cancelled_before_send' AND sent_at IS NULL
                      AND response IS NULL AND response_hash IS NULL AND event_id IS NULL`,
                        [failed.id, worldId, ownerId],
                      )
                    ).rowCount,
                );
                if (unsent) throw new ActorAdvanceBlocked(error, failed.status, 'actor');
              }
              if (
                failed?.actorId === candidate.actorId &&
                (failed.status === 'unknown_after_send' || failed.status === 'invalid_output')
              )
                throw new ActorAdvanceBlocked(
                  error,
                  failed.status,
                  actorAdvanceFailureScope(error),
                );
            }
            throw error;
          }
          // Real quiet/plan outcomes still execute and persist, but never pretend a new message exists.
          return presentedResult(
            result.eventId,
            candidate.actorId,
            result.state.projectedWorldVersion,
          );
        } finally {
          reservation?.release();
        }
      }
      async function presentedResult(
        eventId: string,
        actorId: string,
        worldVersion: number,
      ): Promise<AdvanceResult> {
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
          changed: true,
          worldVersion,
          played: presented ? 1 : 0,
          actors: presented ? [actorId] : [],
        };
      }
    },
  };
  return {
    /** Deliver a committed Director opportunity whose original HTTP request was interrupted. */
    async dispatchPendingEpisodeDirect(ownerId: string, worldId: string) {
      const world = await worlds.get({ userId: ownerId }, worldId);
      const epoch = await db.transaction(ownerId, async (sql) => {
        const row = (
          await sql.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
            [worldId, ownerId],
          )
        ).rows[0];
        return Number(row?.engine_epoch ?? 1);
      });
      if (epoch < 2) return null;
      const npcModel = new NpcAgentModel({
        complete: (...args) => modelFactory().complete(...args),
      });
      return dispatchPendingAgentEpisode(
        db,
        npcModel,
        ownerId,
        world,
        epoch,
        new Date().toISOString(),
        undefined,
        // Known invalid responses have no committed effects. The explicit dispatch
        // route can request a fresh evaluation; unknown/paid-success remain fenced.
        { allowKnownInvalid: true, freshCommand: randomUUID() },
      );
    },
    /** Owner-authorized explicit review; bypasses the automatic batch lease only for this deliberate call. */
    async reviewDirectorDirect(ownerId: string, worldId: string) {
      return service.advanceOne(ownerId, worldId, undefined, undefined, {
        forceDirectorReview: true,
      });
    },
    async advanceIfEnabled(
      ownerId: string,
      worldId: string,
      retryDirectorAttemptId?: string,
      trackWork?: (work: AdvanceWorkRef) => Promise<void>,
      options?: { forceDirectorReview?: boolean },
    ) {
      const lease = await claimAgentAdvanceBatch(db, ownerId, worldId);
      if (lease.status === 'legacy')
        return service.advanceOne(ownerId, worldId, retryDirectorAttemptId, undefined, options);
      if (lease.status === 'busy')
        return { ...quiet(lease.storyNow), deferred: 'scheduler_busy' as const };
      try {
        if (retryDirectorAttemptId)
          return await service.advanceOne(
            ownerId,
            worldId,
            retryDirectorAttemptId,
            undefined,
            options,
          );
        return await runAgentAdvanceBatch(
          async (batch) => {
            try {
              return await service.advanceOne(ownerId, worldId, undefined, batch, options);
            } catch (error) {
              const scoped = error as {
                directorCoordinationPending?: boolean;
                directorKnownInvalid?: boolean;
              };
              if (scoped?.directorCoordinationPending || scoped?.directorKnownInvalid)
                throw new AgentAdvanceDeferred(error);
              throw error;
            }
          },
          policy,
          Date.now,
          trackWork,
        );
      } finally {
        try {
          await releaseAgentAdvanceBatch(db, ownerId, worldId, lease.token);
        } catch {
          console.warn('AGENT_ADVANCE_BATCH_LEASE_RELEASE_FAILED');
        }
      }
    },
  };
}
