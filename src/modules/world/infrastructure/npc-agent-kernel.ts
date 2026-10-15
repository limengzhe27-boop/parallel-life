import { projectAgentWorldChange } from './world-awareness-commit.ts';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
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

/** Deterministic capability execution + one UoW; models never hold a SQL connection. */
export class PostgresNpcAgentKernel implements AgentKernel {
  private readonly db: PostgresDatabase;
  private readonly worlds: PostgresWorldRepository;
  constructor(db: PostgresDatabase, worlds: PostgresWorldRepository) {
    this.db = db;
    this.worlds = worlds;
  }
  parse(snapshot: AgentSnapshot, raw: unknown) {
    return parseAgentProposal(snapshot, raw);
  }
  async commit(ownerId: string, input: Parameters<AgentKernel['commit']>[1]) {
    const { attempt, snapshot } = input;
    if (snapshot.channel.kind !== 'private')
      throw new AgentValidationError('CHANNEL_PROJECTOR_NOT_REGISTERED');
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
            'SELECT id,text,status FROM parallel_life.memory_records WHERE owner_id=$1 AND character_id=$2 AND (branch_id=$3 OR branch_id IS NULL) AND id=ANY($4::uuid[])',
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
      const worldTime = String(
        (
          await sql.query(
            'SELECT state->>$$time$$ AS time FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2',
            [attempt.worldId, ownerId],
          )
        ).rows[0].time,
      );
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
      const results: AgentActionResult[] = [],
        effects: WorldEffect[] = [];
      for (const action of proposal.actions) {
        if (!['ready', 'proposed', 'waiting'].includes(action.status)) continue;
        const eligibility = evaluateAgentActionEligibility(snapshot, proposal, action, {
          storyAt: at,
          trustedResults: [...historicalResults, ...results],
        });
        if (eligibility.status !== 'ready') {
          action.status = eligibility.status;
          continue;
        }
        if (action.handlesResponsibilityIds.length)
          throw new AgentValidationError('CAPABILITY_CANNOT_HANDLE_EXTERNAL_RESPONSIBILITY');
        let outputRefs: NonNullable<AgentActionResult['outputRefs']> = [];
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
            id: `${eventId}_effect_${effects.length}`,
            title,
            at: new Date(proposedAt).toISOString(),
            participantIds: [attempt.actorId],
          });
          outputRefs = [{ kind: 'appointment', id: effects.at(-1)!.id }];
        } else throw new AgentValidationError('UNREGISTERED_CAPABILITY');
        results.push({
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
      const transition: AgentRuntimeTransition = {
        schemaVersion: 1,
        engineEpoch: attempt.engineEpoch,
        inputReceiptId: attempt.inputReceiptId,
        inputStoryAt: receivedInput.storyAt,
        inputWorldVersion: receivedInput.expectedWorldVersion,
        actorRevisionBefore: current.revision,
        actorRevisionAfter: accepted.state.revision,
        proposal: { ...proposal, statements: accepted.statements },
        results,
        stateAfter: accepted.state,
      };
      for (const statement of accepted.statements)
        effects.push({
          type: 'message.received',
          id: `${eventId}_effect_${effects.length}`,
          actorId: attempt.actorId,
          text: statement.text,
        });
      const command = {
        id: attempt.commandId,
        worldId: attempt.worldId,
        expectedVersion: attempt.expectedWorldVersion,
        actorId: attempt.actorId,
        text: snapshot.input.text,
        ...(snapshot.input.origin !== 'player' ? { origin: 'director' as const } : {}),
      };
      if (accepted.statements.length) {
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
      await projectAgentWorldChange(sql, ownerId, attempt.worldId, eventId);
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
