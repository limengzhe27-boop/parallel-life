import { createHash, randomUUID } from 'node:crypto';
import type { TextModel } from '../modules/ai/application/ports.ts';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type { TurnCommand } from '../modules/world/domain/types.ts';
import { runNpcAgent } from '../modules/world/application/run-agent.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../modules/world/infrastructure/clock-repository.ts';
import { readPrivateAgentSnapshot } from '../modules/world/infrastructure/agent-snapshot-repository.ts';
import { NpcAgentModel } from '../modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { validateCommand } from '../modules/world/domain/validation.ts';
import type { MessageReceiptLookup } from '../contracts/message-receipt-lookup.ts';
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
  constructor(code: NpcMessageError['apiCode'], message: string, status: number) {
    super(message);
    this.apiCode = code;
    this.status = status;
  }
}
/** One explicit engine boundary, not candidate-source fallback. Epoch 2 never calls the old planner. */
export function npcAgentServices(db: PostgresDatabase, modelFactory: () => TextModel) {
  const store = new PostgresAgentRuntimeRepository(db),
    worlds = new PostgresWorldRepository(db);
  return {
    async lookupMessage(
      ownerId: string,
      command: TurnCommand,
    ): Promise<MessageReceiptLookup | null> {
      validateCommand(command);
      const owned = await db.transaction(
        ownerId,
        async (sql) =>
          (
            await sql.query('SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
              command.worldId,
              ownerId,
            ])
          ).rowCount,
      );
      if (!owned) throw new DomainError('NOT_FOUND');
      const accepted = await db.transaction(
        ownerId,
        async (sql) =>
          (
            await sql.query(
              'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
              [command.worldId, ownerId, command.id],
            )
          ).rows[0]?.document,
      );
      if (!accepted) return null; // Older committed receipts remain readable; this never executes an old engine.
      if (
        accepted.inputHash !== inputHash(command) ||
        accepted.recipientActorId !== command.actorId ||
        accepted.text !== command.text
      )
        throw new DomainError('IDEMPOTENCY_CONFLICT');
      const attempt = await store.lookup(ownerId, command.worldId, command.id);
      const identity = {
        commandId: command.id,
        worldId: command.worldId,
        actorId: command.actorId,
      };
      if (attempt?.status !== 'committed') return { ...identity, status: 'unconfirmed' };
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
      if (!event) return { ...identity, status: 'unconfirmed' };
      return {
        ...identity,
        status: 'committed',
        eventId: String(event.id),
        version: Number(event.version),
      };
    },
    async sendMessageIfEnabled(ownerId: string, command: TurnCommand) {
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
      const epoch = Number(control.engine_epoch);
      if (epoch < 2) return null;
      const initial = await worlds.get({ userId: ownerId }, command.worldId);
      try {
        const now = new Date().toISOString(),
          clock = await new PostgresClockStore(db).read(ownerId, command.worldId, now);
        const storyAt = new Date(
          Math.max(Date.parse(initial.time), Date.parse(projectStoryTime(clock, now))),
        ).toISOString();
        // Save the accepted player input before any paid request. Replay returns the original clocks and text.
        const { receipt } = await store.accept(ownerId, {
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
        const previous = await store.lookup(ownerId, command.worldId, command.id);
        if (previous?.status === 'committed') {
          const row = await db.transaction(
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
        if (previous && ['invalid_output', 'stale_discarded'].includes(previous.status))
          throw new NpcMessageError(
            'INVALID_AI_OUTPUT',
            '这次回复未能保存，你的消息仍保留，请核对后重新发送。',
            422,
          );
        if (clock.paused)
          throw new NpcMessageError('INVALID_STATE', '请先继续这段人生，再发送消息。', 409);
        const world = await worlds.get({ userId: ownerId }, command.worldId);
        const actor = await store.read(ownerId, {
          worldId: command.worldId,
          actorId: command.actorId,
        });
        if (!actor)
          throw new NpcMessageError('INVALID_STATE', '人物状态尚未准备完成，请稍后再进入。', 409);
        if (
          previous &&
          (previous.expectedWorldVersion !== world.version ||
            previous.expectedActorRevision !== actor.revision)
        ) {
          await store.mark(ownerId, previous, 'stale_discarded');
          throw new DomainError('VERSION_CONFLICT');
        }
        const snapshot =
          previous?.status === 'response_received'
            ? null
            : (
                await readPrivateAgentSnapshot(
                  db,
                  ownerId,
                  world,
                  command.actorId,
                  receipt,
                  storyAt,
                  actor,
                )
              ).snapshot;
        const result = await runNpcAgent(
          {
            attempts: store,
            model: new NpcAgentModel(modelFactory()),
            kernel: new PostgresNpcAgentKernel(db, worlds),
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
        );
        return {
          status: 'committed' as const,
          commandId: command.id,
          worldId: command.worldId,
          actorId: command.actorId,
          eventId: result.eventId,
          version: result.state.projectedWorldVersion,
        };
      } catch (error) {
        if (error instanceof NpcMessageError || error instanceof DomainError) throw error;
        const code =
          error && typeof error === 'object'
            ? String((error as { code?: unknown }).code ?? '')
            : '';
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
          throw new NpcMessageError('INVALID_STATE', '这次交谈的参与范围已变化，请重新进入。', 409);
        if (['WORLD_PAUSED', 'NPC_DELIVERY_DEFERRED'].includes(code))
          throw new NpcMessageError('INVALID_STATE', '这段人生已暂停，继续后可恢复原回复。', 409);
        if (['NPC_AGENT_INVALID_SNAPSHOT', 'NPC_AGENT_SNAPSHOT_LIMIT'].includes(code))
          throw new NpcMessageError(
            'INVALID_STATE',
            '这次人物资料尚未准备好，你的消息已保留，请核对后再试。',
            422,
          );
        if (code === 'ATTEMPT_PENDING')
          throw new NpcMessageError('BUSY', '人物正在处理上一条消息，请稍等。', 409);
        if (['INVALID_AGENT_PROPOSAL', 'ATTEMPT_INVALID'].includes(code))
          throw new NpcMessageError(
            'INVALID_AI_OUTPUT',
            '这次人物回复未能通过核对，你的消息已保留。',
            422,
          );
        throw new NpcMessageError(
          'UNKNOWN',
          '这次回复尚未确认，请先恢复原请求，不必重复发送。',
          503,
        );
      }
    },
  };
}
