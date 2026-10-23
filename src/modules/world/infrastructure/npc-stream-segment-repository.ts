import { resolveAgentCommitVersion, isAdmittedAgentCommitHead } from './agent-commit-version.ts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { actorContinuationBasis } from '../domain/actor-continuation.ts';
import type {
  ActorAgentState,
  AgentAttempt,
  AgentInputReceipt,
  AgentProposal,
} from '../domain/agent-runtime.ts';
import type { AgentRuntimeTransition } from '../domain/agent-state-event.ts';
import { readableActivityClock } from '../domain/clock-activity.ts';
import { projectStoryTime } from '../domain/clock.ts';
import {
  deterministicStreamEventId,
  streamUnitEventId,
  streamUnitCommandId,
  deterministicStreamMessageId,
  deterministicStreamSegmentId,
  deterministicStreamUserMessageId,
  type CommittedStreamMessageProjection,
  type CommittedStreamSegmentEvent,
  type NpcStreamCompletionStatus,
  type NpcStreamSegmentCredential,
  type NpcStreamSegmentStatus,
  type NpcStreamStatementDraft,
  type NpcStreamTurnSummary,
  type NpcStreamUnitKind,
} from '../domain/npc-stream-segment.ts';
import type { WorldEffect, WorldEvent, WorldState } from '../domain/types.ts';
import { requireActiveAgentDeliveryInTransaction } from './agent-delivery-activity.ts';
import { requireInputAuthority } from './agent-runtime-repository.ts';
import { storedActivityClock } from './clock-activity-repository.ts';
import { PostgresWorldRepository, storeTurnMemories } from './postgres-world-repository.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';

export type StreamSegmentFaultInjection = {
  failAtSegmentPersist?: (segmentIndex: number) => void;
  failBeforeSegmentCommit?: (segmentIndex: number) => void;
};

function buildPrefixStateAndTransition(input: {
  attempt: AgentAttempt;
  snapshot: AgentSnapshot;
  receivedInput: AgentInputReceipt;
  currentState: ActorAgentState;
  committedSegments: readonly {
    segmentIndex: number;
    messageId: string;
    text: string;
    requestsPlayerReply: boolean;
    questionForResponsibilityId?: string;
  }[];
  eventId: string;
  storyAt: string;
  commitVersion: number;
}): {
  effects: WorldEffect[];
  transition: AgentRuntimeTransition;
  stateAfter: ActorAgentState;
} {
  const { attempt, snapshot, receivedInput, currentState, committedSegments, eventId, storyAt } =
    input;
  const worldVersion = input.commitVersion;
  const effects: WorldEffect[] = committedSegments.map((seg) => ({
    type: 'message.received' as const,
    id: seg.messageId,
    actorId: attempt.actorId,
    text: seg.text,
  }));

  const statements: AgentProposal['statements'] = committedSegments.map((seg) => ({
    text: seg.text,
    dependsOnActionIds: [],
    ...(seg.requestsPlayerReply ? { requestsPlayerReply: true } : {}),
    ...(seg.questionForResponsibilityId
      ? { questionForResponsibilityId: seg.questionForResponsibilityId }
      : {}),
  }));

  const nextState: ActorAgentState = {
    ...structuredClone(currentState),
    revision: currentState.revision + 1,
    projectedWorldVersion: worldVersion,
  };

  for (const [idx, seg] of committedSegments.entries()) {
    if (!seg.requestsPlayerReply) continue;
    const questionSourceId = `message:${seg.messageId}`;
    nextState.focus = {
      channel: snapshot.channel.kind,
      threadId: snapshot.channel.threadId,
      subjectId: nextState.focus?.subjectId ?? null,
      questionSourceId,
      replyToActorId: attempt.actorId,
    };
    (nextState.questions ??= []).push({
      id: `${eventId}_question_${idx}`,
      channel: snapshot.channel.kind,
      threadId: snapshot.channel.threadId,
      sourceId: questionSourceId,
      text: seg.text,
      askedAt: storyAt,
      status: 'open',
      ...(seg.questionForResponsibilityId === undefined
        ? {}
        : { responsibilityId: seg.questionForResponsibilityId }),
    });
  }

  nextState.knowledgeSourceIds = [
    ...new Set([
      ...nextState.knowledgeSourceIds,
      ...(snapshot.worldContext?.knowledge.map((k) => k.sourceId) ?? []),
    ]),
  ];

  const continuation = {
    decision: 'no_current_intent' as const,
    reason: '已提交前序分段回复。',
    sourceIds: [snapshot.input.sourceId],
    planIds: [] as string[],
    questionIds: [] as string[],
    conditions: [] as import('../domain/agent-runtime.ts').AgentCondition[],
  };

  nextState.continuation = {
    ...continuation,
    version: 1,
    decidedAt: snapshot.storyAt,
    sourceInputId: snapshot.input.sourceId,
    basisHash: createHash('sha256').update(actorContinuationBasis(nextState)).digest('hex'),
  };

  const proposal: AgentProposal = {
    statements,
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
    continuation,
  };

  const transition: AgentRuntimeTransition = {
    schemaVersion: 1,
    engineEpoch: attempt.engineEpoch,
    inputReceiptId: attempt.inputReceiptId,
    inputStoryAt: receivedInput.storyAt,
    inputWorldVersion: receivedInput.expectedWorldVersion,
    actorRevisionBefore: currentState.revision,
    actorRevisionAfter: nextState.revision,
    proposal,
    results: [],
    stateAfter: nextState,
  };

  return { effects, transition, stateAfter: nextState };
}

