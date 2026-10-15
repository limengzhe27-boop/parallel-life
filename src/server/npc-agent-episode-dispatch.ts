import { createHash, randomUUID } from 'node:crypto';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type { NpcAgentModel } from '../modules/world/application/agent-runtime-ports.ts';
import type { AdvanceResult } from '../modules/world/application/advance-world.ts';
import type { ActorAgentState } from '../modules/world/domain/agent-runtime.ts';
import type { EpisodeConsiderationIntent } from '../modules/world/domain/agent-narrative.ts';
import type { WorldState } from '../modules/world/domain/types.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { runNpcAgent } from '../modules/world/application/run-agent.ts';
import { readPendingEpisodeRequestsInTransaction } from '../modules/world/infrastructure/agent-narrative-repository.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';
import { readPrivateAgentSnapshot } from '../modules/world/infrastructure/agent-snapshot-repository.ts';
import { readWorldAttentionInTransaction } from '../modules/world/infrastructure/world-attention-repository.ts';
import { requireEpisodeDeliveryInTransaction } from '../modules/world/infrastructure/agent-episode-attention.ts';
import {
  eligibleEpisodeDispatches,
  episodeDispatchAttempt,
} from '../modules/world/infrastructure/agent-episode-dispatch-eligibility.ts';

/** One actual consideration through the same actor runner/kernel; no separate planner or paid queue. */
export async function dispatchPendingAgentEpisode(
  db: PostgresDatabase,
  model: NpcAgentModel,
  ownerId: string,
  world: WorldState,
  engineEpoch: number,
  storyAt: string,
): Promise<AdvanceResult | null> {
  const pending = await db.transaction(ownerId, async (sql) => {
    const requests = await readPendingEpisodeRequestsInTransaction(sql, ownerId, {
      worldId: world.id,
      engineEpoch,
    });
    if (!requests.length) return null;
    const current = (
      await sql.query('SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
        world.id,
        ownerId,
      ])
    ).rows[0];
    if (current?.version !== world.version) throw new DomainError('VERSION_CONFLICT');
    const attention = await readWorldAttentionInTransaction(sql, ownerId, {
      worldId: world.id,
      worldVersion: world.version,
    });
    const attempts = (
      await sql.query(
        `SELECT a.actor_id,a.command_id,a.status,a.sent_at,a.response_hash,r.document
         FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts r
         ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
         WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3 ORDER BY a.created_at,a.id`,
        [world.id, ownerId, engineEpoch],
      )
    ).rows.map(episodeDispatchAttempt);
    return { requests, attention, attempts };
  });
  if (!pending) return null;
  const store = new PostgresAgentRuntimeRepository(db);
  for (const { request, commandId } of eligibleEpisodeDispatches(
    world.id,
    world.version,
    pending.requests,
    pending.attention,
    pending.attempts,
  )) {
    try {
      await db.transaction(ownerId, (sql) =>
        requireEpisodeDeliveryInTransaction(sql, ownerId, {
          worldId: world.id,
          worldVersion: world.version,
          actorId: request.actorId,
        }),
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EPISODE_DELIVERY_DEFERRED'
      )
        continue;
      throw error;
    }
    const actor: ActorAgentState | null = await store.read(ownerId, {
      worldId: world.id,
      actorId: request.actorId,
    });
    if (!actor) throw new DomainError('INVALID_PROPOSAL', 'EPISODE_ACTOR_STATE_MISSING');
    const intent: EpisodeConsiderationIntent = {
      type: 'npc_episode_consideration',
      requestId: request.id,
      revision: 0,
      activity: request.activity,
      placeOptionIds: [],
      basisSourceIds: [`definition:${actor.definitionRef}`],
    };
    const text = JSON.stringify(intent);
    const { receipt } = await store.accept(ownerId, {
      id: randomUUID(),
      worldId: world.id,
      commandId,
      inputHash: createHash('sha256')
        .update(JSON.stringify([world.id, request.actorId, request.id, world.version, text]))
        .digest('hex'),
      channel: 'private',
      threadId: request.actorId,
      recipientActorId: request.actorId,
      expectedWorldVersion: world.version,
      receivedAt: new Date().toISOString(),
      storyAt,
      origin: 'coordination',
      text,
    });
    const snapshot = (
      await readPrivateAgentSnapshot(db, ownerId, world, request.actorId, receipt, storyAt, actor)
    ).snapshot;
    let result;
    try {
      result = await runNpcAgent(
        {
          attempts: store,
          model,
          kernel: new PostgresNpcAgentKernel(db, new PostgresWorldRepository(db)),
        },
        ownerId,
        {
          id: randomUUID(),
          worldId: world.id,
          actorId: request.actorId,
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
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EPISODE_DELIVERY_DEFERRED'
      )
        continue;
      throw error;
    }
    const presented = await db.transaction(ownerId, async (sql) =>
      Number(
        (
          await sql.query(
            `SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2
       AND actor_id=$3 AND document->>'sourceEventId'=$4`,
            [world.id, ownerId, request.actorId, result.eventId],
          )
        ).rows[0].n,
      ),
    );
    return {
      storyNow: storyAt,
      changed: true,
      worldVersion: result.state.projectedWorldVersion,
      played: presented ? 1 : 0,
      folded: 0,
      summary: null,
      actors: presented ? [request.actorId] : [],
    };
  }
  return null;
}
