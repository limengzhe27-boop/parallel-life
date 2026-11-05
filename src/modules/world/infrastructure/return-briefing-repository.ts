import { createHash, randomUUID } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import type { ReturnBriefing, ReturnBriefingStatus } from '../domain/return-briefing.ts';
import { RETURN_BRIEFING_LEASE_MS } from '../domain/return-briefing.ts';

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}
function decode(row: Row): ReturnBriefing {
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    ownerId: String(row.owner_id),
    leftAt: iso(row.left_at),
    returnedAt: iso(row.returned_at),
    gapSeconds: Number(row.gap_seconds),
    storyFrom: iso(row.story_from),
    storyUntil: iso(row.story_until),
    status: row.status as ReturnBriefingStatus,
    attempt: Number(row.attempt),
    leaseUntil: row.lease_until ? iso(row.lease_until) : null,
    beatIndex: Number(row.beat_index),
    messageIds: Array.isArray(row.message_ids) ? (row.message_ids as string[]) : [],
    error: row.error ? String(row.error) : null,
  };
}

export async function readReturnBriefingInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  briefingId: string,
): Promise<ReturnBriefing | null> {
  const row = (
    await sql.query(
      'SELECT * FROM parallel_life.world_return_briefings WHERE world_id=$1 AND owner_id=$2 AND id=$3',
      [worldId, ownerId, briefingId],
    )
  ).rows[0];
  return row ? decode(row) : null;
}

export async function latestReturnBriefingInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  leftAt: string,
): Promise<ReturnBriefing | null> {
  const row = (
    await sql.query(
      `SELECT * FROM parallel_life.world_return_briefings
        WHERE world_id=$1 AND owner_id=$2 AND left_at=$3::timestamptz
        ORDER BY created_at DESC LIMIT 1`,
      [worldId, ownerId, leftAt],
    )
  ).rows[0];
  return row ? decode(row) : null;
}

/**
 * One row per leave/return pair. A crash or refresh reuses the same row; a
 * completed briefing is never reopened by a later resume of the same absence.
 */
export async function createReturnBriefingInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: {
    worldId: string;
    leftAt: string;
    returnedAt: string;
    gapSeconds: number;
    storyFrom: string;
    storyUntil: string;
  },
): Promise<ReturnBriefing> {
  const row = (
    await sql.query(
      `INSERT INTO parallel_life.world_return_briefings(
         id,world_id,owner_id,left_at,returned_at,gap_seconds,story_from,story_until,status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       ON CONFLICT(world_id,left_at) DO UPDATE SET
         returned_at=EXCLUDED.returned_at,
         gap_seconds=EXCLUDED.gap_seconds,
         story_until=GREATEST(parallel_life.world_return_briefings.story_until,EXCLUDED.story_until),
         updated_at=now()
       WHERE parallel_life.world_return_briefings.status IN ('pending','failed')
       RETURNING *`,
      [
        randomUUID(),
        input.worldId,
        ownerId,
        input.leftAt,
        input.returnedAt,
        input.gapSeconds,
        input.storyFrom,
        input.storyUntil,
      ],
    )
  ).rows[0];
  if (row) return decode(row);
  const existing = await latestReturnBriefingInTransaction(sql, ownerId, input.worldId, input.leftAt);
  if (!existing) throw new DomainError('INVALID_COMMAND', '回访补演无法建立');
  return existing;
}

/** A live lease or a completed row never buys another paid turn. */
export async function claimReturnBriefingInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  briefingId: string,
): Promise<{ briefing: ReturnBriefing; claimed: boolean }> {
  const existing = await readReturnBriefingInTransaction(sql, ownerId, worldId, briefingId);
  if (!existing) throw new DomainError('NOT_FOUND');
  if (existing.status === 'completed') return { briefing: existing, claimed: false };
  if (existing.status === 'running' && existing.leaseUntil && Date.parse(existing.leaseUntil) > Date.now())
    return { briefing: existing, claimed: false };
  if (existing.status === 'failed' && existing.attempt >= 2)
    throw new DomainError('INVALID_COMMAND', '这段回访补演已经失败，请重新进入这段人生');
  const row = (
    await sql.query(
      `UPDATE parallel_life.world_return_briefings SET
         status='running',attempt=attempt+1,lease_until=now()+$4::interval,
         error=NULL,updated_at=now()
       WHERE world_id=$1 AND owner_id=$2 AND id=$3
         AND (status IN ('pending','failed') OR (status='running' AND (lease_until IS NULL OR lease_until<=now())))
       RETURNING *`,
      [worldId, ownerId, briefingId, `${RETURN_BRIEFING_LEASE_MS} milliseconds`],
    )
  ).rows[0];
  if (row) return { briefing: decode(row), claimed: true };
  const raced = await readReturnBriefingInTransaction(sql, ownerId, worldId, briefingId);
  if (!raced) throw new DomainError('NOT_FOUND');
  return { briefing: raced, claimed: false };
}

export async function recordReturnBriefingBeatInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  briefingId: string,
  beatIndex: number,
  messageIds: readonly string[],
): Promise<void> {
  await sql.query(
    `UPDATE parallel_life.world_return_briefings SET
       beat_index=GREATEST(beat_index,$4),
       message_ids=COALESCE((SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(message_ids || $5::jsonb) value),'[]'::jsonb),
       lease_until=now()+$6::interval,updated_at=now()
     WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND status='running'`,
    [worldId, ownerId, briefingId, beatIndex, JSON.stringify(messageIds), `${RETURN_BRIEFING_LEASE_MS} milliseconds`],
  );
}

export async function finishReturnBriefingInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  briefingId: string,
): Promise<ReturnBriefing> {
  const row = (
    await sql.query(
      `UPDATE parallel_life.world_return_briefings SET
         status='completed',lease_until=NULL,error=NULL,updated_at=now()
       WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND status='running'
       RETURNING *`,
      [worldId, ownerId, briefingId],
    )
  ).rows[0];
  if (row) return decode(row);
  const existing = await readReturnBriefingInTransaction(sql, ownerId, worldId, briefingId);
  if (!existing) throw new DomainError('NOT_FOUND');
  return existing;
}

export async function failReturnBriefingInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  briefingId: string,
  error: string,
): Promise<void> {
  await sql.query(
    `UPDATE parallel_life.world_return_briefings SET
       status='failed',lease_until=NULL,error=$4,updated_at=now()
     WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND status='running'`,
    [worldId, ownerId, briefingId, error.slice(0, 500)],
  );
}

/** The simulation advances the clock to one beat at a time, never to real wall time. */
export async function setReturnBriefingBeatInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  storyAt: string,
): Promise<void> {
  const row = (
    await sql.query(
      `UPDATE parallel_life.world_clock SET
         story_now=GREATEST(story_now,$3::timestamptz),last_tick_at=now(),
         paused=false,pause_reason=NULL,active_until=NULL,updated_at=now()
       WHERE world_id=$1 AND owner_id=$2
       RETURNING story_now`,
      [worldId, ownerId, storyAt],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
}

export async function resumeAfterReturnBriefingInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  storyUntil: string,
): Promise<void> {
  await sql.query(
    `UPDATE parallel_life.world_clock SET
       story_now=GREATEST(story_now,$3::timestamptz),last_tick_at=now(),
       paused=false,pause_reason=NULL,active_until=NULL,summary=NULL,last_present_at=now(),updated_at=now()
     WHERE world_id=$1 AND owner_id=$2`,
    [worldId, ownerId, storyUntil],
  );
}

/** Deterministic command identity: retries cannot buy the same beat twice. */
export function returnBriefingCommandId(worldId: string, briefingId: string, threadKey: string) {
  const bytes = createHash('sha256')
    .update(`return-briefing:${worldId}:${briefingId}:${threadKey}`)
    .digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function returnBriefingMessageIdsInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  actorId: string,
  eventId: string,
): Promise<string[]> {
  const rows = (
    await sql.query(
      `SELECT id FROM parallel_life.world_messages
        WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND document->>'sourceEventId'=$4
        ORDER BY id`,
      [worldId, ownerId, actorId, eventId],
    )
  ).rows;
  return rows.map((row) => String(row.id));
}

export class PostgresReturnBriefingRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  read(ownerId: string, worldId: string, briefingId: string) {
    return this.db.transaction(ownerId, (sql) =>
      readReturnBriefingInTransaction(sql, ownerId, worldId, briefingId),
    );
  }
}