export async function recordStreamSegmentError(
  db: PostgresDatabase,
  ownerId: string,
  input: {
    attempt: AgentAttempt;
    segmentIndex: number;
    text?: string;
  },
): Promise<void> {
  const { attempt, segmentIndex } = input;
  const eventId = deterministicStreamEventId(attempt.id);
  const segmentId = deterministicStreamSegmentId(attempt.id, segmentIndex);
  const messageId = deterministicStreamMessageId(eventId, segmentIndex);
  const safeText = input.text?.trim() ? input.text.trim().slice(0, 12000) : '[invalid_segment]';
  await db.transaction(ownerId, async (sql) => {
    await sql.query(
      `INSERT INTO parallel_life.agent_attempt_stream_segments(
        world_id, owner_id, attempt_id, command_id, actor_id, segment_index,
        segment_id, message_id, unit_kind, text, depends_on_action_ids,
        requests_player_reply, question_for_responsibility_id, status,
        completion_status, message_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'independent_statement',$9,'[]'::jsonb,false,NULL,'aborted_error','partial_interrupted',now())
      ON CONFLICT(world_id, attempt_id, segment_index)
      DO UPDATE SET status='aborted_error', completion_status='partial_interrupted', updated_at=now()`,
      [
        attempt.worldId,
        ownerId,
        attempt.id,
        attempt.commandId,
        attempt.actorId,
        segmentIndex,
        segmentId,
        messageId,
        safeText,
      ],
    );
  });
}

export async function persistAndCommitStreamSegment(
  db: PostgresDatabase,
  worlds: PostgresWorldRepository,
  ownerId: string,
  input: {
    attempt: AgentAttempt;
    snapshot: AgentSnapshot;
    statement: NpcStreamStatementDraft;
    unitKind: NpcStreamUnitKind;
    faultInjection?: StreamSegmentFaultInjection;
  },
): Promise<
  | { outcome: 'committed'; event: CommittedStreamSegmentEvent }
  | { outcome: 'withheld' }
  | { outcome: 'superseded'; reason: string }
