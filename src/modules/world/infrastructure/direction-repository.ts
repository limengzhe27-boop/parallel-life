import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { DirectionStore } from '../application/ports.ts';
import { EMPTY_DIRECTION, type Pacing, type WorldDirection } from '../domain/direction.ts';

/** The director brief of one life. Absent means "no guidance yet". */
export class PostgresDirectionStore implements DirectionStore {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async read(ownerId: string, worldId: string): Promise<WorldDirection> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          'SELECT guidance, themes, pacing, focus_actor_ids FROM parallel_life.world_direction WHERE world_id=$1 AND owner_id=$2',
          [worldId, ownerId],
        )
      ).rows[0];
      if (!row) return EMPTY_DIRECTION;
      return {
        guidance: String(row.guidance),
        themes: Array.isArray(row.themes) ? row.themes.map(String) : [],
        pacing: String(row.pacing) as Pacing,
        focusActorIds: Array.isArray(row.focus_actor_ids) ? row.focus_actor_ids.map(String) : [],
      };
    });
  }
  async write(ownerId: string, worldId: string, direction: WorldDirection): Promise<void> {
    await this.db.transaction(ownerId, (sql) =>
      sql.query(
        `INSERT INTO parallel_life.world_direction(world_id,owner_id,guidance,themes,pacing,focus_actor_ids,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT(world_id) DO UPDATE SET guidance=EXCLUDED.guidance,themes=EXCLUDED.themes,
           pacing=EXCLUDED.pacing,focus_actor_ids=EXCLUDED.focus_actor_ids,updated_at=now()`,
        [
          worldId,
          ownerId,
          direction.guidance,
          direction.themes,
          direction.pacing,
          direction.focusActorIds,
        ],
      ),
    );
  }
}
