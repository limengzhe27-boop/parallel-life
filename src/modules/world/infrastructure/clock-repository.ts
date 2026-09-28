import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ClockStore } from '../application/ports.ts';
import type { WorldClock } from '../domain/clock.ts';
import { clampSpeed, DEFAULT_SPEED, projectStoryTime } from '../domain/clock.ts';
import { DomainError } from '../domain/errors.ts';
import { createHash } from 'node:crypto';

export class PostgresClockStore implements ClockStore {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  beatCommandId(worldId: string, at: string): string {
    const bytes = createHash('sha256').update(`director-beat:${worldId}:${at}`).digest();
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  async withAdvanceLock<T>(worldId: string, run: () => Promise<T>): Promise<T> {
    const client = await this.db.pool.connect();
    let locked = false;
    try {
      locked = Boolean(
        (
          await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [
            worldId,
          ])
        ).rows[0]?.locked,
      );
      if (!locked) throw new DomainError('VERSION_CONFLICT', '导演正在处理这段人生');
      return await run();
    } finally {
      if (locked) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [worldId]);
          client.release();
        } catch {
          client.release(true);
        }
      } else client.release();
    }
  }
  async read(ownerId: string, worldId: string): Promise<WorldClock> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2',
          [worldId, ownerId],
        )
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
      if (!world) throw new DomainError('NOT_FOUND');
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
  async ensureAnchor(ownerId: string, worldId: string, clock: WorldClock): Promise<void> {
    await this.db.transaction(ownerId, (sql) =>
      sql.query(
        `INSERT INTO parallel_life.world_clock
           (world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats,summary)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(world_id) DO NOTHING`,
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
    realNow = new Date().toISOString(),
  ): Promise<void> {
    const clock = await this.read(ownerId, worldId);
    await this.write(ownerId, worldId, {
      ...clock,
      storyNow: projectStoryTime(clock, realNow),
      paused: input.paused ?? clock.paused,
      speed: input.speed === undefined ? clock.speed : clampSpeed(input.speed),
      /* Anchor the old rate before changing it; paused time never accumulates on resume. */
      lastTickAt: realNow,
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
  async committedBeat(ownerId: string, worldId: string, commandId: string): Promise<string | null> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT payload->'data'->>'actorId' AS actor_id
             FROM parallel_life.world_events
            WHERE world_id=$1 AND owner_id=$2 AND command_id=$3`,
          [worldId, ownerId, commandId],
        )
      ).rows[0];
      return row?.actor_id ? String(row.actor_id) : null;
    });
  }
  async recentActors(ownerId: string, worldId: string, sinceStoryAt: string): Promise<string[]> {
    return this.db.transaction(ownerId, async (sql) => {
      const rows = await sql.query(
        `SELECT DISTINCT actor_id FROM parallel_life.world_beats
          WHERE world_id=$1 AND owner_id=$2 AND planned_for >= $3 AND status='played'`,
        [worldId, ownerId, sinceStoryAt],
      );
      return rows.rows.map((row) => String(row.actor_id));
    });
  }
  async hasUnresolvedAttempt(ownerId: string, worldId: string): Promise<boolean> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT EXISTS (
             SELECT 1 FROM parallel_life.world_director_attempts a
              WHERE a.world_id=$1 AND a.owner_id=$2 AND a.status<>'committed'
                AND NOT EXISTS (
                  SELECT 1 FROM parallel_life.world_events e
                   WHERE e.world_id=a.world_id AND e.owner_id=a.owner_id
                     AND e.command_id=a.command_id::text
                )
           ) AS unresolved`,
          [worldId, ownerId],
        )
      ).rows[0];
      return Boolean(row?.unresolved);
    });
  }
  async pendingAttempt(
    ownerId: string,
    worldId: string,
  ): Promise<{ commandId: string; plannedFor: string; actorId: string } | null> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT command_id,planned_for,actor_id FROM parallel_life.world_director_attempts
            WHERE world_id=$1 AND owner_id=$2 AND status<>'committed'
            ORDER BY planned_for,created_at LIMIT 1`,
          [worldId, ownerId],
        )
      ).rows[0];
      return row
        ? {
            commandId: String(row.command_id),
            plannedFor: new Date(String(row.planned_for)).toISOString(),
            actorId: String(row.actor_id),
          }
        : null;
    });
  }
  async beginAttempt(
    ownerId: string,
    worldId: string,
    attempt: { commandId: string; plannedFor: string; actorId: string },
    allowRetry: boolean,
  ): Promise<boolean> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT status FROM parallel_life.world_director_attempts
            WHERE world_id=$1 AND owner_id=$2 AND command_id=$3 FOR UPDATE`,
          [worldId, ownerId, attempt.commandId],
        )
      ).rows[0];
      if (row?.status === 'committed') return false;
      if (row && !allowRetry) return false;
      if (row) {
        await sql.query(
          `UPDATE parallel_life.world_director_attempts
              SET status='started',actor_id=$4,updated_at=now()
            WHERE world_id=$1 AND owner_id=$2 AND command_id=$3`,
          [worldId, ownerId, attempt.commandId, attempt.actorId],
        );
      } else {
        await sql.query(
          `INSERT INTO parallel_life.world_director_attempts
             (world_id,owner_id,command_id,planned_for,actor_id,status)
           VALUES($1,$2,$3,$4,$5,'started')`,
          [worldId, ownerId, attempt.commandId, attempt.plannedFor, attempt.actorId],
        );
      }
      return true;
    });
  }
  async markAttempt(
    ownerId: string,
    worldId: string,
    commandId: string,
    status: 'committed' | 'unknown',
  ): Promise<void> {
    await this.db.transaction(ownerId, (sql) =>
      sql.query(
        `UPDATE parallel_life.world_director_attempts
            SET status=$4,updated_at=now()
          WHERE world_id=$1 AND owner_id=$2 AND command_id=$3`,
        [worldId, ownerId, commandId, status],
      ),
    );
  }
  async finishAdvance(ownerId: string, worldId: string, clock: WorldClock): Promise<void> {
    await this.db.transaction(ownerId, async (sql) => {
      const world = (
        await sql.query(
          'SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0];
      if (!world) throw new DomainError('NOT_FOUND');
      const currentTime = String(world.state.time);
      const storyNow = new Date(
        Math.max(Date.parse(currentTime), Date.parse(clock.storyNow)),
      ).toISOString();
      await sql.query(
        `UPDATE parallel_life.worlds
            SET state=jsonb_set(state,'{time}',to_jsonb($2::text)),updated_at=now()
          WHERE id=$1 AND owner_id=$3`,
        [worldId, storyNow, ownerId],
      );
      await sql.query(
        `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats,summary,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
         ON CONFLICT(world_id) DO UPDATE SET
           story_now=GREATEST(parallel_life.world_clock.story_now,EXCLUDED.story_now),
           speed=parallel_life.world_clock.speed,paused=parallel_life.world_clock.paused,
           last_tick_at=GREATEST(parallel_life.world_clock.last_tick_at,EXCLUDED.last_tick_at),
           missed_beats=EXCLUDED.missed_beats,summary=EXCLUDED.summary,updated_at=now()`,
        [
          worldId,
          ownerId,
          storyNow,
          clock.speed,
          clock.paused,
          clock.lastTickAt,
          clock.missedBeats,
          clock.summary,
        ],
      );
    });
  }
}
