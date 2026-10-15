import {
  nativeAgentProjectionId,
  projectNativeAgentChannelInTransaction,
} from './agent-channel-projector.ts';
import { readActorStrategyBasis } from './agent-source-resolver.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentKernel, AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { AgentActionResult, AgentProposal } from '../domain/agent-runtime.ts';
import type {
  AgentRuntimeTransition,
  AgentStateCommittedEvent,
} from '../domain/agent-state-event.ts';
import { applyAgentStateEvent } from '../domain/agent-state-event.ts';
import { reduceActorAgentState, AgentValidationError } from '../domain/agent-kernel.ts';
import { evaluateAgentActionEligibility } from '../domain/agent-eligibility.ts';
import { parseAgentProposal } from './agent-proposal-parser.ts';
import { projectEpisodeRequestInTransaction } from './agent-narrative-repository.ts';
import {
  beginAgentCommitInTransaction,
  finishAgentCommitInTransaction,
} from './agent-runtime-repository.ts';
import { compactWorldState, PostgresWorldRepository } from './postgres-world-repository.ts';
import type { WorldEffect, WorldEvent } from '../domain/types.ts';
import { storedActivityClock } from './clock-activity-repository.ts';
import { readableActivityClock } from '../domain/clock-activity.ts';
import { projectStoryTime } from '../domain/clock.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import {
  prepareAgentTravel,
  commitAgentDeparture,
  type AgentJourney,
} from '../domain/agent-travel.ts';
import { worldBoundary } from '../domain/world-awareness.ts';
import {
  readAgentJourneysInTransaction,
  recordAgentDepartureInTransaction,
} from './agent-journey-repository.ts';
import {
  applyAgentSceneDeparture,
  type AgentSceneDeparture,
} from '../domain/agent-scene-departure.ts';
import { SceneRuntimeSessionSchema } from '../../../contracts/scenes.ts';

