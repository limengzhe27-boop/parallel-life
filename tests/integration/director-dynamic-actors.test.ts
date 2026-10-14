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
import {
  PublicationStoryRepository,
  readPublicationInvitationLinks,
  readPublicationSceneBrief,
} from '../../src/modules/settings/infrastructure/publication-story-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { readPresentedActorStory } from '../../src/modules/settings/infrastructure/presented-story-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import { buildStoryPlan } from '../../src/modules/settings/domain/publication-story.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import type { PublicationStoryClaim } from '../../src/modules/settings/application/publication-story-ports.ts';
import type { WorldEffect } from '../../src/modules/world/domain/types.ts';

const start = '2026-10-12T09:00:00.000Z';
const receiptId = randomUUID();
const review: PublicationReviewPort = {
  async review({ content }) {
    return {
      reviewerVersion: 'explicit_local_story_fixture',
      runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId },
    };
  },
};
/** Until Root's compiler extension is integrated, this local trusted adapter compiles only the
 * validated opening using the actual Q compiler. It writes no future events; 46 runs the real plan.
 * All turn effects below are explicitly synthetic test proposals, never provider-success claims. */
const compiler: PublicationWorldCompilerPort = {
  prepare(i) {
    const c = structuredClone(i.content) as Record<string, unknown>;
    delete c.timeline;
    delete c.conditions;
    c.candidates = [];
    const r = compilePublicationGenesis({
      ...i,
      content: c,
      originKind: i.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(r.status, 'compiled');
    if (r.status !== 'compiled') throw Error('OPENING_NOT_SUPPORTED');
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

test('real PG dynamic casting: complete manuscript, multiple places, persisted chosen actor and wrong-actor rejection', async (t) => {
  const config = await localConfig();
  const port = process.env.DIRECTOR_DYNAMIC_ACTOR_TEST_PORT ?? '55503';
  assert.match(port, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(port) <= 65535);
  assert.equal(config.port, Number(port));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const role = 'pl_director_dynamic_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const pub = new PostgresDatabase(
    `postgresql://${role}:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await pub.close();
    await admin.end();
  });
  const staff = randomUUID(),
    owner = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '动态演员合成测试'],
  );
  await new IdentityRepository(app).ensureGuest(owner);
  const report = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(report)![1]!);
  const script = '保留完整正文。'.repeat(650) + '尾段：玩家拒绝则另作安排。';
  content.world.startAt = start;
  content.candidates = [
    {
      key: 'dynamic',
      kind: 'candidate',
      title: '可选安排',
      editorialIntent: '旧简述',
      script,
      sceneText: '医院走廊 / 母亲病房',
      scenePlaceKeys: content.places.map((p: any) => p.key),
      actorKeys: [],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event' },
    },
  ];
  delete content.timeline;
  delete content.openingEventKey;
  const doc = PublishedWorldContentSchema.parse(content);
  const works = new PublicationRepository(pub, review),
    worlds = new PublicationWorldRepository(app, compiler),
    story = new PublicationStoryRepository(app),
    runtime = new PostgresWorldRepository(app);
  const work = await works.create(staff, {
    commandId: randomUUID(),
    title: doc.work.title,
    content: doc,
  });
  const checked = await works.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
  });
  assert.equal(checked.status, 'ready');
  await works.publish(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    expectedMetadataVersion: 0,
    checkId: checked.id,
  });
  const world = await worlds.startPublished(owner, work.id, {
    commandId: randomUUID(),
    publicationVersion: 1,
  });
  await admin.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
    world.worldId,
  ]);
  const pool = await story.opportunities(owner, world.worldId, false),
    candidate = pool.candidates[0]!;
  assert.equal(candidate.actorId, undefined);
  assert.ok(candidate.actorOptions!.length >= 2);
  assert.equal(candidate.editorialIntent, script);
  assert.equal(candidate.direction?.mode, 'optional');
  assert.deepEqual(
    candidate.places!.map((p) => p.key),
    content.candidates[0].scenePlaceKeys,
  );
  const chosen = candidate.actorOptions![1]!.id;
  for (const actorId of [undefined, randomUUID()]) {
    await assert.rejects(
      story.prepare(owner, world.worldId, {
        automatic: false,
        nodeKey: 'dynamic',
        expectedVersion: pool.version,
        ...(actorId ? { actorId } : {}),
      }),
      (e) => (e as { code: string }).code === 'INVALID_INPUT',
    );
  }
  const attempt = randomUUID();
  assert.equal(
    await story.beginSelection(owner, world.worldId, pool.version, attempt, ['dynamic']),
    true,
  );
  await story.finishSelection(owner, world.worldId, attempt, 'selected', 'dynamic');
  const prepared = await story.prepare(owner, world.worldId, {
    automatic: false,
    nodeKey: 'dynamic',
    actorId: chosen,
    expectedVersion: pool.version,
  });
  assert.equal(prepared.status, 'claimed');
  if (prepared.status !== 'claimed') throw Error('NO_CLAIM');
  assert.equal(prepared.claim.actorId, chosen);
  assert.equal(prepared.claim.script, script);
  assert.equal(prepared.claim.editorialIntent, script);
  const pending = await story.prepare(owner, world.worldId, { automatic: false });
  assert.equal(pending.status, 'unknown');
  const resumed = await story.retry(owner, world.worldId, prepared.claim.claimId);
  assert.equal(resumed.status, 'claimed');
  if (resumed.status !== 'claimed') throw Error('NO_RESUME');
  assert.equal(resumed.claim.actorId, chosen);
  assert.equal(resumed.claim.claimId, prepared.claim.claimId);
  assert.equal(
    (await runtime.get({ userId: owner }, world.worldId)).space!.currentPlaceId,
    content.world.startPlaceKey,
  );
  await assert.rejects(
    app.transaction(owner, (sql) =>
      sql.query(
        'UPDATE parallel_life.publication_story_nodes SET actor_id=$3 WHERE world_id=$1 AND owner_id=$2',
        [world.worldId, owner, candidate.actorOptions![0]!.id],
      ),
    ),
    (e) => ['23514', '42501'].includes((e as { code: string }).code),
  );
});
