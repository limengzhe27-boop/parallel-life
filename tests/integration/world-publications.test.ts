import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { OFFICIAL_LIFE_PACKS } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  PublicationRepository,
  type PublicationReviewPort,
} from '../../src/modules/settings/infrastructure/publication-repository.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';

async function completeContent() {
  const r = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  return PublishedWorldContentSchema.parse(JSON.parse(/```json\n([\s\S]*?)\n```/.exec(r)![1]!));
}
async function before42(admin: Awaited<ReturnType<typeof adminClient>>) {
  await admin.query(
    'CREATE TABLE IF NOT EXISTS public.pl_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())',
  );
  for (const name of (await readdir(new URL('../../db/migrations/', import.meta.url)))
    .filter((n) => n.endsWith('.sql') && !n.startsWith('0042'))
    .sort()) {
    const sql = await readFile(new URL('../../db/migrations/' + name, import.meta.url), 'utf8'),
      hash = createHash('sha256').update(sql).digest('hex');
    const old = (
      await admin.query('SELECT checksum FROM public.pl_migrations WHERE name=$1', [name])
    ).rows[0];
    if (old) {
      assert.equal(old.checksum, hash);
      continue;
    }
    await admin.query('BEGIN');
    try {
      await admin.query(sql);
      await admin.query('INSERT INTO public.pl_migrations(name,checksum) VALUES($1,$2)', [
        name,
        hash,
      ]);
      await admin.query('COMMIT');
    } catch (e) {
      await admin.query('ROLLBACK');
      throw e;
    }
  }
}
class SyntheticReview implements PublicationReviewPort {
  media = true;
  trial = true;
  runtime = true;
  manifest = 'a'.repeat(64);
  receipt = randomUUID();
  throwing = false;
  onReview: (() => Promise<void>) | undefined;
  async review({ content }: Parameters<PublicationReviewPort['review']>[0]) {
    if (this.onReview) await this.onReview();
    if (this.throwing) throw Error('PRIVATE_UPSTREAM_ERROR_MUST_NOT_LEAK');
    return {
      reviewerVersion: 'synthetic_pg_fixture_v1',
      runtimeCapabilities: new Set(
        this.runtime ? inspectPublishedWorldSupport(content).requiredCapabilities : [],
      ),
      media: { verified: this.media, manifestHash: this.media ? this.manifest : null },
      trial: { verified: this.trial, receiptId: this.trial ? this.receipt : null },
    };
  }
}
test('real PostgreSQL isolated staff publication workspace, role boundaries and atomic history', async (t) => {
  const config = await localConfig();
  const portText = process.env.PUBLISHER_TEST_PORT ?? '55477';
  assert.match(portText, /^[1-9][0-9]{0,4}$/, 'Explicit local test port must be an integer');
  const port = Number(portText);
  assert.ok(Number.isSafeInteger(port) && port <= 65535, 'Explicit local test port is invalid');
  assert.equal(config.port, port, 'Use only explicitly owned local test port');
  // adminClient fixes the loopback host and this dedicated database; never use DATABASE_URL.
  const admin = await adminClient('parallel_life_test');
  const resources: PostgresDatabase[] = [];
  t.after(async () => {
    for (const resource of resources) await resource.close();
    await admin.end();
  });
  await before42(admin);
  const app = new PostgresDatabase(
      `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    ),
    worker = new PostgresDatabase(
      `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    );
  resources.push(app, worker);
  const legacyOwner = randomUUID();
  await new IdentityRepository(app).ensureGuest(legacyOwner);
  const oldCatalog = {
    list: () => OFFICIAL_LIFE_PACKS,
    get: (id: string) => OFFICIAL_LIFE_PACKS.find((p) => p.card.id === id),
  };
  const old = await new OfficialLifeRepository(app, oldCatalog).start(
    legacyOwner,
    'county-yellow-hair',
    { commandId: randomUUID(), version: OFFICIAL_LIFE_PACKS[0]!.card.version },
  );
  const oldRead = async () => ({
    world: (await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [old.worldId]))
      .rows[0],
    initial: (
      await admin.query(
        'SELECT state,approved_seed FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
        [old.worldId],
      )
    ).rows[0],
    instances: (
      await admin.query(
        'SELECT * FROM parallel_life.official_life_instances WHERE owner_id=$1 ORDER BY preset_id,content_version',
        [legacyOwner],
      )
    ).rows,
  });
  const legacyBefore = await oldRead(),
    oldChecks = (
      await admin.query(
        "SELECT name,checksum FROM public.pl_migrations WHERE name<'0042' ORDER BY name",
      )
    ).rows;
  assert.equal(oldChecks.length, 41);
  await migrate(admin);
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_publication_fixture'")).rowCount
  )
    await admin.query(
      `CREATE ROLE pl_publication_fixture LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_publication_fixture');
  const db = new PostgresDatabase(
      `postgresql://pl_publication_fixture:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    ),
    editor = randomUUID(),
    publisher = randomUUID(),
    both = randomUUID(),
    disabled = randomUUID();
  resources.push(db);
  for (const [id, canEdit, canPublish, active] of [
    [editor, true, false, true],
    [publisher, false, true, true],
    [both, true, true, true],
    [disabled, true, true, false],
  ] as const)
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,$3,$4,$5)',
      [id, '本地合成员工', canEdit, canPublish, active],
    );
  const gate = new SyntheticReview(),
    repo = new PublicationRepository(db, gate),
    unavailable = new PublicationRepository(db),
    valid = await completeContent();
  const created: string[] = [];
  const make = async (content: Record<string, unknown> = valid) => {
    const w = await repo.create(editor, { commandId: randomUUID(), title: '内部工作名', content });
    created.push(w.id);
    return w;
  };
  const ready = async (id: string, p = publisher) =>
    repo.check(p, id, {
      commandId: randomUUID(),
      expectedDraftVersion: (await repo.get(p, id)).draftVersion,
    });
  const publish = async (id: string, p = publisher) => {
    const w = await repo.get(p, id),
      check = await ready(id, p);
    assert.equal(
      check.status,
      'ready',
      'Synthetic trusted proof is a fixture, not production support',
    );
    return repo.publish(p, id, {
      commandId: randomUUID(),
      expectedDraftVersion: w.draftVersion,
      expectedMetadataVersion: w.metadataVersion,
      checkId: check.id,
    });
  };
  try {
    await t.test(
      'current principal is self-scoped, inactive or absent is null and pooled contexts do not leak',
      async () => {
        assert.deepEqual(await repo.getPrincipal(editor), {
          id: editor,
          displayName: '本地合成员工',
          canEdit: true,
          canPublish: false,
          active: true,
        });
        assert.equal((await repo.getPrincipal(publisher))!.canPublish, true);
        assert.equal(await repo.getPrincipal(disabled), null);
        assert.equal(await repo.getPrincipal(randomUUID()), null);
        await admin.query(
          'UPDATE parallel_life.publisher_principals SET can_edit=false WHERE id=$1',
          [editor],
        );
        assert.equal((await repo.getPrincipal(editor))!.canEdit, false);
        await admin.query(
          'UPDATE parallel_life.publisher_principals SET can_edit=true WHERE id=$1',
          [editor],
        );
        await assert.rejects(new PublicationRepository(app).getPrincipal(editor), {
          code: 'FORBIDDEN',
        });
      },
    );
    await t.test(
      'guest forged principal and worker cannot read staff raw tables or execute internal functions',
      async () => {
        const w = await make({});
        await assert.rejects(new PublicationRepository(app).get(editor, w.id), {
          code: 'FORBIDDEN',
        });
        await assert.rejects(new PublicationRepository(worker).get(editor, w.id), {
          code: 'FORBIDDEN',
        });
        for (const connection of [app, worker])
          for (const table of [
            'publisher_principals',
            'publication_works',
            'publication_draft_revisions',
            'publication_checks',
            'publication_versions',
            'publication_receipts',
            'publisher_login_buckets',
          ])
            await assert.rejects(
              connection.transaction(legacyOwner, (sql) =>
                sql.query(`SELECT * FROM parallel_life.${table}`),
              ),
              { code: '42501' },
            );
        await assert.rejects(
          new PublicationRepository(app).consumeLoginLimit('username', 'f'.repeat(64)),
          { code: 'FORBIDDEN' },
        );
        await assert.rejects(
          db.transaction(editor, (sql) => sql.query('SELECT * FROM parallel_life.worlds')),
          { code: '42501' },
        );
      },
    );
    await t.test(
      'only edit can save, only publish can publish, inactive and missing principals are denied',
      async () => {
        const w = await make();
        await assert.rejects(
          repo.create(publisher, { commandId: randomUUID(), title: '无编辑权', content: {} }),
          { code: 'FORBIDDEN' },
        );
        await assert.rejects(repo.get(disabled, w.id), { code: 'FORBIDDEN' });
        await assert.rejects(repo.get(randomUUID(), w.id), { code: 'FORBIDDEN' });
        const check = await ready(w.id);
        await assert.rejects(
          repo.publish(editor, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: check.id,
          }),
          { code: 'FORBIDDEN' },
        );
        await assert.rejects(
          repo.save(publisher, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            content: valid,
          }),
          { code: 'FORBIDDEN' },
        );
        assert.equal((await publish(w.id)).status, 'published');
      },
    );
    await t.test(
      'incomplete/unknown drafts persist and invalid publication checks do not fabricate readiness',
      async () => {
        const w = await make({ schemaVersion: 999, futureField: { draft: true } });
        assert.deepEqual((await repo.get(publisher, w.id)).draft.content, {
          schemaVersion: 999,
          futureField: { draft: true },
        });
        const check = await ready(w.id);
        assert.equal(check.status, 'invalid');
        await assert.rejects(
          repo.publish(publisher, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: check.id,
          }),
          { code: 'INVALID_STATE' },
        );
      },
    );
    await t.test(
      'default gate has no capabilities/media/trial and cannot publish valid content',
      async () => {
        const w = await make(),
          check = await unavailable.check(publisher, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
          });
        assert.equal(check.status, 'blocked');
        assert.ok(check.missingCapabilities.includes('publication.opening.v1'));
        assert.equal(check.mediaVerified, false);
        assert.equal(check.trialVerified, false);
        await assert.rejects(
          unavailable.publish(publisher, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: check.id,
          }),
          { code: 'INVALID_STATE' },
        );
      },
    );
    await t.test(
      'media/trial missing and gate exceptions cannot become ready or leak upstream strings',
      async () => {
        const w = await make();
        for (const kind of ['media', 'trial', 'throwing'] as const) {
          if (kind === 'throwing') gate.throwing = true;
          else gate[kind] = false;
          const check = await ready(w.id);
          assert.equal(check.status, 'blocked');
          assert.doesNotMatch(JSON.stringify(check), /PRIVATE_UPSTREAM/);
          if (kind === 'throwing') gate.throwing = false;
          else gate[kind] = true;
        }
      },
    );
    await t.test(
      'team rename is a draft revision, omitted title keeps name, and old formal public title stays immutable',
      async () => {
        const w = await make(),
          pub = await publish(w.id),
          card = (await repo.publicCatalog()).works.find((x) => x.id === w.id)!;
        const before = (
          await admin.query('SELECT * FROM parallel_life.publication_versions WHERE work_id=$1', [
            w.id,
          ])
        ).rows;
        const saved = await repo.save(editor, w.id, {
          commandId: randomUUID(),
          expectedDraftVersion: 0,
          title: '团队重命名',
          content: valid,
        });
        assert.equal(saved.title, '团队重命名');
        assert.equal(saved.draftVersion, 1);
        assert.equal(saved.metadataVersion, pub.metadataVersion);
        assert.equal(
          (await repo.publicCatalog()).works.find((x) => x.id === w.id)!.title,
          card.title,
        );
        await repo.save(editor, w.id, {
          commandId: randomUUID(),
          expectedDraftVersion: 1,
          content: {},
        });
        assert.equal((await repo.get(editor, w.id)).title, '团队重命名');
        assert.deepEqual(
          (
            await admin.query('SELECT * FROM parallel_life.publication_versions WHERE work_id=$1', [
              w.id,
            ])
          ).rows,
          before,
        );
        await assert.rejects(
          repo.save(editor, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            title: '晚到改名',
            content: {},
          }),
          { code: 'VERSION_CONFLICT' },
        );
        assert.equal((await repo.get(editor, w.id, 0)).draft.version, 0);
      },
    );
    await t.test(
      'canonical idempotency includes actor/op/work; identical concurrent create replays one result',
      async () => {
        const input = { commandId: randomUUID(), title: '并发创建', content: { b: 2, a: 1 } };
        const results = await Promise.all([
          repo.create(editor, input),
          repo.create(editor, { ...input, content: { a: 1, b: 2 } }),
        ]);
        assert.equal(results[0]!.id, results[1]!.id);
        created.push(results[0]!.id);
        await assert.rejects(repo.create(editor, { ...input, title: '不同正文' }), {
          code: 'IDEMPOTENCY_CONFLICT',
        });
        const w = await make();
        await assert.rejects(
          repo.save(editor, w.id, {
            commandId: input.commandId,
            expectedDraftVersion: 0,
            content: {},
          }),
          { code: 'IDEMPOTENCY_CONFLICT' },
        );
        const another = await repo.create(both, input);
        created.push(another.id);
        assert.notEqual(another.id, results[0]!.id);
      },
    );
    await t.test(
      'concurrent save and rename have one winner and one immutable new revision',
      async () => {
        const w = await make({});
        const r = await Promise.allSettled(
          [1, 2].map((i) =>
            repo.save(editor, w.id, {
              commandId: randomUUID(),
              expectedDraftVersion: 0,
              title: '新名' + i,
              content: { i },
            }),
          ),
        );
        assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
        assert.equal(
          r.filter((x) => x.status === 'rejected' && x.reason.code === 'VERSION_CONFLICT').length,
          1,
        );
        assert.equal((await repo.get(editor, w.id)).draftVersion, 1);
      },
    );
    await t.test(
      'wrong work/revision checks cannot publish, and fresh gate changes invalidate old ready proof',
      async () => {
        const w = await make(),
          other = await make(),
          check = await ready(w.id);
        await assert.rejects(
          repo.publish(publisher, other.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: check.id,
          }),
          { code: 'NOT_FOUND' },
        );
        gate.manifest = 'b'.repeat(64);
        await assert.rejects(
          repo.publish(publisher, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: check.id,
          }),
          { code: 'INVALID_STATE' },
        );
        gate.manifest = 'a'.repeat(64);
        await repo.save(editor, w.id, {
          commandId: randomUUID(),
          expectedDraftVersion: 0,
          content: valid,
        });
        await assert.rejects(
          repo.publish(publisher, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 1,
            expectedMetadataVersion: 0,
            checkId: check.id,
          }),
          { code: 'NOT_FOUND' },
        );
      },
    );
    await t.test(
      'two publishers racing one revision/metadata have a single new immutable formal version',
      async () => {
        const w = await make(),
          check = await ready(w.id);
        const r = await Promise.allSettled(
          [1, 2].map(() =>
            repo.publish(publisher, w.id, {
              commandId: randomUUID(),
              expectedDraftVersion: 0,
              expectedMetadataVersion: 0,
              checkId: check.id,
            }),
          ),
        );
        assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
        assert.equal(
          r.filter((x) => x.status === 'rejected' && x.reason.code === 'VERSION_CONFLICT').length,
          1,
        );
        assert.equal(
          Number(
            (
              await admin.query(
                'SELECT count(*) FROM parallel_life.publication_versions WHERE work_id=$1',
                [w.id],
              )
            ).rows[0].count,
          ),
          1,
        );
      },
    );
    await t.test(
      'unpublish removes only public directory, restore old formal version does not read a new invalid draft',
      async () => {
        const w = await make(),
          pub = await publish(w.id);
        await repo.save(editor, w.id, {
          commandId: randomUUID(),
          expectedDraftVersion: 0,
          content: { schemaVersion: 999 },
        });
        const input = { commandId: randomUUID(), expectedMetadataVersion: pub.metadataVersion },
          unlisted = await repo.unpublish(publisher, w.id, input);
        assert.deepEqual(await repo.unpublish(publisher, w.id, input), unlisted);
        assert.ok(!(await repo.publicCatalog()).works.some((x) => x.id === w.id));
        const restored = await repo.restore(publisher, w.id, {
          commandId: randomUUID(),
          expectedMetadataVersion: unlisted.metadataVersion,
          publicationVersion: pub.publicationVersion,
        });
        assert.equal(restored.status, 'published');
        assert.ok((await repo.publicCatalog()).works.some((x) => x.id === w.id));
        assert.equal((await repo.get(editor, w.id)).draftVersion, 1);
        assert.equal(
          Number(
            (
              await admin.query(
                'SELECT count(*) FROM parallel_life.publication_versions WHERE work_id=$1',
                [w.id],
              )
            ).rows[0].count,
          ),
          1,
        );
      },
    );
    await t.test(
      'formal/draft/check/receipt update and delete are immutable and raw privilege cannot rename via metadata path',
      async () => {
        const w = await make(),
          pub = await publish(w.id);
        for (const table of [
          'publication_draft_revisions',
          'publication_checks',
          'publication_versions',
          'publication_receipts',
        ]) {
          await assert.rejects(
            admin.query(`UPDATE parallel_life.${table} SET work_id=work_id WHERE work_id=$1`, [
              w.id,
            ]),
            { code: '23514' },
          );
          await assert.rejects(
            admin.query(`DELETE FROM parallel_life.${table} WHERE work_id=$1`, [w.id]),
            { code: '23514' },
          );
        }
        await assert.rejects(
          db.transaction(publisher, async (sql) => {
            await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [publisher]);
            return sql.query(
              'UPDATE parallel_life.publication_works SET title=$2,metadata_version=metadata_version+1 WHERE id=$1',
              [w.id, '越权名字'],
            );
          }),
          { code: '23514' },
        );
        assert.equal((await repo.get(publisher, w.id)).metadataVersion, pub.metadataVersion);
      },
    );
    await t.test(
      'revocation is checked before success receipt replay and after long validation preparation',
      async () => {
        const w = await make(),
          check = await ready(w.id),
          input = {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: check.id,
          };
        await repo.publish(publisher, w.id, input);
        await admin.query(
          'UPDATE parallel_life.publisher_principals SET can_publish=false WHERE id=$1',
          [publisher],
        );
        await assert.rejects(repo.publish(publisher, w.id, input), { code: 'FORBIDDEN' });
        await admin.query(
          'UPDATE parallel_life.publisher_principals SET can_publish=true WHERE id=$1',
          [publisher],
        );
        const next = await make(),
          nextCheck = await ready(next.id);
        gate.onReview = async () => {
          gate.onReview = undefined;
          await admin.query(
            'UPDATE parallel_life.publisher_principals SET active=false WHERE id=$1',
            [publisher],
          );
        };
        await assert.rejects(
          repo.publish(publisher, next.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: nextCheck.id,
          }),
          { code: 'FORBIDDEN' },
        );
        await admin.query('UPDATE parallel_life.publisher_principals SET active=true WHERE id=$1', [
          publisher,
        ]);
        assert.equal((await repo.get(editor, next.id)).metadataVersion, 0);
      },
    );
    await t.test(
      'late receipt failure rolls back draft/title, formal version and public pointer',
      async () => {
        const w = await make(),
          check = await ready(w.id);
        await admin.query(
          "CREATE FUNCTION parallel_life.publication_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_LATE_FAILURE' USING ERRCODE='XX000'; END $$",
        );
        await admin.query(
          'CREATE TRIGGER publication_fixture_fail BEFORE INSERT ON parallel_life.publication_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_fixture_fail()',
        );
        try {
          await assert.rejects(
            repo.save(editor, w.id, {
              commandId: randomUUID(),
              expectedDraftVersion: 0,
              title: '不应保存',
              content: {},
            }),
            { code: 'UNAVAILABLE' },
          );
          await assert.rejects(
            repo.publish(publisher, w.id, {
              commandId: randomUUID(),
              expectedDraftVersion: 0,
              expectedMetadataVersion: 0,
              checkId: check.id,
            }),
            { code: 'UNAVAILABLE' },
          );
          const latest = await repo.get(editor, w.id);
          assert.equal(latest.draftVersion, 0);
          assert.equal(latest.title, w.title);
          assert.equal(latest.metadataVersion, 0);
          assert.equal(
            Number(
              (
                await admin.query(
                  'SELECT count(*) FROM parallel_life.publication_versions WHERE work_id=$1',
                  [w.id],
                )
              ).rows[0].count,
            ),
            0,
          );
        } finally {
          await admin.query(
            'DROP TRIGGER publication_fixture_fail ON parallel_life.publication_receipts',
          );
          await admin.query('DROP FUNCTION parallel_life.publication_fixture_fail()');
        }
      },
    );
    await t.test(
      'safe check errors are capped at 100 with truncation flag and no raw validator message',
      async () => {
        const broken = {
          ...valid,
          actors: Array.from({ length: 12 }, () => ({
            key: null,
            name: null,
            knownAtStart: null,
            publicCard: { identity: 1, traits: [1], appearance: 1, avatarMediaKey: 1 },
            privatePersona: { background: 1, motivation: 1, voice: 1, boundaries: 1 },
          })),
        };
        const w = await make(broken),
          check = await ready(w.id);
        assert.equal(check.status, 'invalid');
        assert.equal(check.issues.length, 100);
        assert.equal(check.issuesTruncated, true);
        assert.doesNotMatch(
          JSON.stringify(check),
          /Invalid input|expected string|PRIVATE_UPSTREAM/,
        );
      },
    );
    await t.test(
      'safe public directory is not limited to four and exposes no private template payload',
      async () => {
        for (let i = 0; i < 6; i++) await publish((await make()).id);
        const publicRepo = new PublicationRepository(app),
          cards = await publicRepo.publicCatalog();
        assert.ok(cards.works.length > 4);
        assert.doesNotMatch(
          JSON.stringify(cards),
          /privatePersona|hiddenContext|initialKnowledge|password|trialReceipt|contentHash/,
        );
        const first = await publicRepo.publicCatalog({ limit: 2 });
        assert.equal(first.works.length, 2);
        assert.ok(first.nextCursor);
        const second = await publicRepo.publicCatalog({ limit: 2, cursor: first.nextCursor! });
        assert.ok(second.works.every((x) => !first.works.some((a) => a.id === x.id)));
      },
    );
    await t.test(
      'login buckets enforce fixed limits atomically, hide raw tables and reset only an expired window',
      async () => {
        for (const [kind, max] of [
          ['global', 60],
          ['client', 10],
          ['username', 6],
        ] as const) {
          const key = createHash('sha256').update(randomUUID()).digest('hex');
          const r = await Promise.all(
            Array.from({ length: max + 2 }, () => repo.consumeLoginLimit(kind, key)),
          );
          assert.equal(r.filter((x) => x.allowed).length, max);
          assert.ok(r.filter((x) => !x.allowed).every((x) => x.retryAfterSeconds > 0));
          await admin.query(
            "UPDATE parallel_life.publisher_login_buckets SET window_started_at=now()-interval '1 hour' WHERE kind=$1 AND bucket_hash=$2",
            [kind, key],
          );
          assert.equal((await repo.consumeLoginLimit(kind, key)).allowed, true);
        }
        await assert.rejects(
          db.transaction('', (sql) =>
            sql.query('SELECT * FROM parallel_life.publisher_login_buckets'),
          ),
          { code: '42501' },
        );
        await assert.rejects(repo.consumeLoginLimit('client', 'not-a-hash'), {
          code: 'INVALID_INPUT',
        });
      },
    );
    await t.test(
      'null-prototype inert drafts roundtrip and staff cannot self-grant permissions',
      async () => {
        const array = Object.setPrototypeOf([1, true, null], null);
        const raw = Object.assign(Object.create(null), { array, text: '仅私有草稿' });
        const w = await make(raw);
        assert.deepEqual((await repo.get(editor, w.id)).draft.content, {
          array: [1, true, null],
          text: '仅私有草稿',
        });
        await assert.rejects(
          db.transaction(editor, async (sql) => {
            await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [editor]);
            return sql.query(
              'UPDATE parallel_life.publisher_principals SET can_publish=true WHERE id=$1',
              [editor],
            );
          }),
          { code: '42501' },
        );
      },
    );
    await t.test(
      'runtime support can be revoked after a ready check and restore cannot bypass an unavailable gate',
      async () => {
        const w = await make(),
          check = await ready(w.id);
        gate.runtime = false;
        await assert.rejects(
          repo.publish(publisher, w.id, {
            commandId: randomUUID(),
            expectedDraftVersion: 0,
            expectedMetadataVersion: 0,
            checkId: check.id,
          }),
          { code: 'INVALID_STATE' },
        );
        gate.runtime = true;
        const pub = await publish(w.id),
          down = await repo.unpublish(publisher, w.id, {
            commandId: randomUUID(),
            expectedMetadataVersion: pub.metadataVersion,
          });
        await assert.rejects(
          unavailable.restore(publisher, w.id, {
            commandId: randomUUID(),
            expectedMetadataVersion: down.metadataVersion,
            publicationVersion: pub.publicationVersion,
          }),
          { code: 'INVALID_STATE' },
        );
        assert.equal((await repo.get(editor, w.id)).status, 'unpublished');
      },
    );
    await t.test(
      'stale metadata, unknown restoration and unsafe public catalog limits reject',
      async () => {
        const w = await make(),
          pub = await publish(w.id);
        await assert.rejects(
          repo.unpublish(publisher, w.id, { commandId: randomUUID(), expectedMetadataVersion: 0 }),
          { code: 'VERSION_CONFLICT' },
        );
        await assert.rejects(
          repo.restore(publisher, w.id, {
            commandId: randomUUID(),
            expectedMetadataVersion: pub.metadataVersion,
            publicationVersion: 99,
          }),
          { code: 'NOT_FOUND' },
        );
        await assert.rejects(
          app.transaction('', (sql) =>
            sql.query('SELECT * FROM parallel_life.published_work_catalog(NULL,NULL)'),
          ),
          { code: '22023' },
        );
        assert.equal((await repo.get(editor, w.id)).metadataVersion, pub.metadataVersion);
      },
    );
    await t.test(
      'old forty-one migrations, official four templates and immutable player world remain byte-identical',
      async () => {
        assert.deepEqual(await oldRead(), legacyBefore);
        assert.deepEqual(
          (
            await admin.query(
              "SELECT name,checksum FROM public.pl_migrations WHERE name<'0042' ORDER BY name",
            )
          ).rows,
          oldChecks,
        );
        assert.equal(
          (await new OfficialLifeRepository(app, oldCatalog).list(legacyOwner)).lives.length,
          4,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT rolcanlogin,rolbypassrls,rolsuper FROM pg_roles WHERE rolname='pl_publisher'",
            )
          ).rows[0].rolcanlogin,
          false,
        );
        assert.equal(
          (await admin.query("SELECT rolbypassrls FROM pg_roles WHERE rolname='pl_publisher'"))
            .rows[0].rolbypassrls,
          false,
        );
      },
    );
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [legacyOwner]);
  }
});
