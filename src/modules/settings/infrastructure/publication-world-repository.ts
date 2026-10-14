import { z } from 'zod';
import {
  PublishedWorldStartRequestSchema,
  PublicationTrialStartRequestSchema,
  PublicationWorldResultSchema,
  PublicationTrialSchema,
  PublicationTrialEvidenceSchema,
  PublicationPlayerCatalogSchema,
  PublicationOriginSchema,
  type PublishedWorldStartRequest,
  type PublicationTrialStartRequest,
} from '../../../contracts/publication-worlds.ts';
import { Id, Timestamp } from '../../../contracts/api.ts';
import { publicationArt } from '../../../contracts/publication-assets.ts';
import { PublishedWorldContentSchema } from '../../../contracts/published-world-content.ts';
import { publicationStorageIssues } from '../domain/publication-content.ts';
import { ensurePublishableDefaults } from '../domain/publication-defaults.ts';
import type {
  PublicationWorldCompilerPort,
  PublicationWorldPrepare,
} from '../application/publication-world-ports.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';

const text = (max: number) => z.string().min(1).max(max);
const ref = z.string().min(1).max(200);
const key = z.string().regex(/^[a-z0-9_]{1,64}$/);
const source = z.strictObject({
  kind: z.literal('seed_genesis'),
  seedId: Id,
  snapshotVersion: z.literal(0),
});
const actor = z.strictObject({
  id: ref,
  name: text(80),
  persona: text(6000),
  relationship: text(600).optional(),
});
const message = z.strictObject({
  id: ref,
  actorId: ref,
  role: z.enum(['assistant', 'user']),
  text: text(8000),
  at: Timestamp,
  sourceEventId: ref,
  initialRead: z.boolean(),
  history: z.strictObject({ version: z.literal(1), key: ref }).optional(),
});
const fact = z.strictObject({
  id: ref,
  text: text(1600),
  kind: z.literal('canonical'),
  sourceEventId: ref,
  visibility: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('owner') }),
    z.strictObject({ kind: z.literal('actors'), actorIds: z.array(ref).min(1).max(12) }),
  ]),
});
const invitation = z.strictObject({
  id: ref,
  title: text(120),
  at: Timestamp,
  participantIds: z.array(ref).min(1).max(12),
  sourceEventId: ref,
  sourceMessageId: ref,
  status: z.literal('proposed'),
});
const worldSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: Id,
  ownerId: ref,
  version: z.literal(0),
  title: text(80),
  time: Timestamp,
  messageHistory: z.strictObject({
    version: z.literal(1),
    startAt: Timestamp,
    timeZone: z.literal('UTC+08:00'),
  }),
  actors: z.array(actor).min(1).max(12),
  actorTies: z.array(z.never()).max(0),
  facts: z.array(fact).max(128),
  messages: z.array(message).max(40),
  appointments: z.array(invitation).max(12),
  mediaRequests: z.array(z.never()).max(0),
  space: z.strictObject({
    places: z
      .array(
        z.strictObject({
          id: key,
          name: text(100),
          description: text(800),
          source,
          contactActorIds: z.array(ref).max(12),
          appointmentIds: z.array(ref).max(12),
        }),
      )
      .min(1)
      .max(16),
    routes: z
      .array(
        z.strictObject({
          id: key,
          fromPlaceId: key,
          toPlaceId: key,
          durationMinutes: z.number().int().min(1).max(120),
          modeLabel: text(80),
          source,
        }),
      )
      .max(64),
    currentPlaceId: key,
    positionSource: source,
  }),
});
const openingSchema = z.strictObject({
  kind: z.literal('publication_opening'),
  schemaVersion: z.literal(1),
  origin: PublicationOriginSchema,
  originKind: z.enum(['published', 'trial']),
  identity: text(300),
  situation: text(1000),
  setting: text(1600),
  experienceNote: text(300),
  contacts: z
    .array(
      z.strictObject({
        actorKey: key,
        actorId: ref,
        name: text(80),
        relationship: z.string().max(600),
        introduction: text(1600).optional(),
        identity: text(160).optional(),
        traits: z.array(text(60)).max(3),
        appearance: text(240).optional(),
      }),
    )
    .max(12),
  notes: z
    .array(
      z.strictObject({
        key,
        id: ref,
        title: text(120),
        text: text(1600),
        sourceEventId: ref,
        factKeys: z.array(key).max(64),
      }),
    )
    .max(12),
});
const seedSchema = z.strictObject({
  id: Id,
  createdAt: Timestamp,
  source: PublicationOriginSchema.extend({ kind: z.enum(['published_work', 'publication_trial']) }),
  identity: text(300),
  situation: text(1000),
  setting: text(1600),
  experienceNote: text(300),
});
const preparedSchema = z.strictObject({
  world: worldSchema,
  opening: openingSchema,
  seed: seedSchema,
});
const admissionSchema = z.strictObject({
  ticket: Id,
  content: z.unknown(),
  origin: PublicationOriginSchema,
  originKind: z.enum(['published_work', 'trial']),
  worldId: Id,
  ownerId: ref,
  seedId: Id,
});
const unavailable: PublicationWorldCompilerPort = {
  prepare() {
    throw new TaskError('UNAVAILABLE');
  },
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function validatePrepared(raw: unknown, input: PublicationWorldPrepare, characterTrial = false) {
  if (characterTrial && input.originKind !== 'trial') throw new TaskError('INVALID_STATE');
  if (publicationStorageIssues(raw).length) throw new TaskError('INVALID_STATE');
  const parsed = preparedSchema.safeParse(raw);
  if (!parsed.success) throw new TaskError('INVALID_STATE');
  const p = parsed.data,
    c = PublishedWorldContentSchema.parse(input.content);
  const ids = new Set(p.world.actors.map((a) => a.id));
  const messageIds = new Set(p.world.messages.map((m) => m.id));
  const placeIds = new Set(p.world.space.places.map((x) => x.id));
  const genesis = 'publication-genesis:' + input.worldId;
  if (
    p.world.id !== input.worldId ||
    p.world.ownerId !== input.ownerId ||
    p.seed.id !== input.seedId ||
    p.world.title !== c.work.title ||
    p.world.time !== c.world.startAt ||
    p.world.messageHistory.startAt !== c.world.startAt ||
    ids.size !== p.world.actors.length ||
    p.world.actors.length !== c.actors.length ||
    !equal(p.opening.origin, input.origin) ||
    !equal(p.seed.source, {
      ...input.origin,
      kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
    }) ||
    p.opening.originKind !== (input.originKind === 'trial' ? 'trial' : 'published') ||
    p.opening.identity !== c.protagonist.identity ||
    p.opening.situation !== c.protagonist.situation ||
    p.opening.setting !== c.world.publicSetting ||
    p.opening.experienceNote !== c.work.experienceNote ||
    p.seed.identity !== p.opening.identity ||
    p.seed.situation !== p.opening.situation ||
    p.seed.setting !== p.opening.setting ||
    p.seed.experienceNote !== p.opening.experienceNote ||
    messageIds.size !== p.world.messages.length ||
    !placeIds.has(p.world.space.currentPlaceId)
  )
    throw new TaskError('INVALID_STATE');
  const unique = (list: { id: string }[]) => new Set(list.map((x) => x.id)).size === list.length;
  if (
    !unique(p.world.facts) ||
    !unique(p.world.appointments) ||
    !unique(p.world.space.routes) ||
    !unique(p.world.space.places) ||
    !unique(p.opening.notes)
  )
    throw new TaskError('INVALID_STATE');
  for (const m of p.world.messages)
    if (
      m.sourceEventId !== genesis ||
      !ids.has(m.actorId) ||
      Date.parse(m.at) > Date.parse(p.world.time) ||
      (m.role === 'user' &&
        !c.phone.messages.some(
          (source) =>
            source.key === m.history?.key &&
            source.actorKey === p.opening.contacts.find((a) => a.actorId === m.actorId)?.actorKey &&
            source.speaker === 'player' &&
            source.origin === 'history' &&
            source.text === m.text &&
            source.at === m.at,
        ))
    )
      throw new TaskError('INVALID_STATE');
  for (const f of p.world.facts)
    if (
      f.sourceEventId !== genesis ||
      (f.visibility.kind === 'actors' && f.visibility.actorIds.some((id) => !ids.has(id)))
    )
      throw new TaskError('INVALID_STATE');
  for (const inv of p.world.appointments)
    if (
      inv.sourceEventId !== genesis ||
      !messageIds.has(inv.sourceMessageId) ||
      inv.participantIds.some((id) => !ids.has(id))
    )
      throw new TaskError('INVALID_STATE');
  for (const contact of p.opening.contacts) {
    const a = c.actors.find((a) => a.key === contact.actorKey);
    if (
      !a ||
      (!a.knownAtStart && !(characterTrial && input.originKind === 'trial')) ||
      !ids.has(contact.actorId) ||
      contact.name !== a.name ||
      contact.introduction !== a.publicCard.introduction ||
      contact.identity !== a.publicCard.identity ||
      contact.appearance !== a.publicCard.appearance ||
      !equal(contact.traits, a.publicCard.traits)
    )
      throw new TaskError('INVALID_STATE');
  }
  for (const n of p.opening.notes)
    if (
      n.sourceEventId !== genesis ||
      !c.phone.notes.some(
        (note) =>
          note.key === n.key &&
          note.title === n.title &&
          note.text === n.text &&
          equal(note.factKeys, n.factKeys),
      )
    )
      throw new TaskError('INVALID_STATE');
  for (const s of [
    ...p.world.space.places,
    ...p.world.space.routes,
    { source: p.world.space.positionSource },
  ])
    if (s.source.seedId !== input.seedId) throw new TaskError('INVALID_STATE');
  for (const r of p.world.space.routes)
    if (!placeIds.has(r.fromPlaceId) || !placeIds.has(r.toPlaceId) || r.fromPlaceId === r.toPlaceId)
      throw new TaskError('INVALID_STATE');
  return p;
}
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const p = schema.safeParse(value);
  if (!p.success) throw new TaskError('INVALID_INPUT');
  return p.data;
}
function error(e: unknown): never {
  if (e instanceof TaskError) throw e;
  const code = (e as { code?: string }).code,
    message = (e as { message?: string }).message;
  if (code === '42501') throw new TaskError('FORBIDDEN');
  if (code === '22023' || code === '22P02' || code === '23514')
    throw new TaskError('INVALID_STATE');
  if (
    code === 'P0001' &&
    ['NOT_FOUND', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(message ?? '')
  )
    throw new TaskError(message as 'NOT_FOUND' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT');
  throw new TaskError('UNAVAILABLE');
}
/** The database pool is the ordinary app pool for player starts, a publisher pool for staff trials. */
export class PublicationWorldRepository {
  private db: PostgresDatabase;
  private compiler: PublicationWorldCompilerPort;
  private readonly characterTrial: boolean;
  constructor(
    db: PostgresDatabase,
    compiler: PublicationWorldCompilerPort = unavailable,
    options: { characterTrial?: boolean } = {},
  ) {
    this.db = db;
    this.compiler = compiler;
    this.characterTrial = options.characterTrial === true;
  }
  private async tx<T>(
    identity: string,
    staff: boolean,
    run: (sql: SqlClient) => Promise<T>,
  ): Promise<T> {
    parse(staff ? Id : ref, identity);
    try {
      return await this.db.transaction(staff ? '' : identity, async (sql) => {
        if (staff)
          await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [identity]);
        return run(sql);
      });
    } catch (e) {
      return error(e);
    }
  }
  private async commit(sql: SqlClient, admission: unknown, kind: 'published_work' | 'trial') {
    if (admission && typeof admission === 'object' && Object.hasOwn(admission, 'result'))
      return PublicationWorldResultSchema.parse((admission as { result: unknown }).result);
    const a = admissionSchema.parse(admission);
    if (a.originKind !== kind) throw new TaskError('INVALID_STATE');
    const { ticket, ...input } = a;
    // The compiler and the admission validator must see the same normalized content.
    // Publication versions are already normalized on publish; draft trials need this too.
    const preparedInput = {
      ...input,
      content: PublishedWorldContentSchema.parse(
        PublishedWorldContentSchema.safeParse(input.content).success
          ? input.content
          : ensurePublishableDefaults(input.content as Record<string, unknown>),
      ),
    };
    let raw: unknown;
    try {
      raw = await this.compiler.prepare(structuredClone(preparedInput));
    } catch (e) {
      if (e instanceof TaskError) throw e;
      throw new TaskError('INVALID_STATE');
    }
    const p = validatePrepared(raw, preparedInput, this.characterTrial);
    // PostgreSQL JSONB text inserts whitespace. Check the actual physical budget before writes.
    const sizes = (
      await sql.query(
        'SELECT octet_length($1::jsonb::text) AS world_bytes,octet_length($2::jsonb::text) AS opening_bytes,octet_length($3::jsonb::text) AS seed_bytes',
        [p.world, p.opening, p.seed],
      )
    ).rows[0];
    if (sizes.world_bytes >= 262144 || sizes.opening_bytes >= 65536 || sizes.seed_bytes >= 65536)
      throw new TaskError('INVALID_STATE');

    const fn = kind === 'trial' ? 'publication_commit_trial' : 'publication_commit_published';
    const row = (await sql.query(`SELECT parallel_life.${fn}($1,$2) AS result`, [ticket, p]))
      .rows[0];
    return PublicationWorldResultSchema.parse(row.result);
  }
  startPublished(ownerId: string, workId: string, raw: PublishedWorldStartRequest) {
    if (this.characterTrial) throw new TaskError('INVALID_STATE');
    const input = parse(PublishedWorldStartRequestSchema, raw);
    parse(Id, workId);
    return this.tx(ownerId, false, async (sql) =>
      this.commit(
        sql,
        (
          await sql.query(
            'SELECT parallel_life.publication_admit_published($1,$2,$3) AS admission',
            [workId, input.publicationVersion, input.commandId],
          )
        ).rows[0].admission,
        'published_work',
      ),
    );
  }
  startTrial(principalId: string, workId: string, raw: PublicationTrialStartRequest) {
    const input = parse(PublicationTrialStartRequestSchema, raw);
    parse(Id, workId);
    return this.tx(principalId, true, async (sql) =>
      this.commit(
        sql,
        (
          await sql.query(
            'SELECT parallel_life.publication_admit_trial($1,$2,$3,$4) AS admission',
            [workId, input.draftVersion, input.contentHash, input.commandId],
          )
        ).rows[0].admission,
        'trial',
      ),
    );
  }
  getTrial(principalId: string, trialId: string) {
    parse(Id, trialId);
    return this.tx(principalId, true, async (sql) =>
      PublicationTrialSchema.parse(
        (await sql.query('SELECT parallel_life.publication_get_trial($1) AS result', [trialId]))
          .rows[0].result,
      ),
    );
  }
  /** Internal only: authorize the bound trial before constructing an app service session. */
  trialSession(principalId: string, trialId: string) {
    parse(Id, trialId);
    return this.tx(principalId, true, async (sql) =>
      z
        .strictObject({ ownerId: ref, worldId: Id, seedId: Id, origin: PublicationOriginSchema })
        .parse(
          (
            await sql.query('SELECT parallel_life.publication_trial_session($1) AS result', [
              trialId,
            ])
          ).rows[0].result,
        ),
    );
  }
  trialEvidence(principalId: string, workId: string, draftVersion: number, contentHash: string) {
    parse(PublicationTrialStartRequestSchema, { commandId: workId, draftVersion, contentHash });
    return this.tx(principalId, true, async (sql) =>
      PublicationTrialEvidenceSchema.parse(
        (
          await sql.query('SELECT parallel_life.publication_trial_evidence($1,$2,$3) AS result', [
            workId,
            draftVersion,
            contentHash,
          ])
        ).rows[0].result,
      ),
    );
  }
  catalog(ownerId: string, { limit = 50, cursor }: { limit?: number; cursor?: string } = {}) {
    parse(z.number().int().min(1).max(100), limit);
    if (cursor) parse(Id, cursor);
    return this.tx(ownerId, false, async (sql) => {
      const rows = (
        await sql.query('SELECT * FROM parallel_life.publication_player_catalog($1,$2)', [
          cursor ?? null,
          limit,
        ])
      ).rows;
      const covers = new Map<string, string>();
      for (const r of rows.slice(0, limit)) {
        const media = (
          await sql.query('SELECT parallel_life.publication_catalog_visual($1,$2) AS media', [
            r.id,
            r.version,
          ])
        ).rows[0]?.media;
        const art = publicationArt(media, 'cover');
        if (art) covers.set(r.id, art.url);
      }
      return PublicationPlayerCatalogSchema.parse({
        works: rows.slice(0, limit).map((r) => ({
          id: r.id,
          version: Number(r.version),
          title: r.title,
          hook: r.hook,
          identityLabel: r.identity_label,
          experienceNote: r.experience_note,
          description: r.description,
          worldId: r.world_id ?? null,
          ...(covers.has(r.id) ? { coverUrl: covers.get(r.id) } : {}),
        })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      });
    });
  }
}
