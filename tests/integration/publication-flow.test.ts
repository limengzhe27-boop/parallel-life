import { findPublicationCard } from './publication-catalog-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import {
  publicationWorldCompiler,
  publicationReview,
} from '../../src/server/publication-runtime.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';
import { SeedRepository } from '../../src/modules/discovery/infrastructure/seed-repository.ts';
test('local integrated save → private trial → explicit synthetic NPC turn → publish → isolated player phone and authored notes', async (t) => {
  const cfg = await localConfig();
  const expectedPort = process.env.PUBLICATION_FLOW_TEST_PORT ?? '55476';
  assert.match(expectedPort, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(expectedPort) <= 65535);
  assert.equal(cfg.port, Number(expectedPort), 'Explicit owned local test database only');
  const admin = await adminClient('parallel_life_test');
  t.after(() => admin.end());
  await migrate(admin);
  const role = 'pl_publication_flow_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${cfg.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const pub = new PostgresDatabase(
      `postgresql://${role}:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    app = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  t.after(async () => {
    await pub.close();
    await app.close();
  });
  const staff = randomUUID();
  await admin.query('INSERT INTO parallel_life.publisher_principals VALUES($1,$2,true,true,true)', [
    staff,
    '本地整链合成验证',
  ]);
  const worlds = new PublicationWorldRepository(pub, publicationWorldCompiler),
    works = new PublicationRepository(
      pub,
      publicationReview((w, v, h) => worlds.trialEvidence(staff, w, v, h)),
    );
  const source = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(source)![1]!);
  content.candidates = [];
  delete content.timeline;
  content.media = [];
  content.phone.album = [];
  content.history = [
    {
      key: 'shop_fact',
      kind: 'established_fact',
      text: '你们已经租下这家小店',
      occurredAt: '2026-10-11T09:00:00Z',
      actorKeys: [],
      visibility: { kind: 'player' },
    },
  ];
  content.protagonist.knownFactKeys = ['shop_fact'];
  content.phone.notes = [
    {
      key: 'shop_note',
      title: '开店记录',
      text: '租下这家店后，要讨论开业安排。',
      factKeys: ['shop_fact'],
    },
  ];
  const work = await works.create(staff, {
    commandId: randomUUID(),
    title: '整链合成故事',
    content,
  });
  const saved = await works.save(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    title: '河边的小店',
    content,
  });
  const before = await works.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
  });
  assert.equal(before.status, 'blocked');
  assert.equal(before.trialVerified, false);
  const trial = await worlds.startTrial(staff, work.id, {
    commandId: randomUUID(),
    draftVersion: 1,
    contentHash: saved.draft.contentHash,
  });
  const privateScope = await worlds.trialSession(staff, trial.trialId!);
  const phone = await new BuildRepository(app).phone(privateScope.ownerId, trial.worldId);
  assert.equal(phone.actors.length, 2);
  assert.ok(phone.notes.some((n) => n.origin?.kind === 'publication_opening'));
  assert.equal(JSON.stringify(phone).includes('privatePersona'), false);
  assert.equal(phone.notes[0]!.origin!.draftVersion, 1);
  const turn = await resolveTurn(
    {
      worlds: new PostgresWorldRepository(app),
      planner: {
        async propose({ context }) {
          assert.ok(context.actor.persona.includes(content.world.publicSetting));
          return {
            schemaVersion: 1,
            effects: [
              {
                type: 'message.received',
                id: 'synthetic_reply',
                actorId: context.actor.id,
                text: '本地合成检验回复，不代表真实模型验收。',
              },
            ],
          };
        },
      },
      now: () => new Date().toISOString(),
      storyNow: () => phone.time,
      newId: randomUUID,
    },
    { userId: privateScope.ownerId },
    {
      id: randomUUID(),
      worldId: trial.worldId,
      expectedVersion: 0,
      actorId: phone.actors[0]!.id,
      text: '这是明确的本地合成测试输入',
    },
  );
  assert.equal(turn.state.version, 1);
  const check = await works.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
  });
  assert.equal(check.status, 'ready');
  const published = await works.publish(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 1,
    expectedMetadataVersion: saved.metadataVersion,
    checkId: check.id,
  });
  const identity = new IdentityRepository(app),
    owner = randomUUID(),
    other = randomUUID();
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  const playerWorlds = new PublicationWorldRepository(app, publicationWorldCompiler);
  const card = (await findPublicationCard((input) => playerWorlds.catalog(owner, input), work.id))!;
  assert.equal(card.worldId, null);
  assert.equal(JSON.stringify(card).includes('hiddenContext'), false);
  const request = { commandId: randomUUID(), publicationVersion: published.publicationVersion };
  const opened = await playerWorlds.startPublished(owner, work.id, request),
    second = await playerWorlds.startPublished(other, work.id, {
      ...request,
      commandId: randomUUID(),
    });
  assert.notEqual(opened.worldId, second.worldId);
  assert.notEqual(opened.worldId, trial.worldId);
  const replay = await playerWorlds.startPublished(owner, work.id, request);
  assert.equal(replay.worldId, opened.worldId);
  const actual = await new BuildRepository(app).phone(owner, opened.worldId);
  assert.equal(actual.version, 0);
  assert.equal(actual.actors.length, 2);
  assert.equal(
    actual.messages.some((m) => m.text.includes('本地合成检验回复')),
    false,
  );
  assert.ok(actual.notes.some((n) => n.origin?.kind === 'publication_opening'));
  assert.equal((await new SeedRepository(app).list(owner)).length, 0);
  assert.equal((await new BuildRepository(app).list(owner)).length, 0);
  await assert.rejects(new BuildRepository(app).phone(other, opened.worldId));
  const hidden = await app.transaction(other, (sql) =>
    sql.query('SELECT parallel_life.player_publication_origin($1,$2) AS origin', [
      opened.worldId,
      opened.seedId,
    ]),
  );
  assert.equal(hidden.rows[0].origin, null);
  for (const [role, expected] of [
    ['pl_app', true],
    ['pl_worker', false],
    ['pl_publisher', false],
  ] as const) {
    const grant = await admin.query(
      "SELECT has_function_privilege($1,'parallel_life.player_publication_origin(text,uuid)','EXECUTE') AS yes",
      [role],
    );
    assert.equal(grant.rows[0].yes, expected);
  }
  const tableGrant = await admin.query(
    "SELECT has_table_privilege('pl_app','parallel_life.publication_world_bindings','SELECT') AS yes",
  );
  assert.equal(tableGrant.rows[0].yes, false);
  assert.equal(
    (await findPublicationCard((input) => playerWorlds.catalog(owner, input), work.id))!.worldId,
    opened.worldId,
  );
});
