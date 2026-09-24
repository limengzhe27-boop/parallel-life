import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ClockStore } from '../application/ports.ts';
import type { WorldClock } from '../domain/clock.ts';
import { clampSpeed, DEFAULT_SPEED } from '../domain/clock.ts';

export class PostgresClockStore implements ClockStore {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async read(ownerId: string, worldId: string): Promise<WorldClock> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2', [
          worldId,
          ownerId,
        ])
      ).rows[0];
      if (row)
        return {
          storyNow: new Date(String(row.story_now)).toISOString(),
          speed: Number(row.speed),
          paused: Boolean(row.paused),
          lastTickAt: new Date(String(row.last_tick_at)).toISOString(),
          missedBeats: Number(row.missed_beats),
          summary: row.summary ? String(row.summary) : null,
        };
      /* A world created before the clock existed starts from its own story time. */
      const world = (
        await sql.query('SELECT state->>$$time$$ AS time FROM parallel_life.worlds WHERE id=$1', [
          worldId,
        ])
      ).rows[0];
      if (!world) throw new Error('NOT_FOUND');
      return {
        storyNow: new Date(String(world.time)).toISOString(),
        speed: DEFAULT_SPEED,
        paused: false,
        lastTickAt: new Date(String(world.time)).toISOString(),
        missedBeats: 0,
        summary: null,
      };
    });
  }
  async write(ownerId: string, worldId: string, clock: WorldClock): Promise<void> {
    await this.db.transaction(ownerId, (sql) =>
      sql.query(
        `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats,summary,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT(world_id) DO UPDATE SET story_now=EXCLUDED.story_now,speed=EXCLUDED.speed,
           paused=EXCLUDED.paused,last_tick_at=EXCLUDED.last_tick_at,missed_beats=EXCLUDED.missed_beats,
           summary=EXCLUDED.summary,updated_at=now()`,
        [
          worldId,
          ownerId,
          clock.storyNow,
          clock.speed,
          clock.paused,
          clock.lastTickAt,
          clock.missedBeats,
          clock.summary,
        ],
      ),
    );
  }
  async setClock(
    ownerId: string,
    worldId: string,
    input: { paused?: boolean; speed?: number },
  ): Promise<void> {
    const clock = await this.read(ownerId, worldId);
    await this.write(ownerId, worldId, {
      ...clock,
      paused: input.paused ?? clock.paused,
      speed: input.speed === undefined ? clock.speed : clampSpeed(input.speed),
      /* lastTickAt is left alone: time already elapsed still counts and no time is invented. */
    });
  }
  async setStoryTime(ownerId: string, worldId: string, storyNow: string): Promise<void> {
    await this.db.transaction(ownerId, (sql) =>
      sql.query(
        `UPDATE parallel_life.worlds
            SET state = jsonb_set(state, '{time}', to_jsonb($2::text)), updated_at = now()
          WHERE id=$1 AND owner_id=$3`,
        [worldId, storyNow, ownerId],
      ),
    );
  }
  async recordBeat(
    ownerId: string,
    worldId: string,
    beat: { id: string; commandId: string; plannedFor: string; actorId: string; status: string },
  ): Promise<void> {
    await this.db.transaction(ownerId, (sql: SqlClient) =>
      sql.query(
        `INSERT INTO parallel_life.world_beats(id,world_id,owner_id,command_id,planned_for,actor_id,status)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(world_id,command_id) DO NOTHING`,
        [beat.id, worldId, ownerId, beat.commandId, beat.plannedFor, beat.actorId, beat.status],
      ),
    );
  }
}