> {
  const { attempt, snapshot, statement, unitKind, faultInjection } = input;
  const unit = `statement:${statement.segmentIndex}`;
  const eventId = streamUnitEventId(attempt.id, unit);
  const segmentId = deterministicStreamSegmentId(attempt.id, statement.segmentIndex);
  const messageId = deterministicStreamMessageId(eventId, statement.segmentIndex);
  let userMessageId = deterministicStreamUserMessageId(eventId);

  faultInjection?.failAtSegmentPersist?.(statement.segmentIndex);

  const initialStatus: NpcStreamSegmentStatus =
    unitKind === 'dependent_statement' ? 'withheld_dependency' : 'persisted';
  const nowIso = new Date().toISOString();

  await db.transaction(ownerId, async (sql) => {
    await sql.query(
      `INSERT INTO parallel_life.agent_attempt_stream_segments(
        world_id, owner_id, attempt_id, command_id, actor_id, segment_index,
        segment_id, message_id, unit_kind, text, depends_on_action_ids,
        requests_player_reply, question_for_responsibility_id, status,
        completion_status, message_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,'streaming',$15)
      ON CONFLICT(world_id, attempt_id, segment_index) DO NOTHING`,
      [
        attempt.worldId,
        ownerId,
        attempt.id,
        attempt.commandId,
        attempt.actorId,
        statement.segmentIndex,
        segmentId,
        messageId,
        unitKind,
        statement.text,
        JSON.stringify(statement.dependsOnActionIds),
        statement.requestsPlayerReply === true,
        statement.questionForResponsibilityId ?? null,
        initialStatus,
        nowIso,
      ],
    );
  });

  if (unitKind === 'dependent_statement') {
    return { outcome: 'withheld' };
  }

  try {
    faultInjection?.failBeforeSegmentCommit?.(statement.segmentIndex);
  } catch (error) {
    await db
      .transaction(ownerId, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.agent_attempt_stream_segments
           SET status='aborted_error', completion_status='partial_interrupted', updated_at=now()
           WHERE world_id=$1 AND owner_id=$2 AND attempt_id=$3 AND segment_index=$4`,
          [attempt.worldId, ownerId, attempt.id, statement.segmentIndex],
        );
      })
      .catch(() => {});
    throw error;
  }

  return db.transaction(ownerId, async (sql) => {
    const worldRow = (
      await sql.query(
        'SELECT version, state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [attempt.worldId, ownerId],
      )
    ).rows[0];
    if (!worldRow || worldRow.state?.deletedAt) {
      throw Object.assign(Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    }

    const epochRow = (
      await sql.query(
        'SELECT COALESCE(engine_epoch,1) AS engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
        [attempt.worldId, ownerId],
      )
    ).rows[0];
    if (Number(epochRow?.engine_epoch ?? 1) !== attempt.engineEpoch) {
      await markSegmentSupersededInTx(sql, ownerId, attempt, statement.segmentIndex);
      return { outcome: 'superseded' as const, reason: 'ENGINE_EPOCH_CONFLICT' };
    }

    const attemptRow = (
      await sql.query(
        'SELECT *, lease_until>clock_timestamp() AS live FROM parallel_life.agent_attempts WHERE id=$1 AND world_id=$2 AND owner_id=$3 FOR UPDATE',
        [attempt.id, attempt.worldId, ownerId],
      )
    ).rows[0];
    if (
      !attemptRow ||
      attemptRow.token !== attempt.token ||
      !attemptRow.live ||
      attemptRow.status !== 'request_sent'
    ) {
      await markSegmentSupersededInTx(sql, ownerId, attempt, statement.segmentIndex);
      return { outcome: 'superseded' as const, reason: 'ATTEMPT_STALE' };
    }

    const actorStateRow = (
      await sql.query(
        'SELECT revision, document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 FOR UPDATE',
        [attempt.worldId, ownerId, attempt.actorId],
      )
    ).rows[0];
    if (
      !actorStateRow ||
      Number(actorStateRow.revision) !== attempt.expectedActorRevision ||
      !isDeepStrictEqual(actorStateRow.document, snapshot.state)
    ) {
      await markSegmentSupersededInTx(sql, ownerId, attempt, statement.segmentIndex);
      return { outcome: 'superseded' as const, reason: 'AGENT_REVISION_CONFLICT' };
    }

    const receiptRow = (
      await sql.query(
        'SELECT document, created_at FROM parallel_life.agent_input_receipts WHERE id=$1 AND world_id=$2 AND owner_id=$3',
        [attempt.inputReceiptId, attempt.worldId, ownerId],
      )
    ).rows[0];
    const receivedInput = receiptRow?.document as AgentInputReceipt | undefined;
    if (!receivedInput) {
      await markSegmentSupersededInTx(sql, ownerId, attempt, statement.segmentIndex);
      return { outcome: 'superseded' as const, reason: 'INPUT_SCOPE_FORBIDDEN' };
    }

    // Check if a newer player input receipt arrived for this actor thread (user interruption)
    const newerPlayerInput = (
      await sql.query(
        `SELECT 1 FROM parallel_life.agent_input_receipts
         WHERE world_id=$1 AND owner_id=$2 AND id<>$3
           AND document->>'origin'='player'
           AND document->>'channel'='private'
           AND document->>'recipientActorId'=$4
           AND created_at >= $5
         LIMIT 1`,
        [attempt.worldId, ownerId, attempt.inputReceiptId, attempt.actorId, receiptRow.created_at],
      )
    ).rowCount;
    if (newerPlayerInput) {
      await markSegmentSupersededInTx(sql, ownerId, attempt, statement.segmentIndex);
      return { outcome: 'superseded' as const, reason: 'SUPERSEDED_BY_USER_INTERRUPT' };
    }

    await requireInputAuthority(
      sql,
      ownerId,
      receivedInput,
      attempt.actorId,
      attempt.expectedWorldVersion,
    );
    const { clock } = await requireActiveAgentDeliveryInTransaction(
      sql,
      ownerId,
      attempt.worldId,
      'NPC_DELIVERY_DEFERRED',
    );

    const priorCommitted = (
      await sql.query(
        `SELECT segment_index, message_id, text, requests_player_reply, question_for_responsibility_id, message_at, user_message_id
         FROM parallel_life.agent_attempt_stream_segments
         WHERE world_id=$1 AND owner_id=$2 AND attempt_id=$3 AND status='committed'
         ORDER BY segment_index ASC`,
        [attempt.worldId, ownerId, attempt.id],
      )
    ).rows;

    const isFirstCommit = priorCommitted.length === 0;
    if (!isFirstCommit) userMessageId = String(priorCommitted[0].user_message_id);
    const currentWorldVersion = Number(worldRow.version);

    const position = await resolveAgentCommitVersion(
      sql,
      ownerId,
      attempt,
      currentWorldVersion,
      !isFirstCommit,
      snapshot,
    );
    if (!position) {
      // Keep the persisted unit for the same response's final commit/recovery.
      // Another world append is not evidence of a player interrupt.
      return { outcome: 'superseded' as const, reason: 'VERSION_CONFLICT' };
    }

    const occurredAt = new Date().toISOString();
    const executionWorld = worldRow.state as WorldState;
    const worldTime = executionWorld.time;
    const storyAt = new Date(
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

    await sql.query(
      "SELECT set_config('app.agent_engine_epoch',$1,true),set_config('app.agent_world_id',$2,true),set_config('app.agent_commit_attempt_id',$3,true)",
      [String(attempt.engineEpoch), attempt.worldId, attempt.id],
    );

    const allCommitted = [
      ...priorCommitted.map((r) => ({
        segmentIndex: Number(r.segment_index),
        messageId: String(r.message_id),
        text: String(r.text),
        requestsPlayerReply: Boolean(r.requests_player_reply),
        ...(typeof r.question_for_responsibility_id === 'string'
          ? { questionForResponsibilityId: r.question_for_responsibility_id }
          : {}),
      })),
      {
        segmentIndex: statement.segmentIndex,
        messageId,
        text: statement.text,
        requestsPlayerReply: statement.requestsPlayerReply === true,
        ...(statement.questionForResponsibilityId
          ? { questionForResponsibilityId: statement.questionForResponsibilityId }
          : {}),
      },
    ];

    const { effects, transition } = buildPrefixStateAndTransition({
      attempt,
      snapshot,
      receivedInput,
      currentState: actorStateRow.document as ActorAgentState,
      committedSegments: allCommitted,
      eventId,
      storyAt,
      commitVersion: position.commitVersion,
    });

    const command = {
      id: streamUnitCommandId(attempt.id, unit),
      worldId: attempt.worldId,
      expectedVersion: position.appendBaseVersion,
      actorId: attempt.actorId,
      text: snapshot.input.text,
      ...(snapshot.input.origin !== 'player' ? { origin: 'director' as const } : {}),
    };

    const event: WorldEvent = {
      schemaVersion: 1,
      id: eventId,
      worldId: attempt.worldId,
      commandId: command.id,
      version: position.commitVersion,
      occurredAt,
      storyAt,
      type: 'turn.resolved',
      data: {
        actorId: attempt.actorId,
        userText: command.text,
        effects: effects.filter((effect) => effect.id === messageId),
        stream: {
          attemptId: attempt.id,
          parentCommandId: attempt.commandId,
          unit,
          inputMessageId: userMessageId,
        },
        origin: command.origin,
        userAt: receivedInput.storyAt,
        agentRuntime: transition,
      },
    };

    await worlds.commitInTransaction(sql, { userId: ownerId }, command, event, undefined, {
      legacyProgress: false,
      finalizePrefixEvent: false,
      skipMemories: true,
    });

    await sql.query(
      `UPDATE parallel_life.agent_attempt_stream_segments
       SET status='committed',
           source_event_id=$5,
           source_version=$6,
           user_message_id=$7,
           message_at=$8,
           updated_at=now()
       WHERE world_id=$1 AND owner_id=$2 AND attempt_id=$3 AND segment_index=$4`,
      [
        attempt.worldId,
        ownerId,
        attempt.id,
        statement.segmentIndex,
        eventId,
        position.commitVersion,
        userMessageId,
        storyAt,
      ],
    );

    const committedEvent: CommittedStreamSegmentEvent = {
      status: 'segment_committed',
      commandId: attempt.commandId,
      worldId: attempt.worldId,
      actorId: attempt.actorId,
      attemptId: attempt.id,
      eventId,
      version: position.commitVersion,
      segmentIndex: statement.segmentIndex,
      segmentId,
      unitKind,
      message: {
        id: messageId,
        actorId: attempt.actorId,
        role: 'assistant',
        text: statement.text,
        at: storyAt,
        sourceEventId: eventId,
        sourceVersion: position.commitVersion,
      },
      ...(isFirstCommit
        ? {
            userMessage: {
              id: userMessageId,
              actorId: attempt.actorId,
              role: 'user',
              text: command.text,
              at: receivedInput.storyAt,
              sourceEventId: eventId,
              sourceVersion: position.commitVersion,
            },
          }
        : {}),
    };

    return { outcome: 'committed' as const, event: committedEvent };
  });
}

async function markSegmentSupersededInTx(
  sql: SqlClient,
  ownerId: string,
  attempt: AgentAttempt,
  segmentIndex: number,
): Promise<void> {
  await sql.query(
    `UPDATE parallel_life.agent_attempt_stream_segments
     SET status='superseded_by_interrupt', completion_status='superseded', updated_at=now()
     WHERE world_id=$1 AND owner_id=$2 AND attempt_id=$3 AND segment_index=$4`,
    [attempt.worldId, ownerId, attempt.id, segmentIndex],
  );
}

export async function sealCommittedStreamPrefix(
  db: PostgresDatabase,
  ownerId: string,
  input: {
    attempt: AgentAttempt;
    snapshot: AgentSnapshot;
    completionStatus: 'partial_interrupted' | 'superseded';
    failureCode?: string;
    partialRawText?: string;
  },
): Promise<
  | {
      sealed: true;
      eventId: string;
      version: number;
      state: ActorAgentState;
      committedSegmentCount: number;
    }
  | { sealed: false }
> {
  const { attempt, snapshot, completionStatus, failureCode, partialRawText } = input;
  return db.transaction(ownerId, async (sql) => {
    const worldRow = (
      await sql.query(
        'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [attempt.worldId, ownerId],
      )
    ).rows[0];
    if (!worldRow) return { sealed: false as const };
    const attemptRow = (
      await sql.query(
        'SELECT * FROM parallel_life.agent_attempts WHERE id=$1 AND world_id=$2 AND owner_id=$3 FOR UPDATE',
        [attempt.id, attempt.worldId, ownerId],
      )
    ).rows[0];
    if (!attemptRow) return { sealed: false as const };

    const committedRows = (
      await sql.query(
        `SELECT segment_index, message_id, text, requests_player_reply, question_for_responsibility_id, source_event_id, source_version, user_message_id, message_at
         FROM parallel_life.agent_attempt_stream_segments
         WHERE world_id=$1 AND owner_id=$2 AND attempt_id=$3 AND status='committed'
         ORDER BY segment_index ASC FOR UPDATE`,
        [attempt.worldId, ownerId, attempt.id],
      )
    ).rows;

    if (committedRows.length === 0) {
      return { sealed: false as const };
    }

    let eventId = String(committedRows[0]!.source_event_id);
    let eventVersion = Number(committedRows[0]!.source_version);
    const appendUnits = Boolean(
      (
        await sql.query(
          'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3',
          [attempt.worldId, ownerId, eventId],
        )
      ).rows[0]?.payload?.data?.stream,
    );

    if (attemptRow.status === 'committed') {
      const stateRow = (
        await sql.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
          [attempt.worldId, ownerId, attempt.actorId],
        )
      ).rows[0];
      return {
        sealed: true as const,
        eventId: String(attemptRow.event_id ?? eventId),
        version: Number(
          (
            await sql.query(
              'SELECT version FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3',
              [attempt.worldId, ownerId, attemptRow.event_id ?? eventId],
            )
          ).rows[0]?.version ?? eventVersion,
        ),
        state: (stateRow?.document ?? snapshot.state) as ActorAgentState,
        committedSegmentCount: committedRows.length,
      };
    }

    // Mark any uncommitted segments in the ledger as superseded/aborted
    const remainderStatus: NpcStreamSegmentStatus =
      completionStatus === 'superseded' ? 'superseded_by_interrupt' : 'aborted_error';
    await sql.query(
      `UPDATE parallel_life.agent_attempt_stream_segments
       SET status = CASE WHEN status='committed' THEN 'committed' ELSE $4 END,
           completion_status = $5,
           updated_at = now()
       WHERE world_id=$1 AND owner_id=$2 AND attempt_id=$3`,
      [attempt.worldId, ownerId, attempt.id, remainderStatus, completionStatus],
    );

    const stateRow = (
      await sql.query(
        'SELECT revision, document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 FOR UPDATE',
        [attempt.worldId, ownerId, attempt.actorId],
      )
    ).rows[0];
    if (!stateRow || Number(stateRow.revision) !== attempt.expectedActorRevision) {
      return { sealed: false as const };
    }

    const receiptRow = (
      await sql.query(
        'SELECT document FROM parallel_life.agent_input_receipts WHERE id=$1 AND world_id=$2 AND owner_id=$3',
        [attempt.inputReceiptId, attempt.worldId, ownerId],
      )
    ).rows[0];
    const receivedInput = receiptRow?.document as AgentInputReceipt | undefined;
    if (!receivedInput) return { sealed: false as const };

    if (appendUnits) {
      const media = (
        await sql.query(
          `SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND command_id=$4`,
          [
            attempt.worldId,
            ownerId,
            streamUnitEventId(attempt.id, 'media'),
            streamUnitCommandId(attempt.id, 'media'),
          ],
        )
      ).rows[0]?.payload?.data?.agentRuntime as AgentRuntimeTransition | undefined;
      eventId = streamUnitEventId(attempt.id, 'final');
      eventVersion = Number(worldRow.version) + 1;
      const base = media
        ? {
            ...media.stateAfter,
            revision: attempt.expectedActorRevision,
            questions: snapshot.state.questions,
            focus: snapshot.state.focus,
          }
        : (stateRow.document as ActorAgentState);
      const storyAt = (worldRow.state as WorldState).time;
      const built = buildPrefixStateAndTransition({
        attempt,
        snapshot,
        receivedInput,
        currentState: base,
        committedSegments: committedRows.map((r) => ({
          segmentIndex: Number(r.segment_index),
          messageId: String(r.message_id),
          text: String(r.text),
          requestsPlayerReply: Boolean(r.requests_player_reply),
          ...(r.question_for_responsibility_id
            ? { questionForResponsibilityId: String(r.question_for_responsibility_id) }
            : {}),
        })),
        eventId,
        storyAt,
        commitVersion: eventVersion,
      });
      // A failed suffix has made no new continuation decision. Keep the already
      // accepted plan/waiting basis instead of inventing a no-intent conclusion.
      if (base.continuation) {
        built.stateAfter.continuation = {
          ...base.continuation,
          basisHash: createHash('sha256')
            .update(actorContinuationBasis(built.stateAfter))
            .digest('hex'),
        };
        const { decision, reason, sourceIds, planIds, questionIds, conditions } = base.continuation;
        built.transition.proposal.continuation = {
          decision,
          reason,
          sourceIds,
          planIds,
          questionIds,
          conditions,
        };
      } else {
        delete built.stateAfter.continuation;
        delete built.transition.proposal.continuation;
      }
      const event: WorldEvent = {
        schemaVersion: 1,
        id: eventId,
        worldId: attempt.worldId,
        commandId: attempt.commandId,
        version: eventVersion,
        occurredAt: new Date().toISOString(),
        storyAt,
        type: 'turn.resolved',
        data: {
          actorId: attempt.actorId,
          userText: snapshot.input.text,
          userAt: receivedInput.storyAt,
          ...(snapshot.input.origin !== 'player' ? { origin: 'director' as const } : {}),
          effects: [],
          agentRuntime: built.transition,
          stream: {
            attemptId: attempt.id,
            parentCommandId: attempt.commandId,
            unit: 'final',
            inputMessageId: String(committedRows[0]!.user_message_id),
          },
        },
      };
      await sql.query(
        "SELECT set_config('app.agent_engine_epoch',$1,true),set_config('app.agent_world_id',$2,true),set_config('app.agent_commit_attempt_id',$3,true)",
        [String(attempt.engineEpoch), attempt.worldId, attempt.id],
      );
      const worlds = new PostgresWorldRepository(db);
      await worlds.commitInTransaction(
        sql,
        { userId: ownerId },
        {
          id: attempt.commandId,
          worldId: attempt.worldId,
          actorId: attempt.actorId,
          expectedVersion: eventVersion - 1,
          text: snapshot.input.text,
          ...(snapshot.input.origin !== 'player' ? { origin: 'director' as const } : {}),
        },
        event,
        undefined,
        { legacyProgress: false, sealStreamPrefix: true },
      );
      const raw = JSON.stringify({
        kind: 'npc_agent_partial_stream',
        schemaVersion: 1,
        snapshot,
        partialRawText: partialRawText?.slice(0, 200000),
        partialStream: { completionStatus, failureCode },
      });
      await sql.query(
        `UPDATE parallel_life.agent_attempts SET status='committed',event_id=$2,response=COALESCE(response,$3::jsonb),response_hash=COALESCE(response_hash,$4),updated_at=now() WHERE id=$1`,
        [attempt.id, eventId, raw, createHash('sha256').update(raw).digest('hex')],
      );
      await sql.query(
        `UPDATE parallel_life.actor_agent_states SET revision=$4,projected_world_version=$5,document=$6,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND revision=$7`,
        [
          attempt.worldId,
          ownerId,
          attempt.actorId,
          built.stateAfter.revision,
          eventVersion,
          built.stateAfter,
          attempt.expectedActorRevision,
        ],
      );
      await projectAgentWorldChange(sql, ownerId, attempt.worldId, eventId);
      return {
        sealed: true as const,
        eventId,
        version: eventVersion,
        state: built.stateAfter,
        committedSegmentCount: committedRows.length,
      };
    }
    const eventRow = (
      await sql.query(
        'SELECT payload, occurred_at FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE',
        [attempt.worldId, ownerId, eventId],
      )
    ).rows[0];
    if (!eventRow) return { sealed: false as const };

    const storyAt = String(
      eventRow.payload?.storyAt ?? committedRows.at(-1)!.message_at ?? snapshot.storyAt,
    );
    let { effects, transition, stateAfter } = buildPrefixStateAndTransition({
      attempt,
      snapshot,
      receivedInput,
      currentState: stateRow.document as ActorAgentState,
      committedSegments: committedRows.map((r) => ({
        segmentIndex: Number(r.segment_index),
        messageId: String(r.message_id),
        text: String(r.text),
        requestsPlayerReply: Boolean(r.requests_player_reply),
        ...(typeof r.question_for_responsibility_id === 'string'
          ? { questionForResponsibilityId: r.question_for_responsibility_id }
          : {}),
      })),
      eventId,
      storyAt,
      commitVersion: eventVersion,
    });

    const acceptedPrefix = eventRow.payload?.data?.agentRuntime as
      AgentRuntimeTransition | undefined;
    if (Number(worldRow.version) !== eventVersion && !acceptedPrefix)
      return { sealed: false as const };
    if (
      Number(worldRow.version) !== eventVersion ||
      acceptedPrefix?.results.some((result) =>
        result.outputRefs?.some((ref) => ref.kind === 'media'),
      )
    ) {
      // The suffix failing cannot erase an already authorized, queued media action.
      effects = eventRow.payload.data.effects;
      transition = acceptedPrefix!;
      stateAfter = acceptedPrefix!.stateAfter;
    }

    const sealedEvent: WorldEvent = {
      ...(eventRow.payload as WorldEvent),
      data: {
        ...(eventRow.payload.data as WorldEvent['data']),
        effects,
        agentRuntime: transition,
      },
    };

    await sql.query(
      "SELECT set_config('app.agent_engine_epoch',$1,true),set_config('app.agent_world_id',$2,true),set_config('app.agent_commit_attempt_id',$3,true)",
      [String(attempt.engineEpoch), attempt.worldId, attempt.id],
    );

    // Once another event follows this prefix, it is history: seal only the ledger
    // and actor state already represented by that event, never rewrite its payload.
    if (Number(worldRow.version) === eventVersion)
      await sql.query(
        'UPDATE parallel_life.world_events SET payload=$4 WHERE world_id=$1 AND owner_id=$2 AND id=$3',
        [attempt.worldId, ownerId, eventId, sealedEvent],
      );
    if (worldRow) {
      const hydrated = await PostgresWorldRepository.hydrateInTransaction(sql, {
        ...(worldRow.state as WorldState),
        version: Number(worldRow.version),
      });
      await storeTurnMemories(sql, ownerId, hydrated, sealedEvent);
    }

    if (!attemptRow.response_hash) {
      // Honest record: the actual (possibly truncated) raw stream, never a fabricated complete reply.
      const syntheticBody = JSON.stringify({
        kind: 'npc_agent_partial_stream',
        schemaVersion: 1,
        snapshot,
        ...(partialRawText ? { partialRawText: partialRawText.slice(0, 200000) } : {}),
        partialStream: {
          completionStatus,
          committedSegmentCount: committedRows.length,
          ...(failureCode ? { failureCode } : {}),
          ...(partialRawText ? { partialRawBytes: Buffer.byteLength(partialRawText) } : {}),
        },
      });
      const digest = createHash('sha256').update(syntheticBody).digest('hex');
      await sql.query(
        'UPDATE parallel_life.agent_attempts SET response=$2::jsonb, response_hash=$3, status=$4, event_id=$5, updated_at=now() WHERE id=$1',
        [attempt.id, syntheticBody, digest, 'committed', eventId],
      );
    } else {
      await sql.query(
        "UPDATE parallel_life.agent_attempts SET status='committed', event_id=$2, updated_at=now() WHERE id=$1",
        [attempt.id, eventId],
      );
    }

    await sql.query(
      'UPDATE parallel_life.actor_agent_states SET revision=$4, projected_world_version=$5, document=$6, updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND revision=$7',
      [
        attempt.worldId,
        ownerId,
        attempt.actorId,
        stateAfter.revision,
        stateAfter.projectedWorldVersion,
        stateAfter,
        attempt.expectedActorRevision,
      ],
    );

    for (const result of transition.results) {
      await sql.query(
        `INSERT INTO parallel_life.agent_action_results(world_id,owner_id,actor_id,id,action_id,source_event_id,world_version,document)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(world_id,id) DO NOTHING`,
        [
          attempt.worldId,
          ownerId,
          attempt.actorId,
          result.id,
          result.actionId,
          eventId,
          eventVersion,
          result,
        ],
      );
    }
    await projectAgentWorldChange(sql, ownerId, attempt.worldId, eventId);

    return {
      sealed: true as const,
      eventId,
      version: eventVersion,
      state: stateAfter,
      committedSegmentCount: committedRows.length,
    };
  });
}

export async function readStreamSegmentsForCommand(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  commandId: string,
): Promise<{
  segments: NpcStreamSegmentCredential[];
  messages: CommittedStreamMessageProjection[];
  summary: NpcStreamTurnSummary | null;
}> {
  return db.transaction(ownerId, async (sql) => {
    const rows = (
      await sql.query(
        `SELECT * FROM parallel_life.agent_attempt_stream_segments
         WHERE world_id=$1 AND owner_id=$2 AND command_id=$3
         ORDER BY segment_index ASC`,
        [worldId, ownerId, commandId],
      )
    ).rows;
    if (rows.length === 0) {
      return { segments: [], messages: [], summary: null };
    }
    const segments: NpcStreamSegmentCredential[] = rows.map((r) => ({
      worldId: String(r.world_id),
      attemptId: String(r.attempt_id),
      commandId: String(r.command_id),
      actorId: String(r.actor_id),
      segmentIndex: Number(r.segment_index),
      segmentId: String(r.segment_id),
      messageId: String(r.message_id),
      unitKind: r.unit_kind as NpcStreamUnitKind,
      text: String(r.text),
      dependsOnActionIds: Array.isArray(r.depends_on_action_ids)
        ? (r.depends_on_action_ids as string[])
        : [],
      requestsPlayerReply: Boolean(r.requests_player_reply),
      ...(typeof r.question_for_responsibility_id === 'string'
        ? { questionForResponsibilityId: r.question_for_responsibility_id }
        : {}),
      status: r.status as NpcStreamSegmentStatus,
      completionStatus: r.completion_status as NpcStreamCompletionStatus,
      ...(typeof r.source_event_id === 'string' ? { sourceEventId: r.source_event_id } : {}),
      ...(typeof r.source_version === 'number' ? { sourceVersion: r.source_version } : {}),
      ...(typeof r.user_message_id === 'string' ? { userMessageId: r.user_message_id } : {}),
      messageAt: new Date(r.message_at).toISOString(),
    }));

    const committedWithEvent = [...segments]
      .reverse()
      .find((s) => s.status === 'committed' && s.sourceEventId !== undefined);
    let messages: CommittedStreamMessageProjection[] = [];
    if (committedWithEvent?.sourceEventId) {
      const msgRows = (
        await sql.query(
          `SELECT document FROM parallel_life.world_messages
           WHERE world_id=$1 AND owner_id=$2 AND document->>'sourceEventId'=ANY($3::text[])
           ORDER BY ordinal ASC`,
          [
            worldId,
            ownerId,
            [
              ...new Set(
                segments.filter((s) => s.status === 'committed').map((s) => s.sourceEventId),
              ),
            ],
          ],
        )
      ).rows;
      messages = msgRows
        .map((row) => {
          const doc = row.document as Record<string, unknown> | undefined;
          if (!doc) return undefined;
          return {
            id: String(doc.id),
            actorId: String(doc.actorId),
            role: doc.role as 'user' | 'assistant',
            text: String(doc.text),
            at: String(doc.at),
            sourceEventId: String(doc.sourceEventId),
            sourceVersion: Number(doc.sourceVersion ?? committedWithEvent.sourceVersion),
          };
        })
        .filter((doc): doc is CommittedStreamMessageProjection => Boolean(doc));
    }

    const terminal = committedWithEvent
      ? (
          await sql.query(
            `SELECT e.id,e.version FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3 AND a.status='committed'`,
            [worldId, ownerId, committedWithEvent.attemptId],
          )
        ).rows[0]
      : undefined;
    const summary: NpcStreamTurnSummary | null = committedWithEvent
      ? {
          attemptId: committedWithEvent.attemptId,
          commandId,
          eventId: String(terminal?.id ?? committedWithEvent.sourceEventId!),
          version: Number(terminal?.version ?? committedWithEvent.sourceVersion!),
          completionStatus: segments[0]!.completionStatus,
          committedSegmentCount: segments.filter((s) => s.status === 'committed').length,
          withheldSegmentCount: segments.filter((s) => s.status === 'withheld_dependency').length,
          supersededSegmentCount: segments.filter((s) => s.status === 'superseded_by_interrupt')
            .length,
          abortedSegmentCount: segments.filter((s) => s.status === 'aborted_error').length,
        }
      : null;

    return { segments, messages, summary };
  });
}

export async function isStreamPrefixWorldVersion(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  actorId: string,
  expectedWorldVersion: number,
  actualWorldVersion: number,
): Promise<boolean> {
  if (
    await isAdmittedAgentCommitHead(
      sql,
      ownerId,
      worldId,
      actorId,
      expectedWorldVersion,
      actualWorldVersion,
    )
  )
    return true;
  if (actualWorldVersion !== expectedWorldVersion + 1) return false;
  const res = await sql.query(
    `SELECT 1 FROM parallel_life.agent_attempt_stream_segments s
     JOIN parallel_life.world_events e ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id
     WHERE s.world_id=$1 AND s.owner_id=$2 AND s.actor_id=$3 AND s.status='committed'
       AND e.version=$4 LIMIT 1`,
    [worldId, ownerId, actorId, actualWorldVersion],
  );
  return (res.rowCount ?? 0) > 0;
}
