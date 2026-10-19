import { storedClockStopped } from './clock-activity-repository.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  readWorldAttentionInTransaction,
  type WorldAttention,
} from './world-attention-repository.ts';

export { isActorEpisodeConsiderationInput as isEpisodeConsiderationInput } from '../domain/actor-episode-intent.ts';
/** Immediate interruption policy only; never an execution or audience authorization. */
export function episodeAttentionAllows(attention: WorldAttention, actorId: string) {
  return (
    !attention.conversationWithoutTarget &&
    (!attention.focus.length ||
      attention.focus.some((f) => f.channel === 'private' && f.threadId === actorId))
  );
}
/**
 * A verified conversation focus controls presentation, not another actor's independent work.
 * Unresolved/revoked focus remains conservative; callers still authenticate the original
 * request, actor, channel, world version and active clock before executing anything.
 */
export function episodeExecutionAllows(attention: WorldAttention) {
  return !attention.conversationWithoutTarget;
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
      'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [frame.worldId, ownerId],
    )
  ).rows[0];
  // Sample after taking locks, consistent with attention/clock writers.
  const realNow = new Date().toISOString();
  const deferred = () => {
    throw Object.assign(Error('EPISODE_DELIVERY_DEFERRED'), { code: 'EPISODE_DELIVERY_DEFERRED' });
  };
  if (clock && storedClockStopped(clock, realNow)) deferred();
  const attention = await readWorldAttentionInTransaction(sql, ownerId, {
    worldId: frame.worldId,
    worldVersion: frame.worldVersion,
    realNow,
  });
  if (!episodeExecutionAllows(attention)) deferred();
}
