import { randomUUID } from 'node:crypto';
import { ProfileSchema, type Profile } from '../../../contracts/api.ts';
import { usableProfileFact } from '../../profile/domain/profile-view.ts';
import { ApprovedSeedSchema } from '../../../contracts/seeds.ts';
import {
  LifeDraftSchema,
  PrepareDraftSchema,
  SaveDraftSchema,
  ConfirmDraftSchema,
  type LifeDraft,
  type PrepareDraft,
  type SaveDraftInput,
  type ConfirmDraft,
} from '../../../contracts/life-drafts.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError, requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { readDiscovery } from './discovery-repository.ts';

async function profileFor(sql: SqlClient, owner: string) {
  const row = (
    await sql.query(
      'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
      [owner],
    )
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  return ProfileSchema.parse({ ...row.document, version: row.version });
}
async function read(sql: SqlClient, owner: string, id: string) {
  const row = (
    await sql.query('SELECT document FROM parallel_life.life_drafts WHERE id=$1 AND owner_id=$2', [
      id,
      owner,
    ])
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  return LifeDraftSchema.parse(row.document);
}
async function selectionFor(
  sql: SqlClient,
  owner: string,
  profile: Profile,
  selection: LifeDraft['selection'],
) {
  const facts = selection.factIds.map((id) => {
    const fact = profile.facts.find((f) => f.id === id);
    const usable = fact ? usableProfileFact(profile, fact) : null;
    if (!fact || !usable) throw new TaskError('INVALID_INPUT');
    return { factId: fact.id, ...usable };
  });
  const events = selection.eventIds.map((id) => {
    const event = profile.events.find((e) => e.id === id);
    if (!event) throw new TaskError('INVALID_INPUT');
    return { eventId: event.id, title: event.title, date: event.date };
  });
  const people = selection.personIds.map((id) => {
    const person = profile.people.find((p) => p.id === id);
    if (!person) throw new TaskError('INVALID_INPUT');
    // Selecting this person explicitly brings their associated image into this branch.
    return {
      ...person,
      assetId: person.assetId,
    };
  });
  if (people.length > 8) throw new TaskError('INVALID_INPUT');
  const assetIds = [
    ...new Set([
      ...selection.assetIds,
      ...people.map((p) => p.assetId).filter((id): id is string => !!id),
    ]),
  ];
  const allowed = new Set(
    [
      profile.portraitAssetId,
      ...profile.referenceAssetIds,
      ...profile.people.filter((p) => selection.personIds.includes(p.id)).map((p) => p.assetId),
    ].filter(Boolean),
  );
  if (selection.assetIds.some((id) => !allowed.has(id))) throw new TaskError('INVALID_INPUT');
  if (selection.portraitAssetId && selection.portraitAssetId !== profile.portraitAssetId)
    throw new TaskError('INVALID_INPUT');
  const rows = assetIds.length
    ? (
        await sql.query(
          "SELECT id,revision FROM parallel_life.assets WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND world_id IS NULL AND origin='upload' AND status='ready' ORDER BY id FOR SHARE",
          [assetIds, owner],
        )
      ).rows
    : [];
  if (rows.length !== assetIds.length) throw new TaskError('INVALID_INPUT');
  return {
    facts,
    events,
    people,
    assets: rows.map((a) => ({ assetId: String(a.id), revision: Number(a.revision) })),
  };
}
export class DraftRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  list(owner: string) {
    return this.db.transaction(owner, async (sql) =>
      (
        await sql.query(
          'SELECT document FROM parallel_life.life_drafts WHERE owner_id=$1 ORDER BY updated_at DESC,id LIMIT 100',
          [owner],
        )
      ).rows.map((r) => LifeDraftSchema.parse(r.document)),
    );
  }
  get(owner: string, id: string) {
    return this.db.transaction(owner, (sql) => read(sql, owner, id));
  }
  private command(
    owner: string,
    commandId: string,
    hash: string,
    run: (sql: SqlClient) => Promise<LifeDraft>,
  ) {
    return this.db.transaction(owner, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [owner]);
      const receipt = (
        await sql.query(
          'SELECT request_hash,response FROM parallel_life.draft_receipts WHERE owner_id=$1 AND command_id=$2',
          [owner, commandId],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return LifeDraftSchema.parse(receipt.response);
      }
      const result = await run(sql);
      await sql.query(
        'INSERT INTO parallel_life.draft_receipts(owner_id,command_id,request_hash,draft_id,response) VALUES($1,$2,$3,$4,$5)',
        [owner, commandId, hash, result.id, result],
      );
      return result;
    });
  }
  prepare(owner: string, raw: PrepareDraft) {
    const input = PrepareDraftSchema.parse(raw);
    return this.command(
      owner,
      input.commandId,
      requestHash(['prepare-draft', input]),
      async (sql) => {
        const existing = (
          await sql.query(
            'SELECT document FROM parallel_life.life_drafts WHERE owner_id=$1 AND direction_id=$2 AND discovery_version=$3',
            [owner, input.directionId, input.discoveryVersion],
          )
        ).rows[0];
        if (existing) return LifeDraftSchema.parse(existing.document);
        const discovery = await readDiscovery(sql, owner);
        if (discovery.version !== input.discoveryVersion) throw new TaskError('VERSION_CONFLICT');
        const direction = discovery.directions.find((d) => d.id === input.directionId);
        if (!direction) throw new TaskError('NOT_FOUND');
        const count = (
          await sql.query(
            'SELECT count(*)::int AS n FROM parallel_life.life_drafts WHERE owner_id=$1',
            [owner],
          )
        ).rows[0];
        if (count.n >= 100) throw new TaskError('RATE_LIMITED');
        const profile = await profileFor(sql, owner),
          now = new Date().toISOString();
        const draft = LifeDraftSchema.parse({
          id: randomUUID(),
          version: 0,
          profileVersion: profile.version,
          discoveryVersion: discovery.version,
          directionId: direction.id,
          status: 'draft',
          story: {
            title: direction.title,
            premise: direction.premise,
            opening: direction.opening,
            tradeoff: direction.tradeoff,
          },
          setup: { identity: '', place: '', tone: '' },
          selection: {
            factIds: [],
            eventIds: [],
            personIds: [],
            assetIds: [],
            portraitAssetId: null,
          },
          assets: [],
          seedId: null,
          createdAt: now,
          updatedAt: now,
        });
        await sql.query(
          'INSERT INTO parallel_life.life_drafts(id,owner_id,profile_id,direction_id,discovery_version,status,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            draft.id,
            owner,
            profile.id,
            draft.directionId,
            draft.discoveryVersion,
            draft.status,
            draft,
          ],
        );
        return draft;
      },
    );
  }
  save(owner: string, id: string, raw: SaveDraftInput) {
    const input = SaveDraftSchema.parse(raw);
    return this.command(
      owner,
      input.commandId,
      requestHash(['save-draft', id, input]),
      async (sql) => {
        const current = await read(sql, owner, id);
        if (current.status !== 'draft') throw new TaskError('INVALID_STATE');
        if (current.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
        const profile = await profileFor(sql, owner);
        if (profile.version !== input.expectedProfileVersion)
          throw new TaskError('VERSION_CONFLICT');
        const selected = await selectionFor(sql, owner, profile, input.selection);
        const next = LifeDraftSchema.parse({
          ...current,
          story: input.story,
          setup: input.setup,
          selection: input.selection,
          assets: selected.assets,
          profileVersion: profile.version,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
        });
        await sql.query(
          'UPDATE parallel_life.life_drafts SET document=$1,version=$2,updated_at=now() WHERE id=$3 AND owner_id=$4',
          [next, next.version, id, owner],
        );
        return next;
      },
    );
  }
  confirm(owner: string, id: string, raw: ConfirmDraft) {
    const input = ConfirmDraftSchema.parse(raw);
    return this.command(
      owner,
      input.commandId,
      requestHash(['confirm-draft', id, input]),
      async (sql) => {
        const current = await read(sql, owner, id);
        if (current.status === 'confirmed') {
          if (
            ![current.version, current.version - 1].includes(input.expectedVersion) ||
            current.profileVersion !== input.expectedProfileVersion
          )
            throw new TaskError('VERSION_CONFLICT');
          return current;
        }
        if (
          current.version !== input.expectedVersion ||
          current.profileVersion !== input.expectedProfileVersion
        )
          throw new TaskError('VERSION_CONFLICT');
        const profile = await profileFor(sql, owner);
        if (profile.version !== input.expectedProfileVersion)
          throw new TaskError('VERSION_CONFLICT');
        const selected = await selectionFor(sql, owner, profile, current.selection);
        if (JSON.stringify(selected.assets) !== JSON.stringify(current.assets))
          throw new TaskError('VERSION_CONFLICT');
        const seed = ApprovedSeedSchema.parse({
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          profileVersion: profile.version,
          discoveryVersion: current.discoveryVersion,
          directionId: current.directionId,
          story: current.story,
          setup: current.setup,
          ...selected,
          personRoles: current.selection.personRoles ?? [],
          portraitAssetId: current.selection.portraitAssetId,
          draftRef: { id, version: current.version },
        });
        await sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [
            seed.id,
            owner,
            profile.id,
            input.commandId,
            requestHash(['draft-seed', id, current.version]),
            seed,
          ],
        );
        const next = LifeDraftSchema.parse({
          ...current,
          status: 'confirmed',
          seedId: seed.id,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
        });
        await sql.query(
          "UPDATE parallel_life.life_drafts SET document=$1,version=$2,status='confirmed',seed_id=$3,updated_at=now() WHERE id=$4 AND owner_id=$5",
          [next, next.version, seed.id, id, owner],
        );
        return next;
      },
    );
  }
}
