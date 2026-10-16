import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { AgentAttempt, AgentInputReceipt } from '../domain/agent-runtime.ts';
import {
  validPlayerEpisodeManifest,
  type PlayerEpisodeManifest,
} from '../domain/player-episode-manifest.ts';
import { readActorEpisodeIntentsInTransaction } from './actor-episode-intent-repository.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';

function forbidden(): never {
  throw Object.assign(Error('INPUT_SCOPE_FORBIDDEN'), { code: 'INPUT_SCOPE_FORBIDDEN' });
}
export async function episodePaymentRows(
  sql: SqlClient,
  owner: string,
  worldId: string,
  actorId: string,
  epoch: number,
) {
  return (
    await sql.query(
      `SELECT a.id,a.status,a.sent_at,a.response_hash,i.document,b.request_id AS bound_request_id
    FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts i
    ON i.world_id=a.world_id AND i.owner_id=a.owner_id AND i.id=a.input_receipt_id
    LEFT JOIN parallel_life.agent_episode_attempt_bindings b ON b.world_id=a.world_id AND b.owner_id=a.owner_id AND b.attempt_id=a.id
    WHERE a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3 AND a.engine_epoch=$4`,
      [worldId, owner, actorId, epoch],
    )
  ).rows;
}
export function paidEpisodeRequest(row: {
  document: { origin: string; text: string };
  bound_request_id?: string | null;
}) {
  if (row.bound_request_id) return row.bound_request_id;
  if (row.document.origin !== 'coordination') return null;
  try {
    const intent = JSON.parse(row.document.text);
    return intent?.type === 'npc_episode_consideration' ? intent.requestId : null;
  } catch {
    return null;
  }
}
/** Known successful ordinary dialogue may carry the still-pending opportunity on a later player turn.
 * All uncertain/invalid/stale paid attempts stay fenced. Background dispatch cannot reuse this exception. */
