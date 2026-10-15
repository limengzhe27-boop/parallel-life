import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt } from '../domain/agent-runtime.ts';
import {
  readWorldAttentionInTransaction,
  type WorldAttention,
} from './world-attention-repository.ts';

export function isEpisodeConsiderationInput(input: Pick<AgentInputReceipt, 'origin' | 'text'>) {
  if (input.origin !== 'coordination') return false;
  try {
    return JSON.parse(input.text)?.type === 'npc_episode_consideration';
  } catch {
    return false;
  }
}
export function episodeAttentionAllows(attention: WorldAttention, actorId: string) {
  return (
    !attention.conversationWithoutTarget &&
    (!attention.focus.length ||
      attention.focus.some((f) => f.channel === 'private' && f.threadId === actorId))
  );
}
/** Same short world -> clock lock order as business attention writes. Never held over a model call. */
export async function requireEpisodeDeliveryInTransaction(
  sql: SqlClient,
  ownerId: string,
  frame: { worldId: string; worldVersion: number; actorId: string },
) {
  const world = (
    await sql.query(
      'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [frame.worldId, ownerId],
    )
  ).rows[0];
  if (world?.version !== frame.worldVersion)
    throw Object.assign(Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' });
  const clock = (
    await sql.query(
      'SELECT paused,managed,active_until FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [frame.worldId, ownerId],
    )
  ).rows[0];
  // Sample after taking locks, consistent with attention/clock writers.
  const realNow = new Date().toISOString();
  const deferred = () => {
    throw Object.assign(Error('EPISODE_DELIVERY_DEFERRED'), { code: 'EPISODE_DELIVERY_DEFERRED' });
  };
  if (
    clock &&
    (clock.paused ||
      (clock.managed &&
        (!clock.active_until || Date.parse(clock.active_until) <= Date.parse(realNow))))
  )
    deferred();
  const attention = await readWorldAttentionInTransaction(sql, ownerId, {
    worldId: frame.worldId,
    worldVersion: frame.worldVersion,
    realNow,
  });
  if (!episodeAttentionAllows(attention, frame.actorId)) deferred();
}
