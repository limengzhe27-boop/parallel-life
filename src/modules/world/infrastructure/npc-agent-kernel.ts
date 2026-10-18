import { validateGroupObservationContext } from './group-observation-context-validation.ts';
import { validateActorObservationInbox } from './actor-observation-inbox.ts';
import { validateSceneObservationContext } from './scene-observation-context-validation.ts';
import { validateActorEpisodeResults } from './episode-result-context-repository.ts';
import { validateEpisodeLifecycleContext } from './episode-lifecycle-repository.ts';
import {
  validatePlayerEpisodeManifest,
  requirePlayerEpisodeBinding,
} from './player-episode-manifest-repository.ts';
import { readLocationReportAudience } from './location-report-audience.ts';
import { projectLocationReportKnowledge } from '../domain/project-location-report-knowledge.ts';
import {
  nativeAgentProjectionId,
  projectNativeAgentChannelInTransaction,
} from './agent-channel-projector.ts';
import { readActorStrategyBasis } from './agent-source-resolver.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  validateGenerateImageToolInput,
  validateGenerateVideoToolInput,
  validateMediaShareToolInput,
} from '../../media/domain/media-tools.ts';
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
import { requireActiveAgentDeliveryInTransaction } from './agent-delivery-activity.ts';
import { validateActorEpisodeIntentSnapshotInTransaction } from './actor-episode-intent-repository.ts';
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
import {
  isEpisodeConsiderationInput,
  requireEpisodeDeliveryInTransaction,
} from './agent-episode-attention.ts';

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
      await validateActorEpisodeIntentSnapshotInTransaction(sql, ownerId, snapshot);
      await validateEpisodeLifecycleContext(sql, ownerId, snapshot);
      await validateActorEpisodeResults(sql, ownerId, snapshot);
      await validateSceneObservationContext(sql, ownerId, snapshot);
      await validateGroupObservationContext(sql, ownerId, snapshot);
      await validateActorObservationInbox(sql, ownerId, snapshot);
      await validatePlayerEpisodeManifest(sql, ownerId, snapshot);
      await requirePlayerEpisodeBinding(sql, ownerId, attempt, snapshot);
      if (isEpisodeConsiderationInput(receivedInput))
        await requireEpisodeDeliveryInTransaction(sql, ownerId, {
          worldId: attempt.worldId,
          worldVersion: attempt.expectedWorldVersion,
          actorId: attempt.actorId,
        });
      const { clock } = await requireActiveAgentDeliveryInTransaction(
        sql,
        ownerId,
        attempt.worldId,
        'NPC_DELIVERY_DEFERRED',
      );
      const strategy = snapshot.sources.filter(
        (source) =>
          source.usage === 'private_strategy' &&
          !snapshot.actorObservationInbox?.sourceIds.includes(source.id),
      );
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
        if (
          action.handlesResponsibilityIds.length &&
          action.capability !== 'appointment.fulfill' &&
          action.capability !== 'appointment.cancel' &&
          action.capability !== 'appointment.accept' &&
          action.capability !== 'appointment.reschedule' &&
          action.capability !== 'item.deliver' &&
          action.capability !== 'item.use' &&
          action.capability !== 'activity.participate' &&
          action.capability !== 'relationship.bond' &&
          action.capability !== 'moment.publish' &&
          action.capability !== 'moment.interact'
        )
          throw new AgentValidationError('CAPABILITY_CANNOT_HANDLE_EXTERNAL_RESPONSIBILITY');
        let outputRefs: NonNullable<AgentActionResult['outputRefs']> = [];
        let handledResponsibilityIds: string[] = [];
        let completedGoalIds: string[] = [];
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
            proposedAt = action.parameters.at,
            placeId = action.parameters.placeId;
          if (
            typeof title !== 'string' ||
            !title.trim() ||
            title.length > 120 ||
            typeof proposedAt !== 'string' ||
            !validOffsetInstant(proposedAt) ||
            Date.parse(proposedAt) <= Date.parse(at) ||
            (placeId !== undefined && (typeof placeId !== 'string' || !placeId.trim())) ||
            Object.keys(action.parameters).some((key) => !['title', 'at', 'placeId'].includes(key))
          )
            throw new AgentValidationError('APPOINTMENT_PROPOSAL');
          if (placeId !== undefined) {
            const places =
              (
                await sql.query(
                  "SELECT state->'space'->'places' AS places FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2",
                  [attempt.worldId, ownerId],
                )
              ).rows[0]?.places ?? [];
            if (
              !snapshot.worldContext?.boundary.placeIds.includes(placeId as string) ||
              places.filter((p: { id: string }) => p.id === placeId).length !== 1
            )
              failureCode = 'APPOINTMENT_PLACE_NOT_AVAILABLE';
          }
          if (!failureCode) {
            effects.push({
              type: 'appointment.proposed',
              id: randomUUID(),
              title,
              at: new Date(proposedAt).toISOString(),
              participantIds: [attempt.actorId],
              ...(placeId === undefined ? {} : { placeId: placeId as string }),
            });
            outputRefs = [{ kind: 'appointment', id: effects.at(-1)!.id }];
          }
        } else if (action.capability === 'appointment.fulfill') {
          const appointmentId = action.parameters.appointmentId;
          if (
            typeof appointmentId !== 'string' ||
            !appointmentId.trim() ||
            Object.keys(action.parameters).some((key) => key !== 'appointmentId')
          )
            throw new AgentValidationError('APPOINTMENT_FULFILL_PARAMETERS');
          if (action.handlesResponsibilityIds.length !== 1)
            throw new AgentValidationError('APPOINTMENT_FULFILL_RESPONSIBILITY_REQUIRED');
          const respId = action.handlesResponsibilityIds[0]!;
          const resp =
            proposal.responsibilities.find((r) => r.id === respId) ??
            snapshot.state.responsibilities.find((r) => r.id === respId);
          if (!resp || resp.subject.kind !== 'appointment' || resp.subject.id !== appointmentId)
            throw new AgentValidationError('APPOINTMENT_FULFILL_RESPONSIBILITY_MISMATCH');

          const appointmentRow = (
            await sql.query(
              'SELECT a.document FROM parallel_life.world_appointments a WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3',
              [attempt.worldId, ownerId, appointmentId],
            )
          ).rows[0]?.document;

          const ap =
            appointmentRow ?? executionWorld.appointments?.find((a: any) => a.id === appointmentId);
          if (!ap) {
            failureCode = 'APPOINTMENT_NOT_FOUND';
          } else if (!['confirmed', 'scheduled'].includes(ap.status)) {
            failureCode = 'APPOINTMENT_NOT_CONFIRMED';
          } else if (Date.parse(at) < Date.parse(ap.at)) {
            failureCode = 'APPOINTMENT_NOT_DUE';
          } else {
            const venuePlaceId =
              ap.placeId ??
              executionWorld.space?.places.find((p: any) =>
                p.appointmentIds?.includes(appointmentId),
              )?.id;
            if (venuePlaceId && ownActual?.placeId !== venuePlaceId) {
              failureCode = 'ACTOR_NOT_AT_VENUE';
            }
          }

          if (!failureCode) {
            effects.push({
              type: 'appointment.fulfilled',
              id: randomUUID(),
              appointmentId,
              actorId: attempt.actorId,
              at,
            });
            outputRefs = [{ kind: 'appointment', id: appointmentId }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'appointment.cancel') {
          const appointmentId = action.parameters.appointmentId;
          const reason =
            typeof action.parameters.reason === 'string' && action.parameters.reason.trim()
              ? action.parameters.reason.trim()
              : undefined;
          if (
            typeof appointmentId !== 'string' ||
            !appointmentId.trim() ||
            Object.keys(action.parameters).some((key) => !['appointmentId', 'reason'].includes(key))
          )
            throw new AgentValidationError('APPOINTMENT_CANCEL_PARAMETERS');
          if (action.handlesResponsibilityIds.length > 1)
            throw new AgentValidationError('APPOINTMENT_CANCEL_RESPONSIBILITY_LIMIT');

          const appointmentRow = (
            await sql.query(
              'SELECT a.document FROM parallel_life.world_appointments a WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3',
              [attempt.worldId, ownerId, appointmentId],
            )
          ).rows[0]?.document;

          const ap =
            appointmentRow ?? executionWorld.appointments?.find((a: any) => a.id === appointmentId);
          if (!ap) {
            failureCode = 'APPOINTMENT_NOT_FOUND';
          } else if (['cancelled', 'attended', 'missed'].includes(ap.status)) {
            failureCode = 'APPOINTMENT_ALREADY_TERMINAL';
          } else {
            const isParticipant =
              ap.participantIds?.includes(attempt.actorId) ||
              ap.proposerId === attempt.actorId ||
              executionWorld.appointments?.some(
                (a: any) =>
                  a.id === appointmentId &&
                  (a.participantIds?.includes(attempt.actorId) || a.proposerId === attempt.actorId),
              );
            if (!isParticipant) {
              failureCode = 'ACTOR_NOT_APPOINTMENT_PARTICIPANT';
            }
          }

          if (!failureCode) {
            effects.push({
              type: 'appointment.cancelled',
              id: randomUUID(),
              appointmentId,
              actorId: attempt.actorId,
              at,
              ...(reason ? { reason } : {}),
            });
            outputRefs = [{ kind: 'appointment', id: appointmentId }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'appointment.accept') {
          const appointmentId = action.parameters.appointmentId;
          if (
            typeof appointmentId !== 'string' ||
            !appointmentId.trim() ||
            Object.keys(action.parameters).some((key) => key !== 'appointmentId')
          )
            throw new AgentValidationError('APPOINTMENT_ACCEPT_PARAMETERS');
          if (action.handlesResponsibilityIds.length > 1)
            throw new AgentValidationError('APPOINTMENT_ACCEPT_RESPONSIBILITY_LIMIT');

          const appointmentRow = (
            await sql.query(
              'SELECT a.document FROM parallel_life.world_appointments a WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3',
              [attempt.worldId, ownerId, appointmentId],
            )
          ).rows[0]?.document;

          const ap =
            appointmentRow ?? executionWorld.appointments?.find((a: any) => a.id === appointmentId);
          if (!ap) {
            failureCode = 'APPOINTMENT_NOT_FOUND';
          } else if (ap.status !== 'proposed') {
            failureCode = 'APPOINTMENT_NOT_PROPOSED';
          } else if (Date.parse(at) > Date.parse(ap.at)) {
            failureCode = 'APPOINTMENT_EXPIRED';
          } else {
            const isParticipant =
              ap.participantIds?.includes(attempt.actorId) ||
              ap.proposerId === attempt.actorId ||
              executionWorld.appointments?.some(
                (a: any) =>
                  a.id === appointmentId &&
                  (a.participantIds?.includes(attempt.actorId) || a.proposerId === attempt.actorId),
              );
            if (!isParticipant) {
              failureCode = 'ACTOR_NOT_APPOINTMENT_PARTICIPANT';
            }
          }

          if (!failureCode) {
            effects.push({
              type: 'appointment.confirmed',
              id: randomUUID(),
              appointmentId,
              actorId: attempt.actorId,
              at,
            });
            outputRefs = [{ kind: 'appointment', id: appointmentId }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'appointment.reschedule') {
          const appointmentId = action.parameters.appointmentId;
          const newAt = action.parameters.at;
          const placeId =
            typeof action.parameters.placeId === 'string' && action.parameters.placeId.trim()
              ? action.parameters.placeId.trim()
              : typeof action.parameters.locationId === 'string' &&
                  action.parameters.locationId.trim()
                ? action.parameters.locationId.trim()
                : undefined;
          const reason =
            typeof action.parameters.reason === 'string' && action.parameters.reason.trim()
              ? action.parameters.reason.trim()
              : undefined;

          const allowedKeys = ['appointmentId', 'at', 'placeId', 'locationId', 'reason'];
          if (
            typeof appointmentId !== 'string' ||
            !appointmentId.trim() ||
            typeof newAt !== 'string' ||
            !newAt.trim() ||
            Object.keys(action.parameters).some((key) => !allowedKeys.includes(key))
          )
            throw new AgentValidationError('APPOINTMENT_RESCHEDULE_PARAMETERS');
          if (action.handlesResponsibilityIds.length > 1)
            throw new AgentValidationError('APPOINTMENT_RESCHEDULE_RESPONSIBILITY_LIMIT');

          let parsedNewAt: number;
          try {
            parsedNewAt = Date.parse(newAt);
            if (Number.isNaN(parsedNewAt)) throw new Error('Invalid ISO date');
          } catch {
            throw new AgentValidationError('INVALID_RESCHEDULE_TIME');
          }

          const appointmentRow = (
            await sql.query(
              'SELECT a.document FROM parallel_life.world_appointments a WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3',
              [attempt.worldId, ownerId, appointmentId],
            )
          ).rows[0]?.document;

          const ap =
            appointmentRow ?? executionWorld.appointments?.find((a: any) => a.id === appointmentId);
          if (!ap) {
            failureCode = 'APPOINTMENT_NOT_FOUND';
          } else if (['cancelled', 'attended', 'missed'].includes(ap.status)) {
            failureCode = 'APPOINTMENT_TERMINAL';
          } else if (parsedNewAt <= Date.parse(at)) {
            failureCode = 'RESCHEDULE_TIME_PAST';
          } else {
            const isParticipant =
              ap.participantIds?.includes(attempt.actorId) ||
              ap.proposerId === attempt.actorId ||
              executionWorld.appointments?.some(
                (a: any) =>
                  a.id === appointmentId &&
                  (a.participantIds?.includes(attempt.actorId) || a.proposerId === attempt.actorId),
              );
            if (!isParticipant) {
              failureCode = 'ACTOR_NOT_APPOINTMENT_PARTICIPANT';
            }
          }

          if (!failureCode) {
            effects.push({
              type: 'appointment.rescheduled',
              id: randomUUID(),
              appointmentId,
              actorId: attempt.actorId,
              at,
              newAt,
              ...(placeId ? { placeId } : {}),
              ...(reason ? { reason } : {}),
            });
            outputRefs = [{ kind: 'appointment', id: appointmentId }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'item.deliver') {
          const itemId = action.parameters.itemId;
          const recipientActorId = action.parameters.recipientActorId;
          const title =
            typeof action.parameters.title === 'string' && action.parameters.title.trim()
              ? action.parameters.title.trim()
              : undefined;
          const note =
            typeof action.parameters.note === 'string' && action.parameters.note.trim()
              ? action.parameters.note.trim()
              : undefined;

          if (
            typeof itemId !== 'string' ||
            !itemId.trim() ||
            typeof recipientActorId !== 'string' ||
            !recipientActorId.trim() ||
            Object.keys(action.parameters).some(
              (key) => !['itemId', 'recipientActorId', 'title', 'note'].includes(key),
            )
          ) {
            throw new AgentValidationError('ITEM_DELIVER_PARAMETERS');
          }

          if (recipientActorId === attempt.actorId) {
            failureCode = 'CANNOT_DELIVER_TO_SELF';
          }

          if (!failureCode && !executionWorld.actors.some((a: any) => a.id === recipientActorId)) {
            failureCode = 'RECIPIENT_NOT_FOUND';
          }

          if (!failureCode) {
            const recipientActual = (
              await sql.query(
                'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3 AND source_version<=$4',
                [
                  attempt.worldId,
                  ownerId,
                  `actor:${recipientActorId}`,
                  attempt.expectedWorldVersion,
                ],
              )
            ).rows[0]?.document;

            const ownPlaceId = ownActual?.status === 'at' ? ownActual.placeId : undefined;
            const recipientPlaceId =
              recipientActual?.status === 'at' ? recipientActual.placeId : undefined;

            if (ownPlaceId && recipientPlaceId && ownPlaceId !== recipientPlaceId) {
              failureCode = 'RECIPIENT_NOT_CO_LOCATED';
            }
          }

          if (!failureCode && executionWorld.items && executionWorld.items.length > 0) {
            const existingItem = executionWorld.items.find((i: any) => i.id === itemId);
            if (existingItem && existingItem.holderActorId !== attempt.actorId) {
              failureCode = 'ITEM_NOT_OWNED_BY_ACTOR';
            }
          }

          if (!failureCode) {
            effects.push({
              type: 'item.delivered',
              id: randomUUID(),
              itemId,
              ...(title ? { title } : {}),
              fromActorId: attempt.actorId,
              toActorId: recipientActorId,
              ...(ownActual?.placeId ? { placeId: ownActual.placeId } : {}),
              at,
              ...(note ? { note } : {}),
            });
            outputRefs = [{ kind: 'item', id: itemId }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'item.use') {
          const itemId = action.parameters.itemId;
          const title =
            typeof action.parameters.title === 'string' && action.parameters.title.trim()
              ? action.parameters.title.trim()
              : undefined;
          const purpose =
            typeof action.parameters.purpose === 'string' && action.parameters.purpose.trim()
              ? action.parameters.purpose.trim()
              : undefined;
          const consumed =
            typeof action.parameters.consumed === 'boolean' ? action.parameters.consumed : false;
          const note =
            typeof action.parameters.note === 'string' && action.parameters.note.trim()
              ? action.parameters.note.trim()
              : undefined;
          const specifiedPlaceId =
            typeof action.parameters.placeId === 'string' && action.parameters.placeId.trim()
              ? action.parameters.placeId.trim()
              : undefined;

          if (
            typeof itemId !== 'string' ||
            !itemId.trim() ||
            Object.keys(action.parameters).some(
              (key) => !['itemId', 'title', 'purpose', 'consumed', 'note', 'placeId'].includes(key),
            )
          ) {
            throw new AgentValidationError('ITEM_USE_PARAMETERS');
          }

          let existingItem: any = undefined;
          if (executionWorld.items && executionWorld.items.length > 0) {
            existingItem = executionWorld.items.find((i: any) => i.id === itemId);
            if (!existingItem || existingItem.holderActorId !== attempt.actorId) {
              failureCode = 'ITEM_NOT_OWNED_BY_ACTOR';
            } else if (existingItem.status === 'consumed') {
              failureCode = 'ITEM_ALREADY_CONSUMED';
            }
          }

          const ownPlaceId = ownActual?.status === 'at' ? ownActual.placeId : undefined;
          if (!failureCode && specifiedPlaceId && ownPlaceId && specifiedPlaceId !== ownPlaceId) {
            failureCode = 'ACTOR_NOT_AT_SPECIFIED_PLACE';
          }

          if (!failureCode) {
            const effectPlaceId = specifiedPlaceId ?? ownPlaceId;
            const itemTitle = title ?? existingItem?.title;
            effects.push({
              type: 'item.used',
              id: randomUUID(),
              itemId,
              ...(itemTitle ? { title: itemTitle } : {}),
              actorId: attempt.actorId,
              ...(effectPlaceId ? { placeId: effectPlaceId } : {}),
              at,
              ...(purpose ? { purpose } : {}),
              ...(consumed ? { consumed: true } : {}),
              ...(note ? { note } : {}),
            });
            outputRefs = [{ kind: 'item', id: itemId }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'activity.participate') {
          const activityId = action.parameters.activityId;
          const title = action.parameters.title;
          const specifiedPlaceId =
            typeof action.parameters.placeId === 'string' && action.parameters.placeId.trim()
              ? action.parameters.placeId.trim()
              : undefined;
          const participantActorIds = Array.isArray(action.parameters.participantActorIds)
            ? action.parameters.participantActorIds
            : undefined;
          const outcome =
            typeof action.parameters.outcome === 'string' && action.parameters.outcome.trim()
              ? action.parameters.outcome.trim()
              : undefined;
          const note =
            typeof action.parameters.note === 'string' && action.parameters.note.trim()
              ? action.parameters.note.trim()
              : undefined;

          if (
            typeof activityId !== 'string' ||
            !activityId.trim() ||
            typeof title !== 'string' ||
            !title.trim() ||
            (participantActorIds !== undefined &&
              !participantActorIds.every((id: any) => typeof id === 'string' && id.trim())) ||
            Object.keys(action.parameters).some(
              (key) =>
                ![
                  'activityId',
                  'title',
                  'placeId',
                  'participantActorIds',
                  'outcome',
                  'note',
                ].includes(key),
            )
          ) {
            throw new AgentValidationError('ACTIVITY_PARTICIPATE_PARAMETERS');
          }

          const ownPlaceId = ownActual?.status === 'at' ? ownActual.placeId : undefined;
          if (!ownPlaceId) {
            failureCode = 'ACTOR_NOT_AT_ANY_PLACE';
          } else if (specifiedPlaceId && specifiedPlaceId !== ownPlaceId) {
            failureCode = 'ACTOR_NOT_AT_SPECIFIED_PLACE';
          }

          const effectivePlaceId = (ownPlaceId ?? specifiedPlaceId)!;
          const validParticipants = new Set<string>([attempt.actorId]);

          if (!failureCode && participantActorIds && participantActorIds.length > 0) {
            for (const pId of participantActorIds) {
              if (pId === attempt.actorId) continue;
              if (!executionWorld.actors.some((a: any) => a.id === pId)) {
                failureCode = 'PARTICIPANT_NOT_FOUND';
                break;
              }
              const pActual = (
                await sql.query(
                  'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3 AND source_version<=$4',
                  [attempt.worldId, ownerId, `actor:${pId}`, attempt.expectedWorldVersion],
                )
              ).rows[0]?.document;

              if (pActual?.status !== 'at' || pActual.placeId !== effectivePlaceId) {
                failureCode = 'PARTICIPANT_NOT_CO_LOCATED';
                break;
              }
              validParticipants.add(pId);
            }
          }

          if (!failureCode) {
            effects.push({
              type: 'activity.participated',
              id: randomUUID(),
              activityId,
              title,
              actorId: attempt.actorId,
              participantActorIds: Array.from(validParticipants),
              placeId: effectivePlaceId,
              at,
              ...(outcome ? { outcome } : {}),
              ...(note ? { note } : {}),
            });
            outputRefs = [{ kind: 'activity', id: activityId }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'relationship.bond') {
          const targetActorId = action.parameters.targetActorId;
          const relationship = action.parameters.relationship;
          const mayShare =
            typeof action.parameters.mayShare === 'boolean' ? action.parameters.mayShare : true;
          const reason =
            typeof action.parameters.reason === 'string' && action.parameters.reason.trim()
              ? action.parameters.reason.trim()
              : undefined;
          const note =
            typeof action.parameters.note === 'string' && action.parameters.note.trim()
              ? action.parameters.note.trim()
              : undefined;

          if (
            typeof targetActorId !== 'string' ||
            !targetActorId.trim() ||
            typeof relationship !== 'string' ||
            !relationship.trim() ||
            Object.keys(action.parameters).some(
              (key) =>
                !['targetActorId', 'relationship', 'mayShare', 'reason', 'note'].includes(key),
            )
          ) {
            throw new AgentValidationError('RELATIONSHIP_BOND_PARAMETERS');
          }

          if (targetActorId === attempt.actorId) {
            failureCode = 'ACTOR_CANNOT_BOND_SELF';
          } else if (!executionWorld.actors.some((a: any) => a.id === targetActorId)) {
            failureCode = 'TARGET_ACTOR_NOT_FOUND';
          }

          if (!failureCode) {
            const effectId = randomUUID();
            effects.push({
              type: 'relationship.bonded',
              id: effectId,
              fromActorId: attempt.actorId,
              toActorId: targetActorId,
              relationship,
              mayShare,
              at,
              ...(reason ? { reason } : {}),
              ...(note ? { note } : {}),
            });
            const tieKey = `${attempt.actorId}:${targetActorId}`;
            outputRefs = [{ kind: 'relationship', id: tieKey }];
            handledResponsibilityIds = [...action.handlesResponsibilityIds];
            if (action.goalId) {
              completedGoalIds = [action.goalId];
            }
          }
        } else if (action.capability === 'moment.publish') {
          const text = action.parameters.text;
          const keyParam = action.parameters.key;
          const placeId =
            typeof action.parameters.placeId === 'string' && action.parameters.placeId.trim()
              ? action.parameters.placeId.trim()
              : undefined;
          const image =
            typeof action.parameters.image === 'string' && action.parameters.image.trim()
              ? action.parameters.image.trim()
              : undefined;
          const images = Array.isArray(action.parameters.images)
            ? action.parameters.images
                .filter(
                  (img: unknown) => typeof img === 'string' && Boolean((img as string).trim()),
                )
                .map((img: string) => img.trim())
                .slice(0, 9)
            : undefined;
          const note =
            typeof action.parameters.note === 'string' && action.parameters.note.trim()
              ? action.parameters.note.trim()
              : undefined;

          if (
            typeof text !== 'string' ||
            !text.trim() ||
            text.trim().length > 1600 ||
            (keyParam !== undefined &&
              (typeof keyParam !== 'string' || !keyParam.trim() || keyParam.trim().length > 32)) ||
            Object.keys(action.parameters).some(
              (key) => !['text', 'key', 'placeId', 'image', 'images', 'note'].includes(key),
            )
          ) {
            throw new AgentValidationError('MOMENT_PUBLISH_PARAMETERS');
          }

          const momentKey =
            (typeof keyParam === 'string' && keyParam.trim()) ||
            `m_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

          const actorName =
            executionWorld.actors.find((a: any) => a.id === attempt.actorId)?.name || '未知';

          const effectId = randomUUID();
          effects.push({
            type: 'moment.published',
            id: effectId,
            key: momentKey,
            actorId: attempt.actorId,
            name: actorName,
            text: text.trim(),
            at,
            ...(placeId ? { placeId } : {}),
            ...(image ? { image } : {}),
            ...(images && images.length ? { images } : {}),
            ...(note ? { note } : {}),
          });
          outputRefs = [{ kind: 'moment', id: momentKey }];
          handledResponsibilityIds = [...action.handlesResponsibilityIds];
          if (action.goalId) {
            completedGoalIds = [action.goalId];
          }
        } else if (action.capability === 'moment.interact') {
          const momentKey = action.parameters.momentKey;
          const kind = action.parameters.kind;
          const comment = action.parameters.comment;
          const note =
            typeof action.parameters.note === 'string' && action.parameters.note.trim()
              ? action.parameters.note.trim()
              : undefined;

          if (
            typeof momentKey !== 'string' ||
            !momentKey.trim() ||
            momentKey.trim().length > 64 ||
            (kind !== 'like' && kind !== 'comment')
          ) {
            throw new AgentValidationError('MOMENT_INTERACTION_PARAMETERS');
          }

          let momentFound = (executionWorld.moments ?? []).some(
            (m: any) => m.key === momentKey.trim(),
          );
          if (!momentFound) {
            try {
              const pubRes = await sql.query(
                'SELECT parallel_life.publication_social_opening($1) AS document',
                [attempt.worldId],
              );
              const opening = pubRes.rows[0]?.document;
              if (opening && Array.isArray(opening.moments)) {
                momentFound = opening.moments.some((m: any) => m.key === momentKey.trim());
              }
            } catch {
              // Not in a published world or query unavailable
            }
          }

          if (!momentFound) {
            throw new AgentValidationError('MOMENT_NOT_FOUND');
          }

          if (kind === 'like') {
            const alreadyLiked = (executionWorld.momentInteractions ?? []).some(
              (interaction: any) =>
                interaction.momentKey === momentKey.trim() &&
                interaction.actorId === attempt.actorId &&
                interaction.kind === 'like',
            );
            if (alreadyLiked) {
              throw new AgentValidationError('MOMENT_ALREADY_LIKED');
            }
          } else if (kind === 'comment') {
            if (typeof comment !== 'string' || !comment.trim() || comment.trim().length > 500) {
              throw new AgentValidationError('COMMENT_EMPTY');
            }
          }

          const interactionId = randomUUID();
          effects.push({
            type: 'moment.interacted',
            id: interactionId,
            momentKey: momentKey.trim(),
            actorId: attempt.actorId,
            kind,
            ...(kind === 'comment' && typeof comment === 'string'
              ? { comment: comment.trim() }
              : {}),
            at,
            ...(note ? { note } : {}),
          });
          outputRefs = [{ kind: 'moment_interaction', id: interactionId }];
          handledResponsibilityIds = [...action.handlesResponsibilityIds];
          if (action.goalId) {
            completedGoalIds = [action.goalId];
          }
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
        } else if (action.capability === 'media.generate_image') {
          const validation = validateGenerateImageToolInput(action.parameters);
          if (!validation.success)
            throw new AgentValidationError(`MEDIA_IMAGE_PARAMETERS:${validation.errorCode}`);
          const reqId = randomUUID();
          const desc = validation.data.sceneDescription;
          effects.push({
            type: 'media.requested',
            id: reqId,
            prompt: desc,
            mediaType: 'image',
            title: `【留影】${desc.slice(0, 30)}`,
            targetActorId: attempt.actorId,
          });
          outputRefs = [{ kind: 'media', id: reqId }];
        } else if (action.capability === 'media.generate_video') {
          const validation = validateGenerateVideoToolInput(action.parameters);
          if (!validation.success)
            throw new AgentValidationError(`MEDIA_VIDEO_PARAMETERS:${validation.errorCode}`);
          const reqId = randomUUID();
          const desc = validation.data.actionDescription;
          effects.push({
            type: 'media.requested',
            id: reqId,
            prompt: desc,
            mediaType: 'video',
            title: `【动态】${desc.slice(0, 30)}`,
            targetActorId: attempt.actorId,
          });
          outputRefs = [{ kind: 'media', id: reqId }];
        } else if (action.capability === 'media.share') {
          const validation = validateMediaShareToolInput(action.parameters);
          if (!validation.success)
            throw new AgentValidationError(`MEDIA_SHARE_PARAMETERS:${validation.errorCode}`);
          const assetRow = (
            await sql.query(
              `SELECT id, status FROM parallel_life.assets WHERE world_id=$1 AND owner_id=$2 AND id=$3`,
              [attempt.worldId, ownerId, validation.data.assetId],
            )
          ).rows[0];
          if (!assetRow || assetRow.status !== 'ready') {
            failureCode = 'ASSET_NOT_READY';
          } else {
            outputRefs = [{ kind: 'asset', id: validation.data.assetId }];
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
          handledResponsibilityIds,
          evidenceSourceIds: action.sourceIds,
          completedGoalIds,
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
      for (const result of results) {
        const action = proposal.actions.find((a) => a.id === result.actionId);
        if (action?.capability === 'appointment.propose') {
          for (const output of result.outputRefs ?? []) {
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
          }
        }
      }
      for (const result of results) {
        const action = proposal.actions.find((a) => a.id === result.actionId);
        if (action?.capability === 'relationship.bond' && result.outcome === 'succeeded') {
          for (const output of result.outputRefs ?? []) {
            if (output.kind === 'relationship') {
              if (!accepted.state.relationshipIds.includes(output.id)) {
                accepted.state.relationshipIds.push(output.id);
              }
            }
          }
        }
        if (result.outcome === 'succeeded') {
          const isCancel = effects.some(
            (e) =>
              e.type === 'appointment.cancelled' &&
              result.handledResponsibilityIds.some((rId) => {
                const r = accepted.state.responsibilities.find((resp) => resp.id === rId);
                return r?.subject.kind === 'appointment' && r.subject.id === e.appointmentId;
              }),
          );
          const isAccept = effects.some(
            (e) =>
              e.type === 'appointment.confirmed' &&
              result.handledResponsibilityIds.some((rId) => {
                const r = accepted.state.responsibilities.find((resp) => resp.id === rId);
                return r?.subject.kind === 'appointment' && r.subject.id === e.appointmentId;
              }),
          );
          const isReschedule = effects.some(
            (e) =>
              e.type === 'appointment.rescheduled' &&
              result.handledResponsibilityIds.some((rId) => {
                const r = accepted.state.responsibilities.find((resp) => resp.id === rId);
                return r?.subject.kind === 'appointment' && r.subject.id === e.appointmentId;
              }),
          );
          for (const respId of result.handledResponsibilityIds) {
            const resp = accepted.state.responsibilities.find((r) => r.id === respId);
            if (resp && resp.status !== 'fulfilled' && resp.status !== 'withdrawn') {
              if (isCancel) {
                resp.status = 'withdrawn';
                resp.resolutionResultId = result.id;
                resp.endReason = '约定已撤回或取消';
              } else if (isAccept) {
                resp.status = 'open';
                resp.waitingOn = null;
                resp.resolutionResultId = result.id;
                resp.endReason = undefined;
              } else if (isReschedule) {
                resp.status = 'waiting';
                resp.waitingOn = 'player';
                resp.revision = (resp.revision ?? 0) + 1;
                resp.resolutionResultId = result.id;
                resp.endReason = undefined;
              } else {
                resp.status = 'fulfilled';
                resp.resolutionResultId = result.id;
                resp.endReason = '已按约履行';
              }
            }
          }
          for (const goalId of result.completedGoalIds ?? []) {
            const goal = accepted.state.goals.find((g) => g.id === goalId);
            if (goal && goal.status !== 'fulfilled' && goal.status !== 'withdrawn') {
              if (isCancel) {
                goal.status = 'withdrawn';
                goal.resultIds = Array.from(new Set([...goal.resultIds, result.id]));
                goal.endReason = '约定目标已撤回';
              } else if (isAccept || isReschedule) {
                goal.status = 'active';
                goal.resultIds = Array.from(new Set([...goal.resultIds, result.id]));
              } else {
                goal.status = 'fulfilled';
                goal.resultIds = Array.from(new Set([...goal.resultIds, result.id]));
                goal.endReason = '目标已达成';
              }
            }
          }
        }
      }
      for (const cancelEffect of effects.filter(
        (e): e is Extract<WorldEffect, { type: 'appointment.cancelled' }> =>
          e.type === 'appointment.cancelled',
      )) {
        for (const resp of accepted.state.responsibilities) {
          if (
            resp.subject.kind === 'appointment' &&
            resp.subject.id === cancelEffect.appointmentId &&
            resp.status !== 'fulfilled' &&
            resp.status !== 'withdrawn'
          ) {
            resp.status = 'withdrawn';
            resp.endReason = '约定已撤回或取消';
          }
        }
        for (const goal of accepted.state.goals) {
          if (
            goal.summary.includes(cancelEffect.appointmentId) &&
            goal.status !== 'fulfilled' &&
            goal.status !== 'withdrawn'
          ) {
            goal.status = 'withdrawn';
            goal.endReason = '约定目标已撤回';
          }
        }
      }
      for (const confirmEffect of effects.filter(
        (e): e is Extract<WorldEffect, { type: 'appointment.confirmed' }> =>
          e.type === 'appointment.confirmed',
      )) {
        const ap = executionWorld.appointments?.find(
          (a: any) => a.id === confirmEffect.appointmentId,
        );
        const title = ap?.title ?? '约定事项';
        const existingResp = accepted.state.responsibilities.find(
          (r) => r.subject.kind === 'appointment' && r.subject.id === confirmEffect.appointmentId,
        );
        if (existingResp) {
          if (existingResp.status !== 'fulfilled' && existingResp.status !== 'withdrawn') {
            existingResp.status = 'open';
            existingResp.waitingOn = null;
          }
        } else {
          accepted.state.responsibilities.push({
            id: `appointment:${confirmEffect.appointmentId}`,
            subject: { kind: 'appointment', id: confirmEffect.appointmentId },
            summary: `按约赴约：${title}`,
            sourceIds: [`appointment:${confirmEffect.appointmentId}`],
            revision: 0,
            status: 'open',
            waitingOn: null,
            nextCheck: [],
          });
        }
        const existingGoal = accepted.state.goals.find(
          (g) => g.summary.includes(confirmEffect.appointmentId) || g.summary.includes(title),
        );
        if (existingGoal) {
          if (existingGoal.status !== 'fulfilled' && existingGoal.status !== 'withdrawn') {
            existingGoal.status = 'active';
          }
        } else {
          accepted.state.goals.push({
            id: `goal:appointment:${confirmEffect.appointmentId}`,
            summary: `按时参加「${title}」`,
            status: 'active',
            sourceIds: [`appointment:${confirmEffect.appointmentId}`],
            resultIds: [],
          });
        }
      }
      for (const rescheduleEffect of effects.filter(
        (e): e is Extract<WorldEffect, { type: 'appointment.rescheduled' }> =>
          e.type === 'appointment.rescheduled',
      )) {
        const ap = executionWorld.appointments?.find(
          (a: any) => a.id === rescheduleEffect.appointmentId,
        );
        const title = ap?.title ?? '约定事项';
        const existingResp = accepted.state.responsibilities.find(
          (r) =>
            r.subject.kind === 'appointment' && r.subject.id === rescheduleEffect.appointmentId,
        );
        if (existingResp) {
          if (existingResp.status !== 'fulfilled' && existingResp.status !== 'withdrawn') {
            existingResp.status = 'waiting';
            existingResp.waitingOn = 'player';
            existingResp.deadline = {
              at: rescheduleEffect.newAt,
              sourceId: `appointment:${rescheduleEffect.appointmentId}`,
            };
            existingResp.summary = `改期等待确认：${title}`;
          }
        } else {
          accepted.state.responsibilities.push({
            id: `appointment:${rescheduleEffect.appointmentId}`,
            subject: { kind: 'appointment', id: rescheduleEffect.appointmentId },
            summary: `改期等待确认：${title}`,
            sourceIds: [`appointment:${rescheduleEffect.appointmentId}`],
            revision: 1,
            status: 'waiting',
            waitingOn: 'player',
            deadline: {
              at: rescheduleEffect.newAt,
              sourceId: `appointment:${rescheduleEffect.appointmentId}`,
            },
            nextCheck: [],
          });
        }
        const existingGoal = accepted.state.goals.find(
          (g) => g.summary.includes(rescheduleEffect.appointmentId) || g.summary.includes(title),
        );
        if (existingGoal) {
          if (existingGoal.status !== 'fulfilled' && existingGoal.status !== 'withdrawn') {
            existingGoal.status = 'active';
            existingGoal.summary = `按新时间参加「${title}」`;
          }
        } else {
          accepted.state.goals.push({
            id: `goal:appointment:${rescheduleEffect.appointmentId}`,
            summary: `按新时间参加「${title}」`,
            status: 'active',
            sourceIds: [`appointment:${rescheduleEffect.appointmentId}`],
            resultIds: [],
          });
        }
      }
      for (const statement of accepted.statements)
        effects.push({
          type: 'message.received',
          id: randomUUID(),
          actorId: attempt.actorId,
          text: statement.text,
        });
      // Media requests come from validated NPC actions above. A user's keyword
      // alone must not override this character's refusal or invent an execution.
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
      if (proposal.locationReports?.length) {
        const audience = await readLocationReportAudience(
          sql,
          ownerId,
          bounded,
          receivedInput,
          attempt.actorId,
        );
        positionKnowledge.push(
          ...projectLocationReportKnowledge({
            worldId: attempt.worldId,
            actorIds: bounded.actors.map((a: { id: string }) => a.id),
            placeIds: (bounded.space?.places ?? []).map((p: { id: string }) => p.id),
            responderActorId: attempt.actorId,
            input: receivedInput,
            inputSourceId: snapshot.input.sourceId,
            eventId,
            worldVersion: attempt.expectedWorldVersion + 1,
            reports: proposal.locationReports,
            audience,
          }),
        );
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
            effects: effects as (
              | Extract<WorldEffect, { type: 'appointment.proposed' }>
              | Extract<WorldEffect, { type: 'appointment.fulfilled' }>
              | Extract<WorldEffect, { type: 'appointment.cancelled' }>
              | Extract<WorldEffect, { type: 'appointment.confirmed' }>
              | Extract<WorldEffect, { type: 'appointment.rescheduled' }>
              | Extract<WorldEffect, { type: 'item.delivered' }>
              | Extract<WorldEffect, { type: 'item.used' }>
              | Extract<WorldEffect, { type: 'activity.participated' }>
              | Extract<WorldEffect, { type: 'relationship.bonded' }>
              | Extract<WorldEffect, { type: 'moment.published' }>
              | Extract<WorldEffect, { type: 'moment.interacted' }>
              | Extract<WorldEffect, { type: 'media.requested' }>
            )[],
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
        for (const effect of effects) {
          if (effect.type === 'appointment.fulfilled')
            await sql.query(
              "UPDATE parallel_life.world_appointments SET document=jsonb_set(document, '{status}', '\"attended\"') WHERE world_id=$1 AND owner_id=$2 AND id=$3",
              [attempt.worldId, ownerId, effect.appointmentId],
            );
          if (effect.type === 'appointment.cancelled')
            await sql.query(
              "UPDATE parallel_life.world_appointments SET status='cancelled', document=jsonb_set(document, '{status}', '\"cancelled\"') WHERE world_id=$1 AND owner_id=$2 AND id=$3",
              [attempt.worldId, ownerId, effect.appointmentId],
            );
          if (effect.type === 'appointment.confirmed') {
            await sql.query(
              "UPDATE parallel_life.world_appointments SET status='confirmed', document=jsonb_set(document, '{status}', '\"confirmed\"') WHERE world_id=$1 AND owner_id=$2 AND id=$3",
              [attempt.worldId, ownerId, effect.appointmentId],
            );
          }
          if (effect.type === 'appointment.rescheduled') {
            const loc = effect.placeId ?? effect.locationId;
            if (loc) {
              await sql.query(
                `UPDATE parallel_life.world_appointments 
                 SET status='proposed', 
                     document=jsonb_set(
                       jsonb_set(
                         jsonb_set(document, '{status}', '"proposed"'),
                         '{at}',
                         to_jsonb($4::text)
                       ),
                       '{placeId}',
                       to_jsonb($5::text)
                     )
                 WHERE world_id=$1 AND owner_id=$2 AND id=$3`,
                [attempt.worldId, ownerId, effect.appointmentId, effect.newAt, loc],
              );
            } else {
              await sql.query(
                `UPDATE parallel_life.world_appointments 
                 SET status='proposed', 
                     document=jsonb_set(
                       jsonb_set(
                         document, 
                         '{status}', 
                         '"proposed"'
                       ), 
                       '{at}', 
                       to_jsonb($4::text)
                     )
                 WHERE world_id=$1 AND owner_id=$2 AND id=$3`,
                [attempt.worldId, ownerId, effect.appointmentId, effect.newAt],
              );
            }
          }
        }
        for (const media of next.mediaRequests.filter((item) => item.sourceEventId === event.id)) {
          await sql.query(
            'INSERT INTO parallel_life.world_media_requests(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
            [media.id, attempt.worldId, ownerId, media],
          );
          await sql.query(
            'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
            [
              `${event.id}_${media.id}`,
              attempt.worldId,
              ownerId,
              event.id,
              {
                id: `${event.id}_${media.id}`,
                eventId: event.id,
                worldId: attempt.worldId,
                type: media.mediaType === 'video' ? 'video.generate' : 'image.generate',
                requestId: media.id,
                prompt: media.prompt,
                title: media.title,
                mediaType: media.mediaType,
                ...(media.targetActorId ? { targetActorId: media.targetActorId } : {}),
              },
            ],
          );
        }
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
      await projectEpisodeRequestInTransaction(sql, ownerId, { attempt, eventId });
      await projectAgentWorldChange(sql, ownerId, attempt.worldId, eventId);
      await this.afterCommit?.(sql, { attempt, eventId });
      await requireActiveAgentDeliveryInTransaction(
        sql,
        ownerId,
        attempt.worldId,
        'NPC_DELIVERY_DEFERRED',
      );
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
