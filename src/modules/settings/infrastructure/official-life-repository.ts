import { randomUUID } from 'node:crypto';
import {
  OfficialLifeCardSchema,
  OfficialLifeStartRequestSchema,
  OfficialLifeStartResultSchema,
  type OfficialLifeId,
  type OfficialLifeStartRequest,
} from '../../../contracts/official-lives.ts';
import { ApprovedSeedSchema } from '../../../contracts/seeds.ts';
import type { OfficialLifeCatalog } from '../application/official-life-pack.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { requestHash, TaskError } from '../../tasks/infrastructure/task-repository.ts';
import { officialGenesis } from '../../world/domain/official-genesis.ts';

/** Uses the existing world/initial/clock tables in one owner transaction. No AI creation task. */
export class OfficialLifeRepository {
  private readonly db: PostgresDatabase;
  private readonly catalog: OfficialLifeCatalog;
  constructor(db: PostgresDatabase, catalog: OfficialLifeCatalog) {
    this.db = db;
    this.catalog = catalog;
  }
  list(owner: string) {
    return this.db.transaction(owner, async (sql) => {
      const saved = (
        await sql.query(
          'SELECT preset_id,content_version,world_id FROM parallel_life.official_life_instances WHERE owner_id=$1',
          [owner],
        )
      ).rows;
      return {
        lives: this.catalog.list().map((pack) =>
          OfficialLifeCardSchema.parse({
            ...pack.card,
            worldId:
              saved.find(
                (row) =>
                  row.preset_id === pack.card.id && row.content_version === pack.card.version,
              )?.world_id ?? null,
          }),
        ),
      };
    });
  }
  start(owner: string, id: OfficialLifeId, raw: OfficialLifeStartRequest) {
    const input = OfficialLifeStartRequestSchema.parse(raw);
    const pack = this.catalog.get(id);
    if (!pack) throw new TaskError('NOT_FOUND');
    const hash = requestHash(['official-life-start', id, input.version]);
    return this.db.transaction(owner, async (sql) => {
      const account = await sql.query(
        'SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE',
        [owner],
      );
      if (!account.rowCount) throw new TaskError('NOT_FOUND');
      const old = (
        await sql.query(
          'SELECT request_hash,result FROM parallel_life.official_life_start_receipts WHERE owner_id=$1 AND command_id=$2',
          [owner, input.commandId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return OfficialLifeStartResultSchema.parse(old.result);
      }
      if (input.version !== pack.card.version) throw new TaskError('VERSION_CONFLICT');
      const other = (
        await sql.query(
          'SELECT id FROM parallel_life.approved_seeds WHERE owner_id=$1 AND command_id=$2',
          [owner, input.commandId],
        )
      ).rows[0];
      if (other) throw new TaskError('IDEMPOTENCY_CONFLICT');
      const instance = (
        await sql.query(
          'SELECT seed_id,world_id FROM parallel_life.official_life_instances WHERE owner_id=$1 AND preset_id=$2 AND content_version=$3',
          [owner, id, input.version],
        )
      ).rows[0];
      const realNow = new Date().toISOString();
      let seedId: string, worldId: string;
      if (instance) {
        seedId = instance.seed_id;
        worldId = instance.world_id;
      } else {
        seedId = randomUUID();
        worldId = randomUUID();
        const seed = ApprovedSeedSchema.parse({
          id: seedId,
          createdAt: realNow,
          source: { kind: 'official_life', presetId: id, version: input.version },
          story: pack.story,
          facts: [],
          events: [],
          people: [],
          portraitAssetId: null,
          assets: [],
        });
        const state = officialGenesis({
          opening: pack.opening,
          presetId: id,
          contentVersion: input.version,
          worldId,
          ownerId: owner,
          title: pack.card.title,
          newId: randomUUID,
        });
        // Player-facing identity/setting are not automatically shared with every NPC.
        // Only authored facts with explicit visibility enter character context.
        await sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,NULL,$3,$4,$5)',
          [seedId, owner, input.commandId, hash, seed],
        );
        await sql.query(
          'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
          [
            worldId,
            owner,
            state.title,
            { ...state, messages: [], appointments: [], mediaRequests: [], facts: [] },
          ],
        );
        await sql.query(
          'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
          [worldId, owner, state, seed],
        );
        // Build.phone reads these same metadata; no succeeded fake AI task is inserted.
        await sql.query(
          'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id,opening) VALUES($1,$2,$3,$4)',
          [
            seedId,
            owner,
            worldId,
            {
              identity: pack.opening.identity,
              setting: pack.opening.setting,
              actors: pack.opening.actors,
              messages: [],
              notes: [],
            },
          ],
        );
        await sql.query(
          'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats,summary) VALUES($1,$2,$3,1,false,$4,0,NULL)',
          [worldId, owner, state.time, realNow],
        );
        await sql.query(
          'INSERT INTO parallel_life.official_life_instances(owner_id,preset_id,content_version,seed_id,world_id) VALUES($1,$2,$3,$4,$5)',
          [owner, id, input.version, seedId, worldId],
        );
      }
      const result = OfficialLifeStartResultSchema.parse({
        presetId: id,
        version: input.version,
        worldId,
        seedId,
        resumed: Boolean(instance),
      });
      await sql.query(
        'INSERT INTO parallel_life.official_life_start_receipts(owner_id,command_id,request_hash,result,world_id) VALUES($1,$2,$3,$4,$5)',
        [owner, input.commandId, hash, result, worldId],
      );
      return result;
    });
  }
}
