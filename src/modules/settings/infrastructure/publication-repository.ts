import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ensurePublishableDefaults } from '../domain/publication-defaults.ts';
import { Id } from '../../../contracts/api.ts';
import {
  PublishedWorldContentSchema,
  type PublishedWorldContent,
} from '../../../contracts/published-world-content.ts';
import { inspectPublishedWorldSupport } from '../../../contracts/published-world-content.ts';
import {
  PublisherPrincipalSchema,
  PublisherCreateWorkSchema,
  PublisherSaveDraftSchema,
  PublisherCheckDraftSchema,
  PublisherPublishSchema,
  PublisherUnpublishSchema,
  PublisherRestoreSchema,
  PublisherRenameWorkSchema,
  PublisherDeleteWorkResultSchema,
  PublisherWorkSchema,
  PublisherWorkListSchema,
  PublisherCheckResultSchema,
  PublisherPublicationResultSchema,
  PublishedWorkCatalogSchema,
  type PublisherCreateWork,
  type PublisherSaveDraft,
  type PublisherRenameWork,
  type PublisherDeleteWorkResult,
  type PublisherCheckDraft,
  type PublisherPublish,
  type PublisherUnpublish,
  type PublisherRestore,
} from '../../../contracts/world-publisher.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';

export interface PublicationReviewPort {
  review(input: {
    workId: string;
    draftVersion: number;
    contentHash: string;
    content: PublishedWorldContent;
  }): Promise<{
    reviewerVersion: string;
    runtimeCapabilities: ReadonlySet<string>;
    media: { verified: boolean; manifestHash: string | null };
    trial: { verified: boolean; receiptId: string | null };
  }>;
}
const unavailable: PublicationReviewPort = {
  async review() {
    return {
      reviewerVersion: 'unavailable_v1',
      runtimeCapabilities: new Set(),
      media: { verified: false, manifestHash: null },
      trial: { verified: false, receiptId: null },
    };
  },
};
const reviewSchema = z.strictObject({
  reviewerVersion: z.string().min(1).max(100),
  capabilities: z.array(z.string().min(1).max(100)).max(64),
  media: z.strictObject({
    verified: z.boolean(),
    manifestHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  }),
  trial: z.strictObject({ verified: z.boolean(), receiptId: Id.nullable() }),
});
const pageSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(100),
  cursor: Id.optional(),
});
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return Array.from(value, canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new TaskError('INVALID_INPUT');
  return r.data;
}
const instant = (x: Date | string) => new Date(x).toISOString();
function summary(r: Record<string, any>) {
  return {
    id: r.id,
    title: r.title,
    draftVersion: Number(r.draft_version),
    metadataVersion: Number(r.metadata_version),
    publicationVersion: r.publication_version === null ? null : Number(r.publication_version),
    status: r.listed ? 'published' : r.publication_version === null ? 'draft' : 'unpublished',
    createdAt: instant(r.created_at),
    updatedAt: instant(r.updated_at),
  };
}
/** Private staff DB only. A signed HTTP identity and operation checks remain the server's responsibility. */
export class PublicationRepository {
  private db: PostgresDatabase;
  private reviews: PublicationReviewPort;
  constructor(db: PostgresDatabase, reviews: PublicationReviewPort = unavailable) {
    this.db = db;
    this.reviews = reviews;
  }
  async getPrincipal(principal: string) {
    parse(Id, principal);
    try {
      return await this.db.transaction(principal, async (sql) => {
        await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [principal]);
        const row = (
          await sql.query(
            'SELECT id,display_name,can_edit,can_publish,active FROM parallel_life.publisher_principals WHERE id=$1 AND active',
            [principal],
          )
        ).rows[0];
        return row
          ? PublisherPrincipalSchema.parse({
              id: row.id,
              displayName: row.display_name,
              canEdit: row.can_edit,
              canPublish: row.can_publish,
              active: row.active,
            })
          : null;
      });
    } catch (e) {
      throw new TaskError((e as { code?: string }).code === '42501' ? 'FORBIDDEN' : 'UNAVAILABLE');
    }
  }
  private async tx<T>(principal: string, permission: string, run: (sql: SqlClient) => Promise<T>) {
    parse(Id, principal);
    try {
      return await this.db.transaction(principal, async (sql) => {
        await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [principal]);
        await sql.query('SELECT parallel_life.publisher_lock_permission($1)', [permission]);
        return run(sql);
      });
    } catch (e) {
      if (e instanceof TaskError) throw e;
      const code = (e as { code?: string }).code;
      throw new TaskError(
        code === '42501'
          ? 'FORBIDDEN'
          : code === '23505'
            ? 'IDEMPOTENCY_CONFLICT'
            : code === '23514' || code === '22023'
              ? 'INVALID_INPUT'
              : 'UNAVAILABLE',
      );
    }
  }
  private async work(sql: SqlClient, id: string, lock = false) {
    const r = (
      await sql.query(
        'SELECT * FROM parallel_life.publication_works WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
        [id],
      )
    ).rows[0];
    if (!r) throw new TaskError('NOT_FOUND');
    return r;
  }
  private async draft(sql: SqlClient, workId: string, version: number) {
    const r = (
      await sql.query(
        'SELECT * FROM parallel_life.publication_draft_revisions WHERE work_id=$1 AND version=$2',
        [workId, version],
      )
    ).rows[0];
    if (!r) throw new TaskError('NOT_FOUND');
    return r;
  }
  private async dto(sql: SqlClient, w: Record<string, any>, version = Number(w.draft_version)) {
    const d = await this.draft(sql, w.id, version);
    return PublisherWorkSchema.parse({
      ...summary(w),
      draft: {
        version: Number(d.version),
        content: d.content,
        contentHash: d.content_hash,
        createdAt: instant(d.created_at),
        createdBy: d.created_by,
      },
    });
  }
  private async old(sql: SqlClient, principal: string, command: string, hash: string) {
    const r = (
      await sql.query(
        'SELECT request_hash,result FROM parallel_life.publication_receipts WHERE principal_id=$1 AND command_id=$2',
        [principal, command],
      )
    ).rows[0];
    if (r && r.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
    return r?.result;
  }
  private hash(principal: string, op: string, workId: string | null, input: unknown) {
    return digest({ principal, op, workId, input });
  }
  private async command<T>(
    principal: string,
    permission: string,
    op: string,
    command: string,
    hash: string,
    run: (sql: SqlClient) => Promise<{ workId: string; result: T }>,
  ) {
    return this.tx(principal, permission, async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        principal + ':' + command,
      ]);
      await sql.query('SELECT parallel_life.publisher_lock_permission($1)', [permission]);
      const previous = await this.old(sql, principal, command, hash);
      if (previous) return previous as T;
      const { workId, result } = await run(sql);
      await sql.query('SELECT parallel_life.publisher_lock_permission($1)', [permission]);
      await sql.query(
        'INSERT INTO parallel_life.publication_receipts(principal_id,command_id,request_hash,operation,work_id,result) VALUES($1,$2,$3,$4,$5,$6)',
        [principal, command, hash, op, workId, result],
      );
      return result;
    });
  }
  async list(principal: string, raw: { limit?: number; cursor?: string } = {}) {
    const p = parse(pageSchema, raw);
    return this.tx(principal, 'view', async (sql) => {
      const rows = (
        await sql.query(
          "SELECT * FROM parallel_life.publication_works WHERE ($1::uuid IS NULL OR id>$1) AND NOT (title LIKE '[deleted]%') ORDER BY id LIMIT $2",
          [p.cursor ?? null, p.limit + 1],
        )
      ).rows;
      return PublisherWorkListSchema.parse({
        works: rows.slice(0, p.limit).map(summary),
        nextCursor: rows.length > p.limit ? rows[p.limit - 1].id : null,
      });
    });
  }
  async get(principal: string, id: string, version?: number) {
    parse(Id, id);
    if (version !== undefined) parse(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), version);
    return this.tx(principal, 'view', async (sql) => {
      const w = await this.work(sql, id);
      if (typeof w.title === 'string' && w.title.startsWith('[deleted]')) {
        throw new TaskError('NOT_FOUND');
      }
      return this.dto(sql, w, version);
    });
  }
  async create(principal: string, raw: PublisherCreateWork) {
    const input = parse(PublisherCreateWorkSchema, raw);
    if (input.title.startsWith('[deleted]')) throw new TaskError('INVALID_INPUT');
    const hash = this.hash(principal, 'create', null, input);
    return this.command(principal, 'edit', 'create', input.commandId, hash, async (sql) => {
      const id = randomUUID();
      await sql.query(
        'INSERT INTO parallel_life.publication_works(id,title,created_by) VALUES($1,$2,$3)',
        [id, input.title, principal],
      );
      await sql.query(
        'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,0,$2,$3,$4)',
        [id, input.content, digest(input.content), principal],
      );
      return { workId: id, result: await this.dto(sql, await this.work(sql, id)) };
    });
  }
  async save(principal: string, id: string, raw: PublisherSaveDraft) {
    parse(Id, id);
    const input = parse(PublisherSaveDraftSchema, raw);
    if (input.title && input.title.startsWith('[deleted]')) throw new TaskError('INVALID_INPUT');
    const hash = this.hash(principal, 'save', id, input);
    return this.command(principal, 'edit', 'save', input.commandId, hash, async (sql) => {
      const w = await this.work(sql, id, true);
      if (typeof w.title === 'string' && w.title.startsWith('[deleted]')) {
        throw new TaskError('NOT_FOUND');
      }
      if (Number(w.draft_version) !== input.expectedDraftVersion)
        throw new TaskError('VERSION_CONFLICT');
      const version = input.expectedDraftVersion + 1;
      if (!Number.isSafeInteger(version)) throw new TaskError('INVALID_STATE');
      await sql.query(
        'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,$2,$3,$4,$5)',
        [id, version, input.content, digest(input.content), principal],
      );
      await sql.query(
        'UPDATE parallel_life.publication_works SET draft_version=$2,title=$3,updated_at=now() WHERE id=$1',
        [id, version, input.title ?? w.title],
      );
      return { workId: id, result: await this.dto(sql, await this.work(sql, id)) };
    });
  }
  async rename(principal: string, id: string, raw: PublisherRenameWork) {
    parse(Id, id);
    const input = parse(PublisherRenameWorkSchema, raw);
    if (input.title.startsWith('[deleted]')) throw new TaskError('INVALID_INPUT');
    const commandId = input.commandId ?? randomUUID();
    const hash = this.hash(principal, 'save', id, { op: 'rename', title: input.title, commandId });
    return this.command(principal, 'edit', 'save', commandId, hash, async (sql) => {
      const w = await this.work(sql, id, true);
      if (typeof w.title === 'string' && w.title.startsWith('[deleted]')) {
        throw new TaskError('NOT_FOUND');
      }
      if (
        input.expectedDraftVersion !== undefined &&
        Number(w.draft_version) !== input.expectedDraftVersion
      )
        throw new TaskError('VERSION_CONFLICT');
      const version = Number(w.draft_version) + 1;
      if (!Number.isSafeInteger(version)) throw new TaskError('INVALID_STATE');
      const d = await this.draft(sql, id, Number(w.draft_version));
      let content = d.content;
      if (
        content &&
        typeof content === 'object' &&
        'world' in content &&
        content.world &&
        typeof content.world === 'object'
      ) {
        content = {
          ...content,
          world: {
            ...(content.world as Record<string, unknown>),
            title: input.title,
          },
        };
      }
      await sql.query(
        'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,$2,$3,$4,$5)',
        [id, version, content, digest(content), principal],
      );
      await sql.query(
        'UPDATE parallel_life.publication_works SET draft_version=$2,title=$3,updated_at=now() WHERE id=$1',
        [id, version, input.title],
      );
      return { workId: id, result: await this.dto(sql, await this.work(sql, id)) };
    });
  }
  async delete(principal: string, id: string) {
    parse(Id, id);
    const commandId = randomUUID();
    const hash = this.hash(principal, 'save', id, { op: 'delete', id, commandId });
    return this.command(principal, 'edit', 'save', commandId, hash, async (sql) => {
      const w = await this.work(sql, id, true);
      if (typeof w.title === 'string' && w.title.startsWith('[deleted]')) {
        throw new TaskError('NOT_FOUND');
      }
      if (w.listed) throw new TaskError('INVALID_STATE');
      const version = Number(w.draft_version) + 1;
      if (!Number.isSafeInteger(version)) throw new TaskError('INVALID_STATE');
      const d = await this.draft(sql, id, Number(w.draft_version));
      const deletedTitle = `[deleted] ${w.title}`.slice(0, 80);
      await sql.query(
        'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,$2,$3,$4,$5)',
        [id, version, d.content, d.content_hash, principal],
      );
      await sql.query(
        'UPDATE parallel_life.publication_works SET draft_version=$2,title=$3,updated_at=now() WHERE id=$1',
        [id, version, deletedTitle],
      );
      return {
        workId: id,
        result: PublisherDeleteWorkResultSchema.parse({
          acknowledged: true,
          id,
        }),
      };
    });
  }
  private async assess(id: string, version: number, hash: string, raw: unknown) {
    const enriched = PublishedWorldContentSchema.safeParse(raw).success
      ? raw
      : raw && typeof raw === 'object'
        ? ensurePublishableDefaults(raw as Record<string, unknown>)
        : raw;
    const parsed = PublishedWorldContentSchema.safeParse(enriched);
    if (!parsed.success) {
      const all = parsed.error.issues;
      return {
        status: 'invalid' as const,
        issues: all.slice(0, 100).map((e) => ({
          path: e.path
            .slice(0, 16)
            .map((p) => (typeof p === 'number' ? p : String(p).slice(0, 80))),
          code: e.code === 'custom' && /^[a-zA-Z0-9_]{1,80}$/.test(e.message) ? e.message : e.code,
        })),
        issuesTruncated: all.length > 100,
        missingCapabilities: [] as string[],
        mediaVerified: false,
        trialVerified: false,
        basis: {
          reviewerVersion: 'invalid_content',
          mediaManifestHash: null,
          trialReceiptId: null,
        },
      };
    }
    try {
      const actual = await this.reviews.review({
        workId: id,
        draftVersion: version,
        contentHash: hash,
        content: structuredClone(parsed.data),
      });
      const { runtimeCapabilities, ...evidence } = actual;
      const r = reviewSchema.parse({ ...evidence, capabilities: [...runtimeCapabilities] });
      return this.checkedAssessment(parsed.data, r);
    } catch {
      return {
        status: 'blocked' as const,
        issues: [{ path: [] as (string | number)[], code: 'gate_unavailable' }],
        issuesTruncated: false,
        missingCapabilities: inspectPublishedWorldSupport(parsed.data).missingCapabilities,
        mediaVerified: false,
        trialVerified: false,
        basis: {
          reviewerVersion: 'gate_unavailable',
          mediaManifestHash: null,
          trialReceiptId: null,
        },
      };
    }
  }
  private checkedAssessment(content: PublishedWorldContent, r: z.infer<typeof reviewSchema>) {
    const s = inspectPublishedWorldSupport(content, new Set(r.capabilities)),
      issues: { path: (string | number)[]; code: string }[] = [];
    if (!s.runtimeReady) issues.push({ path: [], code: 'unsupported_runtime' });
    const media = r.media.verified && r.media.manifestHash !== null,
      trial = r.trial.verified && r.trial.receiptId !== null;
    if (!media) issues.push({ path: [], code: 'media_unverified' });
    if (!trial) issues.push({ path: [], code: 'trial_unverified' });
    return {
      status: issues.length ? ('blocked' as const) : ('ready' as const),
      issues,
      issuesTruncated: false,
      missingCapabilities: s.missingCapabilities,
      mediaVerified: media,
      trialVerified: trial,
      basis: {
        reviewerVersion: r.reviewerVersion,
        mediaManifestHash: r.media.manifestHash,
        trialReceiptId: r.trial.receiptId,
      },
    };
  }
  async check(principal: string, id: string, raw: PublisherCheckDraft) {
    parse(Id, id);
    const input = parse(PublisherCheckDraftSchema, raw),
      hash = this.hash(principal, 'check', id, input);
    const first = await this.tx(principal, 'review', async (sql) => {
      const old = await this.old(sql, principal, input.commandId, hash);
      if (old) return { old };
      const w = await this.work(sql, id);
      if (Number(w.draft_version) !== input.expectedDraftVersion)
        throw new TaskError('VERSION_CONFLICT');
      return { d: await this.draft(sql, id, input.expectedDraftVersion) };
    });
    if (first.old) return PublisherCheckResultSchema.parse(first.old);
    const d = first.d!,
      a = await this.assess(id, input.expectedDraftVersion, d.content_hash, d.content);
    return this.command(principal, 'review', 'check', input.commandId, hash, async (sql) => {
      const w = await this.work(sql, id, true);
      if (Number(w.draft_version) !== input.expectedDraftVersion)
        throw new TaskError('VERSION_CONFLICT');
      const latest = await this.draft(sql, id, input.expectedDraftVersion);
      if (latest.content_hash !== d.content_hash) throw new TaskError('VERSION_CONFLICT');
      const checkId = randomUUID(),
        { basis, ...visible } = a,
        result = PublisherCheckResultSchema.parse({
          id: checkId,
          workId: id,
          draftVersion: input.expectedDraftVersion,
          contentHash: d.content_hash,
          checkedAt: new Date().toISOString(),
          ...visible,
        });
      await sql.query(
        'INSERT INTO parallel_life.publication_checks(id,work_id,draft_version,content_hash,document,basis,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [checkId, id, input.expectedDraftVersion, d.content_hash, result, basis, principal],
      );
      return { workId: id, result };
    });
  }
  async publish(principal: string, id: string, raw: PublisherPublish) {
    parse(Id, id);
    const input = parse(PublisherPublishSchema, raw),
      hash = this.hash(principal, 'publish', id, input);
    const first = await this.tx(principal, 'publish', async (sql) => {
      const old = await this.old(sql, principal, input.commandId, hash);
      if (old) return { old };
      const w = await this.work(sql, id);
      if (
        Number(w.draft_version) !== input.expectedDraftVersion ||
        Number(w.metadata_version) !== input.expectedMetadataVersion
      )
        throw new TaskError('VERSION_CONFLICT');
      const c = (
        await sql.query(
          'SELECT * FROM parallel_life.publication_checks WHERE id=$1 AND work_id=$2 AND draft_version=$3',
          [input.checkId, id, input.expectedDraftVersion],
        )
      ).rows[0];
      if (!c) throw new TaskError('NOT_FOUND');
      if (c.document.status !== 'ready') throw new TaskError('INVALID_STATE');
      return { c, d: await this.draft(sql, id, input.expectedDraftVersion) };
    });
    if (first.old) return PublisherPublicationResultSchema.parse(first.old);
    const { c, d } = first,
      a = await this.assess(id, input.expectedDraftVersion, d.content_hash, d.content);
    if (
      a.status !== 'ready' ||
      digest(a.basis) !== digest(c.basis) ||
      c.content_hash !== d.content_hash
    )
      throw new TaskError('INVALID_STATE');
    return this.command(principal, 'publish', 'publish', input.commandId, hash, async (sql) => {
      const w = await this.work(sql, id, true);
      if (
        Number(w.draft_version) !== input.expectedDraftVersion ||
        Number(w.metadata_version) !== input.expectedMetadataVersion
      )
        throw new TaskError('VERSION_CONFLICT');
      const version = Number(
        (
          await sql.query(
            'SELECT COALESCE(max(version),0)+1 AS next FROM parallel_life.publication_versions WHERE work_id=$1',
            [id],
          )
        ).rows[0].next,
      );
      if (!Number.isSafeInteger(version)) throw new TaskError('INVALID_STATE');
      const content = PublishedWorldContentSchema.parse(
          PublishedWorldContentSchema.safeParse(d.content).success
            ? d.content
            : ensurePublishableDefaults(d.content as Record<string, unknown>, w.title),
        ),
        card = {
          title: content.work.title,
          hook: content.work.hook,
          identityLabel: content.protagonist.identity,
          experienceNote: content.work.experienceNote,
          description: content.work.description,
        };
      await sql.query(
        'INSERT INTO parallel_life.publication_versions(work_id,version,draft_version,content_hash,check_id,content,card,basis,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          id,
          version,
          input.expectedDraftVersion,
          d.content_hash,
          input.checkId,
          content,
          card,
          a.basis,
          principal,
        ],
      );
      await sql.query(
        'UPDATE parallel_life.publication_works SET publication_version=$2,listed=true,metadata_version=metadata_version+1,updated_at=now() WHERE id=$1',
        [id, version],
      );
      return {
        workId: id,
        result: PublisherPublicationResultSchema.parse({
          workId: id,
          publicationVersion: version,
          metadataVersion: input.expectedMetadataVersion + 1,
          status: 'published',
        }),
      };
    });
  }
  async unpublish(principal: string, id: string, raw: PublisherUnpublish) {
    parse(Id, id);
    const input = parse(PublisherUnpublishSchema, raw),
      hash = this.hash(principal, 'unpublish', id, input);
    return this.command(principal, 'publish', 'unpublish', input.commandId, hash, async (sql) => {
      const w = await this.work(sql, id, true);
      if (Number(w.metadata_version) !== input.expectedMetadataVersion)
        throw new TaskError('VERSION_CONFLICT');
      if (!w.listed || w.publication_version === null) throw new TaskError('INVALID_STATE');
      await sql.query(
        'UPDATE parallel_life.publication_works SET listed=false,metadata_version=metadata_version+1,updated_at=now() WHERE id=$1',
        [id],
      );
      return {
        workId: id,
        result: PublisherPublicationResultSchema.parse({
          workId: id,
          publicationVersion: Number(w.publication_version),
          metadataVersion: input.expectedMetadataVersion + 1,
          status: 'unpublished',
        }),
      };
    });
  }
  async restore(principal: string, id: string, raw: PublisherRestore) {
    parse(Id, id);
    const input = parse(PublisherRestoreSchema, raw),
      hash = this.hash(principal, 'restore', id, input);
    const first = await this.tx(principal, 'publish', async (sql) => {
      const old = await this.old(sql, principal, input.commandId, hash);
      if (old) return { old };
      const w = await this.work(sql, id);
      if (Number(w.metadata_version) !== input.expectedMetadataVersion)
        throw new TaskError('VERSION_CONFLICT');
      const v = (
        await sql.query(
          'SELECT * FROM parallel_life.publication_versions WHERE work_id=$1 AND version=$2',
          [id, input.publicationVersion],
        )
      ).rows[0];
      if (!v) throw new TaskError('NOT_FOUND');
      return { v };
    });
    if (first.old) return PublisherPublicationResultSchema.parse(first.old);
    const v = first.v!,
      a = await this.assess(id, Number(v.draft_version), v.content_hash, v.content);
    if (a.status !== 'ready' || digest(a.basis) !== digest(v.basis))
      throw new TaskError('INVALID_STATE');
    return this.command(principal, 'publish', 'restore', input.commandId, hash, async (sql) => {
      const w = await this.work(sql, id, true);
      if (Number(w.metadata_version) !== input.expectedMetadataVersion)
        throw new TaskError('VERSION_CONFLICT');
      await sql.query(
        'UPDATE parallel_life.publication_works SET listed=true,publication_version=$2,metadata_version=metadata_version+1,updated_at=now() WHERE id=$1',
        [id, input.publicationVersion],
      );
      return {
        workId: id,
        result: PublisherPublicationResultSchema.parse({
          workId: id,
          publicationVersion: input.publicationVersion,
          metadataVersion: input.expectedMetadataVersion + 1,
          status: 'published',
        }),
      };
    });
  }
  async publicCatalog(raw: { limit?: number; cursor?: string } = {}) {
    const p = parse(pageSchema, raw);
    try {
      return await this.db.transaction('', async (sql) => {
        const r = (
          await sql.query('SELECT * FROM parallel_life.published_work_catalog($1,$2)', [
            p.cursor ?? null,
            p.limit,
          ])
        ).rows;
        return PublishedWorkCatalogSchema.parse({
          works: r.slice(0, p.limit).map((x) => ({
            id: x.id,
            version: Number(x.version),
            title: x.title,
            hook: x.hook,
            identityLabel: x.identity_label,
            experienceNote: x.experience_note,
            description: x.description,
          })),
          nextCursor: r.length > p.limit ? r[p.limit - 1].id : null,
        });
      });
    } catch {
      throw new TaskError('UNAVAILABLE');
    }
  }
  async consumeLoginLimit(kind: 'global' | 'client' | 'username', bucketHash: string) {
    parse(z.enum(['global', 'client', 'username']), kind);
    parse(z.string().regex(/^[a-f0-9]{64}$/), bucketHash);
    try {
      return await this.db.transaction('', async (sql) => {
        const r = (
          await sql.query('SELECT * FROM parallel_life.publisher_consume_login_limit($1,$2)', [
            kind,
            bucketHash,
          ])
        ).rows[0];
        return { allowed: Boolean(r.allowed), retryAfterSeconds: Number(r.retry_after_seconds) };
      });
    } catch (e) {
      throw new TaskError((e as { code?: string }).code === '42501' ? 'FORBIDDEN' : 'UNAVAILABLE');
    }
  }
}
