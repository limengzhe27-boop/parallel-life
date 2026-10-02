import { randomUUID } from 'node:crypto';
import { ApprovedSeedSchema } from '../../../contracts/seeds.ts';
import { LifeSettingContentSchema } from '../../../contracts/life-settings.ts';
import {
  SettingTrialRequestSchema,
  type SettingTrialRequest,
} from '../../../contracts/setting-drafts.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { TaskError, requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { createWorldBuild, readBuild } from '../../world/infrastructure/build-repository.ts';
export class SettingTrialRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  list(owner: string, draftId: string) {
    return this.db.transaction(owner, async (sql) => {
      const owned = await sql.query(
        'SELECT id FROM parallel_life.setting_drafts WHERE id=$1 AND owner_id=$2',
        [draftId, owner],
      );
      if (!owned.rowCount) throw new TaskError('NOT_FOUND');
      const rows = await sql.query(
        'SELECT id FROM parallel_life.approved_seeds WHERE setting_draft_id=$1 AND owner_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100',
        [draftId, owner],
      );
      const builds = [];
      for (const row of rows.rows) builds.push(await readBuild(sql, row.id));
      return builds;
    });
  }
  create(owner: string, draftId: string, raw: SettingTrialRequest) {
    const input = SettingTrialRequestSchema.parse(raw),
      hash = requestHash(['setting-trial', draftId, input]);
    return this.db.transaction(owner, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [owner]);
      const old = (
        await sql.query(
          'SELECT id,request_hash FROM parallel_life.approved_seeds WHERE owner_id=$1 AND command_id=$2',
          [owner, input.commandId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return createWorldBuild(sql, owner, { commandId: input.commandId, seedId: old.id });
      }
      const row = (
        await sql.query(
          'SELECT content FROM parallel_life.setting_draft_revisions WHERE draft_id=$1 AND owner_id=$2 AND version=$3',
          [draftId, owner, input.version],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      const content = LifeSettingContentSchema.parse(row.content);
      if (new Set(content.characters.map((c) => c.name)).size !== content.characters.length)
        throw new TaskError('INVALID_INPUT');
      const count = (
        await sql.query(
          'SELECT count(*)::int AS n FROM parallel_life.approved_seeds WHERE owner_id=$1',
          [owner],
        )
      ).rows[0];
      if (count.n >= 100) throw new TaskError('RATE_LIMITED');
      // Identity FK only: no reality profile document is read or copied.
      const profile = (
        await sql.query('SELECT id FROM parallel_life.profiles WHERE owner_id=$1', [owner])
      ).rows[0];
      if (!profile) throw new TaskError('NOT_FOUND');
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        source: { kind: 'setting_draft', draftId, version: input.version },
        settingContent: content,
        story: content.story,
        setup: content.setup,
        facts: [],
        events: [],
        people: [],
        assets: [],
        portraitAssetId: null,
      });
      await sql.query(
        'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document,setting_draft_id,setting_draft_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [seed.id, owner, profile.id, input.commandId, hash, seed, draftId, input.version],
      );
      return createWorldBuild(sql, owner, { commandId: input.commandId, seedId: seed.id });
    });
  }
}
