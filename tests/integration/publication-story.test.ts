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
import type { WorldEffect, WorldEvent } from '../../src/modules/world/domain/types.ts';

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
const code = (expected: string) => (e: unknown) => {
  assert.equal((e as { code: string }).code, expected);
  return true;
};
test('real PG story sidecar: deterministic eligibility, actor provenance, source-only progress and unknown fencing', async (t) => {
  const config = await localConfig(),
    portText = process.env.PUBLICATION_STORY_TEST_PORT ?? '55478';
  assert.match(portText, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(portText) <= 65535);
  assert.equal(config.port, Number(portText));
  const admin = await adminClient('parallel_life_test'),
    resources: PostgresDatabase[] = [];
  t.after(async () => {
    for (const db of resources) await db.close();
    await admin.end();
  });
  await migrate(admin);
  const app = new PostgresDatabase(
      `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    ),
    worker = new PostgresDatabase(
      `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    );
  resources.push(app, worker);
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_publication_story_fixture'"))
      .rowCount
  )
    await admin.query(
      `CREATE ROLE pl_publication_story_fixture LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_publication_story_fixture');
  const pub = new PostgresDatabase(
    `postgresql://pl_publication_story_fixture:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  resources.push(pub);
  const staff = randomUUID(),
    owner = randomUUID(),
    other = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '仅本地剧情夹具'],
  );
  for (const id of [owner, other]) await new IdentityRepository(app).ensureGuest(id);
  const works = new PublicationRepository(pub, review),
    worlds = new PublicationWorldRepository(app, compiler),
    trials = new PublicationWorldRepository(pub, compiler),
    story = new PublicationStoryRepository(app),
    runtime = new PostgresWorldRepository(app);
  const report = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(report)![1]!);
  const a = base.actors[0].key,
    b = base.actors[1].key;
  for (const actor of base.actors) actor.name = '同名朋友';
  base.world.startAt = start;
  base.world.hiddenContext = 'HIDDEN_FULL_CONTEXT_NEVER_RETURN';
  base.history = [
    {
      key: 'first_fact',
      kind: 'established_fact',
      text: '重复历史',
      occurredAt: '2026-10-11T09:00:00.000Z',
      actorKeys: [a, b],
      visibility: { kind: 'world' },
    },
    {
      key: 'second_fact',
      kind: 'established_fact',
      text: '重复历史',
      occurredAt: '2026-10-11T09:00:00.000Z',
      actorKeys: [a, b],
      visibility: { kind: 'world' },
    },
  ];
  base.initialKnowledge = [{ actorKey: a, factKeys: ['first_fact', 'second_fact'] }];
  base.protagonist.knownFactKeys = [];
  base.phone.messages = [
    {
      key: 'history',
      actorKey: a,
      origin: 'history',
      text: '开场历史，不是未来节点',
      at: '2026-10-11T09:00:00.000Z',
    },
  ];
  const candidate = (key: string, actorKey = a) => ({
    key,
    kind: 'candidate',
    title: '私有未来标题_' + key,
    editorialIntent: '仅这个当下片段_' + key,
    actorKeys: [actorKey],
    prerequisites: [],
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'offer_message', actorKey, text: '源节点小片段_' + key },
  });
  const authored = () => {
    const c = structuredClone(base);
    c.timeline = {
      initialStageKey: 'opening',
      stages: [
        {
          key: 'opening',
          title: '起步',
          order: 0,
          afterStageKeys: [],
          window: { notBefore: start, expiresAt: '2026-10-12T11:00:00.000Z' },
        },
        {
          key: 'later',
          title: '后续',
          order: 1,
          afterStageKeys: ['opening'],
          window: { notBefore: start, expiresAt: '2026-10-12T13:00:00.000Z' },
        },
      ],
    };
    c.candidates = [
      {
        ...candidate('first'),
        prerequisites: [{ kind: 'history_fact', factKey: 'first_fact' }],
        timeline: {
          stageKey: 'opening',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
      {
        ...candidate('invite'),
        prerequisites: [{ kind: 'after_committed_node', nodeKey: 'first' }],
        intent: {
          kind: 'offer_invitation',
          actorKeys: [a],
          placeKey: c.world.startPlaceKey,
          title: '明确实际邀约',
          earliestAt: '2026-10-12T10:30:00.000Z',
        },
        timeline: {
          stageKey: 'later',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
    ];
    return c;
  };
  const make = async (c = authored(), asOwner = owner) => {
    const doc = PublishedWorldContentSchema.parse(c);
    const w = await works.create(staff, {
      commandId: randomUUID(),
      title: doc.work.title,
      content: doc,
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
    const world = await worlds.startPublished(asOwner, w.id, {
      commandId: randomUUID(),
      publicationVersion: 1,
    });
    await admin.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
      world.worldId,
    ]);
    return { w, world };
  };
  const claim = async (worldId: string, automatic = false) => {
    const r = await story.prepare(owner, worldId, { automatic });
    assert.equal(r.status, 'claimed');
    if (r.status !== 'claimed') throw Error('NO_CLAIM');
    return r.claim;
  };
  const commit = async (
    worldId: string,
    c: PublicationStoryClaim,
    effects: WorldEffect[],
    asOwner = owner,
  ) => {
    const at = (
      await admin.query('SELECT story_now FROM parallel_life.world_clock WHERE world_id=$1', [
        worldId,
      ])
    ).rows[0].story_now.toISOString();
    const command = {
      id: c.commandId,
      worldId,
      actorId: c.actorId,
      expectedVersion: c.expectedVersion,
      text: '明确内部本地测试指示',
      origin: 'director' as const,
    };
    return runtime.commit({ userId: asOwner }, command, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      version: c.expectedVersion + 1,
      commandId: c.commandId,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      storyAt: at,
      data: { actorId: c.actorId, userText: command.text, origin: 'director', effects },
    });
  };
  const reply = (c: PublicationStoryClaim): WorldEffect => ({
    type: 'message.received',
    id: randomUUID(),
    actorId: c.actorId,
    text: '仅本地合成回复，不代表真实模型',
  });
  await t.test(
    'migration accepts legacy initial-only plans except when a hidden event is executable',
    async () => {
      const c = authored();
      c.places.push({
        key: 'hidden_hospital',
        name: '医院',
        description: '虚构医院路 8 号',
        knownAtStart: false,
      });
      c.routes.push({
        fromPlaceKey: c.world.startPlaceKey,
        toPlaceKey: 'hidden_hospital',
        minutes: 15,
      });
      const legacy = await make(c);
      const source = (
        await app.transaction(owner, (sql) =>
          sql.query('SELECT parallel_life.publication_story_source($1) AS source', [
            legacy.world.worldId,
          ]),
        )
      ).rows[0].source;
      const plan = buildStoryPlan(source);
      const oldPlan = {
        ...plan,
        places: plan.places.filter((p) => source.initialPlaceKeys.includes(p.key)),
      };
      await app.transaction(owner, (sql) =>
        sql.query('SELECT parallel_life.publication_story_store_plan($1,$2)', [
          legacy.world.worldId,
          oldPlan,
        ]),
      );
      assert.equal(
        (await story.progress(owner, legacy.world.worldId)).totalNodes,
        c.candidates.length,
      );
      const hiddenEvent = structuredClone(c);
      hiddenEvent.candidates[0].settingPlaceKey = 'hidden_hospital';
      const fresh = await make(hiddenEvent);
      const freshSource = (
        await app.transaction(owner, (sql) =>
          sql.query('SELECT parallel_life.publication_story_source($1) AS source', [
            fresh.world.worldId,
          ]),
        )
      ).rows[0].source;
      const invalid = buildStoryPlan(freshSource);
      invalid.places = invalid.places.filter((p) => freshSource.initialPlaceKeys.includes(p.key));
      await assert.rejects(
        app.transaction(owner, (sql) =>
          sql.query('SELECT parallel_life.publication_story_store_plan($1,$2)', [
            fresh.world.worldId,
            invalid,
          ]),
        ),
        (e: unknown) => (e as { code: string }).code === '23514',
      );
    },
  );
  await t.test(
    'named conditions persist from exact published source and block/allow real preparation',
    async () => {
      const doc = authored();
      doc.conditions = [
        {
          key: 'ready_gate',
          title: '时间与地点',
          match: 'all',
          prerequisites: [
            { kind: 'at_place', placeKey: doc.world.startPlaceKey },
            { kind: 'not_before', at: '2026-10-12T10:00:00.000Z' },
          ],
        },
      ];
      doc.candidates[0].conditionKeys = ['ready_gate'];
      const blocked = await make(doc);
      assert.notEqual(
        (await story.prepare(owner, blocked.world.worldId, { automatic: false })).status,
        'claimed',
      );
      const saved = (
        await admin.query(
          'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1',
          [blocked.world.worldId],
        )
      ).rows[0].document;
      assert.deepEqual(saved.conditions, doc.conditions);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_nodes WHERE world_id=$1',
            [blocked.world.worldId],
          )
        ).rows[0].n,
        0,
      );
      // Changing the caller plan cannot bypass its immutable authored gate.
      await assert.rejects(
        () =>
          app.transaction(owner, async (sql) => {
            await sql.query('SELECT parallel_life.publication_story_store_plan($1,$2)', [
              blocked.world.worldId,
              { ...saved, conditions: [] },
            ]);
          }),
        (e: unknown) => (e as { code: string }).code === '23514',
      );
      doc.conditions[0].match = 'any';
      const allowed = await make(doc);
      assert.equal(
        (await story.prepare(owner, allowed.world.worldId, { automatic: false })).status,
        'claimed',
      );
    },
  );
  await t.test(
    'optional director events retain true presentation, selection admission and safe authored phone content',
    async () => {
      const doc = authored();
      delete doc.timeline;
      const event = {
        ...doc.candidates[0],
        intent: { kind: 'director_event', actorKey: a },
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
      };
      delete event.timeline;
      doc.candidates = [
        { ...event, key: 'optional_a', title: '可能发生的交谈' },
        {
          ...event,
          key: 'optional_b',
          title: '之后的交谈',
          prerequisites: [{ kind: 'after_presented_node', nodeKey: 'optional_a' }],
        },
      ];
      doc.actors[0].publicCard.introduction = '作者公开介绍';
      doc.actors[0].lifeModules = { traits: 'ONLY_THIS_PERSON_PRIVATE_MODULE' };
      doc.extensions = [
        {
          namespace: 'parallel_life.authoring_overall',
          version: 1,
          purpose: 'editorial',
          description: '作者总体设定',
          data: { text: 'DIRECTOR_OVERALL_PRIVATE_TEXT' },
        },
      ];
      doc.phone.messages = [
        {
          key: 'past_player',
          actorKey: a,
          speaker: 'player',
          origin: 'history',
          text: '之前那份资料收到了。',
          at: '2026-10-12T08:00:00.000Z',
        },
        {
          key: 'past_actor',
          actorKey: a,
          speaker: 'actor',
          origin: 'history',
          text: '好，我也留了一份。',
          at: '2026-10-12T08:01:00.000Z',
        },
      ];
      doc.phone.moments = [
        {
          key: 'normal_life',
          actorKey: a,
          text: '整理资料的一天。',
          at: '2026-10-11T08:00:00.000Z',
        },
      ];
      const made = await make(doc),
        wid = made.world.worldId;
      for (const role of [null, undefined, 'user']) {
        await assert.rejects(
          () =>
            app.transaction(other, async (sql) => {
              const admission = (
                await sql.query('SELECT parallel_life.publication_admit_published($1,1,$2) AS a', [
                  made.w.id,
                  randomUUID(),
                ])
              ).rows[0].a;
              const prepared = await compiler.prepare({
                content: admission.content,
                origin: admission.origin,
                originKind: admission.originKind,
                worldId: admission.worldId,
                ownerId: admission.ownerId,
                seedId: admission.seedId,
              });
              const malformed = prepared as unknown as {
                world: { messages: Record<string, unknown>[] };
              };
              if (role === undefined) delete malformed.world.messages[1]!.role;
              else malformed.world.messages[1]!.role = role;
              await sql.query('SELECT parallel_life.publication_commit_published($1,$2)', [
                admission.ticket,
                prepared,
              ]);
            }),
          (error: unknown) => ['22023', '23514'].includes((error as { code: string }).code),
        );
      }
      const initial = await runtime.get({ userId: owner }, wid);
      assert.deepEqual(
        initial.messages.map((m) => m.role),
        ['user', 'assistant'],
      );
      const phone = await new BuildRepository(app).phone(owner, wid);
      assert.deepEqual(
        phone.messages.map((m) => m.role),
        ['user', 'assistant'],
      );
      assert.ok(phone.actors.some((a) => a.summary?.includes('作者公开介绍')));
      assert.ok(!JSON.stringify(phone).includes('ONLY_THIS_PERSON_PRIVATE_MODULE'));
      assert.ok(!JSON.stringify(phone).includes('HIDDEN_FULL_CONTEXT'));
      const social = await app.transaction(
        owner,
        async (sql) =>
          (await sql.query('SELECT parallel_life.publication_social_opening($1) AS d', [wid]))
            .rows[0].d,
      );
      assert.equal(social.moments.length, 1);
      assert.equal(social.moments[0].text, '整理资料的一天。');
      assert.ok(!JSON.stringify(social).includes('HIDDEN_FULL_CONTEXT'));
      assert.deepEqual(
        await app.transaction(
          other,
          async (sql) =>
            (await sql.query('SELECT parallel_life.publication_social_opening($1) AS d', [wid]))
              .rows[0].d,
        ),
        { moments: [] },
      );
      const privateSetting = await app.transaction(
        owner,
        async (sql) =>
          (await sql.query('SELECT parallel_life.publication_director_setting($1) AS d', [wid]))
            .rows[0].d,
      );
      assert.equal(privateSetting.overallSetting, 'DIRECTOR_OVERALL_PRIVATE_TEXT');
      assert.equal(
        privateSetting.characterSettings[0].lifeModules.traits,
        'ONLY_THIS_PERSON_PRIVATE_MODULE',
      );
      const ownActorId = initial.actors.find((actor) => actor.name === doc.actors[0].name)!.id;
      const ownModules = await app.transaction(
        owner,
        async (sql) =>
          (
            await sql.query('SELECT parallel_life.publication_actor_life_modules($1,$2) AS d', [
              wid,
              ownActorId,
            ])
          ).rows[0].d,
      );
      assert.deepEqual(ownModules, { traits: 'ONLY_THIS_PERSON_PRIVATE_MODULE' });
      for (const fn of [
        'publication_director_setting($1)',
        'publication_actor_life_modules($1,$2)',
      ])
        assert.equal(
          await app.transaction(
            other,
            async (sql) =>
              (
                await sql.query(
                  'SELECT parallel_life.' + fn + ' AS d',
                  fn.includes('$2') ? [wid, ownActorId] : [wid],
                )
              ).rows[0].d,
          ),
          null,
        );
      assert.ok(!JSON.stringify(social).includes('ONLY_THIS_PERSON_PRIVATE_MODULE'));
      assert.ok(!JSON.stringify(initial).includes('DIRECTOR_OVERALL_PRIVATE_TEXT'));
      const pool = await story.opportunities(owner, wid, false);
      assert.equal(pool.directorPool, true);
      assert.deepEqual(
        pool.candidates.map((c) => c.nodeKey),
        ['optional_a'],
      );
      assert.equal(await story.beginSelection(owner, wid, 0, randomUUID(), ['optional_b']), false);
      const attempt = randomUUID();
      assert.equal(await story.beginSelection(owner, wid, 0, attempt, ['optional_a']), true);
      await assert.rejects(
        () => story.finishSelection(owner, wid, attempt, 'selected', 'optional_b'),
        code('INVALID_STATE'),
      );
      await story.finishSelection(owner, wid, attempt, 'selected', 'optional_a');
      assert.equal(await story.beginSelection(owner, wid, 0, randomUUID(), ['optional_a']), false);
      const claimed = await story.prepare(owner, wid, {
        automatic: false,
        nodeKey: 'optional_a',
        expectedVersion: 0,
      });
      assert.equal(claimed.status, 'claimed');
      if (claimed.status !== 'claimed') throw Error('MISSING_CLAIM');
      await commit(wid, claimed.claim, [reply(claimed.claim)]);
      const progress = await story.finish(owner, wid, claimed.claim.claimId);
      assert.equal(progress.presented[0]!.status, 'presented');
      assert.equal(progress.presented[0]!.outcome, null);
      assert.equal(progress.presented[0]!.playerCompleted, false);
      const knownThreads = await readPresentedActorStory(
        app,
        owner,
        wid,
        claimed.claim.actorId,
        1,
        start,
      );
      assert.equal(knownThreads.length, 1);
      assert.equal(knownThreads[0]!.sourceMessageId, progress.presented[0]!.sourceMessageId);
      const savedOpening = (await runtime.get({ userId: owner }, wid)).messages.find(
        (m) => m.id === progress.presented[0]!.sourceMessageId,
      )!;
      assert.equal(knownThreads[0]!.openingText, savedOpening.text);
      assert.equal(JSON.stringify(knownThreads).includes('DIRECTOR_OVERALL_PRIVATE_TEXT'), false);
      assert.deepEqual(
        await readPresentedActorStory(app, other, wid, claimed.claim.actorId, 1, start),
        [],
      );
      assert.deepEqual(
        await readPresentedActorStory(app, owner, wid, claimed.claim.actorId, 0, start),
        [],
      );
      assert.deepEqual(
        await readPresentedActorStory(
          app,
          owner,
          wid,
          initial.actors.find((x) => x.id !== claimed.claim.actorId)!.id,
          1,
          start,
        ),
        [],
      );
      const forgottenId = randomUUID();
      await admin.query(
        `INSERT INTO parallel_life.memory_records
        (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,source_type,source_ids,status)
        VALUES($1,$2,'character',$3,$4,$3,'episode','local forgotten opening','agent_inference',$5,'forgotten')`,
        [
          forgottenId,
          owner,
          claimed.claim.actorId,
          wid,
          JSON.stringify([knownThreads[0]!.sourceMessageId]),
        ],
      );
      assert.deepEqual(
        await readPresentedActorStory(app, owner, wid, claimed.claim.actorId, 1, start),
        [],
      );
      await admin.query('DELETE FROM parallel_life.memory_records WHERE id=$1', [forgottenId]);
      assert.deepEqual(
        (await story.opportunities(owner, wid, false)).candidates.map((c) => c.nodeKey),
        ['optional_b'],
      );
      assert.equal(
        (
          await story.prepare(owner, wid, {
            automatic: false,
            nodeKey: 'optional_a',
            expectedVersion: 1,
          })
        ).status,
        'none',
      );
      await works.unpublish(staff, made.w.id, {
        commandId: randomUUID(),
        expectedMetadataVersion: 1,
      });
      const still = await app.transaction(
        owner,
        async (sql) =>
          (await sql.query('SELECT parallel_life.publication_social_opening($1) AS d', [wid]))
            .rows[0].d,
      );
      assert.deepEqual(still, social);
    },
  );
  const { w, world } = await make();
  let first: PublicationStoryClaim, invite: PublicationStoryClaim, invitationId: string;
  await t.test(
    'lazy plan init emits no future world event or node completion and exposes no full content',
    async () => {
      const before = (
        await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [world.worldId])
      ).rows[0].version;
      const p = await story.progress(owner, world.worldId);
      assert.equal(p.presented.length, 0);
      assert.equal(p.totalNodes, 2);
      assert.deepEqual(p.currentStageKeys, ['opening']);
      assert.equal(p.pending, null);
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [world.worldId]))
          .rows[0].version,
        before,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_nodes WHERE world_id=$1',
            [world.worldId],
          )
        ).rows[0].n,
        0,
      );
      const document = (
        await admin.query(
          'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1',
          [world.worldId],
        )
      ).rows[0].document;
      assert.equal(JSON.stringify(document).includes('HIDDEN_FULL_CONTEXT_NEVER_RETURN'), false);
      assert.equal(JSON.stringify(document).includes('privatePersona'), false);
      assert.equal(JSON.stringify(document).includes('重复历史'), false);
    },
  );
  await t.test(
    'real duplicate-name actors and duplicate-text facts map by stable namespaces and authorized initial facts',
    async () => {
      const plan = (
        await admin.query(
          'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1',
          [world.worldId],
        )
      ).rows[0].document;
      assert.notEqual(plan.actors[0].id, plan.actors[1].id);
      assert.notDeepEqual(plan.history[0].factIds, plan.history[1].factIds);
      assert.equal(plan.history[0].allowedActorIds.length, 1);
      assert.equal(
        plan.actors.find((x: { key: string }) => x.key === a).id,
        plan.history[0].allowedActorIds[0],
      );
    },
  );
  await t.test(
    'one claim is persisted before model use and concurrent auto prepares cannot double-claim',
    async () => {
      const rs = await Promise.all([
        story.prepare(owner, world.worldId, { automatic: true }),
        story.prepare(owner, world.worldId, { automatic: true }),
      ]);
      const claimed = rs.find((r) => r.status === 'claimed');
      assert.ok(claimed);
      if (claimed!.status !== 'claimed') throw Error();
      first = claimed!.claim;
      assert.ok(rs.some((r) => r.status === 'unknown' || r.status === 'busy'));
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_nodes WHERE world_id=$1',
            [world.worldId],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(first.nodeKey, 'first');
    },
  );
  await t.test(
    'history/initial assistant messages never finish a future node; unknown is not automatically re-paid',
    async () => {
      const p = await story.finish(owner, world.worldId, first.claimId);
      assert.equal(p.presented.length, 0);
      assert.equal(p.pending!.commandId, first.commandId);
      assert.equal(p.pending!.status, 'unknown');
      for (let i = 0; i < 3; i++)
        assert.equal((await story.prepare(owner, world.worldId)).status, 'unknown');
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_nodes WHERE world_id=$1',
            [world.worldId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'explicit retry keeps exact original command and expected version, then actual receipt recovers unknown',
    async () => {
      const r = await story.retry(owner, world.worldId, first.claimId);
      assert.equal(r.status, 'claimed');
      if (r.status === 'claimed') {
        assert.equal(r.claim.commandId, first.commandId);
        assert.equal(r.claim.expectedVersion, first.expectedVersion);
      }
      await commit(world.worldId, first, [reply(first)]);
      const p = await story.finish(owner, world.worldId, first.claimId);
      assert.equal(p.presented[0]!.status, 'presented');
      assert.equal(p.presented[0]!.outcome, 'committed');
      assert.equal(p.presented[0]!.playerCompleted, false);
      assert.equal(p.pending, null);
      assert.deepEqual(p.currentStageKeys, ['later']);
    },
  );
  await t.test(
    'automatic ten story minutes apply, manual next eligible invitation only gives one actor/place',
    async () => {
      assert.equal(
        (await story.prepare(owner, world.worldId, { automatic: true })).status,
        'rate_limited',
      );
      invite = await claim(world.worldId);
      assert.equal(invite.nodeKey, 'invite');
      assert.equal(invite.actorId, first.actorId);
      assert.equal(invite.placeId, base.world.startPlaceKey);
      assert.ok(invite.placeName);
      assert.equal(invite.intent.kind, 'offer_invitation');
    },
  );
  await t.test(
    'actual sourced invitation is offered, not committed or player completion; no future branch briefing',
    async () => {
      const actualId = randomUUID();
      await commit(world.worldId, invite, [
        reply(invite),
        {
          type: 'appointment.proposed',
          id: actualId,
          title: '明确实际邀约',
          at: '2026-10-12T10:30:00.000Z',
          participantIds: [invite.actorId],
        },
      ]);
      const p = await story.finish(owner, world.worldId, invite.claimId),
        s = p.presented.find((n) => n.nodeKey === 'invite')!;
      assert.equal(s.status, 'offered');
      assert.equal(s.outcome, null);
      assert.equal(s.playerCompleted, false);
      invitationId = s.invitationId!;
      const links = await story.invitationLinks(owner, world.worldId);
      assert.equal(links.length, 1);
      assert.equal(links[0]!.invitationId, invitationId);
      assert.equal(links[0]!.sourceEventId, s.sourceEventId);
      const brief = await story.sceneBrief(owner, world.worldId, invitationId);
      assert.equal(brief!.editorialIntent, '仅这个当下片段_invite');
      assert.deepEqual(brief!.actorIds, [invite.actorId]);
      assert.equal(await story.sceneBrief(owner, world.worldId, randomUUID()), null);
    },
  );
  await t.test(
    'same-sql helpers are read-only and worker needs an exact live world lease',
    async () => {
      const before = (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.publication_story_receipts WHERE world_id=$1',
          [world.worldId],
        )
      ).rows[0].n;
      const link = await app.transaction(owner, (sql) =>
        readPublicationInvitationLinks(sql, owner, world.worldId),
      );
      assert.equal(link[0]!.invitationId, invitationId);
      const brief = await app.transaction(owner, (sql) =>
        readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
      );
      assert.equal(brief!.nodeKey, 'invite');
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_receipts WHERE world_id=$1',
            [world.worldId],
          )
        ).rows[0].n,
        before,
      );
      await assert.rejects(
        worker.transaction(owner, (sql) =>
          readPublicationInvitationLinks(sql, owner, world.worldId),
        ),
        (e) => (e as { code: string }).code === '42501',
      );
      const task = randomUUID(),
        token = randomUUID();
      await admin.query(
        `INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input,status,lease_token,lease_until) VALUES($1,$2,'world',$3,$4,$5,$6,'running',$7,now()+interval '120 seconds')`,
        [task, owner, world.worldId, randomUUID(), 'a'.repeat(64), {}, token],
      );
      const leased = async <T>(run: (sql: any) => Promise<T>) =>
        worker.transaction(owner, async (sql) => {
          await sql.query(
            "SELECT set_config('app.task_id',$1,true),set_config('app.lease_token',$2,true)",
            [task, token],
          );
          return run(sql);
        });
      assert.equal(
        (await leased((sql) => readPublicationSceneBrief(sql, owner, world.worldId, invitationId)))!
          .nodeKey,
        'invite',
      );
      await assert.rejects(
        leased((sql) => readPublicationSceneBrief(sql, other, world.worldId, invitationId)),
        (e) => (e as { code: string }).code === '42501',
      );
      await assert.rejects(
        leased((sql) => readPublicationInvitationLinks(sql, owner, randomUUID())),
        (e) => (e as { code: string }).code === '42501',
      );
      await assert.rejects(
        leased((sql) => sql.query('SELECT document FROM parallel_life.publication_story_plans')),
        (e) => (e as { code: string }).code === '42501',
      );
      await admin.query(
        "UPDATE parallel_life.tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
        [task],
      );
      await assert.rejects(
        leased((sql) => readPublicationInvitationLinks(sql, owner, world.worldId)),
        (e) => (e as { code: string }).code === '42501',
      );
    },
  );
  await t.test(
    'scene brief is restricted to active current matching scene when scene rows exist',
    async () => {
      // Explicit synthetic scene rows exercise the read gate; this is not real scene playthrough QA.
      const source = (
        await admin.query(
          'SELECT source_event_id FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND node_key=$2',
          [world.worldId, 'invite'],
        )
      ).rows[0].source_event_id;
      const sceneId = randomUUID();
      await admin.query(
        'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
        [
          sceneId,
          world.worldId,
          owner,
          source,
          {
            id: sceneId,
            worldId: world.worldId,
            ownerId: owner,
            appointmentId: invitationId,
            status: 'closed',
          },
        ],
      );
      assert.equal(
        await app.transaction(owner, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
        null,
      );
      await admin.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
        sceneId,
        {
          id: sceneId,
          worldId: world.worldId,
          ownerId: owner,
          appointmentId: invitationId,
          status: 'active',
        },
      ]);
      assert.equal(
        await app.transaction(owner, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
        null,
      );
      await admin.query(
        'INSERT INTO parallel_life.player_experiences(world_id,owner_id,current_scene_id,document) VALUES($1,$2,$3,$4) ON CONFLICT(world_id) DO UPDATE SET current_scene_id=excluded.current_scene_id,document=excluded.document',
        [
          world.worldId,
          owner,
          sceneId,
          {
            ownerId: owner,
            worldId: world.worldId,
            currentSceneId: sceneId,
            view: { kind: 'scene', sceneId },
          },
        ],
      );
      assert.ok(
        await app.transaction(owner, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
      );
      await admin.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
        sceneId,
        {
          id: sceneId,
          worldId: world.worldId,
          ownerId: owner,
          appointmentId: randomUUID(),
          status: 'active',
        },
      ]);
      assert.equal(
        await app.transaction(owner, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
        null,
      );
      // Remove only this local gate fixture so subsequent invitation-response tests remain independent.
      await admin.query('DELETE FROM parallel_life.player_experiences WHERE world_id=$1', [
        world.worldId,
      ]);
      await admin.query('DELETE FROM parallel_life.scene_sessions WHERE id=$1', [sceneId]);
    },
  );
  await t.test(
    'actual accept/cancel responses, not model promises, control typed invitation outcomes',
    async () => {
      const historicalLinks = await story.invitationLinks(owner, world.worldId);
      let state = await runtime.get({ userId: owner }, world.worldId);
      await runtime.respondToInvitation(
        { userId: owner },
        {
          commandId: randomUUID(),
          worldId: world.worldId,
          id: invitationId,
          expectedVersion: state.version,
          operation: 'accept',
        },
      );
      let p = await story.progress(owner, world.worldId);
      assert.equal(p.presented.find((s) => s.nodeKey === 'invite')!.status, 'committed');
      assert.equal(p.presented.find((s) => s.nodeKey === 'invite')!.playerCompleted, false);
      state = await runtime.get({ userId: owner }, world.worldId);
      await runtime.respondToInvitation(
        { userId: owner },
        {
          commandId: randomUUID(),
          worldId: world.worldId,
          id: invitationId,
          expectedVersion: state.version,
          operation: 'cancel',
        },
      );
      p = await story.progress(owner, world.worldId);
      assert.equal(p.presented.find((s) => s.nodeKey === 'invite')!.outcome, 'declined');
      assert.deepEqual(await story.invitationLinks(owner, world.worldId), historicalLinks);
      assert.equal(await story.sceneBrief(owner, world.worldId, invitationId), null);
    },
  );
  await t.test(
    'public progress reveals only already presented provenance, not future titles, instructions or plan',
    async () => {
      const text = JSON.stringify(await story.progress(owner, world.worldId));
      for (const marker of [
        '私有未来标题',
        '仅这个当下片段',
        '源节点小片段',
        'privatePersona',
        'HIDDEN_FULL_CONTEXT',
        'alternatives',
        'prerequisites',
      ])
        assert.equal(text.includes(marker), false);
    },
  );
  await t.test(
    'precise immutable version plan survives saving/publishing new drafts and downlisting',
    async () => {
      const saved = await works.save(staff, w.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
        content: { ...authored(), candidates: [] },
      });
      assert.equal(saved.draftVersion, 1);
      await works.unpublish(staff, w.id, { commandId: randomUUID(), expectedMetadataVersion: 1 });
      const p = await story.progress(owner, world.worldId);
      assert.equal(p.totalNodes, 2);
      const source = (
        await app.transaction(owner, (sql) =>
          sql.query('SELECT parallel_life.publication_story_source($1) AS s', [world.worldId]),
        )
      ).rows[0].s;
      assert.equal(source.origin.draftVersion, 0);
      assert.equal(source.origin.contentHash, world.origin.contentHash);
    },
  );
  await t.test(
    'another owner cannot read plan/nodes/receipts, claim, skip, finish or retrieve scene briefs',
    async () => {
      for (const method of [
        () => story.progress(other, world.worldId),
        () => story.prepare(other, world.worldId),
        () => story.finish(other, world.worldId, first.claimId),
        () => story.skip(other, world.worldId, 'first', randomUUID()),
        () => story.sceneBrief(other, world.worldId, invitationId),
      ])
        await assert.rejects(method(), code('NOT_FOUND'));
      for (const table of [
        'publication_story_plans',
        'publication_story_nodes',
        'publication_story_receipts',
      ])
        assert.equal(
          (
            await app.transaction(other, (s) =>
              s.query('SELECT * FROM parallel_life.' + table + ' WHERE world_id=$1', [
                world.worldId,
              ]),
            )
          ).rowCount,
          0,
        );
    },
  );
  await t.test(
    'role privileges do not expose publication raw content, new helpers or arbitrary player writes to staff/worker',
    async () => {
      for (const db of [pub, worker])
        for (const table of [
          'publication_story_plans',
          'publication_story_nodes',
          'publication_story_receipts',
        ])
          await assert.rejects(
            db.transaction(owner, (s) => s.query('SELECT * FROM parallel_life.' + table)),
            (e) => (e as { code: string }).code === '42501',
          );
      await assert.rejects(
        app.transaction(owner, (s) =>
          s.query('SELECT content FROM parallel_life.publication_draft_revisions'),
        ),
        (e) => (e as { code: string }).code === '42501',
      );
      for (const db of [pub, worker])
        await assert.rejects(
          db.transaction(owner, (s) =>
            s.query('SELECT parallel_life.publication_story_source($1)', [world.worldId]),
          ),
          (e) => (e as { code: string }).code === '42501',
        );
    },
  );
  await t.test(
    'SQL provenance guards forbid false player completion, guessed source and claim rewrites',
    async () => {
      await assert.rejects(
        app.transaction(owner, (s) =>
          s.query(
            'UPDATE parallel_life.publication_story_nodes SET player_completed=true WHERE world_id=$1 AND node_key=$2',
            [world.worldId, 'first'],
          ),
        ),
        (e) => (e as { code: string }).code === '23514',
      );
      await assert.rejects(
        app.transaction(owner, (s) =>
          s.query(
            'UPDATE parallel_life.publication_story_nodes SET command_id=$3 WHERE world_id=$1 AND node_key=$2',
            [world.worldId, 'first', randomUUID()],
          ),
        ),
        (e) => (e as { code: string }).code === '23514',
      );
      await assert.rejects(
        app.transaction(owner, (s) =>
          s.query(
            'UPDATE parallel_life.publication_story_nodes SET source_event_id=$3 WHERE world_id=$1 AND node_key=$2',
            [world.worldId, 'first', 'publication-genesis:' + world.worldId],
          ),
        ),
        (e) => ['23514', '23503'].includes((e as { code: string }).code),
      );
      await assert.rejects(
        admin.query(
          'UPDATE parallel_life.publication_story_plans SET document=$1 WHERE world_id=$2',
          [{}, world.worldId],
        ),
        (e) => (e as { code: string }).code === '23514',
      );
    },
  );
  await t.test(
    'story clock expiry records a skipped opportunity, never an authored future world event',
    async () => {
      const c = authored();
      c.candidates = [
        {
          ...c.candidates[0],
          prerequisites: [],
          timeline: {
            ...c.candidates[0].timeline,
            window: { notBefore: start, expiresAt: '2026-10-12T09:10:00.000Z' },
          },
        },
      ];
      c.timeline.stages = [c.timeline.stages[0]];
      const { world: x } = await make(c);
      const before = (
        await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [x.worldId])
      ).rows[0].version;
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        x.worldId,
        '2026-10-12T09:10:00.000Z',
      ]);
      assert.equal((await story.prepare(owner, x.worldId)).status, 'none');
      const row = (
        await admin.query('SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1', [
          x.worldId,
        ])
      ).rows[0];
      assert.equal(row.outcome, 'expired');
      assert.equal(row.source_event_id, null);
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [x.worldId]))
          .rows[0].version,
        before,
      );
    },
  );
  await t.test(
    'explicit owner skip is idempotent, different-node command reuse conflicts and future skip rejects',
    async () => {
      const authoredSkip = authored();
      authoredSkip.candidates[1].prerequisites = [
        { kind: 'after_resolved_node', nodeKey: 'first', outcomes: ['skipped'] },
      ];
      const { world: x } = await make(authoredSkip);
      const command = randomUUID();
      await assert.rejects(
        story.skip(owner, x.worldId, 'invite', randomUUID()),
        code('INVALID_STATE'),
      );
      await story.skip(owner, x.worldId, 'first', command);
      await story.skip(owner, x.worldId, 'first', command);
      await assert.rejects(
        story.skip(owner, x.worldId, 'invite', command),
        code('IDEMPOTENCY_CONFLICT'),
      );
      assert.equal((await claim(x.worldId)).nodeKey, 'invite');
    },
  );
  await t.test(
    'invitation destination is independent of the actual player trigger location',
    async () => {
      const c = authored();
      c.places.push({
        key: 'restaurant',
        name: '餐厅',
        description: '公开可去的地点',
        knownAtStart: true,
      });
      c.candidates = [
        {
          ...c.candidates[1],
          prerequisites: [],
          intent: { ...c.candidates[1].intent, placeKey: 'restaurant', title: '餐厅约见' },
          timeline: { ...c.candidates[0].timeline },
        },
      ];
      c.timeline.stages = [c.timeline.stages[0]];
      const { world: x } = await make(c),
        chosen = await claim(x.worldId);
      assert.equal(chosen.placeId, 'restaurant');
      assert.equal(chosen.placeName, '餐厅');
      assert.equal(chosen.placeDescription, '公开可去的地点');
      assert.equal(
        (await runtime.get({ userId: owner }, x.worldId)).space!.currentPlaceId,
        base.world.startPlaceKey,
      );
      await commit(x.worldId, chosen, [
        reply(chosen),
        {
          type: 'appointment.proposed',
          id: randomUUID(),
          title: '餐厅约见',
          at: '2026-10-12T10:30:00.000Z',
          participantIds: [chosen.actorId],
        },
      ]);
      await story.finish(owner, x.worldId, chosen.claimId);
      assert.equal((await story.invitationLinks(owner, x.worldId))[0]!.placeId, 'restaurant');
      assert.equal(
        (await runtime.get({ userId: owner }, x.worldId)).space!.currentPlaceId,
        base.world.startPlaceKey,
      );
      const restricted = structuredClone(c);
      restricted.candidates[0].prerequisites = [{ kind: 'at_place', placeKey: 'restaurant' }];
      const { world: y } = await make(restricted);
      const blocked = await story.prepare(owner, y.worldId, { automatic: false });
      assert.deepEqual(blocked, { status: 'none', managed: true });
    },
  );
  await t.test('director sees an authored address before the player travels there', async () => {
    const c = authored();
    c.places.push({
      key: 'hospital',
      name: '医院',
      description: '虚构城市中心路 8 号',
      knownAtStart: true,
    });
    c.routes.push({
      fromPlaceKey: c.world.startPlaceKey,
      toPlaceKey: 'hospital',
      minutes: 15,
    });
    c.candidates[0].settingPlaceKey = 'hospital';
    c.candidates[0].intent = { kind: 'director_event', actorKey: a };
    const { world: x } = await make(c);
    const pool = await story.opportunities(owner, x.worldId, false);
    assert.equal(pool.candidates[0]?.placeName, '医院');
    assert.equal(pool.candidates[0]?.placeDescription, '虚构城市中心路 8 号');
    const attempt = randomUUID();
    assert.equal(
      await story.beginSelection(owner, x.worldId, pool.version, attempt, ['first']),
      true,
    );
    await story.finishSelection(owner, x.worldId, attempt, 'selected', 'first');
    const prepared = await story.prepare(owner, x.worldId, {
      automatic: false,
      nodeKey: 'first',
      expectedVersion: pool.version,
    });
    assert.equal(prepared.status, 'claimed');
    if (prepared.status !== 'claimed') throw Error('MISSING_CLAIM');
    const chosen = prepared.claim;
    assert.equal(chosen.nodeKey, 'first');
    assert.equal(chosen.placeName, '医院');
    assert.equal(chosen.placeDescription, '虚构城市中心路 8 号');
    assert.equal(
      (await runtime.get({ userId: owner }, x.worldId)).space!.currentPlaceId,
      c.world.startPlaceKey,
    );
  });
  await t.test(
    'hidden authored place appears only after a committed NPC story message and survives retry',
    async () => {
      const c = authored();
      c.places.push({
        key: 'hidden_hospital',
        name: '医院',
        description: '虚构城市中心路 8 号',
        knownAtStart: false,
      });
      c.routes.push({
        fromPlaceKey: c.world.startPlaceKey,
        toPlaceKey: 'hidden_hospital',
        minutes: 15,
      });
      c.candidates[0].settingPlaceKey = 'hidden_hospital';
      c.candidates[0].intent = { kind: 'director_event', actorKey: a };
      const { w, world: x } = await make(c);
      const wid = x.worldId;
      const before = await runtime.get({ userId: owner }, wid);
      assert.equal(
        before.space!.places.some((p) => p.id === 'hidden_hospital'),
        false,
      );
      assert.equal(
        before.space!.routes.some((r) => r.toPlaceId === 'hidden_hospital'),
        false,
      );
      const otherWorld = await worlds.startPublished(other, w.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      });
      assert.equal(
        (await runtime.get({ userId: other }, otherWorld.worldId)).space!.places.some(
          (p) => p.id === 'hidden_hospital',
        ),
        false,
      );
      await assert.rejects(runtime.get({ userId: other }, wid), code('NOT_FOUND'));
      const pool = await story.opportunities(owner, wid, false);
      assert.equal(pool.candidates[0]?.placeName, '医院');
      assert.equal(pool.candidates[0]?.placeDescription, '虚构城市中心路 8 号');
      const attempt = randomUUID();
      assert.equal(await story.beginSelection(owner, wid, pool.version, attempt, ['first']), true);
      await story.finishSelection(owner, wid, attempt, 'selected', 'first');
      const prepared = await story.prepare(owner, wid, {
        automatic: false,
        nodeKey: 'first',
        expectedVersion: pool.version,
      });
      assert.equal(prepared.status, 'claimed');
      if (prepared.status !== 'claimed') throw Error('MISSING_CLAIM');
      const chosen = prepared.claim;
      assert.equal(chosen.placeDescription, '虚构城市中心路 8 号');
      assert.equal(
        (await runtime.get({ userId: owner }, wid)).space!.places.length,
        before.space!.places.length,
      );
      const sourceCommand = {
        id: chosen.commandId,
        worldId: wid,
        actorId: chosen.actorId,
        expectedVersion: chosen.expectedVersion,
        text: '明确内部本地测试指示',
        origin: 'director' as const,
      };
      const sourceEvent: WorldEvent = {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: wid,
        version: chosen.expectedVersion + 1,
        commandId: chosen.commandId,
        type: 'turn.resolved',
        occurredAt: new Date().toISOString(),
        storyAt: before.time,
        data: {
          actorId: chosen.actorId,
          userText: sourceCommand.text,
          origin: 'director',
          effects: [
            {
              type: 'message.received',
              id: randomUUID(),
              actorId: chosen.actorId,
              text: '请到医院，虚构城市中心路 8 号见。',
            },
          ],
        },
      };
      const execute = () =>
        app.transaction(owner, async (sql) => {
          const result = await runtime.commitInTransaction(
            sql,
            { userId: owner },
            sourceCommand,
            sourceEvent,
          );
          // Check the real deferred command→original NPC event identity before this UoW commits.
          await sql.query('SET CONSTRAINTS parallel_life.command_same_event IMMEDIATE');
          return result;
        });
      const countCausalRows = async () => {
        const counts: Record<string, number> = {};
        for (const table of [
          'commands',
          'world_events',
          'world_messages',
          'world_appointments',
          'outbox_jobs',
          'publication_story_nodes',
          'publication_story_receipts',
          'publication_story_progress',
          'publication_story_progress_evidence',
        ])
          counts[table] = Number(
            (
              await admin.query(
                `SELECT count(*) AS n FROM parallel_life.${table} WHERE world_id=$1`,
                [wid],
              )
            ).rows[0].n,
          );
        return counts;
      };
      const beforeProducer = await runtime.get({ userId: owner }, wid),
        beforeCounts = await countCausalRows();
      await admin.query(
        "CREATE FUNCTION parallel_life.story_place_local_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'type'='space.place_revealed' THEN RAISE EXCEPTION 'LOCAL_REVEAL_FAILURE'; END IF; RETURN NEW; END $$",
      );
      await admin.query(
        'CREATE TRIGGER story_place_local_failure BEFORE INSERT ON parallel_life.world_events FOR EACH ROW EXECUTE FUNCTION parallel_life.story_place_local_failure()',
      );
      try {
        await assert.rejects(execute(), { code: 'P0001', message: 'LOCAL_REVEAL_FAILURE' });
      } finally {
        await admin.query('DROP TRIGGER story_place_local_failure ON parallel_life.world_events');
        await admin.query('DROP FUNCTION parallel_life.story_place_local_failure()');
      }
      assert.deepEqual(await runtime.get({ userId: owner }, wid), beforeProducer);
      assert.deepEqual(await countCausalRows(), beforeCounts);
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
            wid,
            sourceCommand.id,
          ])
        ).rowCount,
        0,
      );
      // A suppressed final UPDATE must fail via the actual rowCount guard and roll back both events.
      await admin.query(
        `CREATE FUNCTION parallel_life.story_place_receipt_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${sourceCommand.id}' AND (NEW.result_state->>'version')::integer>${sourceEvent.version} THEN RETURN NULL; END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        'CREATE TRIGGER story_place_receipt_noop BEFORE UPDATE ON parallel_life.commands FOR EACH ROW EXECUTE FUNCTION parallel_life.story_place_receipt_noop()',
      );
      try {
        await assert.rejects(execute(), code('VERSION_CONFLICT'));
      } finally {
        await admin.query('DROP TRIGGER story_place_receipt_noop ON parallel_life.commands');
        await admin.query('DROP FUNCTION parallel_life.story_place_receipt_noop()');
      }
      assert.deepEqual(await runtime.get({ userId: owner }, wid), beforeProducer);
      assert.deepEqual(await countCausalRows(), beforeCounts);
      const turn = await execute();
      assert.equal(turn.event.id, sourceEvent.id);
      assert.equal(turn.event.version, sourceCommand.expectedVersion + 1);
      assert.equal(turn.state.version, turn.event.version + 1);
      assert.equal(
        (await runtime.get({ userId: owner }, wid)).space!.places.some(
          (p) => p.id === 'hidden_hospital',
        ),
        true,
      );
      assert.deepEqual(turn.state, await runtime.get({ userId: owner }, wid));
      const receiptCounts = await countCausalRows();
      assert.deepEqual(await execute(), turn);
      assert.deepEqual(await runtime.receipt({ userId: owner }, sourceCommand), turn);
      assert.deepEqual(await countCausalRows(), receiptCounts);
      const persisted = (
        await admin.query(
          'SELECT expected_version,result_event_id,result_state FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
          [wid, sourceCommand.id],
        )
      ).rows[0];
      assert.equal(persisted.expected_version, sourceCommand.expectedVersion);
      assert.equal(persisted.result_event_id, sourceEvent.id);
      assert.equal(persisted.result_state.version, turn.state.version);
      const subsequentCommand = {
        id: randomUUID(),
        worldId: wid,
        actorId: chosen.actorId,
        expectedVersion: turn.state.version,
        text: '我先看看安排，再决定是否过去。',
      };
      const subsequent = await runtime.commit({ userId: owner }, subsequentCommand, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: wid,
        version: turn.state.version + 1,
        commandId: subsequentCommand.id,
        type: 'turn.resolved',
        occurredAt: new Date().toISOString(),
        storyAt: turn.state.time,
        data: {
          actorId: chosen.actorId,
          userText: subsequentCommand.text,
          effects: [
            {
              type: 'message.received',
              id: randomUUID(),
              actorId: chosen.actorId,
              text: '好，你看过再说。',
            },
          ],
        },
      });
      assert.equal(subsequent.state.version, turn.state.version + 1);
      assert.deepEqual(
        await execute(),
        turn,
        'a different later input must not change the old causal receipt',
      );
      const progress = await story.finish(owner, wid, chosen.claimId);
      assert.equal(progress.presented[0]?.sourceEventId, turn.event.id);
      const after = await runtime.get({ userId: owner }, wid);
      const place = after.space!.places.find((p) => p.id === 'hidden_hospital');
      assert.equal(place?.description, '虚构城市中心路 8 号');
      assert.equal(place?.source.kind, 'world_event');
      assert.equal(after.space!.currentPlaceId, c.world.startPlaceKey);
      const route = after.space!.routes.find((r) => r.toPlaceId === 'hidden_hospital');
      assert.equal(route?.durationMinutes, 15);
      assert.match(route!.id, /^publication_discovery_route_/);
      const map = new PostgresWorldSpace(app, officialLifeCatalog);
      assert.equal(
        (await map.read(owner, wid)).routes.some((r) => r.id === route!.id),
        true,
      );
      const reveal = (
        await admin.query(
          "SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='space.place_revealed'",
          [wid],
        )
      ).rows;
      assert.equal(reveal.length, 1);
      assert.equal(reveal[0].payload.data.sourceEventId, turn.event.id);
      await story.finish(owner, wid, chosen.claimId);
      assert.equal((await runtime.get({ userId: owner }, wid)).version, after.version);
      await admin.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [
        wid,
      ]);
      const journey = await map.travel(owner, wid, {
        commandId: randomUUID(),
        expectedVersion: after.version,
        routeId: route!.id,
      });
      assert.equal(journey.destinationLabel, '医院');
      assert.equal(
        (await runtime.get({ userId: owner }, wid)).space!.currentPlaceId,
        'hidden_hospital',
      );
      assert.equal(
        (await runtime.get({ userId: other }, otherWorld.worldId)).space!.places.some(
          (p) => p.id === 'hidden_hospital',
        ),
        false,
      );
      assert.deepEqual(
        await runtime.receipt({ userId: owner }, sourceCommand),
        turn,
        'later player travel must not change an old receipt or claim earlier arrival',
      );
    },
  );
  await t.test(
    'a greeting or player text cannot reveal an address; a later committed NPC message can',
    async () => {
      const c = authored();
      c.places.push({
        key: 'hidden_hospital',
        name: '医院',
        description: '虚构城市中心路 8 号',
        knownAtStart: false,
      });
      c.routes.push({
        fromPlaceKey: c.world.startPlaceKey,
        toPlaceKey: 'hidden_hospital',
        minutes: 15,
      });
      c.candidates[0].settingPlaceKey = 'hidden_hospital';
      c.candidates[0].intent = { kind: 'director_event', actorKey: a };
      const { world: x } = await make(c);
      const wid = x.worldId;
      const pool = await story.opportunities(owner, wid, false);
      const attempt = randomUUID();
      assert.equal(await story.beginSelection(owner, wid, pool.version, attempt, ['first']), true);
      await story.finishSelection(owner, wid, attempt, 'selected', 'first');
      const prepared = await story.prepare(owner, wid, {
        automatic: false,
        nodeKey: 'first',
        expectedVersion: pool.version,
      });
      assert.equal(prepared.status, 'claimed');
      if (prepared.status !== 'claimed') throw Error('MISSING_CLAIM');
      const chosen = prepared.claim;
      await commit(wid, chosen, [reply(chosen)]);
      await story.finish(owner, wid, chosen.claimId);
      assert.equal(
        (await runtime.get({ userId: owner }, wid)).space!.places.some(
          (p) => p.id === 'hidden_hospital',
        ),
        false,
      );
      const normalReply = async (text: string, userText: string) => {
        const previous = await runtime.get({ userId: owner }, wid);
        const commandId = randomUUID();
        return runtime.commit(
          { userId: owner },
          {
            id: commandId,
            worldId: wid,
            actorId: chosen.actorId,
            expectedVersion: previous.version,
            text: userText,
          },
          {
            schemaVersion: 1,
            id: randomUUID(),
            worldId: wid,
            version: previous.version + 1,
            commandId,
            type: 'turn.resolved',
            occurredAt: new Date().toISOString(),
            storyAt: start,
            data: {
              actorId: chosen.actorId,
              userText,
              effects: [
                {
                  type: 'message.received',
                  id: randomUUID(),
                  actorId: chosen.actorId,
                  text,
                },
              ],
            },
          },
        );
      };
      await normalReply('你好，我们晚点再说。', '医院在哪里？');
      await story.progress(owner, wid);
      assert.equal(
        (await runtime.get({ userId: owner }, wid)).space!.places.some(
          (p) => p.id === 'hidden_hospital',
        ),
        false,
      );
      const later = await normalReply(
        '我在医院等你，地址是虚构城市中心路 8 号。',
        '请告诉我具体位置。',
      );
      await story.progress(owner, wid);
      const after = await runtime.get({ userId: owner }, wid);
      assert.equal(
        after.space!.places.some((p) => p.id === 'hidden_hospital'),
        true,
      );
      const reveals = (
        await admin.query(
          "SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='space.place_revealed'",
          [wid],
        )
      ).rows;
      assert.equal(reveals.length, 1);
      assert.equal(reveals[0].payload.data.sourceEventId, later.event.id);
      await story.progress(owner, wid);
      assert.equal((await runtime.get({ userId: owner }, wid)).version, after.version);
    },
  );
  await t.test(
    'one-way player travel cannot select a hidden event whose address would be unreachable',
    async () => {
      const c = authored();
      c.places.push({ key: 'waypoint', name: '码头', description: '虚构码头', knownAtStart: true });
      c.places.push({
        key: 'hidden_hospital',
        name: '医院',
        description: '虚构城市中心路 8 号',
        knownAtStart: false,
      });
      c.routes.push({ fromPlaceKey: c.world.startPlaceKey, toPlaceKey: 'waypoint', minutes: 5 });
      c.routes.push({
        fromPlaceKey: c.world.startPlaceKey,
        toPlaceKey: 'hidden_hospital',
        minutes: 15,
      });
      c.candidates[0].settingPlaceKey = 'hidden_hospital';
      c.candidates[0].intent = { kind: 'director_event', actorKey: a };
      const { world: x } = await make(c);
      const wid = x.worldId;
      const before = await runtime.get({ userId: owner }, wid);
      const map = new PostgresWorldSpace(app, officialLifeCatalog);
      const route = before.space!.routes.find((r) => r.toPlaceId === 'waypoint')!;
      await admin.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [
        wid,
      ]);
      await map.travel(owner, wid, {
        commandId: randomUUID(),
        expectedVersion: before.version,
        routeId: route.id,
      });
      assert.equal((await runtime.get({ userId: owner }, wid)).space!.currentPlaceId, 'waypoint');
      assert.equal(
        (await story.opportunities(owner, wid, false)).candidates.some(
          (n) => n.nodeKey === 'first',
        ),
        false,
      );
      assert.equal(
        (await story.prepare(owner, wid, { automatic: false, nodeKey: 'first' })).status,
        'none',
      );
      assert.equal(
        (await map.read(owner, wid)).places.some((p) => p.id === 'hidden_hospital'),
        false,
      );
    },
  );
  await t.test(
    'multiple authored places reveal separately with stable independent route IDs',
    async () => {
      const c = authored();
      delete c.timeline;
      c.places.push({
        key: 'hidden_hospital',
        name: '医院',
        description: '虚构医院路 8 号',
        knownAtStart: false,
      });
      c.places.push({
        key: 'hidden_cafe',
        name: '咖啡馆',
        description: '虚构咖啡街 9 号',
        knownAtStart: false,
      });
      c.routes.push({
        fromPlaceKey: c.world.startPlaceKey,
        toPlaceKey: 'hidden_hospital',
        minutes: 15,
      });
      c.routes.push({
        fromPlaceKey: c.world.startPlaceKey,
        toPlaceKey: 'hidden_cafe',
        minutes: 12,
      });
      const first = {
        ...c.candidates[0],
        intent: { kind: 'director_event', actorKey: a },
        settingPlaceKey: 'hidden_hospital',
      };
      const second = {
        ...c.candidates[0],
        key: 'second',
        title: '咖啡馆的来信',
        intent: { kind: 'director_event', actorKey: a },
        settingPlaceKey: 'hidden_cafe',
        prerequisites: [],
      };
      delete first.timeline;
      delete second.timeline;
      c.candidates = [first, second];
      const { world: x } = await make(c);
      const wid = x.worldId;
      const reveal = async (nodeKey: string, placeName: string) => {
        const pool = await story.opportunities(owner, wid, false);
        const attempt = randomUUID();
        assert.equal(
          await story.beginSelection(owner, wid, pool.version, attempt, [nodeKey]),
          true,
        );
        await story.finishSelection(owner, wid, attempt, 'selected', nodeKey);
        const prepared = await story.prepare(owner, wid, {
          automatic: false,
          nodeKey,
          expectedVersion: pool.version,
        });
        assert.equal(prepared.status, 'claimed');
        if (prepared.status !== 'claimed') throw Error('MISSING_CLAIM');
        const chosen = prepared.claim;
        await commit(wid, chosen, [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: chosen.actorId,
            text: `在${placeName}见。`,
          },
        ]);
        await story.finish(owner, wid, chosen.claimId);
      };
      await reveal('first', '医院');
      let after = await runtime.get({ userId: owner }, wid);
      assert.equal(
        after.space!.places.some((p) => p.id === 'hidden_hospital'),
        true,
      );
      assert.equal(
        after.space!.places.some((p) => p.id === 'hidden_cafe'),
        false,
      );
      await admin.query(
        "UPDATE parallel_life.publication_story_selections SET created_at=clock_timestamp()-interval '11 minutes' WHERE world_id=$1",
        [wid],
      );
      await reveal('second', '咖啡馆');
      after = await runtime.get({ userId: owner }, wid);
      const hiddenRoutes = after.space!.routes.filter((r) =>
        r.id.startsWith('publication_discovery_route_'),
      );
      assert.equal(hiddenRoutes.length, 2);
      assert.equal(new Set(hiddenRoutes.map((r) => r.id)).size, 2);
      assert.deepEqual(
        new Set(hiddenRoutes.map((r) => r.toPlaceId)),
        new Set(['hidden_hospital', 'hidden_cafe']),
      );
    },
  );
  await t.test(
    'unknown retry after another world event cannot silently change original expectedVersion',
    async () => {
      const { world: x } = await make();
      const c = await claim(x.worldId);
      await story.finish(owner, x.worldId, c.claimId);
      const s = await runtime.get({ userId: owner }, x.worldId);
      const different = { ...c, commandId: randomUUID(), expectedVersion: s.version };
      await commit(x.worldId, different, [reply(different)]);
      await assert.rejects(story.retry(owner, x.worldId, c.claimId), code('VERSION_CONFLICT'));
      assert.equal((await story.prepare(owner, x.worldId)).status, 'unknown');
    },
  );
  await t.test('actual reply from wrong actor/command cannot fulfill a claimed node', async () => {
    const { world: x } = await make();
    const c = await claim(x.worldId),
      s = await runtime.get({ userId: owner }, x.worldId);
    const wrongActor = s.actors.find((a) => a.id !== c.actorId)!.id;
    const otherClaim = { ...c, actorId: wrongActor };
    await commit(x.worldId, otherClaim, [reply(otherClaim)]);
    await assert.rejects(story.finish(owner, x.worldId, c.claimId), code('INVALID_STATE'));
  });
  await t.test('late audit failure rolls back claim and all receipt state atomically', async () => {
    const { world: x } = await make();
    await story.progress(owner, x.worldId);
    await admin.query(
      "CREATE FUNCTION parallel_life.story_local_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_LATE_STORY_FAILURE'; END $$",
    );
    await admin.query(
      'CREATE TRIGGER story_local_failure BEFORE INSERT ON parallel_life.publication_story_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.story_local_failure()',
    );
    try {
      await assert.rejects(story.prepare(owner, x.worldId), code('UNAVAILABLE'));
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_nodes WHERE world_id=$1',
            [x.worldId],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await admin.query(
        'DROP TRIGGER story_local_failure ON parallel_life.publication_story_receipts',
      );
      await admin.query('DROP FUNCTION parallel_life.story_local_failure()');
    }
  });
  await t.test(
    'static publication with no timeline/candidates returns unmanaged none without sidecar rows',
    async () => {
      const { world: x } = await make(structuredClone(base));
      const r = await story.prepare(owner, x.worldId);
      assert.deepEqual(r, { status: 'none', managed: false });
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_plans WHERE world_id=$1',
            [x.worldId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});
