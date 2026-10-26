import { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';

export type OutboxScope = { ownerId: string; worldId: string; eventId: string };
/** Operational metadata only. This role cannot read job payloads or create tasks. */
export class PostgresOutboxScopeDiscovery {
  private readonly db: PostgresDatabase;
  private afterOwner: string | null = null;
  constructor(url: string) {
    let role: string;
    try {
      role = decodeURIComponent(new URL(url).username).split('.')[0]!;
    } catch {
      throw Error('OUTBOX_DISCOVERY_NOT_CONFIGURED');
    }
    if (role !== 'pl_scheduler') throw Error('OUTBOX_DISCOVERY_SCHEDULER_ROLE_REQUIRED');
    this.db = new PostgresDatabase(url);
  }
  async read(limit = 4): Promise<OutboxScope[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
      throw Error('INVALID_OUTBOX_DISCOVERY_LIMIT');
    const rows = (
      await this.db.pool.query(
        'SELECT owner_id,world_id,event_id FROM parallel_life.discover_due_outbox_scopes($1,$2)',
        [limit, this.afterOwner],
      )
    ).rows;
    if (
      rows.length > limit ||
      rows.some((r) =>
        ['owner_id', 'world_id', 'event_id'].some((k) => typeof r[k] !== 'string' || !r[k]),
      )
    )
      throw Error('INVALID_OUTBOX_DISCOVERY_RESULT');
    const scopes = rows.map((r) => ({
      ownerId: r.owner_id,
      worldId: r.world_id,
      eventId: r.event_id,
    }));
    if (new Set(scopes.map((s) => JSON.stringify(s))).size !== scopes.length)
      throw Error('INVALID_OUTBOX_DISCOVERY_RESULT');
    // In-process scan fairness only, not a second business state or a paid-work cursor.
    if (scopes.length) this.afterOwner = scopes.at(-1)!.ownerId;
    return scopes;
  }
  close() {
    return this.db.close();
  }
}
