import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import {
  PublicationRepository,
  type PublicationReviewPort,
} from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { PublicationStoryRepository } from '../../src/modules/settings/infrastructure/publication-story-repository.ts';
import { buildStoryPlan } from '../../src/modules/settings/domain/publication-story.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
const reviewReceipt = randomUUID();
const review: PublicationReviewPort = {
  async review({ content }) {
    return {
      reviewerVersion: 'local_opening18_fixture',
      runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId: reviewReceipt },
    };
  },
};
const compiler: PublicationWorldCompilerPort = {
  prepare(input) {
    const result = compilePublicationGenesis({
      ...input,
      originKind: input.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(result.status, 'compiled');
    if (result.status !== 'compiled') throw Error('COMPILE_FAILED');
    return {
      world: result.world,
      opening: result.opening,
      seed: {
        id: input.seedId,
        createdAt: new Date().toISOString(),
        source: {
          kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
          ...input.origin,
        },
        identity: result.opening.identity,
        situation: result.opening.situation,
        setting: result.opening.setting,
        experienceNote: result.opening.experienceNote,
      },
    };
  },
};
test('real PostgreSQL optional opening source/plan binding and first-event eligibility remain private and immutable', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.OPENING_EVENT_TEST_PORT ?? 55490));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const databases: PostgresDatabase[] = [];
  t.after(async () => {
    for (const db of databases) await db.close();
    await admin.end();
  });
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_opening18_fixture'")).rowCount)
    await admin.query(
      `CREATE ROLE pl_opening18_fixture LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_opening18_fixture');
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const pub = new PostgresDatabase(
    `postgresql://pl_opening18_fixture:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  databases.push(app, pub);
  const staff = randomUUID(),
    owner = randomUUID(),
    other = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '仅本地开场测试'],
  );
  for (const id of [owner, other]) await new IdentityRepository(app).ensureGuest(id);
  const works = new PublicationRepository(pub, review),
    worlds = new PublicationWorldRepository(app, compiler),
    story = new PublicationStoryRepository(app);
  const report = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(report)![1]!);
  const actor = base.actors[0].key;
  const fixture = () => {
    const c = structuredClone(base);
    c.candidates = ['a_other', 'z_opening'].map((key) => ({
      key,
      kind: 'candidate',
      title: key,
      editorialIntent:
        key === 'z_opening' ? 'PRIVATE_OPENING_INTENT_NEVER_PUBLIC' : 'OTHER_PRIVATE_INTENT',
      actorKeys: [actor],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event', actorKey: actor },
      direction: { mode: 'optional' },
    }));
    delete c.timeline;
    c.conditions = [];
    c.places.push({
      key: 'elsewhere',
      name: '另一地点',
      description: '仅本地测试地点',
      knownAtStart: true,
    });
    return c;
  };
  const make = async (c: Record<string, unknown>) => {
    const content = PublishedWorldContentSchema.parse(c);
    const work = await works.create(staff, {
      commandId: randomUUID(),
      title: content.work.title,
      content,
    });
    const check = await works.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
    });
    assert.equal(check.status, 'ready');
    await works.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: check.id,
    });
    const world = await worlds.startPublished(owner, work.id, {
      commandId: randomUUID(),
      publicationVersion: 1,
    });
    return { work, world };
  };
  await t.test(
    'designated opening survives real publication compilation and private SQL plan initialization',
    async () => {
      const c = fixture();
      c.openingEventKey = 'z_opening';
      const { work, world } = await make(c);
      const opportunities = await story.opportunities(owner, world.worldId, false);
      assert.deepEqual(
        opportunities.candidates.map((n) => n.nodeKey),
        ['z_opening'],
      );
      assert.equal(opportunities.candidates[0]!.direction?.mode, 'required');
      const data = await app.transaction(owner, async (sql) => ({
        source: (
          await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [
            world.worldId,
          ])
        ).rows[0].source,
        plan: (
          await sql.query(
            'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1',
            [world.worldId],
          )
        ).rows[0].document,
      }));
      assert.equal(data.source.openingEventKey, 'z_opening');
      assert.equal(data.plan.openingEventKey, 'z_opening');
      assert.deepEqual((await works.get(staff, work.id)).draft.content, c);
      const progress = await story.progress(owner, world.worldId);
      assert.ok(!JSON.stringify(progress).includes('PRIVATE_OPENING_INTENT'));
      assert.ok(!Object.hasOwn(progress, 'openingEventKey'));
      await assert.rejects(
        app.transaction(owner, (sql) =>
          sql.query('SELECT parallel_life.publication_story_store_plan($1,$2)', [
            world.worldId,
            { ...data.plan, openingEventKey: 'a_other' },
          ]),
        ),
      );
      await assert.rejects(
        app.transaction(owner, (sql) =>
          sql.query('SELECT parallel_life.publication_story_store_plan($1,$2)', [
            world.worldId,
            { ...data.plan, origin: { ...data.plan.origin, contentHash: '0'.repeat(64) } },
          ]),
        ),
      );
      const foreign = await app.transaction(
        other,
        async (sql) =>
          (
            await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [
              world.worldId,
            ])
          ).rows[0].source,
      );
      assert.equal(foreign, null);
      assert.equal(
        (await story.prepare(owner, world.worldId, { automatic: false, nodeKey: 'a_other' }))
          .status,
        'none',
      );
      const claim = await story.prepare(owner, world.worldId, {
        automatic: false,
        nodeKey: 'z_opening',
      });
      assert.equal(claim.status, 'claimed');
      const repeated = await story.prepare(owner, world.worldId, {
        automatic: false,
        nodeKey: 'z_opening',
      });
      assert.ok(repeated.status === 'busy' || repeated.status === 'unknown');
      if (claim.status !== 'claimed') throw Error('NO_CLAIM');
      const at = (
        await admin.query('SELECT story_now FROM parallel_life.world_clock WHERE world_id=$1', [
          world.worldId,
        ])
      ).rows[0].story_now.toISOString();
      await new PostgresWorldRepository(app).commit(
        { userId: owner },
        {
          id: claim.claim.commandId,
          worldId: world.worldId,
          actorId: claim.claim.actorId,
          expectedVersion: claim.claim.expectedVersion,
          text: '仅本地内部开场测试',
          origin: 'director',
        },
        {
          schemaVersion: 1,
          id: randomUUID(),
          worldId: world.worldId,
          version: claim.claim.expectedVersion + 1,
          commandId: claim.claim.commandId,
          type: 'turn.resolved',
          occurredAt: new Date().toISOString(),
          storyAt: at,
          data: {
            actorId: claim.claim.actorId,
            userText: '仅本地内部开场测试',
            origin: 'director',
            effects: [
              {
                type: 'message.received',
                id: randomUUID(),
                actorId: claim.claim.actorId,
                text: '明确合成开场测试，不代表真实模型',
              },
            ],
          },
        },
      );
      const completed = await story.finish(owner, world.worldId, claim.claim.claimId);
      assert.equal(completed.presented[0]!.nodeKey, 'z_opening');
      assert.equal(completed.presented[0]!.outcome, null);
      assert.equal(completed.presented[0]!.playerCompleted, false);
      assert.deepEqual(
        (await story.opportunities(owner, world.worldId, false)).candidates.map(
          (node) => node.nodeKey,
        ),
        ['a_other'],
      );
      assert.equal(
        (await story.prepare(owner, world.worldId, { automatic: false, nodeKey: 'z_opening' }))
          .status,
        'none',
      );
      await story.skip(owner, world.worldId, 'z_opening', randomUUID());
      assert.deepEqual(
        (await story.opportunities(owner, world.worldId, false)).candidates.map(
          (node) => node.nodeKey,
        ),
        ['a_other'],
      );
    },
  );
  await t.test(
    'legacy absent field keeps both source and plan absent and the original event pool',
    async () => {
      const { world } = await make(fixture());
      const pool = await story.opportunities(owner, world.worldId, false);
      assert.equal(pool.candidates.length, 2);
      const source = await app.transaction(
        owner,
        async (sql) =>
          (
            await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [
              world.worldId,
            ])
          ).rows[0].source,
      );
      assert.equal(Object.hasOwn(source, 'openingEventKey'), false);
      assert.equal(Object.hasOwn(buildStoryPlan(source), 'openingEventKey'), false);
    },
  );
  await t.test(
    'unsatisfied opening retains its original prerequisites and never falls back',
    async () => {
      const c = fixture();
      c.openingEventKey = 'z_opening';
      c.candidates[1].prerequisites = [
        {
          kind: 'at_place',
          placeKey: c.places.find((p: any) => p.key !== c.world.startPlaceKey).key,
        },
      ];
      const { world } = await make(c);
      assert.deepEqual((await story.opportunities(owner, world.worldId, false)).candidates, []);
    },
  );
  const stagedFixture = () => {
    const c = fixture();
    c.openingEventKey = 'z_opening';
    c.timeline = {
      initialStageKey: 'start',
      stages: [{ key: 'start', title: '起步', order: 0, afterStageKeys: [] }],
    };
    for (const n of c.candidates)
      n.timeline = {
        stageKey: 'start',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      };
    return c;
  };
  await t.test(
    'owner skip before presentation persists a real terminal outcome and releases the opening gate',
    async () => {
      const c = fixture();
      c.openingEventKey = 'z_opening';
      const { world } = await make(c);
      await story.opportunities(owner, world.worldId, false);
      await story.skip(owner, world.worldId, 'z_opening', randomUUID());
      const row = (
        await admin.query(
          'SELECT status,outcome,source_event_id,source_message_id FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND node_key=$2',
          [world.worldId, 'z_opening'],
        )
      ).rows[0];
      assert.equal(row.status, 'skipped');
      assert.equal(row.outcome, 'skipped');
      assert.equal(row.source_event_id, null);
      assert.equal(row.source_message_id, null);
      assert.deepEqual(
        (await story.opportunities(owner, world.worldId, false)).candidates.map((n) => n.nodeKey),
        ['a_other'],
      );
    },
  );
  await t.test(
    'clock expiry before presentation persists without source evidence and releases other events',
    async () => {
      const c = stagedFixture();
      const start = Date.parse(c.world.startAt);
      c.candidates[1].timeline.window = {
        notBefore: new Date(start).toISOString(),
        expiresAt: new Date(start + 60000).toISOString(),
      };
      const { world } = await make(c);
      await story.opportunities(owner, world.worldId, false);
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        world.worldId,
        new Date(start + 120000).toISOString(),
      ]);
      assert.deepEqual(
        (await story.opportunities(owner, world.worldId, false)).candidates.map((n) => n.nodeKey),
        ['a_other'],
      );
      const row = (
        await admin.query(
          'SELECT status,outcome,source_event_id,source_message_id FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND node_key=$2',
          [world.worldId, 'z_opening'],
        )
      ).rows[0];
      assert.equal(row.status, 'expired');
      assert.equal(row.outcome, 'expired');
      assert.equal(row.source_event_id, null);
      assert.equal(row.source_message_id, null);
    },
  );
  await t.test(
    'causal prerequisites and dependent stage block publication while ANY retains a reachable place branch',
    async () => {
      const c = fixture();
      c.openingEventKey = 'z_opening';
      c.candidates[1].prerequisites = [{ kind: 'after_presented_node', nodeKey: 'a_other' }];
      const original = structuredClone(c);
      const invalid = PublishedWorldContentSchema.safeParse(c);
      assert.equal(invalid.success, false);
      if (!invalid.success)
        assert.ok(
          invalid.error.issues.some((i) => i.message === 'opening_event_requires_prior_event'),
        );
      assert.deepEqual(c, original);
      c.candidates[1].prerequisites = [];
      c.conditions = [
        {
          key: 'opening_choice',
          title: '开场可达',
          match: 'any',
          prerequisites: [
            { kind: 'after_presented_node', nodeKey: 'a_other' },
            { kind: 'at_place', placeKey: c.world.startPlaceKey },
          ],
        },
      ];
      c.candidates[1].conditionKeys = ['opening_choice'];
      const { world } = await make(c);
      assert.deepEqual(
        (await story.opportunities(owner, world.worldId, false)).candidates.map((n) => n.nodeKey),
        ['z_opening'],
      );
      c.conditions[0].match = 'all';
      assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
      const staged = stagedFixture();
      staged.timeline.stages.push({
        key: 'later',
        title: '后续',
        order: 1,
        afterStageKeys: ['start'],
      });
      staged.candidates[1].timeline.stageKey = 'later';
      const invalidStage = PublishedWorldContentSchema.safeParse(staged);
      assert.equal(invalidStage.success, false);
      if (!invalidStage.success)
        assert.ok(
          invalidStage.error.issues.some((i) => i.message === 'opening_event_requires_prior_stage'),
        );
    },
  );
  await t.test(
    'real clock expiration remains a reachable causal prerequisite without presenting the earlier event',
    async () => {
      const c = stagedFixture();
      const start = Date.parse(c.world.startAt);
      c.candidates[0].timeline.window = {
        notBefore: new Date(start).toISOString(),
        expiresAt: new Date(start + 60000).toISOString(),
      };
      c.candidates[1].prerequisites = [
        { kind: 'after_resolved_node', nodeKey: 'a_other', outcomes: ['expired'] },
      ];
      const { world } = await make(c);
      assert.deepEqual((await story.opportunities(owner, world.worldId, false)).candidates, []);
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        world.worldId,
        new Date(start + 120000).toISOString(),
      ]);
      assert.deepEqual(
        (await story.opportunities(owner, world.worldId, false)).candidates.map((n) => n.nodeKey),
        ['z_opening'],
      );
    },
  );
  await t.test(
    'invalid and non-director binding reject author content instead of making a random opening',
    () => {
      const c = fixture();
      assert.equal(
        PublishedWorldContentSchema.safeParse({ ...c, openingEventKey: 'missing' }).success,
        false,
      );
      c.candidates[0].intent = { kind: 'editorial_only' };
      assert.equal(
        PublishedWorldContentSchema.safeParse({ ...c, openingEventKey: 'a_other' }).success,
        false,
      );
    },
  );
});
