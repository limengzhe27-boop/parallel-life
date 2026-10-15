import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import { DEFAULT_SPEED, projectStoryTime, type WorldClock } from '../domain/clock.ts';
import {
  CLOCK_ACTIVITY_LEASE_MS,
  activityMode,
  readableActivityClock,
  validateClockActivity,
  type ClockActivityInput,
  type ClockActivityLease,
} from '../domain/clock-activity.ts';

/** Shared decoder for all clock paths; the deadline must survive DB hydration. */
export function storedActivityClock(row: Record<string, unknown>): WorldClock {
  return {
    storyNow: new Date(row.story_now as string).toISOString(),
    lastTickAt: new Date(row.last_tick_at as string).toISOString(),
    speed: Number(row.speed),
    paused: Boolean(row.paused),
    missedBeats: Number(row.missed_beats),
    summary: row.summary ? String(row.summary) : null,
    ...(row.managed
      ? {
          managed: true,
          activeUntil: row.active_until ? new Date(row.active_until as string).toISOString() : null,
        }
      : {}),
  };
}
export class PostgresClockActivityRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async update(
    ownerId: string,
    worldId: string,
    input: ClockActivityInput,
    realNow = new Date().toISOString(),
  ): Promise<WorldClock> {
    return this.db.transaction(ownerId, (sql) =>
      updateClockActivity(sql, ownerId, worldId, input, realNow),
    );
  }
}

/** Reuses the caller's owner-scoped transaction, including atomic wait receipts. */
export async function updateClockActivity(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  input: ClockActivityInput,
  realNow = new Date().toISOString(),
): Promise<WorldClock> {
  validateClockActivity(input);
  if (!Number.isFinite(Date.parse(realNow))) throw new DomainError('INVALID_COMMAND');

  if (
    !(
      await sql.query('SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
        worldId,
        ownerId,
      ])
    ).rowCount
  )
    throw new DomainError('NOT_FOUND');
  const exclusive = Boolean(
    (
      await sql.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [
        worldId,
      ])
    ).rows[0]?.locked,
  );
  const world = (
    await sql.query(
      'SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0]!;
  const row = (
    await sql.query(
      'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0];
  const clock: WorldClock = row
    ? storedActivityClock(row)
    : {
        storyNow: world.state.time,
        lastTickAt: realNow,
        speed: DEFAULT_SPEED,
        paused: false,
        missedBeats: 0,
        summary: null,
      };
  // Another tab may have committed a newer anchor while this request waited for a row lock.
  realNow = new Date(Math.max(Date.parse(realNow), Date.parse(clock.lastTickAt))).toISOString();
  const leases = (
    await sql.query(
      'SELECT * FROM parallel_life.world_clock_activity WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows.map((r): ClockActivityLease => ({
    clientId: String(r.client_id),
    sequence: Number(r.sequence),
    mode: r.mode,
    expiresAt: new Date(r.expires_at).toISOString(),
  }));
  const previous = leases.find((l) => l.clientId.toLowerCase() === input.clientId.toLowerCase());
  if (previous && previous.sequence >= input.sequence) return readableActivityClock(clock, realNow);
  if (!exclusive) {
    if (
      !clock.managed ||
      clock.paused ||
      !clock.activeUntil ||
      Date.parse(clock.activeUntil) <= Date.parse(realNow) ||
      !previous ||
      previous.mode !== input.mode ||
      input.mode === 'away' ||
      input.resume ||
      Date.parse(previous.expiresAt) <= Date.parse(realNow)
    )
      throw new DomainError('VERSION_CONFLICT');
    const until = new Date(Date.parse(realNow) + CLOCK_ACTIVITY_LEASE_MS).toISOString();
    await sql.query(
      'UPDATE parallel_life.world_clock_activity SET sequence=$4,expires_at=$5,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND client_id=$3',
      [worldId, ownerId, input.clientId, input.sequence, until],
    );
    // Only a known live tab's identical mode may extend presence during model work.
    // This never overwrites time, speed, paused state or the beat anchor.
    const activeUntil = new Date(
      Math.max(Date.parse(clock.activeUntil), Date.parse(until)),
    ).toISOString();
    await sql.query(
      'UPDATE parallel_life.world_clock SET active_until=$3,updated_at=now() WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId, activeUntil],
    );
    return { ...clock, activeUntil };
  }
  if (!previous && leases.length >= 128)
    throw new DomainError('INVALID_COMMAND', '活动窗口过多，请继续使用已有窗口');
  // A retired tab cannot resurrect a managed, inactive world without an explicit choice.
  const liveBefore = activityMode(leases, realNow).activeUntil !== null;
  const permitted = !clock.managed
    ? !clock.paused || input.resume === true
    : input.resume === true || (!clock.paused && liveBefore);
  const lease: ClockActivityLease = {
    clientId: input.clientId,
    sequence: input.sequence,
    mode: permitted ? input.mode : 'away',
    expiresAt:
      permitted && input.mode !== 'away'
        ? new Date(Date.parse(realNow) + CLOCK_ACTIVITY_LEASE_MS).toISOString()
        : realNow,
  };
  await sql.query(
    `INSERT INTO parallel_life.world_clock_activity(world_id,owner_id,client_id,sequence,mode,expires_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(world_id,client_id) DO UPDATE SET sequence=EXCLUDED.sequence,mode=EXCLUDED.mode,expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [worldId, ownerId, input.clientId, input.sequence, lease.mode, lease.expiresAt],
  );
  const mode = activityMode([...leases.filter((l) => l !== previous), lease], realNow);
  const paused = !permitted || !mode.activeUntil;
  const changed =
    !clock.managed || clock.paused || !liveBefore || clock.speed !== mode.speed || paused;
  const storyNow = new Date(
    Math.max(Date.parse(world.state.time), Date.parse(projectStoryTime(clock, realNow))),
  ).toISOString();
  const next: WorldClock = {
    ...clock,
    managed: true,
    activeUntil: paused ? null : mode.activeUntil,
    paused,
    speed: mode.speed,
    storyNow: changed ? storyNow : clock.storyNow,
    lastTickAt: changed ? realNow : clock.lastTickAt,
  };
  await sql.query(
    `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,last_tick_at,speed,paused,missed_beats,summary,managed,active_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9) ON CONFLICT(world_id) DO UPDATE SET story_now=EXCLUDED.story_now,last_tick_at=EXCLUDED.last_tick_at,speed=EXCLUDED.speed,paused=EXCLUDED.paused,managed=true,active_until=EXCLUDED.active_until,updated_at=now()`,
    [
      worldId,
      ownerId,
      next.storyNow,
      next.lastTickAt,
      next.speed,
      next.paused,
      next.missedBeats,
      next.summary,
      next.activeUntil,
    ],
  );
  return readableActivityClock(next, realNow);
}