export async function requireEpisodePaymentAvailable(
  sql: SqlClient,
  owner: string,
  r: { world_id: string; actor_id: string; engine_epoch: number; id: string },
  allowNewPlayerTurn: boolean,
  exceptAttemptId?: string,
) {
  const rows = await episodePaymentRows(sql, owner, r.world_id, r.actor_id, r.engine_epoch);
  for (const a of rows) {
    if (
      a.id === exceptAttemptId ||
      (a.sent_at == null && a.response_hash == null) ||
      paidEpisodeRequest(a) !== r.id
    )
      continue;
    if (
      allowNewPlayerTurn &&
      a.bound_request_id === r.id &&
      a.document.origin === 'player' &&
      a.status === 'committed'
    )
      continue;
    forbidden();
  }
}
async function currentManifest(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; actorId: string; worldVersion: number; storyAt: string },
  requestId: string,
) {
  const row = (
    await sql.query(
      `SELECT r.* FROM parallel_life.agent_episode_requests r
    JOIN parallel_life.agent_runtime_worlds c ON c.world_id=r.world_id AND c.owner_id=r.owner_id AND c.engine_epoch=r.engine_epoch
    WHERE r.world_id=$1 AND r.owner_id=$2 AND r.actor_id=$3 AND r.id=$4 AND r.status='pending'
    AND r.created_at_version<=$5`,
      [frame.worldId, owner, frame.actorId, requestId, frame.worldVersion],
    )
  ).rows[0];
  if (!row) forbidden();
  const view = (await readActorEpisodeIntentsInTransaction(sql, owner, frame, [requestId])).get(
    requestId,
  );
  // No global director prose may be substituted when this actor has no authorized directive.
  if (!view) forbidden();
  const base = {
    schemaVersion: 1 as const,
    requestId,
    requestRevision: 0 as const,
    episodeId: row.episode_id,
    actorId: row.actor_id,
    engineEpoch: row.engine_epoch,
    createdAtVersion: row.created_at_version,
    sourceId: view.source.id,
  };
  const manifest: PlayerEpisodeManifest = {
    ...base,
    contentHash: createHash('sha256')
      .update(
        authoredMaterialCanonicalJson({ base, source: view.source, observation: view.observation }),
      )
      .digest('hex'),
  };
  return { row, view, manifest };
}
export async function selectPlayerEpisodeManifest(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; actorId: string; worldVersion: number; storyAt: string },
  input: AgentInputReceipt,
) {
  if (
    input.origin !== 'player' ||
    input.channel !== 'private' ||
    input.recipientActorId !== frame.actorId ||
    input.threadId !== frame.actorId
  )
    return null;
  const rows = (
    await sql.query(
      `SELECT id FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND status='pending' AND created_at_version<=$4 ORDER BY created_at_version,created_at,id LIMIT 24`,
      [frame.worldId, owner, frame.actorId, frame.worldVersion],
    )
  ).rows;
  for (const r of rows) {
    try {
      const value = await currentManifest(sql, owner, frame, r.id);
      await requireEpisodePaymentAvailable(sql, owner, value.row, true);
      return value;
    } catch (error) {
      if ((error as { code?: string }).code !== 'INPUT_SCOPE_FORBIDDEN') throw error;
    }
  }
  return null;
}
export async function validatePlayerEpisodeManifest(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
) {
  const m = snapshot.episodeManifest;
  if (!m) return;
  if (
    !validPlayerEpisodeManifest(m) ||
    snapshot.input.origin !== 'player' ||
    snapshot.channel.kind !== 'private' ||
    snapshot.channel.threadId !== snapshot.state.actorId ||
    m.actorId !== snapshot.state.actorId
  )
    forbidden();
  const value = await currentManifest(
    sql,
    owner,
    {
      worldId: snapshot.state.worldId,
      actorId: snapshot.state.actorId,
      worldVersion: snapshot.worldVersion,
      storyAt: snapshot.storyAt,
    },
    m.requestId,
  );
  if (
    !isDeepStrictEqual(m, value.manifest) ||
    !snapshot.sources.some((s) => isDeepStrictEqual(s, value.view.source)) ||
    snapshot.observations.filter((o) => o.sourceId === m.sourceId).length !== 1 ||
    !snapshot.observations.some((o) => isDeepStrictEqual(o, value.view.observation))
  )
    forbidden();
}
export async function bindPlayerEpisodeAttempt(
  sql: SqlClient,
  owner: string,
  attempt: AgentAttempt,
  snapshot: AgentSnapshot,
) {
  if (!snapshot.episodeManifest) return;
  await validatePlayerEpisodeManifest(sql, owner, snapshot);
  const m = snapshot.episodeManifest;
  await requireEpisodePaymentAvailable(
    sql,
    owner,
    {
      world_id: attempt.worldId,
      actor_id: attempt.actorId,
      engine_epoch: attempt.engineEpoch,
      id: m.requestId,
    },
    true,
    attempt.id,
  );
  await sql.query(
    `INSERT INTO parallel_life.agent_episode_attempt_bindings(world_id,owner_id,actor_id,engine_epoch,request_id,episode_id,attempt_id,input_receipt_id,document)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(world_id,attempt_id) DO NOTHING`,
    [
      attempt.worldId,
      owner,
      attempt.actorId,
      attempt.engineEpoch,
      m.requestId,
      m.episodeId,
      attempt.id,
      attempt.inputReceiptId,
      JSON.stringify(m),
    ],
  );
  await requirePlayerEpisodeBinding(sql, owner, attempt, snapshot);
}
export async function requirePlayerEpisodeBinding(
  sql: SqlClient,
  owner: string,
  attempt: AgentAttempt,
  snapshot: AgentSnapshot,
) {
  const saved = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_episode_attempt_bindings WHERE world_id=$1 AND owner_id=$2 AND attempt_id=$3 AND actor_id=$4 AND input_receipt_id=$5',
      [attempt.worldId, owner, attempt.id, attempt.actorId, attempt.inputReceiptId],
    )
  ).rows[0];
  if (!isDeepStrictEqual(saved?.document ?? undefined, snapshot.episodeManifest)) forbidden();
}
