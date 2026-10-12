import { findPublicationCard } from './publication-catalog-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';

// Review approvals are explicit local fixtures; worlds are initialized by the real pure compiler.
// This suite calls no model, browser, upload service, shared database or production endpoint.
const localReviewId = randomUUID();
const review: PublicationReviewPort = {
  async review() {
    return {
      reviewerVersion: 'saved_catalog_local_fixture',
      runtimeCapabilities: new Set(['publication.opening.v1']),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId: localReviewId },
    };
  },
};
const compiler: PublicationWorldCompilerPort = {
  prepare(i) {
    const r = compilePublicationGenesis({
      ...i,
      originKind: i.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(r.status, 'compiled');
    if (r.status !== 'compiled') throw Error('LOCAL_CONTENT_NOT_SUPPORTED');
    return {
      world: r.world,
      opening: r.opening,
      seed: {
        id: i.seedId,
        createdAt: new Date().toISOString(),
        source: {
          kind: i.originKind === 'trial' ? 'publication_trial' : 'published_work',
          ...i.origin,
        },
        identity: r.opening.identity,
        situation: r.opening.situation,
        setting: r.opening.setting,
        experienceNote: r.opening.experienceNote,
      },
    };
  },
};
async function before45(admin: Awaited<ReturnType<typeof adminClient>>) {
  await admin.query(
    'CREATE TABLE IF NOT EXISTS public.pl_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())',
  );
  for (const name of (await readdir(new URL('../../db/migrations/', import.meta.url)))
    .filter((n) => n.endsWith('.sql') && n < '0045')
    .sort()) {
    const raw = await readFile(new URL('../../db/migrations/' + name, import.meta.url), 'utf8'),
      checksum = createHash('sha256').update(raw).digest('hex');
    const old = (
      await admin.query('SELECT checksum FROM public.pl_migrations WHERE name=$1', [name])
    ).rows[0];
    if (old) {
      assert.equal(old.checksum, checksum);
      continue;
    }
    await admin.query('BEGIN');
    try {
      await admin.query(raw);
      await admin.query('INSERT INTO public.pl_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
      await admin.query('COMMIT');
    } catch (e) {
      await admin.query('ROLLBACK');
      throw e;
    }
  }
}
test('real PG saved publication catalog keeps exact own editions without exposing downlisted works or private trials', async (t) => {
  const c = await localConfig(),
    portText = process.env.SAVED_CATALOG_TEST_PORT ?? '55479';
  assert.match(portText, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(portText) <= 65535);
  assert.equal(c.port, Number(portText));
  const admin = await adminClient('parallel_life_test'),
    resources: PostgresDatabase[] = [];
  t.after(async () => {
    for (const r of resources) await r.close();
    await admin.end();
  });
  await before45(admin);
  const app = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    worker = new PostgresDatabase(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
  resources.push(app, worker);
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_saved_catalog_fixture'")).rowCount
  )
    await admin.query(
      `CREATE ROLE pl_saved_catalog_fixture LOGIN PASSWORD '${c.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_saved_catalog_fixture');
  const pub = new PostgresDatabase(
    `postgresql://pl_saved_catalog_fixture:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  resources.push(pub);
  const staff = randomUUID(),
    owner = randomUUID(),
    other = randomUUID(),
    newPlayer = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '独立本地合成员工'],
  );
  for (const id of [owner, other, newPlayer]) await new IdentityRepository(app).ensureGuest(id);
  const works = new PublicationRepository(pub, review),
    worlds = new PublicationWorldRepository(app, compiler),
    trials = new PublicationWorldRepository(pub, compiler);
  const report = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const raw = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(report)![1]!);
  const content = (edition: number) => ({
    ...structuredClone(raw),
    work: {
      ...raw.work,
      title: '安全版本 ' + edition,
      hook: '公开引子 ' + edition,
      description: '版本 ' + edition + ' 的公开说明',
    },
    world: { ...raw.world, hiddenContext: 'PRIVATE_CONTEXT_MUST_NEVER_APPEAR_' + edition },
  });
  let work = await works.create(staff, {
    commandId: randomUUID(),
    title: '原始工作名',
    content: content(1),
  });
  const publish = async () => {
    const check = await works.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: work.draftVersion,
    });
    assert.equal(check.status, 'ready');
    await works.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: work.draftVersion,
      expectedMetadataVersion: work.metadataVersion,
      checkId: check.id,
    });
    work = await works.get(staff, work.id);
  };
  await publish();
  const first = await worlds.startPublished(owner, work.id, {
    commandId: randomUUID(),
    publicationVersion: 1,
  });
  const trial = await trials.startTrial(staff, work.id, {
    commandId: randomUUID(),
    draftVersion: 0,
    contentHash: work.draft.contentHash,
  });
  work = await works.save(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    content: content(2),
  });
  await publish();
  const secondOwner = await worlds.startPublished(other, work.id, {
    commandId: randomUUID(),
    publicationVersion: 2,
  });
  const snapshot = async () => {
    const out: Record<string, unknown> = {};
    for (const table of [
      'accounts',
      'publication_works',
      'publication_draft_revisions',
      'publication_versions',
      'publication_world_bindings',
      'publication_world_receipts',
      'worlds',
      'world_initial_snapshots',
      'approved_seeds',
      'world_builds',
      'world_clock',
      'world_events',
      'world_messages',
    ])
      out[table] = (
        await admin.query(
          `SELECT COALESCE(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) AS rows FROM (SELECT to_jsonb(t) r FROM parallel_life.${table} t) x`,
        )
      ).rows[0].rows;
    return out;
  };
  const preMigration = await snapshot();
  await migrate(admin);
  const entry = async (id: string) =>
    await findPublicationCard((input) => worlds.catalog(id, input), work.id);
  await t.test(
    'function replacement changes no source revision/world/seed/baseline/message/receipt or account',
    async () => {
      assert.deepEqual(await snapshot(), preMigration);
    },
  );
  await t.test(
    'existing owner keeps v1 card with v1 world even while v2 is publicly listed',
    async () => {
      const card = await entry(owner);
      assert.ok(card);
      assert.equal(card.version, 1);
      assert.equal(card.title, '安全版本 1');
      assert.equal(card.hook, '公开引子 1');
      assert.equal(card.description, '版本 1 的公开说明');
      assert.equal(card.worldId, first.worldId);
    },
  );
  await t.test(
    'other owner has only its own v2 binding and new player sees current v2 without a save',
    async () => {
      assert.equal((await entry(other))!.worldId, secondOwner.worldId);
      assert.equal((await entry(other))!.version, 2);
      const card = (await entry(newPlayer))!;
      assert.equal(card.version, 2);
      assert.equal(card.title, '安全版本 2');
      assert.equal(card.worldId, null);
    },
  );
  await t.test(
    'catalog row exposes only the fixed eight SQL columns and safe public card fields',
    async () => {
      const row = await findPublicationCard(async ({ limit, cursor }) => {
        const result = await app.transaction(owner, (s) =>
          s.query('SELECT * FROM parallel_life.publication_player_catalog($1,$2)', [
            cursor ?? null,
            limit,
          ]),
        );
        return {
          works: result.rows.slice(0, limit),
          nextCursor: result.rows.length > limit ? result.rows[limit - 1].id : null,
        };
      }, work.id);
      assert.ok(row);
      assert.deepEqual(Object.keys(row), [
        'id',
        'version',
        'title',
        'hook',
        'identity_label',
        'experience_note',
        'description',
        'world_id',
      ]);
      const encoded = JSON.stringify(await worlds.catalog(owner));
      for (const marker of [
        'PRIVATE_CONTEXT_MUST_NEVER_APPEAR',
        'privatePersona',
        'publisher_principal',
        'contentHash',
        trial.worldId,
        trial.seedId,
      ])
        assert.equal(encoded.includes(marker), false);
    },
  );
  await t.test(
    'downlisted world stays accessible only to owners with real published saves',
    async () => {
      await works.unpublish(staff, work.id, {
        commandId: randomUUID(),
        expectedMetadataVersion: work.metadataVersion,
      });
      assert.equal((await entry(owner))!.worldId, first.worldId);
      assert.equal((await entry(owner))!.version, 1);
      assert.equal((await entry(other))!.worldId, secondOwner.worldId);
      assert.equal(await entry(newPlayer), undefined);
      assert.equal(
        (await new PostgresWorldRepository(app).get({ userId: owner }, first.worldId)).id,
        first.worldId,
      );
      await assert.rejects(
        new PostgresWorldRepository(app).get({ userId: newPlayer }, first.worldId),
      );
    },
  );
  await t.test(
    'private trial is never an eligible save even when queried under that trial owner',
    async () => {
      const session = await trials.trialSession(staff, trial.trialId!);
      assert.equal(await entry(session.ownerId), undefined);
      const id = randomUUID();
      const privateOnly = await works.create(staff, {
        commandId: randomUUID(),
        title: 'PRIVATE_UNPUBLISHED_DRAFT',
        content: content(3),
      });
      const draftTrial = await trials.startTrial(staff, privateOnly.id, {
        commandId: id,
        draftVersion: 0,
        contentHash: privateOnly.draft.contentHash,
      });
      const bound = await trials.trialSession(staff, draftTrial.trialId!);
      assert.equal(
        (await worlds.catalog(bound.ownerId)).works.some((card) => card.id === privateOnly.id),
        false,
      );
      assert.equal(
        (await worlds.catalog(newPlayer)).works.some((card) => card.id === privateOnly.id),
        false,
      );
    },
  );
  await t.test(
    'restored listing preserves an old save while a later actual new edition save becomes preferred',
    async () => {
      await works.restore(staff, work.id, {
        commandId: randomUUID(),
        expectedMetadataVersion: work.metadataVersion + 1,
        publicationVersion: 2,
      });
      assert.equal((await entry(owner))!.worldId, first.worldId);
      const newer = await worlds.startPublished(owner, work.id, {
        commandId: randomUUID(),
        publicationVersion: 2,
      });
      assert.notEqual(newer.worldId, first.worldId);
      const card = (await entry(owner))!;
      assert.equal(card.worldId, newer.worldId);
      assert.equal(card.version, 2);
      assert.equal(card.title, '安全版本 2');
      // The older instance and its immutable origin remain present, rather than becoming the new version.
      assert.equal(
        (await new PostgresWorldRepository(app).get({ userId: owner }, first.worldId)).title,
        '安全版本 1',
      );
    },
  );
  await t.test(
    'pool context cannot leak owner saves and absent/unknown owner sees listed cards only',
    async () => {
      work = await works.get(staff, work.id);
      await works.unpublish(staff, work.id, {
        commandId: randomUUID(),
        expectedMetadataVersion: work.metadataVersion,
      });
      for (const id of [owner, newPlayer, other, '', randomUUID(), owner]) {
        const card = await findPublicationCard(async ({ limit, cursor }) => {
          const result = await app.transaction(id, (s) =>
            s.query('SELECT * FROM parallel_life.publication_player_catalog($1,$2)', [
              cursor ?? null,
              limit,
            ]),
          );
          assert.ok(result.rows.every((r) => r.world_id !== trial.worldId));
          return {
            works: result.rows.slice(0, limit),
            nextCursor: result.rows.length > limit ? result.rows[limit - 1].id : null,
          };
        }, work.id);
        assert.equal(Boolean(card), id === owner || id === other);
      }
    },
  );
  await t.test(
    'pagination is stable and deduplicates listed-plus-saved works across one-row pages',
    async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const doc = content(4);
        doc.work.title = '另一作品同名';
        const next = await works.create(staff, {
          commandId: randomUUID(),
          title: '另一作品同名',
          content: doc,
        });
        const check = await works.check(staff, next.id, {
          commandId: randomUUID(),
          expectedDraftVersion: 0,
        });
        await works.publish(staff, next.id, {
          commandId: randomUUID(),
          expectedDraftVersion: 0,
          expectedMetadataVersion: 0,
          checkId: check.id,
        });
        ids.add(next.id);
      }
      ids.add(work.id);
      let cursor: string | undefined;
      const seen: string[] = [];
      do {
        const page = await worlds.catalog(owner, { limit: 1, cursor });
        seen.push(...page.works.map((x) => x.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(new Set(seen).size, seen.length);
      assert.ok([...ids].every((id) => seen.includes(id)));
      assert.deepEqual(seen, [...seen].sort());
    },
  );
  await t.test(
    'invalid limits reject and table/function privileges remain app-only with owner-scoped body',
    async () => {
      for (const limit of [null, 0, -1, 101])
        await assert.rejects(
          app.transaction(owner, (s) =>
            s.query('SELECT * FROM parallel_life.publication_player_catalog(NULL,$1)', [limit]),
          ),
          (e) => (e as { code: string }).code === '22023',
        );
      for (const db of [worker, pub])
        await assert.rejects(
          db.transaction(owner, (s) =>
            s.query('SELECT * FROM parallel_life.publication_player_catalog(NULL,10)'),
          ),
          (e) => (e as { code: string }).code === '42501',
        );
      for (const table of [
        'publication_world_bindings',
        'publication_versions',
        'publication_draft_revisions',
      ])
        await assert.rejects(
          app.transaction(owner, (s) => s.query('SELECT * FROM parallel_life.' + table)),
          (e) => (e as { code: string }).code === '42501',
        );
      const fn = (
        await admin.query(
          `SELECT proconfig,prosecdef,has_function_privilege('pl_app',oid,'EXECUTE') app,has_function_privilege('pl_publisher',oid,'EXECUTE') staff,has_function_privilege('pl_worker',oid,'EXECUTE') worker FROM pg_proc WHERE oid='parallel_life.publication_player_catalog(uuid,integer)'::regprocedure`,
        )
      ).rows[0];
      assert.deepEqual(fn, {
        proconfig: ['search_path=pg_catalog'],
        prosecdef: true,
        app: true,
        staff: false,
        worker: false,
      });
    },
  );
});
