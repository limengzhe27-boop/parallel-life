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

test('real PG progress ledger binds actual node introduction and records unrelated input, refusal and bounded non-success closure', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, 55503);
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
  for (const signal of [
    { sourceEventId: intro.eventId, sourceRecordId: intro.recordId, kind: 'invented' },
    {
      sourceEventId: intro.eventId,
      sourceRecordId: intro.recordId,
      kind: 'closure',
      closure: 'fulfilled',
    },
    {
      sourceEventId: intro.eventId,
      sourceRecordId: intro.recordId,
      kind: 'introduced',
      complete: true,
    },
  ]) {
    await assert.rejects(
      app.transaction(owner, (sql) =>
        ledger.apply(sql, value, { signal: signal as ProgressSignal }, 1),
      ),
      (e) => (e as { code: string }).code === 'INVALID_INPUT',
    );
  }
  const apply = (
    source: { eventId: string; recordId: string; version: number },
    kind: ProgressSignal['kind'],
    quote?: string,
    closure?: ProgressSignal['closure'],
  ) =>
    app.transaction(owner, (sql) =>
      ledger.apply(
        sql,
        value,
        {
          signal: {
            sourceEventId: source.eventId,
            sourceRecordId: source.recordId,
            kind,
            ...(closure ? { closure } : {}),
          },
          ...(quote ? { quote } : {}),
        },
        source.version,
      ),
    );
  const introduced = await apply(intro, 'introduced');
  assert.equal(introduced.phase, 'introduced');
  assert.equal(introduced.productiveBeats, 1);
  assert.deepEqual(introduced.sourceRecordKeys, []);
  assert.deepEqual(await apply(intro, 'introduced'), introduced);
  const unrelated = await turn(1, 'player', '今天的天气怎么样？');
  await assert.rejects(
    apply({ ...unrelated, recordId: randomUUID() }, 'unrelated', '天气'),
    (e) => (e as { code: string }).code === 'INVALID_STATE',
  );
  await assert.rejects(
    apply(unrelated, 'unrelated', '没有说过的内容'),
    (e) => (e as { code: string }).code === 'INVALID_STATE',
  );
  const distracted = await apply(unrelated, 'unrelated', '天气');
  assert.equal(distracted.productiveBeats, 1);
  assert.equal(distracted.unrelatedInputs, 1);
  const refusal = await turn(2, 'player', '我不参加，你自己安排吧。');
  const refused = await apply(refusal, 'declined', '我不参加');
  assert.equal(refused.actorParticipation[chosen], 'declined');
  assert.equal(refused.actorGoalStatus[chosen], 'deferred');
  assert.equal(refused.resolution, null);
  const closing = await turn(3, 'director', '那我另作安排，这次先不约了。');
  await assert.rejects(
    apply(closing, 'introduced'),
    (e) => (e as { code: string }).code === 'INVALID_STATE',
  );
  await assert.rejects(apply(closing, 'nudge', '这次先不约了'), /PARTICIPATION_PRESSURE_BLOCKED/);
  const closed = await apply(closing, 'closure', '这次先不约了', 'withdrawn');
  assert.equal(closed.phase, 'resolved');
  assert.equal(closed.resolution, 'withdrawn');
  assert.equal(closed.criterionSources && Object.keys(closed.criterionSources).length, 0);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int n FROM parallel_life.publication_story_progress_evidence WHERE world_id=$1',
        [world.worldId],
      )
    ).rows[0].n,
    4,
  );
  assert.equal(await app.transaction(randomUUID(), (sql) => ledger.load(sql, value)), null);
  const next = await story.prepare(owner, world.worldId, {
    automatic: false,
    nodeKey: 'complete',
    expectedVersion: 4,
  });
  assert.equal(next.status, 'claimed');
  if (next.status !== 'claimed') throw Error('NO_NEXT_CLAIM');
  assert.equal(next.claim.actorId, chosen);
  const completionSpec = doc.candidates.find((n) => n.key === 'complete')!.direction!.progress!;
  const completeValue: ProgressLedgerDefinition = {
    ...value,
    spec: completionSpec,
    definition: {
      ...value.definition,
      nodeKey: 'complete',
      completion: {
        mode: 'all',
        criteria: [
          {
            id: 'said_result',
            basis: 'actual_npc_message',
            purpose: 'conversation',
            actorId: chosen,
          },
        ],
      },
      goals: [{ ...value.definition.goals[0]!, completionCriterionIds: ['said_result'] }],
    },
  };
  const secondIntro = await turn(4, 'director', '我有一件想商量的事。', next.claim.commandId);
  await story.finish(owner, world.worldId, next.claim.claimId);
  await app.transaction(owner, (sql) =>
    ledger.apply(
      sql,
      completeValue,
      {
        signal: {
          sourceEventId: secondIntro.eventId,
          sourceRecordId: secondIntro.recordId,
          kind: 'introduced',
        },
      },
      5,
    ),
  );
  const actualReply = await turn(5, 'director', '我已经决定，这次不再邀约了。');
  const completed = await app.transaction(owner, (sql) =>
    ledger.apply(
      sql,
      completeValue,
      {
        signal: {
          sourceEventId: actualReply.eventId,
          sourceRecordId: actualReply.recordId,
          kind: 'npc_progress',
        },
        quote: '这次不再邀约了',
      },
      6,
    ),
  );
  assert.equal(completed.resolution, 'fulfilled');
  assert.equal(completed.productiveBeats, 2);
  assert.deepEqual(completed.criterionSources.said_result, [actualReply.eventId]);
  assert.equal(completed.actorGoalStatus[chosen], 'fulfilled');
  await assert.rejects(
    app.transaction(owner, (sql) =>
      ledger.apply(
        sql,
        completeValue,
        {
          signal: {
            sourceEventId: actualReply.eventId,
            sourceRecordId: actualReply.recordId,
            kind: 'npc_progress',
          },
          quote: '这次不再邀约了',
        },
        7,
      ),
    ),
    (e) => (e as { code: string }).code === 'VERSION_CONFLICT',
  );
  const arrivalClaim = await story.prepare(owner, world.worldId, {
    automatic: false,
    nodeKey: 'arrival',
    expectedVersion: 6,
  });
  assert.equal(arrivalClaim.status, 'claimed');
  if (arrivalClaim.status !== 'claimed') throw Error('NO_ARRIVAL_CLAIM');
  const arrivalValue = { ...value, definition: { ...value.definition, nodeKey: 'arrival' } };
  const arrivalIntro = await turn(
    6,
    'director',
    '你方便的话，可以来约定地点。',
    arrivalClaim.claim.commandId,
  );
  await story.finish(owner, world.worldId, arrivalClaim.claim.claimId);
  await app.transaction(owner, (sql) =>
    ledger.apply(
      sql,
      arrivalValue,
      {
        signal: {
          sourceEventId: arrivalIntro.eventId,
          sourceRecordId: arrivalIntro.recordId,
          kind: 'introduced',
        },
      },
      7,
    ),
  );
  await admin.query(
    'UPDATE parallel_life.world_clock SET paused=false,last_tick_at=now() WHERE world_id=$1',
    [world.worldId],
  );
  const route = (await runtime.get({ userId: owner }, world.worldId)).space!.routes.find(
    (r) => r.toPlaceId === 'arrival_place',
  )!;
  const travel = await new PostgresWorldSpace(app, officialLifeCatalog).travel(
    owner,
    world.worldId,
    {
      commandId: randomUUID(),
      expectedVersion: 7,
      routeId: route.id,
    },
  );
  const recordId = `travel:${travel.sourceEventId}:arrival_place`;
  await assert.rejects(
    app.transaction(owner, (sql) =>
      ledger.apply(
        sql,
        arrivalValue,
        {
          signal: {
            sourceEventId: travel.sourceEventId,
            sourceRecordId: `travel:${travel.sourceEventId}:wrong_place`,
            kind: 'npc_progress',
          },
        },
        8,
      ),
    ),
    (e) => (e as { code: string }).code === 'INVALID_STATE',
  );
  const arrived = await app.transaction(owner, (sql) =>
    ledger.apply(
      sql,
      arrivalValue,
      {
        signal: {
          sourceEventId: travel.sourceEventId,
          sourceRecordId: recordId,
          kind: 'npc_progress',
        },
      },
      8,
    ),
  );
  assert.equal(arrived.productiveBeats, 2);
  assert.equal(arrived.resolution, null);
  assert.equal(arrived.actorParticipation[chosen], 'unknown');
  assert.equal(arrived.actorGoalStatus[chosen], 'active');
  assert.equal(
    (await runtime.get({ userId: owner }, world.worldId)).space!.currentPlaceId,
    'arrival_place',
  );
  const changes = await app.transaction(owner, (sql) =>
    ledger.recentWorldInputs(sql, owner, world.worldId, 8),
  );
  assert.deepEqual(
    changes.map((x) => x.kind),
    ['arrival'],
  );
  assert.equal(changes[0]?.sourceEventId, travel.sourceEventId);
  assert.equal(changes[0]?.version, 8);
  assert.equal(JSON.stringify(changes).includes('我不参加'), false);
  assert.deepEqual(
    await app.transaction(owner, (sql) => ledger.recentWorldInputs(sql, owner, world.worldId, 7)),
    [],
  );
  assert.deepEqual(
    await app.transaction(randomUUID(), (sql) =>
      ledger.recentWorldInputs(sql, owner, world.worldId, 8),
    ),
    [],
  );
  const scenes = new SceneRepository(app);
  const entered = await scenes.enterPlace(owner, world.worldId, {
    commandId: randomUUID(),
    expectedVersion: 8,
    placeId: 'arrival_place',
  });
  await app.transaction(owner, (sql) =>
    commitSceneProposal(
      sql,
      owner,
      world.worldId,
      { type: 'scene', sceneId: entered.sceneId, actionId: null, expectedVersion: entered.version },
      {
        location: '约定地点',
        narration: '桌边留着一把空椅子。',
        presentActorIds: [],
        outcome: null,
        observation: null,
        matterTitle: null,
        initialMatters: [],
        matterUpdates: [],
        dialogues: [],
      },
      randomUUID(),
    ),
  );
  // Complete only this synthetic fixture's queued opening after its real commit.
  await admin.query(
    "UPDATE parallel_life.tasks SET status='succeeded',result_version=10,model='explicit_fixture',prompt_version='explicit_fixture' WHERE id=$1",
    [entered.task!.id],
  );
  const input = await scenes.input(owner, world.worldId, entered.sceneId, {
    commandId: randomUUID(),
    expectedVersion: 10,
    text: '我不参加这次安排。',
    relatedMatterIds: [],
  });
  const saved = (
    await admin.query(
      "SELECT id,source_event_id FROM parallel_life.scene_items WHERE world_id=$1 AND kind='entry' AND document->>'kind'='user_action' AND document->>'text'=$2",
      [world.worldId, '我不参加这次安排。'],
    )
  ).rows[0];
  const publicDecision = await app.transaction(owner, (sql) =>
    ledger.apply(
      sql,
      arrivalValue,
      {
        signal: {
          sourceEventId: saved.source_event_id,
          sourceRecordId: saved.id,
          kind: 'declined',
        },
        quote: '我不参加',
      },
      input.version,
    ),
  );
  assert.equal(publicDecision.participation, 'declined');
  assert.equal(publicDecision.actorParticipation[chosen], 'unknown');
  assert.equal(publicDecision.actorGoalStatus[chosen], 'active');
  const thought = await scenes.input(owner, world.worldId, entered.sceneId, {
    commandId: randomUUID(),
    expectedVersion: 11,
    text: '我心里想，这次我不参加。',
    relatedMatterIds: [],
  });
  const privateEntry = (
    await admin.query(
      "SELECT id,source_event_id FROM parallel_life.scene_items WHERE world_id=$1 AND kind='entry' AND document->>'kind'='user_action' AND document->>'text'=$2",
      [world.worldId, '我心里想，这次我不参加。'],
    )
  ).rows[0];
  await assert.rejects(
    app.transaction(owner, (sql) =>
      ledger.apply(
        sql,
        arrivalValue,
        {
          signal: {
            sourceEventId: privateEntry.source_event_id,
            sourceRecordId: privateEntry.id,
            kind: 'declined',
          },
          quote: '我不参加',
        },
        thought.version,
      ),
    ),
    (e) => (e as { code: string }).code === 'INVALID_STATE',
  );
  const sceneChanges = await app.transaction(owner, (sql) =>
    ledger.recentWorldInputs(sql, owner, world.worldId, thought.version),
  );
  assert.deepEqual(
    sceneChanges.map((x) => x.kind),
    ['arrival', 'scene_result'],
  );
  assert.equal(JSON.stringify(sceneChanges).includes('心里'), false);
});
