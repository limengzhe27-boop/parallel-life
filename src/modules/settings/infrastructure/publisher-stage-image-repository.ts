import { expirePublisherPreparations } from './publisher-preparation-repository.ts';
import { createHash, randomUUID } from 'node:crypto';
import { Id } from '../../../contracts/api.ts';
import {
  PublisherStageImageInputSchema,
  PublisherStageImageRecordSchema,
  type PublisherStageImageInput,
  type PublisherStageImageRecord,
} from '../../../contracts/publisher-stage-image.ts';
import type {
  PublisherStageImageStore,
  StageImageMaterial,
  StageImageOperation,
} from '../application/publisher-stage-image.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
function operation(row: Record<string, any>): StageImageOperation {
  if (row.material?.kind !== 'actor_stage_image') throw new TaskError('NOT_FOUND');
  return {
    material: row.material as StageImageMaterial,
    record: PublisherStageImageRecordSchema.parse({
      commandId: row.command_id,
      workId: row.work_id,
      actorKey: row.material.actorKey,
      status: row.status,
      image: row.status === 'succeeded' ? row.result?.image : null,
      errorCode: row.error_code,
    }),
  };
}
export class PublisherStageImageRepository implements PublisherStageImageStore {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  private tx<T>(principal: string, run: (sql: SqlClient) => Promise<T>) {
    if (!Id.safeParse(principal).success) throw new TaskError('INVALID_INPUT');
    return this.db.transaction(principal, async (sql) => {
      await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [principal]);
      await sql.query("SELECT parallel_life.publisher_lock_permission('edit')");
      return run(sql);
    });
  }
  async begin(principal: string, workId: string, raw: PublisherStageImageInput) {
    const input = PublisherStageImageInputSchema.parse(raw);
    if (!Id.safeParse(workId).success) throw new TaskError('INVALID_INPUT');
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          workId,
          input.commandId,
          input.expectedDraftVersion,
          input.actorKey,
          input.sourceAssetId,
          'stage-image-v1',
        ]),
      )
      .digest('hex');
    return this.tx(principal, async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('publisher-preparation:' || $1,0))",
        [principal],
      );
      await expirePublisherPreparations(sql, principal);
      const previous = (
        await sql.query(
          'SELECT * FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND command_id=$2',
          [principal, input.commandId],
        )
      ).rows[0];
      if (previous) {
        if (previous.work_id !== workId || previous.request_hash !== hash)
          throw new TaskError('IDEMPOTENCY_CONFLICT');
        return { ...operation(previous), claimed: false };
      }
      const draft = (
        await sql.query(
          'SELECT w.draft_version,r.content FROM parallel_life.publication_works w JOIN parallel_life.publication_draft_revisions r ON r.work_id=w.id AND r.version=w.draft_version WHERE w.id=$1 FOR SHARE OF w',
          [workId],
        )
      ).rows[0];
      if (!draft) throw new TaskError('NOT_FOUND');
      if (Number(draft.draft_version) !== input.expectedDraftVersion)
        throw new TaskError('VERSION_CONFLICT');
      if (!draft.content?.actors?.some((a: { key: string }) => a.key === input.actorKey))
        throw new TaskError('INVALID_INPUT');
      const source = (
        await sql.query(
          "SELECT id FROM parallel_life.publication_media_assets WHERE id=$1 AND work_id=$2 AND status='ready' AND kind='image'",
          [input.sourceAssetId, workId],
        )
      ).rows[0];
      if (!source) throw new TaskError('NOT_FOUND');
      const budget = (
        await sql.query(
          "SELECT count(*) FILTER(WHERE status='running')::int active,count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int recent FROM parallel_life.publisher_preparations WHERE principal_id=$1",
          [principal],
        )
      ).rows[0];
      if (budget.active > 0) throw new TaskError('INVALID_STATE');
      if (budget.recent >= 10) throw new TaskError('RATE_LIMITED');
      const assetId = randomUUID();
      const material: StageImageMaterial = {
        kind: 'actor_stage_image',
        actorKey: input.actorKey,
        sourceAssetId: input.sourceAssetId,
        outputAssetId: assetId,
        storageKey: `works/${workId}/${assetId}.png`,
        rawStorageKey: `works/${workId}/${randomUUID()}.png`,
        promptVersion: 'stage-image-v1',
      };
      const row = (
        await sql.query(
          "INSERT INTO parallel_life.publisher_preparations(principal_id,command_id,work_id,draft_version,request_hash,material,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,'running') RETURNING *",
          [
            principal,
            input.commandId,
            workId,
            input.expectedDraftVersion,
            hash,
            JSON.stringify(material),
          ],
        )
      ).rows[0];
      return { ...operation(row), claimed: true };
    });
  }
  async read(principal: string, workId: string, commandId: string) {
    if (!Id.safeParse(workId).success || !Id.safeParse(commandId).success)
      throw new TaskError('INVALID_INPUT');
    return this.tx(principal, async (sql) => {
      const row = (
        await sql.query(
          "SELECT * FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND work_id=$2 AND command_id=$3 AND material->>'kind'='actor_stage_image'",
          [principal, workId, commandId],
        )
      ).rows[0];
      return row ? operation(row) : null;
    });
  }
  async finish(
    principal: string,
    workId: string,
    commandId: string,
    status: 'succeeded' | 'failed' | 'unknown',
    image: PublisherStageImageRecord['image'],
    errorCode: string | null,
  ) {
    if (status === 'succeeded' && !image) throw new TaskError('INVALID_INPUT');
    return this.tx(principal, async (sql) => {
      const row = (
        await sql.query(
          "SELECT * FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND work_id=$2 AND command_id=$3 AND material->>'kind'='actor_stage_image' FOR UPDATE",
          [principal, workId, commandId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      if (row.status !== 'running') return operation(row);
      if (image && image.assetId !== row.material.outputAssetId)
        throw new TaskError('INVALID_INPUT');
      if (
        image &&
        !(
          await sql.query(
            "SELECT 1 FROM parallel_life.publication_media_assets WHERE id=$1 AND work_id=$2 AND kind='image' AND status='ready' AND mime_type='image/png' AND byte_length=$3",
            [image.assetId, workId, image.byteLength],
          )
        ).rowCount
      )
        throw new TaskError('INVALID_STATE');
      const saved = (
        await sql.query(
          'UPDATE parallel_life.publisher_preparations SET status=$4,result=$5::jsonb,error_code=$6,updated_at=now() WHERE principal_id=$1 AND work_id=$2 AND command_id=$3 RETURNING *',
          [
            principal,
            workId,
            commandId,
            status,
            image ? JSON.stringify({ image }) : null,
            errorCode,
          ],
        )
      ).rows[0];
      return operation(saved);
    });
  }
}
