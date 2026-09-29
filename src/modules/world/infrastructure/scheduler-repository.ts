import type { DueWorldSource } from '../application/run-daily-scheduler.ts';
import { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';

export class PostgresSchedulerRepository implements DueWorldSource {
  private readonly db: PostgresDatabase;
  constructor(url: string) {
    const parsed = new URL(url);
    if (decodeURIComponent(parsed.username).split('.')[0] !== 'pl_scheduler')
      throw Error('SCHEDULER_ROLE_REQUIRED');
    this.db = new PostgresDatabase(url);
  }
  async claimDue() {
    const result = await this.db.pool.query(
      'SELECT owner_id, world_id FROM parallel_life.claim_due_worlds()',
    );
    return result.rows.map((row) => ({
      ownerId: String(row.owner_id),
      worldId: String(row.world_id),
    }));
  }
  async close() {
    await this.db.close();
  }
}
