import { randomUUID } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { Profile } from '../../../contracts/api.ts';
export class IdentityRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async ensureGuest(userId: string) {
    await this.db.transaction(userId, async (sql) => {
      const exists = (await sql.query('SELECT 1 FROM parallel_life.accounts WHERE id=$1', [userId]))
        .rowCount;
      if (!exists && !(await sql.query('SELECT parallel_life.reserve_guest() ok')).rows[0]?.ok)
        throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
      await sql.query('INSERT INTO parallel_life.accounts(id) VALUES($1) ON CONFLICT DO NOTHING', [
        userId,
      ]);
      const profile: Profile = {
        id: randomUUID(),
        version: 0,
        facts: [],
        events: [],
        people: [],
        portraitAssetId: null,
        updatedAt: new Date().toISOString(),
      };
      await sql.query(
        'INSERT INTO parallel_life.profiles(id,owner_id,document) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO NOTHING',
        [profile.id, userId, profile],
      );
      await sql.query(
        'INSERT INTO parallel_life.interviews(id,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO NOTHING',
        [randomUUID(), userId],
      );
    });
  }
  async exists(userId: string) {
    return this.db.transaction(
      userId,
      async (sql) =>
        !!(await sql.query('SELECT 1 FROM parallel_life.accounts WHERE id=$1', [userId])).rowCount,
    );
  }
}
