import { PUBLICATION_ART } from '../../src/contracts/publication-assets.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  PublicationRepository,
  type PublicationReviewPort,
} from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import type {
  PublicationWorldCompilerPort,
  PublicationWorldPrepare,
} from '../../src/modules/settings/application/publication-world-ports.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { OFFICIAL_LIFE_PACKS } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';

const compiler: PublicationWorldCompilerPort = {
  prepare(input) {
    const r = compilePublicationGenesis({
      ...input,
      originKind: input.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(r.status, 'compiled');
    if (r.status !== 'compiled') throw Error('UNSUPPORTED_REAL_COMPILER');
    return {
      world: r.world,
      opening: r.opening,
      seed: {
        id: input.seedId,
        createdAt: new Date().toISOString(),
        source: {
          kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
          ...input.origin,
        },
        identity: r.opening.identity,
        situation: r.opening.situation,
        setting: r.opening.setting,
        experienceNote: r.opening.experienceNote,
      },
    };
  },
};
// Only publication review proofs are synthetic local fixtures. Genesis uses the actual pure compiler;
// persisted turn effects below are explicit test proposals, never paid provider success claims.
const localReviewReceipt = randomUUID();
const review: PublicationReviewPort = {
  async review() {
    return {
      reviewerVersion: 'local_fixture_only',
      runtimeCapabilities: new Set(['publication.opening.v1', 'publication.media.v1']),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId: localReviewReceipt },
    };
  },
};
const isCode = (code: string) => (e: unknown) => {
  assert.equal((e as { code: string }).code, code);
  return true;
};
async function content() {
  const r = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const c = PublishedWorldContentSchema.parse(JSON.parse(/```json\n([\s\S]*?)\n```/.exec(r)![1]!));
  const a = c.actors[0]!,
    b = c.actors[1]!;
  a.name = '同名朋友';
  b.name = '同名朋友';
  c.history = [
    {
      key: 'prior',
      kind: 'established_fact',
      text: 'PUBLIC_HISTORY_ONLY_FIRST_KNOWS',
      occurredAt: '2026-10-11T09:00:00Z',
      actorKeys: [a.key, b.key],
      visibility: { kind: 'world' },
    },
    {
      key: 'secret',
      kind: 'established_fact',
      text: 'PRIVATE_FIRST_ONLY',
      occurredAt: '2026-10-11T09:00:00Z',
      actorKeys: [a.key],
      visibility: { kind: 'actors', actorKeys: [a.key] },
    },
  ];
  c.protagonist.knownFactKeys = ['prior'];
  c.initialKnowledge = [{ actorKey: a.key, factKeys: ['prior', 'secret'] }];
  c.phone.messages = [
    {
      key: 'old_hello',
      actorKey: a.key,
      origin: 'history',
      text: '仅为已写开场历史',
      at: '2026-10-11T09:00:00Z',
    },
    {
      key: 'hello',
      actorKey: a.key,
      origin: 'incoming',
      text: '已写开场来信，不是试演生成',
      at: c.world.startAt,
    },
  ];
  c.phone.notes = [{ key: 'note', title: '编剧写的便签', text: '历史摘要', factKeys: ['prior'] }];
  return PublishedWorldContentSchema.parse(c);
}
test('real PG publication worlds: trusted genesis, independent owners, private trials and atomic admission', async (t) => {
  const config = await localConfig(),
    portText = process.env.PUBLICATION_WORLD_TEST_PORT ?? '55478';
  assert.match(portText, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(portText) <= 65535);
  assert.equal(config.port, Number(portText));
  const admin = await adminClient('parallel_life_test');
  const resources: PostgresDatabase[] = [];
  t.after(async () => {
    for (const r of resources) await r.close();
    await admin.end();
  });
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  resources.push(app, worker);
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_publication_world_fixture'"))
      .rowCount
  )
    await admin.query(
      `CREATE ROLE pl_publication_world_fixture LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_publication_world_fixture');
  const pub = new PostgresDatabase(
    `postgresql://pl_publication_world_fixture:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  resources.push(pub);
  const staff = randomUUID(),
    otherStaff = randomUUID(),
    owner = randomUUID(),
    otherOwner = randomUUID();
  for (const id of [staff, otherStaff])
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [id, '仅本地合成员工'],
    );
  await new IdentityRepository(app).ensureGuest(owner);
  await new IdentityRepository(app).ensureGuest(otherOwner);
  const works = new PublicationRepository(pub, review),
    worlds = new PublicationWorldRepository(app, compiler),
    trials = new PublicationWorldRepository(pub, compiler);
  // Persistent isolated test databases may contain more than one page of other fixture works.
  // Find the exact work through the actual cursor API, never presume it is on page one.
  const catalogAll = async (user: string) => {
    const list: Awaited<ReturnType<typeof worlds.catalog>>['works'] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const r = await worlds.catalog(user, { limit: 100, ...(cursor ? { cursor } : {}) });
      list.push(...r.works);
      if (!r.nextCursor) return { works: list, nextCursor: null };
      assert.notEqual(r.nextCursor, cursor);
      cursor = r.nextCursor;
    }
    throw Error('fixture catalog exceeded bounded pagination');
  };
  const make = async (override?: Awaited<ReturnType<typeof content>>) => {
    const c = override ?? (await content());
    const w = await works.create(staff, {
      commandId: randomUUID(),
      title: c.work.title,
      content: c,
    });
    const check = await works.check(staff, w.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
    });
    assert.equal(check.status, 'ready');
    await works.publish(staff, w.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: check.id,
    });
    return { w, c };
  };
  await t.test(
    'private character demo persists an unfamiliar contact without rewriting author knowledge or public compiler',
    async () => {
      const c = await content();
      c.actors = [c.actors[0]!];
      c.actors[0]!.knownAtStart = false;
      c.history = [];
      c.initialKnowledge = [];
      c.relationships = [];
      c.protagonist.knownFactKeys = [];
      c.candidates = [];
      delete c.timeline;
      c.phone = { messages: [], notes: [], invitations: [], album: [], moments: [] };
      const w = await works.create(staff, {
        commandId: randomUUID(),
        title: c.work.title,
        content: c,
      });
      const trialInput = {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: w.draft.contentHash,
      };
      await assert.rejects(trials.startTrial(staff, w.id, trialInput));
      const demoCompiler: PublicationWorldCompilerPort = {
        prepare(input) {
          assert.equal(input.originKind, 'trial');
          const r = compilePublicationGenesis({
            ...input,
            originKind: 'trial',
            newId: randomUUID,
            privateCharacterDemo: true,
          });
          assert.equal(r.status, 'compiled');
          if (r.status !== 'compiled') throw Error('PRIVATE_DEMO_COMPILATION_FAILED');
          return {
            world: r.world,
            opening: r.opening,
            seed: {
              id: input.seedId,
              createdAt: new Date().toISOString(),
              source: { kind: 'publication_trial', ...input.origin },
              identity: r.opening.identity,
              situation: r.opening.situation,
              setting: r.opening.setting,
              experienceNote: r.opening.experienceNote,
            },
          };
        },
      };
      const demos = new PublicationWorldRepository(pub, demoCompiler, { characterTrial: true });
      const demoCommand = { ...trialInput, commandId: randomUUID() };
      const demo = await demos.startTrial(staff, w.id, demoCommand);
      const session = await demos.trialSession(staff, demo.trialId!);
      const snapshot = await new PostgresWorldRepository(app).get(
        { userId: session.ownerId },
        session.worldId,
      );
      assert.equal(snapshot.actors.length, 1);
      assert.equal(snapshot.messages.length, 0);
      assert.equal(snapshot.facts.length, 0);
      const phone = await new BuildRepository(app).phone(session.ownerId, session.worldId);
      assert.equal(phone.actors.length, 1);
      assert.equal(phone.messages.length, 0);
      assert.equal(phone.actors[0]!.name, c.actors[0]!.name);
      assert.deepEqual((await works.get(staff, w.id)).draft.content, w.draft.content);
      assert.equal((await demos.startTrial(staff, w.id, demoCommand)).worldId, demo.worldId);
      await assert.rejects(async () =>
        demos.startPublished(owner, w.id, { commandId: randomUUID(), publicationVersion: 1 }),
      );
    },
  );
  const { w, c } = await make();
  let first: Awaited<ReturnType<typeof worlds.startPublished>>;
  let trial: Awaited<ReturnType<typeof trials.startTrial>>;
  const hash = (await works.get(staff, w.id)).draft.contentHash;
  const counts = async () =>
    (
      await admin.query(
        `SELECT (SELECT count(*) FROM parallel_life.accounts)::int accounts,(SELECT count(*) FROM parallel_life.publication_world_bindings)::int bindings,(SELECT count(*) FROM parallel_life.worlds)::int worlds,(SELECT count(*) FROM parallel_life.approved_seeds)::int seeds,(SELECT count(*) FROM parallel_life.world_initial_snapshots)::int initials,(SELECT count(*) FROM parallel_life.world_builds)::int builds,(SELECT count(*) FROM parallel_life.world_clock)::int clocks,(SELECT count(*) FROM parallel_life.publication_world_receipts)::int receipts,(SELECT count(*) FROM parallel_life.publication_world_admissions)::int tickets`,
      )
    ).rows[0];
  await t.test(
    'ordinary player cannot read raw drafts, staff runtime or internal bridge helpers',
    async () => {
      for (const table of [
        'publication_draft_revisions',
        'publication_versions',
        'publication_world_bindings',
        'publication_world_admissions',
      ])
        await assert.rejects(
          app.transaction(owner, (s) => s.query('SELECT * FROM parallel_life.' + table)),
          (e) => (e as { code: string }).code === '42501',
        );
      for (const table of ['worlds', 'profiles', 'approved_seeds', 'world_initial_snapshots'])
        await assert.rejects(
          pub.transaction('', (s) => s.query('SELECT * FROM parallel_life.' + table)),
          (e) => (e as { code: string }).code === '42501',
        );
      await assert.rejects(
        worker.transaction(owner, (s) =>
          s.query('SELECT parallel_life.publication_admit_published($1,1,$2)', [
            w.id,
            randomUUID(),
          ]),
        ),
        (e) => (e as { code: string }).code === '42501',
      );
      await assert.rejects(
        app.transaction(owner, (s) =>
          s.query('SELECT parallel_life.publication_admit_internal($1,$2,1,NULL,$3)', [
            'published_work',
            w.id,
            randomUUID(),
          ]),
        ),
        (e) => (e as { code: string }).code === '42501',
      );
    },
  );
  await t.test(
    'real pure compiler starts atomic world/seed/clock/baseline/binding and no fake succeeded AI task',
    async () => {
      const before = await counts();
      first = await worlds.startPublished(owner, w.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      });
      assert.equal(first.origin.contentHash, hash);
      assert.equal(first.originKind, 'published_work');
      assert.equal(first.trialId, null);
      const after = await counts();
      for (const name of [
        'bindings',
        'worlds',
        'seeds',
        'initials',
        'builds',
        'clocks',
        'receipts',
      ])
        assert.equal(after[name], before[name] + 1);
      assert.equal(after.tickets, 0);
      const seed = (
        await admin.query('SELECT * FROM parallel_life.approved_seeds WHERE id=$1', [first.seedId])
      ).rows[0];
      assert.equal(seed.profile_id, null);
      assert.equal(seed.document.source.kind, 'published_work');
      assert.deepEqual(seed.document.source, { kind: 'published_work', ...first.origin });
      assert.equal(Object.hasOwn(seed.document, 'story'), false);
      const state = (
        await admin.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [first.worldId],
        )
      ).rows[0].state;
      assert.equal(state.version, 0);
      assert.ok(
        state.messages.every(
          (m: { sourceEventId: string }) =>
            m.sourceEventId === 'publication-genesis:' + first.worldId,
        ),
      );
      assert.equal(
        (
          await admin.query('SELECT count(*)::int n FROM parallel_life.tasks WHERE scope_id=$1', [
            first.seedId,
          ])
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'real compiler combined relationships above 400 remain supported through storage',
    async () => {
      const authored = await content(),
        a = authored.actors[0]!;
      authored.relationships = [
        {
          key: 'relation_a',
          from: { kind: 'player' },
          to: { kind: 'actor', actorKey: a.key },
          description: 'A'.repeat(240),
          visibility: { kind: 'world' },
        },
        {
          key: 'relation_b',
          from: { kind: 'actor', actorKey: a.key },
          to: { kind: 'player' },
          description: 'B'.repeat(240),
          visibility: { kind: 'world' },
        },
      ];
      const work = await works.create(staff, {
        commandId: randomUUID(),
        title: authored.work.title,
        content: authored,
      });
      const result = await trials.startTrial(staff, work.id, {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: work.draft.contentHash,
      });
      const opening = (
        await admin.query('SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1', [
          result.seedId,
        ])
      ).rows[0].opening;
      assert.ok(
        opening.contacts.some(
          (contact: { relationship: string }) =>
            contact.relationship.length > 400 && contact.relationship.length <= 600,
        ),
      );
    },
  );
  await t.test(
    'valid compiled opening above legacy 32 KiB persists intact while old openings keep their budget',
    async () => {
      const authored = await content();
      const prototype = authored.actors[0]!;
      authored.actors = Array.from({ length: 12 }, (_, i) => ({
        ...structuredClone(prototype),
        key: 'actor_' + i,
        name: 'N'.repeat(80),
        publicCard: {
          identity: 'I'.repeat(160),
          traits: ['A'.repeat(60), 'B'.repeat(60), 'C'.repeat(60)],
          appearance: 'V'.repeat(240),
        },
      }));
      authored.relationships = authored.actors.flatMap((a, i) => [
        {
          key: 'forward_' + i,
          from: { kind: 'player' as const },
          to: { kind: 'actor' as const, actorKey: a.key },
          description: 'R'.repeat(240),
          visibility: { kind: 'player' as const },
        },
        {
          key: 'backward_' + i,
          from: { kind: 'actor' as const, actorKey: a.key },
          to: { kind: 'player' as const },
          description: 'S'.repeat(240),
          visibility: { kind: 'player' as const },
        },
      ]);
      authored.history = [
        {
          key: 'known',
          kind: 'established_fact',
          text: 'Authored past',
          occurredAt: '2026-10-11T09:00:00Z',
          actorKeys: [],
          visibility: { kind: 'player' },
        },
      ];
      authored.protagonist.knownFactKeys = ['known'];
      authored.initialKnowledge = [];
      authored.phone.messages = [];
      authored.phone.notes = Array.from({ length: 12 }, (_, i) => ({
        key: 'note_' + i,
        title: 'NOTE',
        text: 'T'.repeat(1600),
        factKeys: ['known'],
      }));
      const work = await works.create(staff, {
        commandId: randomUUID(),
        title: authored.work.title,
        content: authored,
      });
      const result = await trials.startTrial(staff, work.id, {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: work.draft.contentHash,
      });
      const row = (
        await admin.query(
          'SELECT opening,octet_length(opening::text) AS bytes FROM parallel_life.world_builds WHERE seed_id=$1',
          [result.seedId],
        )
      ).rows[0];
      assert.ok(row.bytes > 32768 && row.bytes < 65536);
      assert.equal(row.opening.notes.length, 12);
      assert.equal(row.opening.notes[11].text.length, 1600);
      assert.equal(row.opening.contacts.length, 12);
      const legacy = new OfficialLifeRepository(app, {
        list: () => OFFICIAL_LIFE_PACKS,
        get: (id) => OFFICIAL_LIFE_PACKS.find((p) => p.card.id === id),
      });
      const old = await legacy.start(owner, 'only-child', {
        commandId: randomUUID(),
        version: OFFICIAL_LIFE_PACKS.find((p) => p.card.id === 'only-child')!.card.version,
      });
      const before = (
        await admin.query('SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1', [
          old.seedId,
        ])
      ).rows[0].opening;
      for (const opening of [
        { setting: 'X'.repeat(32768) },
        { kind: 'other', schemaVersion: 1, setting: 'X'.repeat(32768) },
        { kind: 'publication_opening', schemaVersion: 2, setting: 'X'.repeat(32768) },
        { kind: 'publication_opening', schemaVersion: 1, setting: 'X'.repeat(65536) },
      ])
        await assert.rejects(
          admin.query('UPDATE parallel_life.world_builds SET opening=$1 WHERE seed_id=$2', [
            opening,
            old.seedId,
          ]),
          (e) => (e as { code: string }).code === '23514',
        );
      assert.deepEqual(
        (
          await admin.query('SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1', [
            old.seedId,
          ])
        ).rows[0].opening,
        before,
      );
    },
  );
  await t.test(
    'same command replay and new command resume exact instance without compiling again',
    async () => {
      const commandId = randomUUID(),
        p = await worlds.startPublished(owner, w.id, { commandId, publicationVersion: 1 });
      const r = await worlds.startPublished(owner, w.id, { commandId, publicationVersion: 1 });
      assert.equal(p.worldId, first.worldId);
      assert.equal(p.resumed, true);
      assert.equal(r.replayed, true);
      assert.equal(r.worldId, p.worldId);
      await assert.rejects(
        worlds.startPublished(owner, w.id, { commandId, publicationVersion: 2 }),
        isCode('IDEMPOTENCY_CONFLICT'),
      );
    },
  );
  await t.test(
    'two player owners have independent actors/worlds/seed IDs and only own catalog link',
    async () => {
      const p = await worlds.startPublished(otherOwner, w.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      });
      assert.notEqual(p.worldId, first.worldId);
      assert.notEqual(p.seedId, first.seedId);
      const a = await new PostgresWorldRepository(app).get({ userId: owner }, first.worldId),
        b = await new PostgresWorldRepository(app).get({ userId: otherOwner }, p.worldId);
      assert.notDeepEqual(
        a.actors.map((x) => x.id),
        b.actors.map((x) => x.id),
      );
      await assert.rejects(
        new PostgresWorldRepository(app).get({ userId: otherOwner }, first.worldId),
      );
      assert.equal(
        (await catalogAll(owner)).works.find((x) => x.id === w.id)!.worldId,
        first.worldId,
      );
      assert.equal(
        (await catalogAll(otherOwner)).works.find((x) => x.id === w.id)!.worldId,
        p.worldId,
      );
    },
  );
  await t.test(
    'concurrent starts create exactly one owner/version instance and distinct receipts',
    async () => {
      const newOwner = randomUUID();
      await new IdentityRepository(app).ensureGuest(newOwner);
      const before = await counts();
      const r = await Promise.all([
        worlds.startPublished(newOwner, w.id, { commandId: randomUUID(), publicationVersion: 1 }),
        worlds.startPublished(newOwner, w.id, { commandId: randomUUID(), publicationVersion: 1 }),
      ]);
      assert.equal(r[0].worldId, r[1].worldId);
      assert.equal((await counts()).worlds, before.worlds + 1);
    },
  );
  await t.test(
    'exact private draft trial creates independent identity, no profile/interview and no public instance',
    async () => {
      trial = await trials.startTrial(staff, w.id, {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: hash,
      });
      assert.equal(trial.origin.publicationVersion, 0);
      assert.ok(trial.trialId);
      assert.notEqual(trial.worldId, first.worldId);
      const b = (
        await admin.query('SELECT * FROM parallel_life.publication_world_bindings WHERE id=$1', [
          trial.trialId,
        ])
      ).rows[0];
      assert.notEqual(b.owner_id, owner);
      assert.match(b.owner_id, /^[a-f0-9-]{36}$/);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.profiles WHERE owner_id=$1',
            [b.owner_id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.interviews WHERE owner_id=$1',
            [b.owner_id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query('SELECT paused FROM parallel_life.world_clock WHERE world_id=$1', [
            trial.worldId,
          ])
        ).rows[0].paused,
        true,
      );
      assert.equal((await trials.getTrial(staff, trial.trialId!)).worldId, trial.worldId);
      await assert.rejects(trials.getTrial(otherStaff, trial.trialId!), isCode('NOT_FOUND'));
      await assert.rejects(new PostgresWorldRepository(app).get({ userId: owner }, trial.worldId));
    },
  );
  await t.test(
    'genesis history and version zero never count as actual trial evidence',
    async () => {
      assert.deepEqual(await trials.trialEvidence(staff, w.id, 0, hash), {
        verified: false,
        receiptId: null,
      });
      assert.deepEqual(await trials.trialEvidence(otherStaff, w.id, 0, hash), {
        verified: false,
        receiptId: null,
      });
    },
  );
  await t.test(
    'real committed assistant projection with same owner/world/source event yields exact evidence',
    async () => {
      const b = (
          await admin.query('SELECT * FROM parallel_life.publication_world_bindings WHERE id=$1', [
            trial.trialId,
          ])
        ).rows[0],
        state = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [trial.worldId],
          )
        ).rows[0].state;
      const authorized = await trials.trialSession(staff, trial.trialId!);
      assert.equal(authorized.ownerId, b.owner_id);
      const session = { userId: authorized.ownerId },
        command = {
          id: randomUUID(),
          worldId: trial.worldId,
          actorId: state.actors[0].id,
          expectedVersion: 0,
          text: '仅本地明确合成验证',
        };
      await new PostgresWorldRepository(app).commit(session, command, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: trial.worldId,
        version: 1,
        commandId: command.id,
        occurredAt: new Date(state.time).toISOString(),
        type: 'turn.resolved',
        data: {
          actorId: command.actorId,
          userText: command.text,
          effects: [
            {
              type: 'message.received',
              id: randomUUID(),
              actorId: command.actorId,
              text: '本地合成回复，不代表供应商验收',
            },
          ],
        },
      });
      assert.deepEqual(await trials.trialEvidence(staff, w.id, 0, hash), {
        verified: true,
        receiptId: trial.trialId,
      });
      assert.deepEqual(await trials.trialEvidence(staff, w.id, 0, 'f'.repeat(64)), {
        verified: false,
        receiptId: null,
      });
    },
  );
  await t.test(
    'assistant role and exact committed event source are required, not just a nonempty message',
    async () => {
      const row = (
        await admin.query(
          `SELECT m.id,m.document FROM parallel_life.world_messages m JOIN parallel_life.world_events e ON e.id=m.document->>'sourceEventId' AND e.world_id=m.world_id WHERE m.world_id=$1 AND m.document->>'role'='assistant'`,
          [trial.worldId],
        )
      ).rows[0];
      assert.ok(row);
      try {
        for (const document of [
          { ...row.document, role: 'user' },
          { ...row.document, sourceEventId: 'publication-genesis:' + trial.worldId },
          { ...row.document, sourceEventId: 'wrong-world-event' },
        ]) {
          await admin.query('UPDATE parallel_life.world_messages SET document=$1 WHERE id=$2', [
            document,
            row.id,
          ]);
          assert.deepEqual(await trials.trialEvidence(staff, w.id, 0, hash), {
            verified: false,
            receiptId: null,
          });
        }
      } finally {
        await admin.query('UPDATE parallel_life.world_messages SET document=$1 WHERE id=$2', [
          row.document,
          row.id,
        ]);
      }
      assert.deepEqual(await trials.trialEvidence(staff, w.id, 0, hash), {
        verified: true,
        receiptId: trial.trialId,
      });
    },
  );
  await t.test(
    'revocation blocks trial read, evidence and receipt replay immediately',
    async () => {
      const commandId = randomUUID();
      await trials.startTrial(staff, w.id, { commandId, draftVersion: 0, contentHash: hash });
      await admin.query('UPDATE parallel_life.publisher_principals SET active=false WHERE id=$1', [
        staff,
      ]);
      try {
        await assert.rejects(trials.getTrial(staff, trial.trialId!), isCode('FORBIDDEN'));
        await assert.rejects(trials.trialEvidence(staff, w.id, 0, hash), isCode('FORBIDDEN'));
        await assert.rejects(
          trials.startTrial(staff, w.id, { commandId, draftVersion: 0, contentHash: hash }),
          isCode('FORBIDDEN'),
        );
      } finally {
        await admin.query('UPDATE parallel_life.publisher_principals SET active=true WHERE id=$1', [
          staff,
        ]);
      }
    },
  );
  await t.test('wrong saved draft/hash and old publication pointer cannot start', async () => {
    await assert.rejects(
      trials.startTrial(staff, w.id, {
        commandId: randomUUID(),
        draftVersion: 1,
        contentHash: hash,
      }),
      isCode('VERSION_CONFLICT'),
    );
    await assert.rejects(
      trials.startTrial(staff, w.id, {
        commandId: randomUUID(),
        draftVersion: 0,
        contentHash: 'f'.repeat(64),
      }),
      isCode('VERSION_CONFLICT'),
    );
    await assert.rejects(
      worlds.startPublished(owner, w.id, { commandId: randomUUID(), publicationVersion: 2 }),
      isCode('VERSION_CONFLICT'),
    );
  });
  await t.test(
    'unsupported/invalid compiler and default absent compiler rollback with no ticket or world debris',
    async () => {
      const { w: other } = await make(),
        before = await counts();
      await assert.rejects(
        new PublicationWorldRepository(app).startPublished(owner, other.id, {
          commandId: randomUUID(),
          publicationVersion: 1,
        }),
        isCode('UNAVAILABLE'),
      );
      await assert.rejects(
        new PublicationWorldRepository(app, {
          prepare() {
            return { status: 'unsupported', capabilities: [] };
          },
        }).startPublished(owner, other.id, { commandId: randomUUID(), publicationVersion: 1 }),
        isCode('INVALID_STATE'),
      );
      assert.deepEqual(await counts(), before);
    },
  );
  await t.test(
    'tampered runtime identity, version, private fields, origin and source reject before commit',
    async () => {
      const { w: other } = await make();
      for (const mutate of [
        (r: any) => (r.world.ownerId = otherOwner),
        (r: any) => (r.world.version = 1),
        (r: any) => (r.world.privateInterview = 'PRIVATE'),
        (r: any) => (r.seed.source.contentHash = 'f'.repeat(64)),
        (r: any) => (r.opening.hiddenContext = 'PRIVATE'),
        (r: any) => r.world.messages[0] && (r.world.messages[0].sourceEventId = 'fake'),
      ]) {
        const before = await counts();
        const bad = new PublicationWorldRepository(app, {
          async prepare(i) {
            const r = await compiler.prepare(i);
            mutate(r);
            return r;
          },
        });
        await assert.rejects(
          bad.startPublished(owner, other.id, { commandId: randomUUID(), publicationVersion: 1 }),
          isCode('INVALID_STATE'),
        );
        assert.deepEqual(await counts(), before);
      }
    },
  );
  await t.test(
    'direct guessed ticket and prepare without consume cannot create a bound world',
    async () => {
      const before = await counts();
      await assert.rejects(
        app.transaction(owner, (s) =>
          s.query('SELECT parallel_life.publication_commit_published($1,$2)', [randomUUID(), {}]),
        ),
        (e) => (e as { code: string }).code === '42501',
      );
      const { w: other } = await make();
      await assert.rejects(
        app.transaction(owner, (s) =>
          s.query('SELECT parallel_life.publication_admit_published($1,1,$2)', [
            other.id,
            randomUUID(),
          ]),
        ),
        (e) => (e as { code: string }).code === '23514',
      );
      assert.deepEqual(await counts(), before);
    },
  );
  await t.test(
    'admission cannot be consumed by another owner even in the same backend transaction',
    async () => {
      const { w: other } = await make(),
        before = await counts();
      await assert.rejects(
        app.transaction(owner, async (sql) => {
          const a = (
            await sql.query('SELECT parallel_life.publication_admit_published($1,1,$2) AS a', [
              other.id,
              randomUUID(),
            ])
          ).rows[0].a;
          const prepared = await compiler.prepare({
            content: a.content,
            origin: a.origin,
            originKind: a.originKind,
            worldId: a.worldId,
            ownerId: a.ownerId,
            seedId: a.seedId,
          });
          await sql.query("SELECT set_config('app.user_id',$1,true)", [otherOwner]);
          await sql.query('SELECT parallel_life.publication_commit_published($1,$2)', [
            a.ticket,
            prepared,
          ]);
        }),
        (e) => (e as { code: string }).code === '42501',
      );
      assert.deepEqual(await counts(), before);
    },
  );
  await t.test(
    'all bridge helper functions have exact app/staff/private grants and workers none',
    async () => {
      const appOnly = [
        'publication_admit_published',
        'publication_commit_published',
        'publication_player_catalog',
      ];
      const staffOnly = [
        'publication_admit_trial',
        'publication_commit_trial',
        'publication_get_trial',
        'publication_trial_evidence',
        'publication_trial_session',
      ];
      const names = [
        ...appOnly,
        ...staffOnly,
        'publication_admit_internal',
        'publication_commit_internal',
        'publication_binding_result',
        'publication_bridge_immutable',
        'publication_admission_consumed',
        'publication_seed_binding',
      ];
      const rows = (
        await admin.query(
          `SELECT proname,has_function_privilege('pl_app',oid,'EXECUTE') app,has_function_privilege('pl_worker',oid,'EXECUTE') worker,has_function_privilege('pl_publisher',oid,'EXECUTE') staff,proconfig FROM pg_proc WHERE pronamespace='parallel_life'::regnamespace AND proname=ANY($1)`,
          [names],
        )
      ).rows;
      assert.equal(rows.length, names.length);
      for (const row of rows) {
        assert.equal(row.app, appOnly.includes(row.proname));
        assert.equal(row.staff, staffOnly.includes(row.proname));
        assert.equal(row.worker, false);
        assert.deepEqual(row.proconfig, ['search_path=pg_catalog']);
      }
    },
  );
  await t.test(
    'direct fake profile-free publication seed rejected by deferred binding constraint',
    async () => {
      await assert.rejects(
        app.transaction(owner, async (s) => {
          await s.query(
            'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,NULL,$3,$4,$5)',
            [
              randomUUID(),
              owner,
              randomUUID(),
              'a'.repeat(64),
              { source: { kind: 'published_work', ...first.origin } },
            ],
          );
        }),
        (e) => (e as { code: string }).code === '23514',
      );
    },
  );
  await t.test(
    'downlisting blocks new admission while preserving old save and trial isolation',
    async () => {
      await works.unpublish(staff, w.id, { commandId: randomUUID(), expectedMetadataVersion: 1 });
      const savedCard = (await catalogAll(owner)).works.find((x) => x.id === w.id);
      assert.ok(savedCard);
      assert.equal(savedCard.version, 1);
      assert.equal(savedCard.worldId, first.worldId);
      const noSaveOwner = randomUUID();
      await new IdentityRepository(app).ensureGuest(noSaveOwner);
      assert.equal(
        (await catalogAll(noSaveOwner)).works.some((x) => x.id === w.id),
        false,
      );
      await assert.rejects(
        worlds.startPublished(owner, w.id, { commandId: randomUUID(), publicationVersion: 1 }),
        isCode('VERSION_CONFLICT'),
      );
      assert.equal(
        (await new PostgresWorldRepository(app).get({ userId: owner }, first.worldId)).id,
        first.worldId,
      );
      assert.equal((await trials.getTrial(staff, trial.trialId!)).worldId, trial.worldId);
    },
  );
  await t.test(
    'admission holds work lock so concurrent downlisting waits for atomic commit',
    async () => {
      const { w: other } = await make();
      let entered!: () => void, release!: () => void;
      const ready = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      const blocked = new PublicationWorldRepository(app, {
        async prepare(i) {
          entered();
          await gate;
          return compiler.prepare(i);
        },
      });
      const start = blocked.startPublished(owner, other.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      });
      await ready;
      let downDone = false;
      const down = works
        .unpublish(staff, other.id, { commandId: randomUUID(), expectedMetadataVersion: 1 })
        .then((r) => {
          downDone = true;
          return r;
        });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(downDone, false);
      release();
      const result = await start;
      await down;
      assert.equal(
        (await new PostgresWorldRepository(app).get({ userId: owner }, result.worldId)).id,
        result.worldId,
      );
      await assert.rejects(
        worlds.startPublished(otherOwner, other.id, {
          commandId: randomUUID(),
          publicationVersion: 1,
        }),
        isCode('VERSION_CONFLICT'),
      );
    },
  );
  await t.test(
    'late clock insert failure rolls back world, seed, baseline, build, binding and receipt',
    async () => {
      const { w: other } = await make(),
        before = await counts();
      await admin.query(
        `CREATE FUNCTION parallel_life.publication_fixture_clock_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_INJECTED_LATE_FAILURE'; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER publication_fixture_clock_failure BEFORE INSERT ON parallel_life.world_clock FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_fixture_clock_failure()`,
      );
      try {
        await assert.rejects(
          worlds.startPublished(owner, other.id, {
            commandId: randomUUID(),
            publicationVersion: 1,
          }),
          isCode('UNAVAILABLE'),
        );
        const saved = await works.get(staff, other.id);
        await assert.rejects(
          trials.startTrial(staff, other.id, {
            commandId: randomUUID(),
            draftVersion: 0,
            contentHash: saved.draft.contentHash,
          }),
          isCode('UNAVAILABLE'),
        );
        assert.deepEqual(await counts(), before);
      } finally {
        await admin.query(
          'DROP TRIGGER publication_fixture_clock_failure ON parallel_life.world_clock',
        );
        await admin.query('DROP FUNCTION parallel_life.publication_fixture_clock_failure()');
      }
    },
  );
  await t.test(
    'internal trial session requires current permission and exact own trial binding',
    async () => {
      const session = await trials.trialSession(staff, trial.trialId!);
      assert.equal(session.worldId, trial.worldId);
      assert.equal(Object.hasOwn(await trials.getTrial(staff, trial.trialId!), 'ownerId'), false);
      await assert.rejects(trials.trialSession(otherStaff, trial.trialId!), isCode('NOT_FOUND'));
      await assert.rejects(
        new PublicationWorldRepository(app, compiler).trialSession(staff, trial.trialId!),
        isCode('FORBIDDEN'),
      );
      await assert.rejects(trials.trialSession(staff, first.worldId), isCode('NOT_FOUND'));
    },
  );
  await t.test(
    'actual compiler private facts honor explicit initial knowledge rather than history participation',
    async () => {
      const state = (
        await admin.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [first.worldId],
        )
      ).rows[0].state;
      const opening = (
        await admin.query('SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1', [
          first.seedId,
        ])
      ).rows[0].opening;
      const informed = opening.contacts.find(
        (a: { actorKey: string }) => a.actorKey === c.actors[0]!.key,
      ).actorId;
      const uninformed = opening.contacts.find(
        (a: { actorKey: string }) => a.actorKey === c.actors[1]!.key,
      ).actorId;
      assert.deepEqual(
        actorContext(state, informed)
          .facts.map((f) => f.text)
          .sort(),
        ['PRIVATE_FIRST_ONLY', 'PUBLIC_HISTORY_ONLY_FIRST_KNOWS'].sort(),
      );
      assert.deepEqual(actorContext(state, uninformed).facts, []);
      for (const actor of state.actors) {
        const ctx = actorContext(state, actor.id);
        assert.ok(
          ctx.facts.every(
            (f) => f.visibility.kind === 'actors' && f.visibility.actorIds.includes(actor.id),
          ),
        );
        assert.equal(ctx.actor.id, actor.id);
      }
    },
  );
  await t.test(
    'publication bindings, seed origin and original baseline remain immutable',
    async () => {
      for (const query of [
        'UPDATE parallel_life.publication_world_bindings SET content_hash=$1 WHERE world_id=$2',
        'DELETE FROM parallel_life.publication_world_bindings WHERE content_hash=$1 AND world_id=$2',
      ])
        await assert.rejects(
          admin.query(query, [hash, first.worldId]).then((r) => {
            if (r.rowCount === 0) throw Error('fixture not changed');
          }),
          (e) => (e as { code: string }).code === '23514',
        );
      await assert.rejects(
        admin.query('UPDATE parallel_life.world_initial_snapshots SET state=$1 WHERE world_id=$2', [
          {},
          first.worldId,
        ]),
        (e) => (e as { code: string }).code === '23514',
      );
    },
  );
  await t.test(
    'publication art binds exact immutable version without leaking Persona or other-owner media',
    async () => {
      const visual = await content();
      visual.media = PUBLICATION_ART.filter((a) => a.key === 'cover' || a.key === 'qingqing').map(
        (a) => ({
          key: a.key,
          asset: { namespace: 'publication', key: a.key, revision: a.revision },
          use: a.uses[0]!,
          depiction: 'generated_image' as const,
          label: a.label,
          visibility: { kind: 'world' as const },
        }),
      );
      visual.work.coverMediaKey = 'cover';
      visual.actors[0]!.publicCard.avatarMediaKey = 'qingqing';
      const v = await make(visual),
        entry = await worlds.startPublished(owner, v.w.id, {
          commandId: randomUUID(),
          publicationVersion: 1,
        });
      const read = (user: string) =>
        app.transaction(user, (s) =>
          s.query('SELECT parallel_life.publication_world_visuals($1) AS v', [entry.worldId]),
        );
      const own = (await read(owner)).rows[0].v;
      assert.equal(own.actors[0].actorKey, visual.actors[0]!.key);
      assert.ok(!JSON.stringify(own).includes('PRIVATE_'));
      assert.ok(!JSON.stringify(own).includes('privatePersona'));
      assert.equal((await read(otherOwner)).rows[0].v, null);
      const phone = await new BuildRepository(app).phone(owner, entry.worldId);
      assert.equal(phone.actors[0]!.publicationActorKey, visual.actors[0]!.key);
      assert.equal(
        phone.publicationWallpaperUrl,
        PUBLICATION_ART.find((a) => a.key === 'cover')!.url,
      );
      assert.equal(
        phone.actors[0]!.publicationAvatarUrl,
        PUBLICATION_ART.find((a) => a.key === 'qingqing')!.url,
      );
      await assert.rejects(new BuildRepository(app).phone(otherOwner, entry.worldId));
      await works.unpublish(staff, v.w.id, { commandId: randomUUID(), expectedMetadataVersion: 1 });
      const card = (user: string) =>
        app.transaction(user, (s) =>
          s.query('SELECT parallel_life.publication_catalog_visual($1,1) AS v', [v.w.id]),
        );
      assert.equal((await card(owner)).rows[0].v.asset.key, 'cover');
      assert.equal((await card(otherOwner)).rows[0].v, null);
      assert.equal((await read(owner)).rows[0].v.coverMediaKey, 'cover');
      for (const role of ['pl_worker', 'pl_publisher'])
        for (const fn of [
          'parallel_life.publication_world_visuals(text)',
          'parallel_life.publication_catalog_visual(uuid,bigint)',
        ])
          assert.equal(
            (await admin.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok", [role, fn]))
              .rows[0].ok,
            false,
          );
    },
  );
  await t.test(
    'old forty-two migration checksums and official start remain compatible',
    async () => {
      const legacy = new OfficialLifeRepository(app, {
        list: () => OFFICIAL_LIFE_PACKS,
        get: (id) => OFFICIAL_LIFE_PACKS.find((p) => p.card.id === id),
      });
      const r = await legacy.start(owner, 'county-yellow-hair', {
        commandId: randomUUID(),
        version: OFFICIAL_LIFE_PACKS[0]!.card.version,
      });
      assert.notEqual(r.worldId, first.worldId);
      const { readdir } = await import('node:fs/promises');
      const { createHash } = await import('node:crypto');
      for (const name of (await readdir(new URL('../../db/migrations/', import.meta.url))).filter(
        (x) => x < '0043',
      )) {
        const raw = await readFile(new URL('../../db/migrations/' + name, import.meta.url), 'utf8');
        assert.equal(
          (await admin.query('SELECT checksum FROM public.pl_migrations WHERE name=$1', [name]))
            .rows[0].checksum,
          createHash('sha256').update(raw).digest('hex'),
        );
      }
    },
  );
});
