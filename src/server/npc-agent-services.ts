import type { FailureDiagnosticInput } from './http-failure-diagnostics.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { TextModel } from '../modules/ai/application/ports.ts';
import type { PostgresDatabase, SqlClient } from '../modules/storage/infrastructure/postgres.ts';
import type { TurnCommand } from '../modules/world/domain/types.ts';
import { runNpcAgent, type AgentRunPhaseTimings } from '../modules/world/application/run-agent.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { readChatContextWorld } from '../modules/world/infrastructure/chat-context-read-repository.ts';
import {
  ChatContextFallbackError,
  type ChatContextRead,
} from '../modules/world/application/chat-context-read.ts';
import { PostgresClockStore } from '../modules/world/infrastructure/clock-repository.ts';
import {
  readPrivateAgentSnapshot,
  readSnapshotCacheMetrics,
} from '../modules/world/infrastructure/agent-snapshot-repository.ts';
import { NpcAgentModel } from '../modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { validateCommand } from '../modules/world/domain/validation.ts';
import type { MessageReceiptLookup } from '../contracts/message-receipt-lookup.ts';
import type {
  ChatTurnServerMetrics,
  CommittedTurnMessage,
} from '../contracts/world-interaction.ts';
import {
  classifyChatTurnError,
  roundDurationMs,
  type ChatTurnTelemetryRecord,
} from '../modules/world/domain/chat-turn-metrics.ts';
import type { AgentAttempt, AgentInputReceipt } from '../modules/world/domain/agent-runtime.ts';
import type {
  AgentAttemptStore,
  AgentSnapshot,
} from '../modules/world/application/agent-runtime-ports.ts';
import type {
  CommittedStreamSegmentEvent,
  NpcStreamTurnSummary,
} from '../modules/world/domain/npc-stream-segment.ts';
import {
  persistAndCommitStreamSegment,
  readStreamSegmentsForCommand,
  recordStreamSegmentError,
  sealCommittedStreamPrefix,
} from '../modules/world/infrastructure/npc-stream-segment-repository.ts';
const inputHash = (command: TurnCommand) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        command.worldId,
        command.expectedVersion,
        command.actorId,
        command.text,
        'private',
        'player',
      ]),
    )
    .digest('hex');

