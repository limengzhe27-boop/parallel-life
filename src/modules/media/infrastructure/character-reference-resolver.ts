import type { CharacterVisualAnchor } from '../domain/types.ts';
import type { CharacterVisualAnchorRepository } from '../application/provider-ports.ts';

export type SqlExecutor = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

/**
 * PostgreSQL implementation of CharacterVisualAnchorRepository.
 * Authenticates character visual bindings and reference assets from
 * parallel_life.world_person_bindings and parallel_life.world_initial_snapshots.
 */
export class PostgresCharacterVisualAnchorRepository implements CharacterVisualAnchorRepository {
  private readonly executor: SqlExecutor;
  constructor(executor: SqlExecutor) {
    this.executor = executor;
  }

  public async findActorVisualAnchor(
    worldId: string,
    actorId: string,
    ownerId: string,
  ): Promise<CharacterVisualAnchor | null> {
    const res = await this.executor.query(
      `SELECT b.actor_id,
              b.person_id,
              b.person_snapshot,
              b.asset_id,
              b.asset_revision,
              a.status AS asset_status
         FROM parallel_life.world_person_bindings b
         LEFT JOIN parallel_life.assets a
           ON a.id = b.asset_id
          AND a.owner_id = b.owner_id
          AND a.revision = b.asset_revision
        WHERE b.world_id = $1
          AND b.actor_id = $2
          AND b.owner_id = $3`,
      [worldId, actorId, ownerId],
    );

    const row = res.rows[0];
    if (!row) {
      const actorRes = await this.executor.query(
        `SELECT a FROM parallel_life.worlds w,
         LATERAL jsonb_array_elements(w.state->'actors') a
         WHERE w.id = $1 AND w.owner_id = $2 AND a->>'id' = $3`,
        [worldId, ownerId, actorId],
      );
      const actor = actorRes.rows[0]?.a;
      if (!actor) {
        return null;
      }
      return {
        actorId,
        name: String(actor.name || '未知人物'),
        gender: typeof actor.gender === 'string' ? actor.gender : undefined,
        age: typeof actor.age === 'number' ? actor.age : undefined,
        referenceAssetId: undefined,
        referenceAssetRevision: undefined,
        isPlayer: false,
        authorizedForWorld: true,
      };
    }

    const snapshot = (row.person_snapshot ?? {}) as Record<string, unknown>;
    const name = String(snapshot.name || snapshot.displayName || '未知人物');
    const gender = typeof snapshot.gender === 'string' ? snapshot.gender : undefined;
    const age = typeof snapshot.age === 'number' ? snapshot.age : undefined;
    const hairStyle = typeof snapshot.hairStyle === 'string' ? snapshot.hairStyle : undefined;
    const hairColor = typeof snapshot.hairColor === 'string' ? snapshot.hairColor : undefined;
    const distinctiveFeatures = Array.isArray(snapshot.distinctiveFeatures)
      ? snapshot.distinctiveFeatures.map(String)
      : undefined;
    const clothingStyle = typeof snapshot.clothingStyle === 'string' ? snapshot.clothingStyle : undefined;

    // Asset must be confirmed 'ready' in the assets table to be usable as a reference
    const hasReadyAsset = Boolean(row.asset_id && row.asset_status === 'ready');

    return {
      actorId: String(row.actor_id),
      personId: row.person_id ? String(row.person_id) : undefined,
      name,
      gender,
      age,
      hairStyle,
      hairColor,
      distinctiveFeatures,
      clothingStyle,
      referenceAssetId: hasReadyAsset ? String(row.asset_id) : undefined,
      referenceAssetRevision: hasReadyAsset ? Number(row.asset_revision) : undefined,
      isPlayer: false,
      authorizedForWorld: true,
    };
  }

  public async findPlayerVisualAnchor(
    worldId: string,
    ownerId: string,
  ): Promise<CharacterVisualAnchor | null> {
    const res = await this.executor.query(
      `SELECT s.approved_seed->>'portraitAssetId' AS portrait_id,
              s.approved_seed->'profile' AS profile,
              a.revision AS asset_revision,
              a.status AS asset_status
         FROM parallel_life.world_initial_snapshots s
         LEFT JOIN parallel_life.assets a
           ON a.id = (s.approved_seed->>'portraitAssetId')::uuid
          AND a.owner_id = s.owner_id
        WHERE s.world_id = $1
          AND s.owner_id = $2`,
      [worldId, ownerId],
    );

    const row = res.rows[0];
    if (!row) {
      const worldRes = await this.executor.query(
        `SELECT 1 FROM parallel_life.worlds WHERE id = $1 AND owner_id = $2`,
        [worldId, ownerId],
      );
      if (!worldRes.rows[0]) {
        return null;
      }
      return {
        actorId: 'player',
        name: '主角',
        referenceAssetId: undefined,
        referenceAssetRevision: undefined,
        isPlayer: true,
        authorizedForWorld: true,
      };
    }

    const profile = (row.profile ?? {}) as Record<string, unknown>;
    const name = String(profile.name || '本人');
    const gender = typeof profile.gender === 'string' ? profile.gender : undefined;
    const hasReadyAsset = Boolean(row.portrait_id && row.asset_status === 'ready');

    return {
      actorId: 'player',
      name,
      gender,
      referenceAssetId: hasReadyAsset ? String(row.portrait_id) : undefined,
      referenceAssetRevision: hasReadyAsset ? Number(row.asset_revision) : undefined,
      isPlayer: true,
      authorizedForWorld: true,
    };
  }
}
