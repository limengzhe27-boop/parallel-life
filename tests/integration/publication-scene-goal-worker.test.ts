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
import { PublicationStoryRepository } from '../../src/modules/settings/infrastructure/publication-story-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';

import { PublicationEventProgressRepository } from '../../src/modules/settings/infrastructure/publication-event-progress-repository.ts';
import type { ProgressSignal } from '../../src/modules/settings/domain/story-event-progress.ts';
import type { ProgressLedgerDefinition } from '../../src/modules/settings/infrastructure/publication-event-progress-repository.ts';
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
/** This trusted fixture compiler creates only the opening; the real story repository
 * reads the immutable authored plan. Turn effects below are synthetic test proposals. */
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

test('leased scene goals expose only real introduced current-actor directions and reject future, foreign and expired leases', async (t) => {
  const config = await localConfig();
  const port = process.env.PUBLICATION_STORY_TEST_PORT ?? '55503';
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
  content.candidates.push({
    ...structuredClone(content.candidates[0]),
    key: 'complete',
    actorKeys: [content.actors[1].key],
    intent: { kind: 'director_event', actorKey: content.actors[1].key },
    direction: {
      mode: 'optional',
      progress: {
        completion: {
          mode: 'all',
          criteria: [
            {
              key: 'said_result',
              kind: 'npc_exact_message',
              actorKey: content.actors[1].key,
              phrase: '这次不再邀约了',
            },
          ],
        },
      },
    },
  });
  content.places.push({
    key: 'arrival_place',
    name: '约定地点',
    description: '明确合成地点',
    knownAtStart: true,
  });
  content.routes.push({
    fromPlaceKey: content.world.startPlaceKey,
    toPlaceKey: 'arrival_place',
    minutes: 10,
  });
  content.candidates.push({
    ...structuredClone(content.candidates[0]),
    key: 'arrival',
    actorKeys: [content.actors[1].key],
    scenePlaceKeys: ['arrival_place'],
    intent: { kind: 'director_event', actorKey: content.actors[1].key },
  });
  delete content.timeline;
  delete content.openingEventKey;
  content.actors.forEach((a: any, i: number) => {
    a.lifeModules = { behavior: `Explicit synthetic character ${i} voice` };
  });
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
    candidate = pool.candidates.find((c) => c.nodeKey === 'dynamic')!;
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

  const ledger = new PublicationEventProgressRepository();
  const value: ProgressLedgerDefinition = {
    definition: {
      ownerId: owner,
      worldId: world.worldId,
      nodeKey: 'dynamic',
      pace: 'brief',
      refusal: 'defer',
      completion: null,
      goals: [
        {
          actorId: chosen,
          want: '准备自己的晚饭',
          stance: '不强求参与',
          boundaries: ['尊重拒绝'],
          authoredSourceId: 'explicit_local_fixture',
          completionCriterionIds: [],
        },
      ],
    },
    spec: { pace: 'brief', refusal: 'defer' },
    actorIdsByKey: new Map(candidate.actorOptions!.map((a) => [a.key, a.id])),
  };
  async function turn(
    version: number,
    role: 'director' | 'player',
    text: string,
    commandId: string = randomUUID(),
  ) {
    const messageId = randomUUID(),
      eventId = randomUUID();
    const command = {
      id: commandId,
      worldId: world.worldId,
      actorId: chosen,
      expectedVersion: version,
      text,
      ...(role === 'director' ? { origin: 'director' as const } : {}),
    };
    const result = await runtime.commit({ userId: owner }, command, {
      schemaVersion: 1,
      id: eventId,
      worldId: world.worldId,
      version: version + 1,
      commandId,
      type: 'turn.resolved',
      occurredAt: start,
      storyAt: start,
      data: {
        actorId: chosen,
        userText: text,
        ...(role === 'director' ? { origin: 'director' as const } : {}),
        effects: [
          {
            type: 'message.received',
            id: messageId,
            actorId: chosen,
            text: role === 'director' ? text : '好的，我听到了。',
          },
        ],
      },
    });
    const player = (
      await admin.query(
        "SELECT id FROM parallel_life.world_messages WHERE world_id=$1 AND document->>'sourceEventId'=$2 AND document->>'role'='user'",
        [world.worldId, eventId],
      )
    ).rows[0];
    return {
      eventId,
      messageId,
      recordId: role === 'director' ? messageId : player.id,
      version: version + 1,
      result,
    };
  }
  const intro = await turn(0, 'director', '今晚我想邀你吃饭。', prepared.claim.commandId);
  await story.finish(owner, world.worldId, prepared.claim.claimId);

  const own = await app.transaction(
    owner,
    async (sql) =>
      (
        await sql.query('SELECT parallel_life.publication_active_event_goals($1,$2) items', [
          world.worldId,
          chosen,
        ])
      ).rows[0].items,
  );
  assert.equal(own.length, 1);
  assert.equal(own[0].node.key, 'dynamic');
  assert.equal(own[0].node.script, script);
  assert.equal(own[0].state.sourceEventId, intro.eventId);
  assert.deepEqual(Object.values(own[0].actorIdsByKey), [chosen]);
  const foreign = randomUUID();
  await new IdentityRepository(app).ensureGuest(foreign);
  await assert.rejects(
    app.transaction(foreign, (sql) =>
      sql.query('SELECT parallel_life.publication_active_event_goals($1,NULL)', [world.worldId]),
    ),
    (e) => (e as any).code === '42501',
  );
  await app.transaction(owner, (sql) => ledger.initialize(sql, value, intro.version));
  await admin.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [
    world.worldId,
  ]);
  const scene = await new SceneRepository(app).enterPlace(owner, world.worldId, {
    commandId: randomUUID(),
    expectedVersion: intro.version,
    placeId: doc.world.startPlaceKey,
  });
  const token = randomUUID();
  const task = (
    await admin.query(
      "UPDATE parallel_life.tasks SET status='running',lease_token=$3,lease_until=clock_timestamp()+interval '60 seconds' WHERE scope_id=$1 AND input->>'sceneId'=$2 RETURNING id",
      [world.worldId, scene.sceneId, token],
    )
  ).rows[0];
  assert.ok(task);
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(() => worker.close());
  const run = async <T>(fn: (sql: any) => Promise<T>, overrideToken = token) =>
    worker.transaction('', async (sql) => {
      await sql.query(
        "SELECT set_config('app.task_id',$1,true),set_config('app.lease_token',$2,true),set_config('app.user_id','',true)",
        [task.id, overrideToken],
      );
      return fn(sql);
    });
  const workerRows = await run(
    async (sql) =>
      (
        await sql.query('SELECT parallel_life.publication_active_event_goals($1,$2) items', [
          world.worldId,
          chosen,
        ])
      ).rows[0].items,
  );
  assert.equal(workerRows.length, 1);
  assert.equal(workerRows[0].persona.voice, doc.actors[1]!.privatePersona.voice);
  const modules = await run(
    async (sql) =>
      (
        await sql.query('SELECT parallel_life.publication_actor_life_modules($1,$2) items', [
          world.worldId,
          chosen,
        ])
      ).rows[0].items,
  );
  assert.equal(modules.behavior, doc.actors[1]!.lifeModules!.behavior);
  const candidates = await run(
    async (sql) =>
      (
        await sql.query('SELECT parallel_life.publication_scene_goal_candidates($1) items', [
          world.worldId,
        ])
      ).rows[0].items,
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].actorId, chosen);
  assert.equal(candidates[0].source.sourceRecordId, intro.messageId);
  assert.equal(candidates[0].persona, undefined);
  await assert.rejects(
    run((sql) =>
      sql.query('SELECT parallel_life.publication_active_event_goals($1,NULL)', [world.worldId]),
    ),
    (e) => (e as any).code === '42501',
  );
  const other = candidate.actorOptions!.find((a) => a.id !== chosen)!.id;
  await assert.rejects(
    run((sql) =>
      sql.query('SELECT parallel_life.publication_actor_life_modules($1,$2)', [
        world.worldId,
        other,
      ]),
    ),
    (e) => (e as any).code === '42501',
  );
  await assert.rejects(
    run((sql) => sql.query('SELECT document FROM parallel_life.publication_story_plans')),
    (e) => (e as any).code === '42501',
  );
  assert.equal(
    (
      await run<{ rows: unknown[] }>((sql) =>
        sql.query(
          'SELECT node_key FROM parallel_life.publication_story_progress WHERE world_id=$1',
          [world.worldId],
        ),
      )
    ).rows.length,
    1,
  );
  await run((sql) =>
    sql.query(
      'UPDATE parallel_life.publication_story_progress SET revision=revision+1 WHERE world_id=$1 AND node_key=$2',
      [world.worldId, 'dynamic'],
    ),
  );
  await assert.rejects(
    run((sql) =>
      sql.query(
        'INSERT INTO parallel_life.publication_story_progress(world_id,owner_id,node_key,definition_hash,revision,world_version,state) VALUES($1,$2,$3,$4,0,$5,$6)',
        [
          world.worldId,
          owner,
          'complete',
          'a'.repeat(64),
          intro.version,
          { schemaVersion: 1, nodeKey: 'complete' },
        ],
      ),
    ),
    (e) => (e as any).code === '42501',
  );
  await assert.rejects(
    run(
      (sql) =>
        sql.query('SELECT parallel_life.publication_active_event_goals($1,$2)', [
          world.worldId,
          chosen,
        ]),
      randomUUID(),
    ),
    (e) => (e as any).code === '42501',
  );
  await assert.rejects(
    run((sql) =>
      sql.query('SELECT parallel_life.publication_active_event_goals($1,$2)', [
        randomUUID(),
        chosen,
      ]),
    ),
    (e) => (e as any).code === '42501',
  );
  await admin.query(
    'INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,source_type,source_ids,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [
      randomUUID(),
      owner,
      'character',
      chosen,
      world.worldId,
      chosen,
      'belief',
      'Explicit forgotten fixture',
      'world_event',
      JSON.stringify([intro.eventId]),
      'forgotten',
    ],
  );
  assert.deepEqual(
    await run(
      async (sql) =>
        (
          await sql.query('SELECT parallel_life.publication_active_event_goals($1,$2) items', [
            world.worldId,
            chosen,
          ])
        ).rows[0].items,
    ),
    [],
  );
  assert.deepEqual(
    await run(
      async (sql) =>
        (
          await sql.query('SELECT parallel_life.publication_scene_goal_candidates($1) items', [
            world.worldId,
          ])
        ).rows[0].items,
    ),
    [],
  );
  await admin.query(
    "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [task.id],
  );
  await assert.rejects(
    run((sql) =>
      sql.query('SELECT parallel_life.publication_active_event_goals($1,$2)', [
        world.worldId,
        chosen,
      ]),
    ),
    (e) => (e as any).code === '42501',
  );
});
