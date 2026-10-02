import { randomUUID } from 'node:crypto';
import {
  CreateSettingDraftSchema,
  SaveSettingDraftSchema,
  SettingDraftSchema,
  SettingDraftListSchema,
  type CreateSettingDraft,
  type SaveSettingDraft,
  type SettingDraft,
} from '../../../contracts/setting-drafts.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError, requestHash } from '../../tasks/infrastructure/task-repository.ts';

async function read(
  sql: SqlClient,
  owner: string,
  id: string,
  version?: number,
): Promise<SettingDraft> {
  const row = (
    await sql.query(
      `
    SELECT d.id,r.version,r.content,d.created_at,r.created_at AS updated_at
    FROM parallel_life.setting_drafts d JOIN parallel_life.setting_draft_revisions r
      ON r.draft_id=d.id AND r.owner_id=d.owner_id AND r.version=COALESCE($3::int,d.version)
    WHERE d.owner_id=$1 AND d.id=$2`,
      [owner, id, version ?? null],
    )
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  return SettingDraftSchema.parse({
    id: row.id,
    version: row.version,
    content: row.content,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}
export class SettingDraftRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  list(owner: string) {
    return this.db.transaction(owner, async (sql) =>
      SettingDraftListSchema.parse(
        (
          await sql.query(
            `
      SELECT d.id,d.version,d.created_at,r.created_at AS updated_at,
        r.content->'story'->>'title' AS title,r.content->'setup'->>'identity' AS identity
      FROM parallel_life.setting_drafts d JOIN parallel_life.setting_draft_revisions r
        ON r.draft_id=d.id AND r.owner_id=d.owner_id AND r.version=d.version
      WHERE d.owner_id=$1 ORDER BY d.updated_at DESC,d.id LIMIT 20`,
            [owner],
          )
        ).rows.map((r) => ({
          id: r.id,
          version: r.version,
          title: r.title,
          identity: r.identity,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
      ),
    );
  }
  get(owner: string, id: string, version?: number) {
    return this.db.transaction(owner, (sql) => read(sql, owner, id, version));
  }
  private command(
    owner: string,
    commandId: string,
    hash: string,
    run: (sql: SqlClient) => Promise<SettingDraft>,
  ) {
    return this.db.transaction(owner, async (sql) => {
      const account = await sql.query(
        'SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE',
        [owner],
      );
      if (!account.rowCount) throw new TaskError('NOT_FOUND');
      const receipt = (
        await sql.query(
          'SELECT request_hash,draft_id,version FROM parallel_life.setting_draft_receipts WHERE owner_id=$1 AND command_id=$2',
          [owner, commandId],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return read(sql, owner, receipt.draft_id, receipt.version);
      }
      const draft = await run(sql);
      await sql.query(
        'INSERT INTO parallel_life.setting_draft_receipts(owner_id,command_id,request_hash,draft_id,version) VALUES($1,$2,$3,$4,$5)',
        [owner, commandId, hash, draft.id, draft.version],
      );
      return draft;
    });
  }
  create(owner: string, raw: CreateSettingDraft) {
    const input = CreateSettingDraftSchema.parse(raw);
    return this.command(
      owner,
      input.commandId,
      requestHash(['create-setting-draft', input]),
      async (sql) => {
        const count = (
          await sql.query(
            'SELECT count(*)::int AS n FROM parallel_life.setting_drafts WHERE owner_id=$1',
            [owner],
          )
        ).rows[0];
        if (count.n >= 20) throw new TaskError('RATE_LIMITED');
        const id = randomUUID();
        await sql.query('INSERT INTO parallel_life.setting_drafts(id,owner_id) VALUES($1,$2)', [
          id,
          owner,
        ]);
        await sql.query(
          'INSERT INTO parallel_life.setting_draft_revisions(draft_id,owner_id,version,content) VALUES($1,$2,0,$3)',
          [id, owner, input.content],
        );
        return read(sql, owner, id);
      },
    );
  }
  save(owner: string, id: string, raw: SaveSettingDraft) {
    const input = SaveSettingDraftSchema.parse(raw);
    return this.command(
      owner,
      input.commandId,
      requestHash(['save-setting-draft', id, input]),
      async (sql) => {
        const current = await read(sql, owner, id);
        if (current.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
        if (current.version >= 99) throw new TaskError('RATE_LIMITED');
        const version = current.version + 1;
        await sql.query(
          'INSERT INTO parallel_life.setting_draft_revisions(draft_id,owner_id,version,content) VALUES($1,$2,$3,$4)',
          [id, owner, version, input.content],
        );
        const update = await sql.query(
          'UPDATE parallel_life.setting_drafts SET version=$1,updated_at=now() WHERE id=$2 AND owner_id=$3 AND version=$4',
          [version, id, owner, current.version],
        );
        if (update.rowCount !== 1) throw new TaskError('VERSION_CONFLICT');
        return read(sql, owner, id);
      },
    );
  }
}
