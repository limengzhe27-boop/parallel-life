import { authorizeWorldCommandInTransaction } from './world-command-uow.ts';
import { storedActivityClock } from './clock-activity-repository.ts';
import { readableActivityClock } from '../domain/clock-activity.ts';
import { randomUUID } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from './postgres-world-repository.ts';
import { lockWorldActivity, assertSpaceIdle } from './space-repository.ts';
import { requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { DomainError } from '../domain/errors.ts';
import { DEFAULT_SPEED, type WorldClock } from '../domain/clock.ts';
import {
  planAppointmentWait,
  applyAppointmentWaitEvent,
  appointmentWaitReceipt,
  AppointmentWaitError,
  type AppointmentWaitEvent,
} from '../domain/appointment-wait.ts';
import type { AppointmentWaitPort } from '../application/appointment-wait.ts';
import {
  AppointmentWaitRequestSchema,
  AppointmentWaitEventSchema,
  AppointmentWaitReceiptSchema,
  type AppointmentWaitRequest,
} from '../../../contracts/appointment-wait.ts';

export class PostgresAppointmentWaitRepository implements AppointmentWaitPort {
  private readonly db: PostgresDatabase;
  private readonly now: () => string;
  private readonly newId: () => string;
  constructor(db: PostgresDatabase, options: { now?: () => string; newId?: () => string } = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? randomUUID;
  }
  private async replay(
    sql: SqlClient,
    ownerId: string,
    worldId: string,
    input: AppointmentWaitRequest,
    hash: string,
  ) {
    const row = (
      await sql.query(
        'SELECT c.request_hash,c.status,e.payload FROM parallel_life.commands c LEFT JOIN parallel_life.world_events e ON e.world_id=c.world_id AND e.owner_id=c.owner_id AND e.id=c.result_event_id WHERE c.world_id=$1 AND c.owner_id=$2 AND c.id=$3',
        [worldId, ownerId, input.commandId],
      )
    ).rows[0];
    if (!row) return null;
    if (row.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
    if (row.status !== 'succeeded') throw new DomainError('VERSION_CONFLICT');
    const event = AppointmentWaitEventSchema.parse(row.payload);
    if (
      event.worldId !== worldId ||
      event.commandId !== input.commandId ||
      event.data.invitationId !== input.invitationId ||
      event.version !== input.expectedVersion + 1
    )
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    return AppointmentWaitReceiptSchema.parse(appointmentWaitReceipt(event));
  }
  async wait(ownerId: string, worldId: string, raw: AppointmentWaitRequest) {
    const input = AppointmentWaitRequestSchema.parse(raw),
      hash = requestHash(['appointment.wait', worldId, input]);
    // A persisted receipt can be read even if the owner later paused, entered a scene or changed the appointment.
    const old = await this.db.transaction(ownerId, async (sql) => {
      if (
        !(
          await sql.query('SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            worldId,
            ownerId,
          ])
        ).rowCount
      )
        throw new DomainError('NOT_FOUND');
      return this.replay(sql, ownerId, worldId, input, hash);
    });
    if (old) return old;
    // Use the existing real hydration, including the root's trusted publication venue links.
    const snapshot = await new PostgresWorldRepository(this.db).get({ userId: ownerId }, worldId);
    if (snapshot.ownerId !== ownerId || snapshot.id !== worldId) throw new DomainError('NOT_FOUND');
    return this.db.transaction(ownerId, async (sql) => {
      await lockWorldActivity(sql, worldId);
      const row = (
        await sql.query(
          'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND');
      const replay = await this.replay(sql, ownerId, worldId, input, hash);
      if (replay) return replay;
      if (Number(row.version) !== input.expectedVersion || snapshot.version !== Number(row.version))
        throw new DomainError('VERSION_CONFLICT');
      await authorizeWorldCommandInTransaction(sql, ownerId, {
        worldId,
        commandId: input.commandId,
        expectedWorldVersion: input.expectedVersion,
        kind: 'story_wait',
      });
      await assertSpaceIdle(sql, worldId);
      const active = (
        await sql.query(
          'SELECT current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0]?.current_scene_id;
      if (active != null) throw new AppointmentWaitError('ACTIVE_SCENE');
      const lockedSnapshot = { ...snapshot, time: row.state.time, version: Number(row.version) };
      const now = this.now(),
        storedClock = (
          await sql.query(
            'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
            [worldId, ownerId],
          )
        ).rows[0];
      const clock: WorldClock = storedClock
        ? readableActivityClock(storedActivityClock(storedClock), now)
        : {
            storyNow: lockedSnapshot.time,
            lastTickAt: now,
            speed: DEFAULT_SPEED,
            paused: false,
            missedBeats: 0,
            summary: null,
          };
      const data = planAppointmentWait(
        lockedSnapshot,
        { ...input, worldId },
        { clock, realNow: now, currentSceneId: null },
      );
      const event: AppointmentWaitEvent = {
        schemaVersion: 1,
        type: 'appointment.waited',
        id: this.newId(),
        worldId,
        commandId: input.commandId,
        version: input.expectedVersion + 1,
        occurredAt: now,
        storyAt: data.toStoryAt,
        data,
      };
      AppointmentWaitEventSchema.parse(event);
      const reduced = applyAppointmentWaitEvent(lockedSnapshot, event),
        receipt = AppointmentWaitReceiptSchema.parse(appointmentWaitReceipt(event));
      // Only time/version changes in the persisted compact snapshot. Hydrated private projections and derived venue links are not copied into it.
      const stored = { ...row.state, version: reduced.version, time: reduced.time };
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [input.commandId, worldId, ownerId, input.expectedVersion, hash, input],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, worldId, ownerId, event.version, input.commandId, event, now],
      );
      await sql.query(
        'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1 AND owner_id=$4',
        [worldId, event.version, stored, ownerId],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$4,result_state=$5,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND id=$3",
        [worldId, ownerId, input.commandId, event.id, stored],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(world_id) DO UPDATE SET story_now=EXCLUDED.story_now,last_tick_at=EXCLUDED.last_tick_at,updated_at=now()',
        [
          worldId,
          ownerId,
          event.storyAt,
          clock.speed,
          clock.paused,
          now,
          clock.missedBeats,
          clock.summary,
        ],
      );
      return receipt;
    });
  }
}
