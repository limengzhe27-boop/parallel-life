import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { PublicOpeningStatus } from '../../../contracts/publication-opening.ts';
import {
  readDirectorBootstrapCauseInTransaction,
  readPendingEpisodeRequestsInTransaction,
} from './agent-narrative-repository.ts';
import { readWorldAttentionInTransaction } from './world-attention-repository.ts';
import {
  eligibleEpisodeDispatches,
  episodeDispatchAttempt,
} from './agent-episode-dispatch-eligibility.ts';

/** Caller holds world then clock share locks; never writes/adopts/claims/calls a model. */
export async function readAgentPhoneEntryProbe(
  sql: SqlClient,
  ownerId: string,
  frame: { worldId: string; engineEpoch: number; worldVersion: number; storyAt: string },
): Promise<NonNullable<PublicOpeningStatus['continuation']>> {
  const ready = (kind: string, identity: string) => ({
    status: 'ready' as const,
    key: createHash('sha256')
      .update(
        JSON.stringify(['phone-continuation-v1', frame.worldId, frame.engineEpoch, kind, identity]),
      )
      .digest('hex'),
  });
  const row = (
    await sql.query(
      'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR SHARE',
      [frame.worldId, ownerId],
    )
  ).rows[0];
  const now = Date.now();
  // Wait for an actual activity acknowledgement, including fresh worlds without a clock row.
  if (
    !row ||
    row.paused ||
    !row.managed ||
    !row.active_until ||
    new Date(row.active_until).getTime() <= now
  )
    return { status: 'deferred' };
  const attention = await readWorldAttentionInTransaction(sql, ownerId, {
    worldId: frame.worldId,
    worldVersion: frame.worldVersion,
    realNow: new Date(now).toISOString(),
  });
  // This fast path presents existing coordination only while browsing. Ordinary own responsibilities
  // retain their original idle scheduling and actor-specific attention rules.
  if (attention.conversationWithoutTarget || attention.focus.length) return { status: 'deferred' };
  const actors = (
    await sql.query(
      `SELECT a.id,a.actor_id,a.command_id,a.status,a.sent_at,a.response_hash,
    a.expected_world_version,a.expected_actor_revision,a.lease_until,r.document,s.revision
    FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts r
      ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
    LEFT JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.actor_id=a.actor_id
    WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3 ORDER BY a.created_at,a.id`,
      [frame.worldId, ownerId, frame.engineEpoch],
    )
  ).rows;
  const raw = actors.find(
    (a) =>
      a.status === 'response_received' &&
      a.document.channel === 'private' &&
      a.expected_world_version === frame.worldVersion &&
      a.expected_actor_revision === a.revision &&
      new Date(a.lease_until).getTime() > now,
  );
  if (raw) return ready('npc_raw', raw.id);
  const requests = await readPendingEpisodeRequestsInTransaction(sql, ownerId, {
    worldId: frame.worldId,
    engineEpoch: frame.engineEpoch,
  });
  const next = eligibleEpisodeDispatches(
    frame.worldId,
    frame.worldVersion,
    requests,
    attention,
    actors.map(episodeDispatchAttempt),
  )[0];
  if (next) return ready('episode', next.commandId);
  const pendingDirectors = (
    await sql.query(
      `SELECT id,status,expected_world_version FROM parallel_life.director_runtime_attempts
    WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3
      AND status IN ('reserved','request_sent','response_received','unknown_after_send') ORDER BY created_at,id`,
      [frame.worldId, ownerId, frame.engineEpoch],
    )
  ).rows;
  if (pendingDirectors.length) {
    const received = pendingDirectors.find(
      (a) => a.status === 'response_received' && a.expected_world_version === frame.worldVersion,
    );
    return received ? ready('director_raw', received.id) : { status: 'pending' };
  }
  const bootstrap = await readDirectorBootstrapCauseInTransaction(sql, ownerId, frame);
  // New time qualifications remain on the normal 75-second opportunity cadence.
  return bootstrap ? ready('bootstrap', bootstrap.id) : { status: 'quiet' };
}
