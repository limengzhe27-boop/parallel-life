import { ProfileSchema } from '../../../contracts/api.ts';
import {
  DiscoverySchema,
  DiscoverRequestSchema,
  DiscoveryInputSchema,
  type DiscoverRequest,
  type Discovery,
} from '../../../contracts/discovery.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  enqueue,
  requestHash,
  publicTask,
  TaskError,
} from '../../tasks/infrastructure/task-repository.ts';
export async function readDiscovery(sql: SqlClient, ownerId: string): Promise<Discovery> {
  const profile = (
    await sql.query('SELECT id,version FROM parallel_life.profiles WHERE owner_id=$1', [ownerId])
  ).rows[0];
  if (!profile) throw new TaskError('NOT_FOUND');
  const row = (
    await sql.query('SELECT * FROM parallel_life.discoveries WHERE owner_id=$1', [ownerId])
  ).rows[0];
  const task = (
    await sql.query(
      "SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='profile' AND scope_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [ownerId, profile.id],
    )
  ).rows[0];
  return DiscoverySchema.parse({
    profileId: profile.id,
    version: row?.version ?? 0,
    profileVersion: row?.profile_version ?? profile.version,
    brief: row?.document.brief ?? '',
    directions: row?.document.directions ?? [],
    updatedAt: row?.updated_at.toISOString() ?? null,
    activeTask: task ? publicTask(task) : null,
  });
}
export class DiscoveryRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  get(ownerId: string) {
    return this.db.transaction(ownerId, (sql) => readDiscovery(sql, ownerId));
  }
  async generate(ownerId: string, raw: DiscoverRequest) {
    const request = DiscoverRequestSchema.parse(raw);
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const hash = requestHash([
        'discovery',
        request.expectedVersion,
        request.expectedProfileVersion,
        request.brief,
        request.basedOnId,
      ]);
      const duplicate = (
        await sql.query('SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=$2', [
          ownerId,
          request.commandId,
        ])
      ).rows[0];
      if (duplicate) {
        if (duplicate.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return publicTask(duplicate);
      }
      const row = (
        await sql.query(
          'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      const profile = ProfileSchema.parse({ ...row.document, version: row.version }),
        saved = await readDiscovery(sql, ownerId);
      if (
        profile.version !== request.expectedProfileVersion ||
        saved.version !== request.expectedVersion
      )
        throw new TaskError('VERSION_CONFLICT');
      const basis = profile.facts
        .filter((f) => f.status === 'confirmed')
        .slice(-24)
        .map((f) => ({ factId: f.id, category: f.category, value: f.value }));
      if (!basis.length && !request.brief) throw new TaskError('INVALID_INPUT');
      const basedOn = request.basedOnId
        ? (saved.directions.find((d) => d.id === request.basedOnId) ?? null)
        : null;
      if (request.basedOnId && !basedOn) throw new TaskError('NOT_FOUND');
      if (basedOn && saved.profileVersion !== profile.version)
        throw new TaskError('VERSION_CONFLICT');
      const input = DiscoveryInputSchema.parse({
        kind: 'discovery',
        profileId: profile.id,
        expectedVersion: saved.version,
        profileVersion: profile.version,
        basis,
        brief: request.brief,
        basedOn,
      });
      await sql.query(
        'INSERT INTO parallel_life.discoveries(profile_id,owner_id,profile_version,document) VALUES($1,$2,$3,$4) ON CONFLICT(profile_id) DO NOTHING',
        [profile.id, ownerId, profile.version, { brief: '', directions: [] }],
      );
      return enqueue(sql, ownerId, 'profile', profile.id, request.commandId, input, hash);
    });
  }
}
