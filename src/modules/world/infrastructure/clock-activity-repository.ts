import { randomUUID } from 'node:crypto';
import { authorizeWorldCommandInTransaction } from './world-command-uow.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import { DEFAULT_SPEED, projectStoryTime, type WorldClock } from '../domain/clock.ts';
import {
  CLOCK_ACTIVITY_LEASE_MS,
  activityMode,
  appointmentDeadline,
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
/** Only persisted owner-visible calendar state enters the clock; no script or private prose. */
async function effectiveAppointments(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  version: number,
) {
  const initial = (
    await sql.query(
      'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId],
    )
  ).rows[0]?.state;
  const projected = (
    await sql.query(
      `SELECT p.document FROM parallel_life.world_appointments p
    JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id AND e.owner_id=p.owner_id
    WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3 ORDER BY e.version,p.id`,
      [worldId, ownerId, version],
    )
  ).rows;
  const appointments = new Map<string, { id: string; at: string; status?: string }>();
  for (const a of [...(initial?.appointments ?? []), ...projected.map((r) => r.document)])
    if (a && typeof a.id === 'string' && typeof a.at === 'string')
      appointments.set(a.id, { id: a.id, at: a.at, status: a.status });
  const changes = await sql.query(
    `SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version<=$3
    AND (payload->>'type'='invitation.responded' OR payload->'data'->'worldResults'->'attendance' IS NOT NULL) ORDER BY version`,
    [worldId, ownerId, version],
  );
  for (const { payload: e } of changes.rows) {
    const attendanceId = e.data?.worldResults?.attendance?.appointmentId;
    if (attendanceId && appointments.has(attendanceId))
      appointments.get(attendanceId)!.status = 'attended';
    if (e.type !== 'invitation.responded') continue;
    const a = appointments.get(e.data?.id);
    if (!a) continue;
    switch (e.data.operation) {
      case 'accept':
        a.status = 'confirmed';
        break;
      case 'cancel':
        a.status = 'cancelled';
        break;
      case 'attend':
        a.status = 'attended';
        break;
      case 'miss':
        a.status = 'missed';
        break;
      case 'reschedule':
        a.status = 'proposed';
        a.at = e.data.at;
        break;
    }
  }
  return [...appointments.values()];
}
function boundedDeadline(until: string, boundary: string | null) {
  return boundary && Date.parse(boundary) < Date.parse(until) ? boundary : until;
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
      'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0]!;
  const row = (
    await sql.query(
      'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0];
  let clock: WorldClock = row
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
  const appointments = await effectiveAppointments(sql, ownerId, worldId, Number(world.version));
  // Reconcile a newly saved earlier appointment before projecting elapsed time.
  // An explicit continue consumes only an already reached boundary, not a future one.
  const originalProjection = projectStoryTime(clock, realNow);
  const skipThrough =
    input.resume &&
    clock.managed &&
    clock.activeUntil &&
    Date.parse(clock.activeUntil) <= Date.parse(realNow)
      ? originalProjection
      : new Date(Math.max(Date.parse(clock.storyNow), Date.parse(world.state.time))).toISOString();
  const boundary = appointmentDeadline(clock, appointments, skipThrough);
  if (clock.activeUntil && boundary)
    clock = { ...clock, activeUntil: boundedDeadline(clock.activeUntil, boundary) };
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
  await authorizeWorldCommandInTransaction(sql, ownerId, {
    worldId,
    commandId: randomUUID(),
    expectedWorldVersion: Number(world.version),
    kind: 'clock_control',
  });
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
    const activeUntil = boundedDeadline(
      new Date(Math.max(Date.parse(clock.activeUntil), Date.parse(until))).toISOString(),
      boundary,
    );
    await sql.query(
      'UPDATE parallel_life.world_clock SET active_until=$3,updated_at=now() WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId, activeUntil],
    );
    return { ...clock, activeUntil };
  }
  const previousLive =
    previous && previous.mode !== 'away' && Date.parse(previous.expiresAt) > Date.parse(realNow);
  const liveCount = leases.filter(
    (l) => l.mode !== 'away' && Date.parse(l.expiresAt) > Date.parse(realNow),
  ).length;
  if (!previousLive && input.mode !== 'away' && liveCount >= 32)
    throw new DomainError('INVALID_COMMAND', '活动窗口过多，请继续使用已有窗口');
  // A retired tab cannot resurrect a managed, inactive world without an explicit choice.
  const liveBefore = activityMode(leases, realNow).activeUntil !== null;
  const permitted = !clock.managed
    ? !clock.paused || input.resume === true
    : input.resume === true ||
      (!clock.paused &&
        liveBefore &&
        !!clock.activeUntil &&
        Date.parse(clock.activeUntil) > Date.parse(realNow));
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
    !clock.managed ||
    clock.paused ||
    !liveBefore ||
    clock.speed !== mode.speed ||
    (!!clock.activeUntil && Date.parse(clock.activeUntil) <= Date.parse(realNow)) ||
    paused;
  const storyNow = new Date(
    Math.max(Date.parse(world.state.time), Date.parse(projectStoryTime(clock, realNow))),
  ).toISOString();
  const next: WorldClock = {
    ...clock,
    managed: true,
    activeUntil: paused ? null : mode.activeUntil,
    paused,
    summary: input.resume ? null : clock.summary,
    speed: mode.speed,
    storyNow: changed ? storyNow : clock.storyNow,
    lastTickAt: changed ? realNow : clock.lastTickAt,
  };
  if (next.activeUntil)
    next.activeUntil = boundedDeadline(next.activeUntil, appointmentDeadline(next, appointments));
  if (
    paused &&
    appointments.some((a) => a.status === 'confirmed' && Date.parse(a.at) === Date.parse(storyNow))
  )
    next.summary = '约定时间到了，请查看日程。';
  await sql.query(
    `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,last_tick_at,speed,paused,missed_beats,summary,managed,active_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9) ON CONFLICT(world_id) DO UPDATE SET story_now=EXCLUDED.story_now,last_tick_at=EXCLUDED.last_tick_at,speed=EXCLUDED.speed,paused=EXCLUDED.paused,managed=true,active_until=EXCLUDED.active_until,summary=EXCLUDED.summary,updated_at=now()`,
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

/** Caller already owns its owner-scoped world transaction. This never extends a lease. */
export async function capClockAtNextAppointment(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  realNow = new Date().toISOString(),
): Promise<void> {
  if (!Number.isFinite(Date.parse(realNow))) throw new DomainError('INVALID_COMMAND');
  const world = (
    await sql.query(
      'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0];
  if (!world) throw new DomainError('NOT_FOUND');
  const row = (
    await sql.query(
      'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0];
  if (!row) return;
  const clock = storedActivityClock(row);
  if (!clock.managed || clock.paused || !clock.activeUntil) return;
  const appointments = await effectiveAppointments(sql, ownerId, worldId, Number(world.version));
  const deadline = appointmentDeadline(
    clock,
    appointments,
    new Date(Math.max(Date.parse(clock.storyNow), Date.parse(world.state.time))).toISOString(),
  );
  if (deadline && Date.parse(deadline) < Date.parse(clock.activeUntil))
    await sql.query(
      'UPDATE parallel_life.world_clock SET active_until=$3,updated_at=now() WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId, deadline],
    );
}