/** Deterministic capability execution + one UoW; models never hold a SQL connection. */
export class PostgresNpcAgentKernel implements AgentKernel {
  private readonly db: PostgresDatabase;
  private readonly worlds: PostgresWorldRepository;
  private readonly afterCommit?: (
    sql: SqlClient,
    receipt: { attempt: import('../domain/agent-runtime.ts').AgentAttempt; eventId: string },
  ) => Promise<void>;
  constructor(
    db: PostgresDatabase,
    worlds: PostgresWorldRepository,
    afterCommit?: (
      sql: SqlClient,
      receipt: { attempt: import('../domain/agent-runtime.ts').AgentAttempt; eventId: string },
    ) => Promise<void>,
  ) {
    this.db = db;
    this.worlds = worlds;
    this.afterCommit = afterCommit;
  }
  parse(snapshot: AgentSnapshot, raw: unknown) {
    return parseAgentProposal(snapshot, raw);
  }
  async commit(ownerId: string, input: Parameters<AgentKernel['commit']>[1]) {
    const { attempt, snapshot } = input;
    const proposal = parseAgentProposal(snapshot, input.proposal);
    return this.db.transaction(ownerId, async (sql) => {
      const replay = (
        await sql.query(
          `SELECT e.payload FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.id=a.event_id AND e.world_id=a.world_id
         WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3 AND a.token=$4 AND a.status='committed'`,
          [attempt.worldId, ownerId, attempt.id, attempt.token],
        )
      ).rows[0]?.payload;
      if (replay) {
        const accepted = replay.data?.agentRuntime as AgentRuntimeTransition | undefined;
        if (!accepted || accepted.inputReceiptId !== attempt.inputReceiptId)
          throw Error('INVALID_AGENT_RECEIPT');
        await projectEpisodeRequestInTransaction(sql, ownerId, { attempt, eventId: replay.id });
        await this.afterCommit?.(sql, { attempt, eventId: replay.id });
        return {
          eventId: replay.id as string,
          state: accepted.stateAfter,
          results: accepted.results,
        };
      }
      const current = await beginAgentCommitInTransaction(sql, ownerId, attempt);
      const receivedInput = (
        await sql.query(
          'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
          [attempt.worldId, ownerId, attempt.inputReceiptId],
        )
      ).rows[0]?.document;
      const inputSource = snapshot.sources.find((source) => source.id === snapshot.input.sourceId);
      if (
        !receivedInput ||
        inputSource?.kind !== 'accepted_input' ||
        receivedInput.text !== snapshot.input.text ||
        receivedInput.origin !== snapshot.input.origin ||
        receivedInput.storyAt !== inputSource?.at ||
        receivedInput.expectedWorldVersion !== inputSource?.worldVersion
      )
        throw new AgentValidationError('INPUT_SOURCE_MISMATCH');
      if (!isDeepStrictEqual(current, snapshot.state))
        throw Object.assign(Error('AGENT_REVISION_CONFLICT'), { code: 'AGENT_REVISION_CONFLICT' });
      const clock = (
        await sql.query(
          `SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2`,
          [attempt.worldId, ownerId],
        )
      ).rows[0];
      if (
        clock &&
        (clock.paused ||
          (clock.managed && (!clock.active_until || Date.parse(clock.active_until) <= Date.now())))
      )
        throw Object.assign(Error('WORLD_PAUSED'), { code: 'WORLD_PAUSED' });
      const strategy = snapshot.sources.filter((source) => source.usage === 'private_strategy');
      if (strategy.length) {
        const currentBasis = await readActorStrategyBasis(
          sql,
          ownerId,
          current,
          attempt.expectedWorldVersion,
          snapshot.storyAt,
        );
        if (strategy.some((source) => !currentBasis.some((now) => isDeepStrictEqual(source, now))))
          throw Object.assign(Error('AGENT_REVISION_CONFLICT'), {
            code: 'AGENT_REVISION_CONFLICT',
          });
      }
      const sourceIds = snapshot.sources.flatMap((source) => [
        source.id,
        source.recordId,
        source.id.replace(/^(fact|message|appointment|opening):/, ''),
      ]);
      const forgotten = await forgottenAgentSourceIds(
        sql,
        ownerId,
        attempt.worldId,
        attempt.actorId,
      );
      if (sourceIds.some((id) => forgotten.has(id)))
        throw Object.assign(Error('AGENT_REVISION_CONFLICT'), { code: 'AGENT_REVISION_CONFLICT' });
      const memorySources = snapshot.sources.filter((source) => source.id.startsWith('memory:'));
      if (memorySources.length) {
        const rows = (
          await sql.query(
            'SELECT id,text,status FROM parallel_life.memory_records WHERE owner_id=$1 AND character_id=$2 AND (branch_id=$3 OR branch_id IS NULL) AND id=ANY($4::text[])',
            [
              ownerId,
              attempt.actorId,
              attempt.worldId,
              memorySources.map((source) => source.id.slice(7)),
            ],
          )
        ).rows;
        const currentMemories = new Map(rows.map((row) => [String(row.id), row]));
        if (
          memorySources.some((source) => {
            const row = currentMemories.get(source.id.slice(7));
            return (
              !row ||
              row.status !== 'active' ||
              source.contentHash !== createHash('sha256').update(String(row.text)).digest('hex')
            );
          })
        )
          throw Object.assign(Error('AGENT_REVISION_CONFLICT'), {
            code: 'AGENT_REVISION_CONFLICT',
          });
      }
      const eventId = randomUUID(),
        occurredAt = new Date().toISOString();
      const executionWorld = (
        await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
          attempt.worldId,
          ownerId,
        ])
      ).rows[0].state as import('../domain/types.ts').WorldState;
      const worldTime = executionWorld.time;
      const at = new Date(
        Math.max(
          Date.parse(worldTime),
          clock
            ? Date.parse(
                projectStoryTime(
                  readableActivityClock(storedActivityClock(clock), occurredAt),
                  occurredAt,
                ),
              )
            : Date.parse(worldTime),
        ),
      ).toISOString();
      if (Date.parse(snapshot.storyAt) > Date.parse(at))
        throw Object.assign(Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' });
      const historicalResults = (
        await sql.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND world_version<=$4',
          [attempt.worldId, ownerId, attempt.actorId, attempt.expectedWorldVersion],
        )
      ).rows.map((row) => row.document as AgentActionResult);
      const ownActual = (
        await sql.query(
          'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3 AND source_version<=$4',
          [attempt.worldId, ownerId, `actor:${attempt.actorId}`, attempt.expectedWorldVersion],
        )
      ).rows[0]?.document;
      const results: AgentActionResult[] = [],
        effects: WorldEffect[] = [],
        departures: AgentJourney[] = [],
        sceneDepartures: AgentSceneDeparture[] = [];
      const changedScenes: import('../domain/experience-rules.ts').SceneSession[] = [];
      for (const action of proposal.actions) {
        if (!['ready', 'proposed', 'waiting'].includes(action.status)) continue;
        const eligibility = evaluateAgentActionEligibility(snapshot, proposal, action, {
          storyAt: at,
          trustedResults: [...historicalResults, ...results],
          ...(ownActual?.status === 'at' ? { actorPlaceId: ownActual.placeId } : {}),
        });
        if (eligibility.status !== 'ready') {
          action.status = eligibility.status;
          continue;
        }
        if (action.handlesResponsibilityIds.length)
          throw new AgentValidationError('CAPABILITY_CANNOT_HANDLE_EXTERNAL_RESPONSIBILITY');
        let outputRefs: NonNullable<AgentActionResult['outputRefs']> = [];
        let failureCode: string | undefined;
        if (action.capability === 'plan.record') {
          const planId = action.parameters.planId;
          if (
            typeof planId !== 'string' ||
            !proposal.plans.some((plan) => plan.id === planId && plan.goalId === action.goalId)
          )
            throw new AgentValidationError('PLAN_RECORD_TARGET');
          outputRefs = [{ kind: 'plan', id: planId }];
        } else if (action.capability === 'appointment.propose') {
          const title = action.parameters.title,
            proposedAt = action.parameters.at;
          if (
            typeof title !== 'string' ||
            !title.trim() ||
            title.length > 120 ||
            typeof proposedAt !== 'string' ||
            !validOffsetInstant(proposedAt) ||
            Date.parse(proposedAt) <= Date.parse(at)
          )
            throw new AgentValidationError('APPOINTMENT_PROPOSAL');
          effects.push({
            type: 'appointment.proposed',
            id: randomUUID(),
            title,
            at: new Date(proposedAt).toISOString(),
            participantIds: [attempt.actorId],
          });
          outputRefs = [{ kind: 'appointment', id: effects.at(-1)!.id }];
        } else if (action.capability === 'travel.begin') {
          if (!clock) throw new AgentValidationError('TRAVEL_CLOCK_UNAVAILABLE');
          if (
            Object.keys(action.parameters).length !== 1 ||
            typeof action.parameters.routeId !== 'string'
          )
            throw new AgentValidationError('INVALID_TRAVEL_PARAMETERS');
          const positionSource = ownActual && `self-position:${ownActual.sourceEventId}`;
          if (
            !positionSource ||
            !action.sourceIds.includes(positionSource) ||
            !snapshot.sources.some((s) => s.id === positionSource)
          )
            throw new AgentValidationError('TRAVEL_ORIGIN_NOT_AUTHORIZED');
          const prepared = prepareAgentTravel({
            frame: {
              worldId: attempt.worldId,
              actorId: attempt.actorId,
              worldVersion: attempt.expectedWorldVersion,
              storyAt: at,
            },
            boundary: worldBoundary(
              executionWorld,
              ownActual.sourceEventId,
              snapshot.channel.allowedCapabilities,
            ),
            ownPosition: ownActual,
            routes: executionWorld.space?.routes ?? [],
            intent: {
              journeyId: randomUUID(),
              actionId: action.id,
              routeId: action.parameters.routeId,
            },
            existingJourneys: [
              ...(await readAgentJourneysInTransaction(sql, ownerId, {
                worldId: attempt.worldId,
                actorId: attempt.actorId,
              })),
              ...departures,
            ],
          });
          if (prepared.status !== 'ready') failureCode = `travel_${prepared.reason}`;
          else {
            const committed = commitAgentDeparture(prepared.plan, {
              id: `${eventId}_result_${results.length}`,
              actionId: action.id,
              worldId: attempt.worldId,
              actorId: attempt.actorId,
              eventId,
              worldVersion: attempt.expectedWorldVersion + 1,
              at,
              outcome: 'succeeded',
              handledResponsibilityIds: [],
              evidenceSourceIds: action.sourceIds,
            });
            if (committed.status !== 'in_transit')
              throw new AgentValidationError('INVALID_TRAVEL_DEPARTURE');
            const scenes = (
              await sql.query(
                `SELECT document FROM parallel_life.scene_sessions WHERE world_id=$1 AND owner_id=$2 AND document->>'status'='active' FOR UPDATE`,
                [attempt.worldId, ownerId],
              )
            ).rows.map((row) => SceneRuntimeSessionSchema.parse(row.document));
            for (const scene of scenes)
              for (const presence of scene.presence.filter(
                (p) =>
                  p.participant.kind === 'actor' &&
                  p.participant.actorId === attempt.actorId &&
                  p.leftVersion === undefined,
              )) {
                const departure = {
                  sceneId: scene.id,
                  actorId: attempt.actorId,
                  joinedVersion: presence.joinedVersion,
                  joinedSourceEventId: presence.sourceEventId,
                };
                changedScenes.push(
                  applyAgentSceneDeparture(scene, {
                    worldId: attempt.worldId,
                    actorId: attempt.actorId,
                    eventId,
                    worldVersion: attempt.expectedWorldVersion + 1,
                    fromPlaceId: prepared.plan.route.fromPlaceId,
                    departure,
                  }),
                );
                sceneDepartures.push(departure);
              }
            departures.push(committed.journey);
            outputRefs = [{ kind: 'journey', id: committed.journey.id }];
          }
        } else throw new AgentValidationError('UNREGISTERED_CAPABILITY');
        results.push({
          id: `${eventId}_result_${results.length}`,
          actionId: action.id,
          worldId: attempt.worldId,
          actorId: attempt.actorId,
          eventId,
          worldVersion: attempt.expectedWorldVersion + 1,
          at,
          outcome: failureCode ? 'failed' : 'succeeded',
          ...(failureCode ? { failureCode } : {}),
          handledResponsibilityIds: [],
          evidenceSourceIds: action.sourceIds,
          completedGoalIds: [],
          outputRefs,
        });
      }
      const accepted = reduceActorAgentState(
        { ...snapshot, knownActionResults: historicalResults },
        proposal,
        results,
        attempt.expectedWorldVersion + 1,
      );
      // Project the actual created invitation into this NPC's responsibility inbox.
      // The model does not need to guess a future appointment ID or a response deadline.
      for (const output of results.flatMap((result) => result.outputRefs ?? []))
        if (output.kind === 'appointment') {
          const invitation = effects.find(
            (effect) => effect.type === 'appointment.proposed' && effect.id === output.id,
          );
          if (invitation?.type !== 'appointment.proposed')
            throw new AgentValidationError('MISSING_CAPABILITY_OUTPUT');
          accepted.state.responsibilities.push({
            id: `appointment:${invitation.id}`,
            subject: { kind: 'appointment', id: invitation.id },
            summary: invitation.title,
            sourceIds: [`appointment:${invitation.id}`],
            revision: 0,
            status: 'waiting',
            waitingOn: 'player',
            nextCheck: [],
          });
        }
      for (const statement of accepted.statements)
        effects.push({
          type: 'message.received',
          id: randomUUID(),
          actorId: attempt.actorId,
          text: statement.text,
        });
      const resolvedFocus = accepted.state.focus?.questionSourceId;
      if (
        resolvedFocus &&
        accepted.state.questions?.some(
          (q) => q.sourceId === resolvedFocus && q.status !== 'open',
        ) &&
        !accepted.state.questions.some((q) => q.sourceId === resolvedFocus && q.status === 'open')
      )
        accepted.state.focus = {
          ...accepted.state.focus!,
          questionSourceId: null,
          replyToActorId: null,
        };
      for (const [questionIndex, statement] of accepted.statements.entries()) {
        if (statement.requestsPlayerReply !== true) continue;
        const messageEffects = effects.filter((effect) => effect.type === 'message.received');
        const questionSourceId =
          snapshot.channel.kind === 'private'
            ? `message:${messageEffects[questionIndex]!.id}`
            : `${snapshot.channel.kind === 'group' ? 'group' : 'scene'}:${nativeAgentProjectionId(eventId, snapshot.channel.kind, snapshot.channel.kind === 'group' ? 0 : questionIndex)}`;
        accepted.state.focus = {
          channel: snapshot.channel.kind,
          threadId: snapshot.channel.threadId,
          subjectId: accepted.state.focus?.subjectId ?? null,
          questionSourceId,
          replyToActorId: attempt.actorId,
        };
        (accepted.state.questions ??= []).push({
          id: `${eventId}_question_${questionIndex}`,
          channel: snapshot.channel.kind,
          threadId: snapshot.channel.threadId,
          sourceId: questionSourceId,
          text: statement.text,
          askedAt: at,
          status: 'open',
          ...(statement.questionForResponsibilityId === undefined
            ? {}
            : {
                responsibilityId: statement.questionForResponsibilityId,
              }),
        });
      }
      const positionKnowledge: import('../domain/world-awareness.ts').ActorPositionKnowledge[] = [];
      const bounded = (
        await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
          attempt.worldId,
          ownerId,
        ])
      ).rows[0].state;
      for (const report of proposal.locationReports ?? []) {
        if (
          (report.subject.kind === 'actor' &&
            !bounded.actors.some(
              (actor: { id: string }) =>
                report.subject.kind === 'actor' && actor.id === report.subject.actorId,
            )) ||
          (report.placeId !== null &&
            !bounded.space?.places.some((place: { id: string }) => place.id === report.placeId))
        )
          throw new AgentValidationError('LOCATION_REPORT_OUT_OF_BOUNDARY');
        if (report.assertion !== 'reported') continue;
        positionKnowledge.push({
          worldId: attempt.worldId,
          observerActorId: attempt.actorId,
          subject: report.subject,
          kind: 'report',
          placeId: report.placeId,
          sourceKind: 'player_report',
          occurredAt: null,
          learnedAt: receivedInput.storyAt,
          sourceEventId: eventId,
          worldVersion: attempt.expectedWorldVersion + 1,
          possiblyStale: true,
          evidence: { inputReceiptId: receivedInput.id, quote: report.quote },
        });
      }
      accepted.state.knowledgeSourceIds = [
        ...new Set([
          ...accepted.state.knowledgeSourceIds,
          ...(snapshot.worldContext?.knowledge.map((k) => k.sourceId) ?? []),
          ...positionKnowledge.map(
            (k) =>
              `knowledge:${eventId}:${k.subject.kind === 'player' ? 'player' : k.subject.actorId}:report`,
          ),
        ]),
      ];
      const transition: AgentRuntimeTransition = {
        schemaVersion: 1,
        engineEpoch: attempt.engineEpoch,
        inputReceiptId: attempt.inputReceiptId,
        inputStoryAt: receivedInput.storyAt,
        inputWorldVersion: receivedInput.expectedWorldVersion,
        actorRevisionBefore: current.revision,
        actorRevisionAfter: accepted.state.revision,
        proposal: { ...proposal, statements: accepted.statements },
        ...(accepted.questionChanges.length ? { questionChanges: accepted.questionChanges } : {}),
        results,
        ...(departures.length ? { departures, sceneDepartures } : {}),
        ...(positionKnowledge.length ? { positionKnowledge } : {}),
        ...(proposal.episodeDecision ? { episodeDecision: proposal.episodeDecision } : {}),
        stateAfter: accepted.state,
      };
      const command = {
        id: attempt.commandId,
        worldId: attempt.worldId,
        expectedVersion: attempt.expectedWorldVersion,
        actorId: attempt.actorId,
        text: snapshot.input.text,
        ...(snapshot.input.origin !== 'player' ? { origin: 'director' as const } : {}),
      };
      if (snapshot.channel.kind !== 'private') {
        await projectNativeAgentChannelInTransaction(sql, ownerId, {
          attempt,
          snapshot,
          transition,
          eventId,
          occurredAt,
          storyAt: at,
          effects,
          statements: accepted.statements,
        });
      } else if (accepted.statements.length) {
        const event: WorldEvent = {
          schemaVersion: 1,
          id: eventId,
          worldId: attempt.worldId,
          commandId: attempt.commandId,
          version: attempt.expectedWorldVersion + 1,
          occurredAt,
          storyAt: at,
          type: 'turn.resolved',
          data: {
            actorId: attempt.actorId,
            userText: command.text,
            effects,
            origin: command.origin,
            userAt: receivedInput.storyAt,
            agentRuntime: transition,
          },
        };
        await this.worlds.commitInTransaction(sql, { userId: ownerId }, command, event, undefined, {
          legacyProgress: false,
        });
      } else {
        // Do not force an empty or fabricated message to satisfy the legacy character-turn contract.
        const event: AgentStateCommittedEvent = {
          schemaVersion: 1,
          id: eventId,
          worldId: attempt.worldId,
          commandId: attempt.commandId,
          version: attempt.expectedWorldVersion + 1,
          occurredAt,
          storyAt: at,
          type: 'agent.state_committed',
          data: {
            actorId: attempt.actorId,
            agentRuntime: transition,
            effects: effects as Extract<WorldEffect, { type: 'appointment.proposed' }>[],
          },
        };
        const world = (
          await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            attempt.worldId,
            ownerId,
          ])
        ).rows[0].state;
        const next = applyAgentStateEvent(world, event),
          compact = compactWorldState(next);
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify([
              command.worldId,
              command.expectedVersion,
              command.actorId,
              command.text,
              ...(command.origin ? [command.origin] : []),
            ]),
          )
          .digest('hex');
        await sql.query(
          "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
          [command.id, attempt.worldId, ownerId, command.expectedVersion, requestHash, command],
        );
        await sql.query(
          'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [event.id, attempt.worldId, ownerId, event.version, command.id, event, occurredAt],
        );
        for (const appointment of next.appointments.filter(
          (item) => item.sourceEventId === event.id,
        ))
          await sql.query(
            'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
            [appointment.id, attempt.worldId, ownerId, appointment],
          );
        await sql.query(
          'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
          [attempt.worldId, event.version, compact],
        );
        await sql.query(
          "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
          [attempt.worldId, command.id, eventId, compact],
        );
      }
      await finishAgentCommitInTransaction(sql, ownerId, {
        attempt,
        eventId,
        state: accepted.state,
        results,
      });
      for (const scene of changedScenes)
        await sql.query(
          'UPDATE parallel_life.scene_sessions SET document=$3 WHERE world_id=$1 AND owner_id=$2 AND id=$4',
          [attempt.worldId, ownerId, SceneRuntimeSessionSchema.parse(scene), scene.id],
        );
      for (const journey of departures)
        await recordAgentDepartureInTransaction(sql, ownerId, { attempt, journey });
      await projectAgentWorldChange(sql, ownerId, attempt.worldId, eventId);
      await projectEpisodeRequestInTransaction(sql, ownerId, { attempt, eventId });
      await this.afterCommit?.(sql, { attempt, eventId });
      return { eventId, state: accepted.state, results };
    });
  }
}
function validOffsetInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return false;
  const wall = new Date(value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, 'Z'));
  return (
    Number.isFinite(wall.getTime()) &&
    wall.toISOString().slice(0, 19) === value.slice(0, 19) &&
    Number.isFinite(Date.parse(value))
  );
}