export class NpcMessageError extends Error {
  readonly apiCode: 'UNKNOWN' | 'BUSY' | 'INVALID_AI_OUTPUT' | 'VERSION_CONFLICT' | 'INVALID_STATE';
  readonly status: number;
  readonly retryable = false;
  readonly diagnostic?: FailureDiagnosticInput;
  constructor(
    code: NpcMessageError['apiCode'],
    message: string,
    status: number,
    diagnostic?: FailureDiagnosticInput,
  ) {
    super(message);
    this.apiCode = code;
    this.status = status;
    this.diagnostic = diagnostic;
  }
}
/** A protected response may be applied, never re-sent or used to claim new work. */
export function protectedMessageReplayStore(
  store: AgentAttemptStore,
  expectedOwnerId: string,
  expected: AgentAttempt,
): AgentAttemptStore {
  if (!['response_received', 'committed'].includes(expected.status))
    throw new DomainError('INVALID_COMMAND');
  const sameIdentity = (ownerId: string, value: Parameters<AgentAttemptStore['claim']>[1]) => {
    if (
      ownerId !== expectedOwnerId ||
      (
        [
          'id',
          'worldId',
          'actorId',
          'commandId',
          'inputReceiptId',
          'inputHash',
          'engineEpoch',
          'expectedWorldVersion',
          'expectedActorRevision',
          'token',
        ] as const
      ).some((key) => value[key] !== expected[key])
    )
      throw new DomainError('IDEMPOTENCY_CONFLICT');
  };
  return {
    lookup: async (ownerId, worldId, commandId) => {
      if (
        ownerId !== expectedOwnerId ||
        worldId !== expected.worldId ||
        commandId !== expected.commandId
      )
        throw new DomainError('IDEMPOTENCY_CONFLICT');
      return store.lookup(ownerId, worldId, commandId);
    },
    claim: async (ownerId, claim) => {
      sameIdentity(ownerId, claim);
      const existing = await store.lookup(ownerId, expected.worldId, expected.commandId);
      if (!existing) throw new DomainError('NOT_FOUND');
      sameIdentity(ownerId, existing);
      return { attempt: existing, replay: true };
    },
    mark: async (ownerId, attempt, status) => {
      sameIdentity(ownerId, attempt);
      if (status !== 'invalid_output' && status !== 'stale_discarded')
        throw Error('MESSAGE_RECOVERY_CANNOT_MUTATE_SEND_LIFECYCLE');
      return store.mark(ownerId, attempt, status);
    },
    readResponse: (ownerId, attempt) => {
      sameIdentity(ownerId, attempt);
      return store.readResponse(ownerId, attempt);
    },
    saveResponse: async () => {
      throw Error('MESSAGE_RECOVERY_CANNOT_SAVE_MODEL_RESPONSE');
    },
  };
}
/** One explicit engine boundary, not candidate-source fallback. Epoch 2 never calls the old planner. */
export function npcAgentServices(db: PostgresDatabase, modelFactory: () => TextModel) {
  const store = new PostgresAgentRuntimeRepository(db),
    worlds = new PostgresWorldRepository(db);
  const identity = (command: TurnCommand) => ({
    commandId: command.id,
    worldId: command.worldId,
    actorId: command.actorId,
  });
  async function acceptedMessage(ownerId: string, command: TurnCommand) {
    validateCommand(command);
    if (command.origin) throw new DomainError('INVALID_COMMAND');
    const control = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            'SELECT COALESCE(c.engine_epoch,1) AS engine_epoch FROM parallel_life.worlds w LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id WHERE w.id=$1 AND w.owner_id=$2',
            [command.worldId, ownerId],
          )
        ).rows[0],
    );
    if (!control) throw new DomainError('NOT_FOUND');
    const accepted = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
            [command.worldId, ownerId, command.id],
          )
        ).rows[0]?.document as AgentInputReceipt | undefined,
    );
    if (
      accepted &&
      (accepted.worldId !== command.worldId ||
        accepted.commandId !== command.id ||
        accepted.inputHash !== inputHash(command) ||
        accepted.recipientActorId !== command.actorId ||
        accepted.text !== command.text ||
        accepted.expectedWorldVersion !== command.expectedVersion ||
        accepted.channel !== 'private' ||
        accepted.threadId !== command.actorId ||
        accepted.origin !== 'player')
    )
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    return { accepted, epoch: Number(control.engine_epoch) };
  }
  function verifyAttempt(command: TurnCommand, accepted: AgentInputReceipt, attempt: AgentAttempt) {
    if (
      attempt.worldId !== command.worldId ||
      attempt.actorId !== command.actorId ||
      attempt.commandId !== command.id ||
      attempt.inputReceiptId !== accepted.id ||
      attempt.inputHash !== accepted.inputHash
    )
      throw new DomainError('IDEMPOTENCY_CONFLICT');
  }
  async function receiptForAttempt(
    ownerId: string,
    command: TurnCommand,
    attempt: AgentAttempt | null,
  ): Promise<MessageReceiptLookup> {
    if (
      attempt &&
      ['invalid_output', 'stale_discarded', 'cancelled_before_send'].includes(attempt.status)
    )
      return {
        ...identity(command),
        status: 'failed',
        code:
          attempt.status === 'invalid_output'
            ? 'INVALID_AI_OUTPUT'
            : attempt.status === 'stale_discarded'
              ? 'VERSION_CONFLICT'
              : 'INVALID_STATE',
      };
    if (attempt?.status !== 'committed')
      return {
        ...identity(command),
        status: 'unconfirmed',
        recovery:
          attempt?.status === 'response_received'
            ? 'response_received'
            : attempt?.status === 'unknown_after_send'
              ? 'unknown'
              : 'pending',
      };
    const event = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            'SELECT id,version FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3',
            [command.worldId, ownerId, attempt.eventId],
          )
        ).rows[0],
    );
    return event
      ? {
          ...identity(command),
          status: 'committed',
          eventId: String(event.id),
          version: Number(event.version),
        }
      : { ...identity(command), status: 'unconfirmed', recovery: 'unknown' };
  }
  async function lookupMessage(
    ownerId: string,
    command: TurnCommand,
  ): Promise<MessageReceiptLookup | null> {
    const { accepted } = await acceptedMessage(ownerId, command);
    // Compatibility: old-engine receipts are still read by the caller, never executed here.
    if (!accepted) return null;
    const attempt = await store.lookup(ownerId, command.worldId, command.id);
    if (attempt) verifyAttempt(command, accepted, attempt);
    return receiptForAttempt(ownerId, command, attempt);
  }
  async function recoverMessage(
    ownerId: string,
    command: TurnCommand,
  ): Promise<MessageReceiptLookup> {
    const { accepted, epoch } = await acceptedMessage(ownerId, command);
    if (epoch < 2)
      throw new NpcMessageError('INVALID_STATE', '这条记录不属于当前人物运行架构。', 409);
    if (!accepted) throw new DomainError('NOT_FOUND');
    const attempt = await store.lookup(ownerId, command.worldId, command.id);
    if (attempt) verifyAttempt(command, accepted, attempt);
    if (attempt?.status !== 'response_received')
      return receiptForAttempt(ownerId, command, attempt);
    const protectedResponse = await store.readResponse(ownerId, attempt);
    if (!protectedResponse.found)
      return { ...identity(command), status: 'unconfirmed', recovery: 'unknown' };
    // Replay-only: the runner cannot accept input, create/resume a claim or buy
    // another response, even if its normal workflow is expanded in the future.
    const replayOnly = protectedMessageReplayStore(store, ownerId, attempt);
    try {
      await runNpcAgent(
        {
          attempts: replayOnly,
          model: {
            decide: async () => {
              throw Error('MESSAGE_RECOVERY_CANNOT_CALL_MODEL');
            },
          },
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        ownerId,
        attempt,
        null,
      );
    } catch (error) {
      const latest = await store.lookup(ownerId, command.worldId, command.id);
      if (latest && latest.status !== 'response_received')
        return receiptForAttempt(ownerId, command, latest);
      rethrowMessageError(error);
    }
    return receiptForAttempt(
      ownerId,
      command,
      await store.lookup(ownerId, command.worldId, command.id),
    );
  }
  const recentTurnMetrics = new Map<string, ChatTurnServerMetrics>();
  const recentTurnTelemetry: ChatTurnTelemetryRecord[] = [];
  const rememberTurnTelemetry = (
    commandId: string,
    serverMetrics: ChatTurnServerMetrics,
    telemetry: ChatTurnTelemetryRecord,
  ) => {
    if (recentTurnMetrics.size >= 128) {
      const oldest = recentTurnMetrics.keys().next().value;
      if (oldest !== undefined) recentTurnMetrics.delete(oldest);
    }
    recentTurnMetrics.set(commandId, serverMetrics);
    if (recentTurnTelemetry.length >= 128) recentTurnTelemetry.shift();
    recentTurnTelemetry.push(telemetry);
  };

  async function readCommittedTurnMessages(
    ownerId: string,
    receipt: { worldId: string; actorId: string; eventId: string; version: number },
  ): Promise<CommittedTurnMessage[]> {
    const rows = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            `SELECT m.id,m.document,e.id AS event_id,e.version
             FROM parallel_life.world_messages m
             JOIN parallel_life.world_events e
               ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.document->>'sourceEventId'
             JOIN parallel_life.commands c
               ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
              AND c.status='succeeded' AND c.result_event_id=e.id
             WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=$3 AND e.version<=$5
               AND (e.id=$4 AND e.version=$5 OR EXISTS (
                 SELECT 1 FROM parallel_life.agent_attempts a
                 JOIN parallel_life.world_events final ON final.world_id=a.world_id
                   AND final.owner_id=a.owner_id AND final.id=a.event_id AND final.version=$5
                 WHERE a.world_id=m.world_id AND a.owner_id=m.owner_id AND a.actor_id=m.actor_id
                   AND a.event_id=$4 AND a.status='committed'
                   AND e.payload#>>'{data,stream,attemptId}'=a.id
                   AND e.payload#>>'{data,stream,parentCommandId}'=a.command_id
                   AND e.payload#>>'{data,actorId}'=a.actor_id
                   AND c.expected_version=e.version-1))
             ORDER BY m.ordinal ASC`,
            [receipt.worldId, ownerId, receipt.actorId, receipt.eventId, receipt.version],
          )
        ).rows,
    );
    const messages: CommittedTurnMessage[] = [];
    for (const row of rows) {
      const doc = row.document as {
        id?: unknown;
        actorId?: unknown;
        role?: unknown;
        text?: unknown;
        at?: unknown;
        sourceEventId?: unknown;
      };
      if (
        !doc ||
        doc.actorId !== receipt.actorId ||
        doc.sourceEventId !== row.event_id ||
        (doc.role !== 'user' && doc.role !== 'assistant') ||
        typeof doc.text !== 'string' ||
        !doc.text.trim() ||
        typeof doc.at !== 'string'
      )
        continue;
      messages.push({
        id: String(row.id),
        actorId: receipt.actorId,
        role: doc.role,
        text: doc.text,
        at: doc.at,
        sourceEventId: String(row.event_id),
        sourceVersion: Number(row.version),
      });
    }
    return messages;
  }

  const activeActorStreams = new Map<
    string,
    {
      attempt: AgentAttempt;
      snapshot: AgentSnapshot;
      controller: AbortController;
    }
  >();

  async function readStreamSegments(
    ownerId: string,
    worldId: string,
    commandId: string,
  ): Promise<{
    segments: import('../modules/world/domain/npc-stream-segment.ts').NpcStreamSegmentCredential[];
    messages: import('../modules/world/domain/npc-stream-segment.ts').CommittedStreamMessageProjection[];
    summary: NpcStreamTurnSummary | null;
  }> {
    return readStreamSegmentsForCommand(db, ownerId, worldId, commandId);
  }

  return {
    lookupMessage,
    recoverMessage,
    readCommittedTurnMessages,
    readStreamSegments,
    readTurnMetrics(commandId: string): ChatTurnServerMetrics | undefined {
      return recentTurnMetrics.get(commandId);
    },
    readRecentTurnTelemetry(): ChatTurnTelemetryRecord[] {
      return [...recentTurnTelemetry];
    },
    async sendMessageIfEnabled(
      ownerId: string,
      command: TurnCommand,
      options?: {
        onSegment?: (segment: CommittedStreamSegmentEvent) => Promise<void> | void;
        onMediaCommitted?: (eventId: string) => void;
      },
    ) {
      validateCommand(command);
      if (command.origin) throw new DomainError('INVALID_COMMAND');
      const serverReceivedAtEpochMs = Date.now();
      const tTurn0 = performance.now();
      let phase: 'context' | 'run' = 'context';
      let queryCount = 0;
      let transactionCount = 0;
      let contextQueryCount = 0;
      let commitQueryCount = 0;
      let modelCallCount = 0;
      let schemaBytes = 0;
      let inputBytes = 0;
      let outputBytes = 0;
      let upstreamFirstChunkMs = 0;
      let contextPrepareMs = 0;
      let runTimings: AgentRunPhaseTimings = {
        modelTotalMs: 0,
        responsePersistMs: 0,
        decodeCompileMs: 0,
        persistAndDecodeWallMs: 0,
        kernelCommitMs: 0,
      };
      const cacheHitsBefore = readSnapshotCacheMetrics().actorModulesCacheHits;

      const turnDb: PostgresDatabase = {
        pool: db.pool,
        close: () => db.close(),
        async transaction<T>(
          txOwnerId: string,
          run: (client: SqlClient) => Promise<T>,
        ): Promise<T> {
          transactionCount += 1;
          return db.transaction(txOwnerId, async (rawClient) => {
            const proxyClient = new Proxy(rawClient, {
              get(target, prop, receiver) {
                if (prop === 'query') {
                  return (...args: Parameters<SqlClient['query']>) => {
                    queryCount += 1;
                    if (phase === 'context') contextQueryCount += 1;
                    else commitQueryCount += 1;
                    return target.query(...args);
                  };
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
            return run(proxyClient);
          });
        },
      } as PostgresDatabase;

      const turnStore = new PostgresAgentRuntimeRepository(turnDb);
      const turnWorlds = new PostgresWorldRepository(turnDb);
      const actorStreamKey = `${ownerId}:${command.worldId}:${command.actorId}`;

      const control = await turnDb.transaction(
        ownerId,
        async (sql) =>
          (
            await sql.query(
              "SELECT COALESCE(c.engine_epoch,1) AS engine_epoch, w.state->>'deletedAt' AS deleted_at, w.state->>'time' AS world_time FROM parallel_life.worlds w LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id WHERE w.id=$1 AND w.owner_id=$2",
              [command.worldId, ownerId],
            )
          ).rows[0],
      );
      if (!control) throw new DomainError('NOT_FOUND');
      const epoch = Number(control.engine_epoch);
      if (epoch < 2) return null;
      if (control.deleted_at) throw new DomainError('NOT_FOUND');
      const initialTime = String(control.world_time);
      let worldVersionBefore: number | null = command.expectedVersion;
      try {
        // User interruption: if an earlier streaming turn on the same actor has already committed
        // >= 1 prefix segments, abort its remainder and seal its committed prefix at V+1 / R+1
        // so the new player message can proceed without BUSY deadlock.
        const inFlight = activeActorStreams.get(actorStreamKey);
        if (inFlight && inFlight.attempt.commandId !== command.id) {
          const sealedInFlight = await sealCommittedStreamPrefix(turnDb, ownerId, {
            attempt: inFlight.attempt,
            snapshot: inFlight.snapshot,
            completionStatus: 'superseded',
          });
          if (sealedInFlight.sealed) {
            inFlight.controller.abort(
              Object.assign(Error('SUPERSEDED_BY_USER_INTERRUPT'), {
                code: 'SUPERSEDED_BY_USER_INTERRUPT',
              }),
            );
            activeActorStreams.delete(actorStreamKey);
          }
        }

        const now = new Date().toISOString(),
          clock = await new PostgresClockStore(turnDb).read(ownerId, command.worldId, now);
        const storyAt = new Date(
          Math.max(Date.parse(initialTime), Date.parse(projectStoryTime(clock, now))),
        ).toISOString();
        // Save the accepted player input before any paid request. Replay returns the original clocks and text.
        const { receipt } = await turnStore.accept(ownerId, {
          id: randomUUID(),
          worldId: command.worldId,
          commandId: command.id,
          channel: 'private',
          threadId: command.actorId,
          recipientActorId: command.actorId,
          expectedWorldVersion: command.expectedVersion,
          origin: 'player',
          text: command.text,
          receivedAt: now,
          storyAt,
          inputHash: inputHash(command),
        });
        const previous = await turnStore.lookup(ownerId, command.worldId, command.id);
        if (previous?.status === 'committed') {
          const row = await turnDb.transaction(
            ownerId,
            async (sql) =>
              (
                await sql.query(
                  'SELECT id,version FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3',
                  [command.worldId, ownerId, previous.eventId],
                )
              ).rows[0],
          );
          if (!row)
            throw new NpcMessageError('INVALID_STATE', '这条记录需要核对，请稍后再查看。', 409);
          contextPrepareMs = roundDurationMs(performance.now() - tTurn0);
          const serverTotalMs = roundDurationMs(performance.now() - tTurn0);
          const cacheHits = Math.max(
            0,
            readSnapshotCacheMetrics().actorModulesCacheHits - cacheHitsBefore,
          );
          const serverMetrics: ChatTurnServerMetrics = {
            serverReceivedAtEpochMs,
            contextPrepareMs,
            upstreamFirstChunkMs: 0,
            modelTotalMs: 0,
            responsePersistMs: 0,
            decodeCompileMs: 0,
            persistAndDecodeWallMs: 0,
            kernelCommitMs: 0,
            serverTotalMs,
            schemaBytes: 0,
            inputBytes: 0,
            outputBytes: 0,
            queryCount,
            transactionCount,
            contextQueryCount,
            commitQueryCount,
            modelCallCount: 0,
            cacheHits,
          };
          rememberTurnTelemetry(command.id, serverMetrics, {
            worldId: command.worldId,
            actorId: command.actorId,
            commandId: command.id,
            eventId: String(row.id),
            worldVersionBefore,
            worldVersionAfter: Number(row.version),
            serverReceivedAtEpochMs,
            timings: {
              clientSendToServerReceiveMs: null,
              contextPrepareMs,
              upstreamFirstChunkMs: 0,
              modelTotalMs: 0,
              responsePersistMs: 0,
              decodeCompileMs: 0,
              persistAndDecodeWallMs: 0,
              kernelCommitMs: 0,
              postCommitToDisplayMs: null,
              firstMeaningfulReplyMs: null,
              fullTurnMs: null,
              toolCompletionMs: 0,
              serverTotalMs,
            },
            schemaBytes: 0,
            inputBytes: 0,
            outputBytes: 0,
            queryCount,
            transactionCount,
            contextQueryCount,
            commitQueryCount,
            modelCallCount: 0,
            cacheHits,
            replay: true,
            outcome: 'committed',
            errorCategory: 'none',
          });
          return {
            status: 'committed' as const,
            commandId: command.id,
            worldId: command.worldId,
            actorId: command.actorId,
            eventId: String(row.id),
            version: Number(row.version),
          };
        }
        if (
          previous &&
          ['reserved', 'request_sent', 'unknown_after_send'].includes(previous.status)
        )
          throw new NpcMessageError(
            previous.status === 'unknown_after_send' ? 'UNKNOWN' : 'BUSY',
            previous.status === 'unknown_after_send'
              ? '这次回复的结果尚未确认，请先恢复原请求。'
              : '人物正在处理这条消息，请稍等。',
            409,
          );
        if (previous?.status === 'stale_discarded') throw new DomainError('VERSION_CONFLICT');
        if (previous?.status === 'invalid_output')
          throw new NpcMessageError(
            'INVALID_AI_OUTPUT',
            '这次回复未能保存，你的消息仍保留，请核对后重新发送。',
            422,
          );
        if (clock.paused)
          throw new NpcMessageError('INVALID_STATE', '请先继续这段人生，再发送消息。', 409);
        // Only fresh context preparation uses a bounded read. Paid response recovery
        // keeps its existing full-world path and immutable snapshot.
        let bounded: ChatContextRead | null = null;
        if (!previous) {
          try {
            bounded = await readChatContextWorld(turnDb, ownerId, {
              worldId: command.worldId,
              actorId: command.actorId,
            });
          } catch (error) {
            if (!(error instanceof ChatContextFallbackError)) throw error;
            console.info(JSON.stringify({ scope: 'chat-context-fallback', reason: error.reason }));
          }
        }
        const world =
          bounded?.world ?? (await turnWorlds.get({ userId: ownerId }, command.worldId));
        worldVersionBefore = world.version;
        const actor = bounded
          ? bounded.actorState
          : await turnStore.read(ownerId, {
              worldId: command.worldId,
              actorId: command.actorId,
            });
        if (!actor)
          throw new NpcMessageError('INVALID_STATE', '人物状态尚未准备完成，请稍后再进入。', 409);
        // A paid response retains its original snapshot. The shared commit resolver
        // decides whether intervening world events are relevant; do not discard it
        // here merely because another actor spoke.
        if (previous && previous.expectedActorRevision !== actor.revision) {
          await turnStore.mark(ownerId, previous, 'stale_discarded');
          throw new DomainError('VERSION_CONFLICT');
        }
        const snapshot =
          previous?.status === 'response_received'
            ? null
            : (
                await readPrivateAgentSnapshot(
                  turnDb,
                  ownerId,
                  world,
                  command.actorId,
                  receipt,
                  storyAt,
                  actor,
                  {
                    referencedSourceIds:
                      bounded?.completeness.referenced.deferredToExistingResolver,
                  },
                )
              ).snapshot;
        contextPrepareMs = roundDurationMs(performance.now() - tTurn0);
        phase = 'run';

        const baseModel = modelFactory();
        const instrumentedTextModel: TextModel = {
          async complete(messages, signal, maxTokens, output) {
            modelCallCount += 1;
            inputBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
            schemaBytes = output ? Buffer.byteLength(JSON.stringify(output), 'utf8') : 0;
            const tUpstream0 = performance.now();
            const text = await baseModel.complete(messages, signal, maxTokens, output);
            upstreamFirstChunkMs = roundDurationMs(performance.now() - tUpstream0);
            outputBytes = Buffer.byteLength(text, 'utf8');
            return text;
          },
          ...(baseModel.streamComplete
            ? {
                async *streamComplete(messages, signal, output) {
                  modelCallCount += 1;
                  inputBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
                  schemaBytes = output ? Buffer.byteLength(JSON.stringify(output), 'utf8') : 0;
                  const tUpstream0 = performance.now();
                  let firstSeen = false;
                  let totalBytes = 0;
                  for await (const chunk of baseModel.streamComplete!(messages, signal, output)) {
                    if (!firstSeen && chunk.length > 0) {
                      firstSeen = true;
                      upstreamFirstChunkMs = roundDurationMs(performance.now() - tUpstream0);
                    }
                    totalBytes += Buffer.byteLength(chunk, 'utf8');
                    yield chunk;
                  }
                  if (!firstSeen) {
                    upstreamFirstChunkMs = roundDurationMs(performance.now() - tUpstream0);
                  }
                  outputBytes = totalBytes;
                },
              }
            : {}),
        };

        const streamAbortController = new AbortController();
        const streamKernel = new PostgresNpcAgentKernel(turnDb, turnWorlds);
        let result: Awaited<ReturnType<typeof runNpcAgent>>;
        try {
          result = await runNpcAgent(
            {
              attempts: turnStore,
              model: new NpcAgentModel(instrumentedTextModel),
              kernel: streamKernel,
              onPhaseTiming: (timings) => {
                runTimings = timings;
              },
              onStreamStart: (attempt, execSnapshot) => {
                activeActorStreams.set(actorStreamKey, {
                  attempt,
                  snapshot: execSnapshot,
                  controller: streamAbortController,
                });
              },
              onStreamEvent: async (attempt, execSnapshot, event) => {
                if (streamAbortController.signal.aborted) return;
                if (event.kind === 'statement') {
                  // A sticker-only bubble has no safe text projection yet; the final
                  // structured commit persists it once with its stickerId.
                  if (!event.statement.text.trim() && event.statement.stickerId) return;
                  const segOutcome = await persistAndCommitStreamSegment(
                    turnDb,
                    turnWorlds,
                    ownerId,
                    {
                      attempt,
                      snapshot: execSnapshot,
                      statement: event.statement,
                      unitKind: event.unitKind,
                    },
                  );
                  if (segOutcome.outcome === 'committed') {
                    await options?.onSegment?.(segOutcome.event);
                  } else if (segOutcome.outcome === 'superseded') {
                    streamAbortController.abort(
                      Object.assign(Error(segOutcome.reason), { code: segOutcome.reason }),
                    );
                  }
                } else if (event.kind === 'execution_intents') {
                  const committed = await streamKernel
                    .commitMediaPrefix(ownerId, {
                      attempt,
                      snapshot: execSnapshot,
                      executions: event.executions,
                    })
                    .catch((error) => {
                      console.warn(
                        JSON.stringify({
                          scope: 'media-prefix',
                          code: (error as { code?: string }).code ?? 'FAILED',
                          frames:
                            error instanceof Error ? error.stack?.split('\n').slice(1, 4) : [],
                        }),
                      );
                      throw error;
                    });
                  if (committed) options?.onMediaCommitted?.(committed.eventId);
                } else if (event.kind === 'statement_error') {
                  await recordStreamSegmentError(turnDb, ownerId, {
                    attempt,
                    segmentIndex: event.segmentIndex,
                  });
                  if (event.code === 'STREAM_DUPLICATE_TOP_LEVEL_KEY') throw Error(event.code);
                }
              },
              onPrefixFailureSeal: async (attempt, execSnapshot, err) => {
                const stopCode =
                  (streamAbortController.signal.reason as { code?: unknown } | undefined)?.code ??
                  (err as { code?: unknown } | null)?.code;
                const isSuperseded = stopCode === 'SUPERSEDED_BY_USER_INTERRUPT';
                const sealed = await sealCommittedStreamPrefix(turnDb, ownerId, {
                  attempt,
                  snapshot: execSnapshot,
                  completionStatus: isSuperseded ? 'superseded' : 'partial_interrupted',
                  failureCode: String(
                    (err as { code?: unknown } | null)?.code ??
                      (err as Error | null)?.message ??
                      'STREAM_INTERRUPTED',
                  ),
                  partialRawText: (err as { partialResponseText?: string } | null)
                    ?.partialResponseText,
                });
                if (!sealed.sealed) return null;
                return {
                  eventId: sealed.eventId,
                  state: sealed.state,
                  results: [],
                };
              },
            },
            ownerId,
            previous ?? {
              id: randomUUID(),
              worldId: command.worldId,
              actorId: command.actorId,
              commandId: command.id,
              inputReceiptId: receipt.id,
              engineEpoch: epoch,
              expectedWorldVersion: world.version,
              expectedActorRevision: actor.revision,
              inputHash: receipt.inputHash,
              token: randomUUID(),
              leaseUntil: new Date(Date.now() + 240_000).toISOString(),
            },
            snapshot,
            streamAbortController.signal,
          );
        } finally {
          const currentActive = activeActorStreams.get(actorStreamKey);
          if (currentActive?.attempt.commandId === command.id) {
            activeActorStreams.delete(actorStreamKey);
          }
        }
        const serverTotalMs = roundDurationMs(performance.now() - tTurn0);
        const cacheHits = Math.max(
          0,
          readSnapshotCacheMetrics().actorModulesCacheHits - cacheHitsBefore,
        );
        const serverMetrics: ChatTurnServerMetrics = {
          serverReceivedAtEpochMs,
          contextPrepareMs,
          upstreamFirstChunkMs: roundDurationMs(upstreamFirstChunkMs || runTimings.modelTotalMs),
          modelTotalMs: roundDurationMs(runTimings.modelTotalMs),
          responsePersistMs: roundDurationMs(runTimings.responsePersistMs),
          decodeCompileMs: roundDurationMs(runTimings.decodeCompileMs),
          persistAndDecodeWallMs: roundDurationMs(runTimings.persistAndDecodeWallMs),
          kernelCommitMs: roundDurationMs(runTimings.kernelCommitMs),
          serverTotalMs,
          schemaBytes,
          inputBytes,
          outputBytes,
          queryCount,
          transactionCount,
          contextQueryCount,
          commitQueryCount,
          modelCallCount,
          cacheHits,
        };
        rememberTurnTelemetry(command.id, serverMetrics, {
          worldId: command.worldId,
          actorId: command.actorId,
          commandId: command.id,
          eventId: result.eventId,
          worldVersionBefore,
          worldVersionAfter: result.state.projectedWorldVersion,
          serverReceivedAtEpochMs,
          timings: {
            clientSendToServerReceiveMs: null,
            contextPrepareMs,
            upstreamFirstChunkMs: serverMetrics.upstreamFirstChunkMs,
            modelTotalMs: serverMetrics.modelTotalMs,
            responsePersistMs: serverMetrics.responsePersistMs,
            decodeCompileMs: serverMetrics.decodeCompileMs,
            persistAndDecodeWallMs: serverMetrics.persistAndDecodeWallMs,
            kernelCommitMs: serverMetrics.kernelCommitMs,
            postCommitToDisplayMs: null,
            firstMeaningfulReplyMs: null,
            fullTurnMs: null,
            toolCompletionMs: 0,
            serverTotalMs,
          },
          schemaBytes,
          inputBytes,
          outputBytes,
          queryCount,
          transactionCount,
          contextQueryCount,
          commitQueryCount,
          modelCallCount,
          cacheHits,
          replay: Boolean(previous),
          outcome: 'committed',
          errorCategory: 'none',
        });
        return {
          status: 'committed' as const,
          commandId: command.id,
          worldId: command.worldId,
          actorId: command.actorId,
          eventId: result.eventId,
          version: result.state.projectedWorldVersion,
        };
      } catch (error) {
        const serverTotalMs = roundDurationMs(performance.now() - tTurn0);
        if (!contextPrepareMs) contextPrepareMs = serverTotalMs;
        const cacheHits = Math.max(
          0,
          readSnapshotCacheMetrics().actorModulesCacheHits - cacheHitsBefore,
        );
        const diagnostic =
          error && typeof error === 'object'
            ? (Object.getOwnPropertyDescriptor(error, 'diagnostic')?.value as
                FailureDiagnosticInput | undefined)
            : undefined;
        const category = classifyChatTurnError(error, diagnostic?.stage);
        const serverMetrics: ChatTurnServerMetrics = {
          serverReceivedAtEpochMs,
          contextPrepareMs,
          upstreamFirstChunkMs: roundDurationMs(upstreamFirstChunkMs || runTimings.modelTotalMs),
          modelTotalMs: roundDurationMs(runTimings.modelTotalMs),
          responsePersistMs: roundDurationMs(runTimings.responsePersistMs),
          decodeCompileMs: roundDurationMs(runTimings.decodeCompileMs),
          persistAndDecodeWallMs: roundDurationMs(runTimings.persistAndDecodeWallMs),
          kernelCommitMs: roundDurationMs(runTimings.kernelCommitMs),
          serverTotalMs,
          schemaBytes,
          inputBytes,
          outputBytes,
          queryCount,
          transactionCount,
          contextQueryCount,
          commitQueryCount,
          modelCallCount,
          cacheHits,
        };
        rememberTurnTelemetry(command.id, serverMetrics, {
          worldId: command.worldId,
          actorId: command.actorId,
          commandId: command.id,
          eventId: null,
          worldVersionBefore,
          worldVersionAfter: null,
          serverReceivedAtEpochMs,
          timings: {
            clientSendToServerReceiveMs: null,
            contextPrepareMs,
            upstreamFirstChunkMs: serverMetrics.upstreamFirstChunkMs,
            modelTotalMs: serverMetrics.modelTotalMs,
            responsePersistMs: serverMetrics.responsePersistMs,
            decodeCompileMs: serverMetrics.decodeCompileMs,
            persistAndDecodeWallMs: serverMetrics.persistAndDecodeWallMs,
            kernelCommitMs: serverMetrics.kernelCommitMs,
            postCommitToDisplayMs: null,
            firstMeaningfulReplyMs: null,
            fullTurnMs: null,
            toolCompletionMs: 0,
            serverTotalMs,
          },
          schemaBytes,
          inputBytes,
          outputBytes,
          queryCount,
          transactionCount,
          contextQueryCount,
          commitQueryCount,
          modelCallCount,
          cacheHits,
          replay: false,
          outcome: category === 'unknown' || category === 'response_store' ? 'unknown' : 'failed',
          errorCategory: category,
        });
        rethrowMessageError(error);
      }
    },
  };
}

function rethrowMessageError(error: unknown): never {
  const diagnostic =
    error && typeof error === 'object'
      ? (Object.getOwnPropertyDescriptor(error, 'diagnostic')?.value as
          FailureDiagnosticInput | undefined)
      : undefined;
  if (error instanceof NpcMessageError || error instanceof DomainError) throw error;
  const code =
    error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : '';
  if (
    [
      'VERSION_CONFLICT',
      'AGENT_REVISION_CONFLICT',
      'ENGINE_EPOCH_CONFLICT',
      'ATTEMPT_STALE',
    ].includes(code)
  )
    throw new DomainError('VERSION_CONFLICT');
  if (['COMMAND_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(code))
    throw new DomainError('IDEMPOTENCY_CONFLICT');
  if (code === 'INPUT_SCOPE_FORBIDDEN')
    throw new NpcMessageError(
      'INVALID_STATE',
      '这次交谈的参与范围已变化，请重新进入。',
      409,
      diagnostic,
    );
  if (['WORLD_PAUSED', 'NPC_DELIVERY_DEFERRED'].includes(code))
    throw new NpcMessageError(
      'INVALID_STATE',
      '这段人生已暂停，继续后可恢复原回复。',
      409,
      diagnostic,
    );
  if (['NPC_AGENT_INVALID_SNAPSHOT', 'NPC_AGENT_SNAPSHOT_LIMIT'].includes(code))
    throw new NpcMessageError(
      'INVALID_STATE',
      '这次人物资料尚未准备好，你的消息已保留，请核对后再试。',
      422,
      diagnostic,
    );
  if (code === 'ATTEMPT_PENDING')
    throw new NpcMessageError('BUSY', '人物正在处理上一条消息，请稍等。', 409, diagnostic);
  if (['INVALID_AGENT_PROPOSAL', 'ATTEMPT_INVALID'].includes(code))
    throw new NpcMessageError(
      'INVALID_AI_OUTPUT',
      '这次人物回复未能通过核对，你的消息已保留。',
      422,
      diagnostic,
    );
  throw new NpcMessageError(
    'UNKNOWN',
    '这次回复尚未确认，请先恢复原请求，不必重复发送。',
    503,
    diagnostic,
  );
}
