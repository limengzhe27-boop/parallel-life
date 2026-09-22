import { randomUUID } from 'node:crypto';
import { ProfileSchema } from '../../../contracts/api.ts';
import {
  ApprovedSeedSchema,
  SeedRequestSchema,
  SeedStorySchema,
  type SeedRequest,
} from '../../../contracts/seeds.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { TaskError, requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { readDiscovery } from './discovery-repository.ts';
export class SeedRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  list(ownerId: string) {
    return this.db.transaction(ownerId, async (sql) =>
      (
        await sql.query(
          'SELECT document FROM parallel_life.approved_seeds WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',
          [ownerId],
        )
      ).rows.map((r) => ApprovedSeedSchema.parse(r.document)),
    );
  }
  async approve(ownerId: string, raw: SeedRequest) {
    const request = SeedRequestSchema.parse(raw),
      hash = requestHash(['approve-seed', request]);
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const duplicate = (
        await sql.query(
          'SELECT document,request_hash FROM parallel_life.approved_seeds WHERE owner_id=$1 AND command_id=$2',
          [ownerId, request.commandId],
        )
      ).rows[0];
      if (duplicate) {
        if (duplicate.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return ApprovedSeedSchema.parse(duplicate.document);
      }
      const row = (
        await sql.query(
          'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      const profile = ProfileSchema.parse({ ...row.document, version: row.version });
      await sql.query(
        'SELECT version FROM parallel_life.discoveries WHERE owner_id=$1 FOR UPDATE',
        [ownerId],
      );
      const discovery = await readDiscovery(sql, ownerId);
      if (
        profile.version !== request.profileVersion ||
        discovery.version !== request.discoveryVersion ||
        discovery.profileVersion !== profile.version
      )
        throw new TaskError('VERSION_CONFLICT');
      const direction = discovery.directions.find((d) => d.id === request.directionId);
      if (!direction) throw new TaskError('NOT_FOUND');
      const facts = request.factIds.map((id) => {
        const f = profile.facts.find((f) => f.id === id && f.status === 'confirmed');
        if (!f) throw new TaskError('INVALID_INPUT');
        return { factId: f.id, category: f.category, value: f.value };
      });
      const people = request.personIds.map((id) => {
        const person = profile.people.find((p) => p.id === id);
        if (!person) throw new TaskError('INVALID_INPUT');
        return person;
      });
      const portraitAssetId = request.includePortrait ? profile.portraitAssetId : null;
      if (request.includePortrait && !portraitAssetId) throw new TaskError('INVALID_INPUT');
      const ids = [
        ...new Set(
          [portraitAssetId, ...people.map((p) => p.assetId)].filter((id): id is string => !!id),
        ),
      ];
      const assets = ids.length
        ? (
            await sql.query(
              "SELECT id,revision FROM parallel_life.assets WHERE id=ANY($1::uuid[]) AND status='ready' FOR SHARE",
              [ids],
            )
          ).rows
        : [];
      if (assets.length !== ids.length) throw new TaskError('INVALID_INPUT');
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: discovery.version,
        directionId: direction.id,
        story: SeedStorySchema.parse({
          title: direction.title,
          premise: direction.premise,
          opening: direction.opening,
          tradeoff: direction.tradeoff,
        }),
        facts,
        people,
        portraitAssetId,
        assets: assets.map((a) => ({ assetId: a.id, revision: a.revision })),
      });
      await sql.query(
        'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
        [seed.id, ownerId, profile.id, request.commandId, hash, seed],
      );
      return seed;
    });
  }
}
