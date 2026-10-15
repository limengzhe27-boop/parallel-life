import test from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { listMemories } from '../../src/modules/memory/infrastructure/memory-store.ts';
import { parseProposal } from '../../src/modules/world/domain/validation.ts';
import { validateStoryInvitation } from '../../src/server/publication-story-service.ts';
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
import { PublicationOpeningRepository } from '../../src/modules/settings/infrastructure/publication-opening-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import type { OpeningDelivery } from '../../src/modules/settings/application/publication-opening-ports.ts';
import { readDirectorObservation } from '../../src/modules/world/infrastructure/director-observation-repository.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';
import { readActorEventGoals } from '../../src/modules/world/infrastructure/actor-goal-repository.ts';
import { publicationCharacterPlanner } from '../../src/server/publication-character-planner.ts';
import { readActorSituation } from '../../src/modules/world/infrastructure/actor-situation-repository.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
const at = '2026-10-15T07:00:00.000Z';
const fixtureReceipt = randomUUID();
const review: PublicationReviewPort = {
  async review({ content }) {
    return {
      reviewerVersion: 'explicit_opening_database_fixture',
      runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId: fixtureReceipt },
    };
  },
};
const compiler: PublicationWorldCompilerPort = {
  prepare(i) {
    const c = structuredClone(i.content) as any;
    delete c.timeline;
    delete c.conditions;
    delete c.openingEventKey;
    c.candidates = [];
    const r = compilePublicationGenesis({
      ...i,
      content: c,
      originKind: i.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(r.status, 'compiled');
    if (r.status !== 'compiled') throw Error('FIXTURE_COMPILE');
    return {
      world: r.world,
      opening: r.opening,
      seed: {
        id: i.seedId,
        createdAt: at,
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

test('actor situations retain own directions and share the current world snapshot', async (t) => {
  const config = await localConfig();
  const port = process.env.ACTOR_SITUATION_TEST_PORT ?? '55566';
  assert.equal(config.port, Number(port));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const role = 'pl_opening37_fixture';
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
  const repository = new PublicationOpeningRepository(app),
    runtime = new PostgresWorldRepository(app),
    story = new PublicationStoryRepository(app);
  async function fixture(completion = false) {
    const staff = randomUUID(),
      owner = randomUUID(),
      foreign = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    await new IdentityRepository(app).ensureGuest(foreign);
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [staff, '独立开场SQL测试'],
    );
    const report = await readFile(
      new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
      'utf8',
    );
    const c = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(report)![1]!);
    c.world.startAt = at;
    c.world.hiddenContext = 'GLOBAL_OPENING_DIRECTOR_ONLY';
    c.history = [];
    c.initialKnowledge = [];
    c.protagonist.knownFactKeys = [];
    c.phone = {
      messages: [
        {
          key: 'old',
          actorKey: c.actors[0].key,
          origin: 'history',
          speaker: 'actor',
          text: '这是作者过去的旧消息。',
          at: '2026-10-14T07:00:00.000Z',
        },
      ],
      moments: [],
      notes: [],
      invitations: [],
      album: [],
    };
    c.candidates = [
      {
        key: 'start',
        kind: 'candidate',
        title: '开场',
        editorialIntent: '各自说自己的新安排。',
        script: 'GLOBAL_OPENING_SCRIPT',
        actorKeys: c.actors.map((a: any) => a.key),
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
      },
    ];
    if (completion)
      c.candidates[0].direction = {
        mode: 'optional',
        progress: {
          completion: {
            mode: 'all',
            criteria: [
              {
                key: 'confirm',
                kind: 'npc_exact_message',
                actorKey: c.actors[1].key,
                phrase: 'CRITERION_CONFIRM',
              },
            ],
          },
        },
      };
    c.openingEventKey = 'start';
    delete c.timeline;
    delete c.conditions;
    const content = PublishedWorldContentSchema.parse(c),
      works = new PublicationRepository(pub, review),
      worlds = new PublicationWorldRepository(app, compiler);
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
    const w = await worlds.startPublished(owner, work.id, {
      commandId: randomUUID(),
      publicationVersion: 1,
    });
    await admin.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
      w.worldId,
    ]);
    const snap = await repository.read(owner, w.worldId);
    assert.equal(snap.phase, 'unplanned');
    assert.equal(snap.source?.actors.length, 2);
    return { owner, foreign, worldId: w.worldId, actors: snap.source!.actors };
  }
  async function commit(
    f: { owner: string; worldId: string },
    actor: string,
    version: number,
    commandId: string = randomUUID(),
    text = '本人物的新来信。',
    player = false,
  ) {
    const eventId = randomUUID();
    await runtime.commit(
      { userId: f.owner },
      {
        id: commandId,
        worldId: f.worldId,
        actorId: actor,
        expectedVersion: version,
        ...(player ? {} : { origin: 'director' as const }),
        text: player ? 'A_REAL_PLAYER_REPLY' : '合成导演调用，仅验证数据库。',
      },
      {
        schemaVersion: 1,
        id: eventId,
        worldId: f.worldId,
        version: version + 1,
        commandId,
        type: 'turn.resolved',
        occurredAt: at,
        storyAt: at,
        data: {
          actorId: actor,
          userText: player ? 'A_REAL_PLAYER_REPLY' : '合成导演调用，仅验证数据库。',
          ...(player ? {} : { origin: 'director' as const }),
          effects: [{ type: 'message.received', id: eventId + '_message', actorId: actor, text }],
        },
      },
    );
    return eventId;
  }
  const f = await fixture();
  const ctx = async (actor: string) =>
    actorContext(await runtime.get({ userId: f.owner }, f.worldId), actor);
  const firstId = f.actors[0]!.id,
    secondId = f.actors[1]!.id;
  const planId = randomUUID();
  await repository.beginPlan(f.owner, f.worldId, planId);
  await repository.savePlan(
    f.owner,
    f.worldId,
    planId,
    f.actors.map((a, i) => ({ actorId: a.id, brief: 'PRIVATE_ACTOR_DIRECTION_' + i })),
  );
  assert.equal(await readActorSituation(app, f.owner, await ctx(firstId)), undefined);
  const first = (await repository.claimNext(f.owner, f.worldId))!;
  await commit(f, first.actorId, first.expectedVersion!, first.commandId, 'OWN_OPENING_ONE');
  await repository.finishDelivery(f.owner, f.worldId, first.actorId, first.commandId);
  const initial = (await readActorSituation(app, f.owner, await ctx(first.actorId)))!;
  assert.equal(initial.opening.direction, 'PRIVATE_ACTOR_DIRECTION_0');
  assert.equal(initial.eventOutcome, null);
  assert(!JSON.stringify(initial).includes('GLOBAL_OPENING'));
  assert(!JSON.stringify(initial).includes('PRIVATE_ACTOR_DIRECTION_1'));
  assert.equal(await readActorSituation(app, f.owner, await ctx(secondId)), undefined);
  const stale = await ctx(firstId);
  const second = (await repository.claimNext(f.owner, f.worldId))!;
  await commit(f, second.actorId, second.expectedVersion!, second.commandId, 'OWN_OPENING_TWO');
  await repository.finishDelivery(f.owner, f.worldId, second.actorId, second.commandId);
  await t.test(
    'all actors read the same current version and time with independent directions',
    async () => {
      const one = (await readActorSituation(app, f.owner, await ctx(firstId)))!;
      const two = (await readActorSituation(app, f.owner, await ctx(secondId)))!;
      assert.equal(one.worldVersion, 2);
      assert.equal(two.worldVersion, 2);
      assert.equal(one.storyAt, two.storyAt);
      assert.notEqual(one.opening.direction, two.opening.direction);
      assert.equal(one.opening.sourceVersion, 1);
      assert.equal(two.opening.sourceVersion, 2);
      assert.equal(one.opening.nodeKey, two.opening.nodeKey);
    },
  );
  await t.test('stale version and foreign owner cannot load directions', async () => {
    await assert.rejects(() => readActorSituation(app, f.owner, stale), /VERSION_CONFLICT/);
    await assert.rejects(
      () => readActorSituation(app, f.foreign, { ...stale, worldVersion: 2 }),
      /NOT_FOUND/,
    );
  });
  await t.test('future-time context cannot expose an opening before delivery', async () => {
    const context = await ctx(firstId);
    assert.equal(
      await readActorSituation(app, f.owner, { ...context, time: '2026-10-14T00:00:00.000Z' }),
      undefined,
    );
  });
  await t.test('tampered source hash prevents private brief read', async () => {
    const hash = (
      await admin.query(
        'SELECT source_hash FROM parallel_life.publication_opening_batches WHERE world_id=$1',
        [f.worldId],
      )
    ).rows[0].source_hash;
    await admin.query(
      'UPDATE parallel_life.publication_opening_batches SET source_hash=$2 WHERE world_id=$1',
      [f.worldId, '0'.repeat(64)],
    );
    assert.equal(await readActorSituation(app, f.owner, await ctx(firstId)), undefined);
    await admin.query(
      'UPDATE parallel_life.publication_opening_batches SET source_hash=$2 WHERE world_id=$1',
      [f.worldId, hash],
    );
  });
  await t.test(
    'a projection mismatching the actual committed message is not evidence',
    async () => {
      await admin.query(
        "UPDATE parallel_life.world_messages SET document=jsonb_set(document,'{text}',to_jsonb('FORGED'::text)) WHERE world_id=$1 AND id=$2",
        [f.worldId, initial.opening.sourceMessageId],
      );
      assert.equal(await readActorSituation(app, f.owner, await ctx(firstId)), undefined);
      await admin.query(
        "UPDATE parallel_life.world_messages SET document=jsonb_set(document,'{text}',to_jsonb('OWN_OPENING_ONE'::text)) WHERE world_id=$1 AND id=$2",
        [f.worldId, initial.opening.sourceMessageId],
      );
    },
  );
  await t.test(
    'forgotten source cannot be resurrected through the private opening brief',
    async () => {
      const id = randomUUID();
      await admin.query(
        "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'summary','Forgotten opening','conversation_summary',$5,'forgotten')",
        [id, f.owner, firstId, f.worldId, JSON.stringify([initial.opening.sourceMessageId])],
      );
      assert.equal(await readActorSituation(app, f.owner, await ctx(firstId)), undefined);
      assert((await readActorSituation(app, f.owner, await ctx(secondId)))?.opening.direction);
      await admin.query('DELETE FROM parallel_life.memory_records WHERE id=$1', [id]);
    },
  );
  await t.test(
    'direction survives recent conversation window without replacing new messages',
    async () => {
      for (let v = 2; v < 16; v++)
        await commit(f, firstId, v, randomUUID(), 'ACTUAL_LATER_MESSAGE_' + v);
      const context = await ctx(firstId);
      assert(!context.messages.some((m) => m.text === 'OWN_OPENING_ONE'));
      const current = (await readActorSituation(app, f.owner, context))!;
      assert.equal(current.opening.direction, initial.opening.direction);
      assert.equal(current.worldVersion, 16);
      assert(context.messages.some((m) => m.text === 'ACTUAL_LATER_MESSAGE_15'));
    },
  );
  await t.test(
    'actual character adapter strips injected private supplements and supplies only own saved direction',
    async () => {
      const context = await ctx(firstId);
      let calls = 0;
      await publicationCharacterPlanner(app, f.owner, f.worldId, {
        async complete(messages) {
          calls++;
          const payload = JSON.parse(messages[1]!.content);
          assert.equal(payload.currentSituation.opening.direction, initial.opening.direction);
          assert.equal(payload.currentSituation.worldVersion, 16);
          assert(!JSON.stringify(payload).includes('INJECTED_OTHER_ACTOR_SECRET'));
          assert(!JSON.stringify(payload).includes('PRIVATE_ACTOR_DIRECTION_1'));
          return 'Here is my own next step.';
        },
      }).propose({
        context: {
          ...context,
          authoredLifeModules: { traits: 'INJECTED_OTHER_ACTOR_SECRET' },
          actorSituation: {
            ...initial,
            opening: { ...initial.opening, direction: 'INJECTED_OTHER_ACTOR_SECRET' },
          },
        },
        userText: 'What happens now?',
      });
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'director observes each actual actor, while director instructions never become player speech',
    async () => {
      const observation = await readDirectorObservation(app, f.owner, f.worldId, 16, at);
      assert.equal(observation.worldVersion, 16);
      assert.equal(observation.actorExchanges.length, 2);
      assert(
        observation.actorExchanges.some((x) => x.actorId === secondId && x.sourceVersion === 2),
      );
      assert(
        observation.actorExchanges.every((x) => x.origin === 'director' && x.playerText === null),
      );
      assert(!JSON.stringify(observation).includes('GLOBAL_OPENING_SCRIPT'));
      assert(!JSON.stringify(observation).includes('合成导演调用'));
      await commit(f, firstId, 16, randomUUID(), 'Actual player reply acknowledgement', true);
      const next = await readDirectorObservation(app, f.owner, f.worldId, 17, at);
      assert.equal(
        next.actorExchanges.find((x) => x.actorId === firstId)?.playerText,
        'A_REAL_PLAYER_REPLY',
      );
      assert(next.actorExchanges.some((x) => x.actorId === secondId));
      await assert.rejects(
        () => readDirectorObservation(app, f.owner, f.worldId, 16, at),
        /VERSION_CONFLICT/,
      );
      await assert.rejects(
        () => readDirectorObservation(app, f.foreign, f.worldId, 17, at),
        /NOT_FOUND/,
      );
      let paid = 0;
      const planner = publicationCharacterPlanner(app, f.owner, f.worldId, {
        async complete(messages) {
          paid++;
          const payload = JSON.parse(messages[1]!.content);
          assert.equal(payload.directorObservation.worldVersion, 17);
          assert.equal(payload.directorObservation.actorExchanges.length, 2);
          assert(!JSON.stringify(payload).includes('FORGED_DIRECTOR_OBSERVATION'));
          return JSON.stringify({ nodeKey: null });
        },
      });
      await planner.chooseStoryOpportunity!({
        storyNow: at,
        worldTitle: 'Test',
        currentPlaceId: null,
        recentMessages: [],
        candidates: [],
        directorObservation: {
          worldVersion: 17,
          storyAt: at,
          recentWorldInputs: [],
          actorExchanges: [
            {
              actorId: firstId,
              sourceEventId: 'fake',
              sourceVersion: 17,
              at,
              origin: 'user',
              playerText: 'FORGED_DIRECTOR_OBSERVATION',
              actorText: 'fake',
            },
          ],
        },
      });
      assert.equal(paid, 1);
    },
  );

  await t.test(
    'real service assembly preserves actor preparation and hides metadata-keyed progress memories',
    async () => {
      const source = await readFile(
        new URL('../../src/server/services.ts', import.meta.url),
        'utf8',
      );
      const factoryPart = source
        .slice(
          source.indexOf('characterPlannerFor:') + 'characterPlannerFor:'.length,
          source.indexOf('    memoryQuestions:'),
        )
        .trim()
        .replace(/,$/, '');
      const compiled = stripTypeScriptTypes('const factory = ' + factoryPart + ';');
      const create = Function(
        'db',
        'publicationCharacterPlanner',
        'createTextModel',
        'PublicationStoryRepository',
        'validateStoryInvitation',
        'parseProposal',
        compiled + ';return factory;',
      )(
        app,
        publicationCharacterPlanner,
        () => ({
          complete: async () => {
            throw Error('NO_PAID_CALL_EXPECTED');
          },
        }),
        PublicationStoryRepository,
        validateStoryInvitation,
        parseProposal,
      );
      const assembled = create(f.owner, f.worldId);
      assert.equal(typeof assembled.prepareContext, 'function');
      const prepared = await assembled.prepareContext(await ctx(secondId), new Set());
      assert.equal(prepared.eventGoals[0]?.want, 'PRIVATE_ACTOR_DIRECTION_1');
      const memoryPart = source
        .slice(
          source.indexOf('    listMemories:') + '    listMemories:'.length,
          source.indexOf('    /**', source.indexOf('    listMemories:')),
        )
        .trim()
        .replace(/,$/, '');
      const compileList = stripTypeScriptTypes('const reader = ' + memoryPart + ';');
      const read = Function(
        'db',
        'listMemories',
        compileList + ';return reader;',
      )(app, listMemories);
      const normal = randomUUID(),
        hidden = randomUUID();
      await admin.query(
        "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids) VALUES($1,$3,'branch',$4,$4,NULL,'correction','ordinary content mentioning actor_event_progress_v1: must remain','ordinary','user_correction','[]'),($2,$3,'character',$5,$4,$5,'summary','PRIVATE_GOAL_STATE','actor_event_progress_v1:test','agent_inference','[]')",
        [normal, hidden, f.owner, f.worldId, secondId],
      );
      const memories = await read(f.owner, {});
      assert(memories.some((m: { id: string }) => m.id === normal));
      assert(!memories.some((m: { id: string }) => m.id === hidden));
    },
  );
  await t.test(
    'live multi-actor opening has independent goals and one receipt-bound common progress ledger',
    async () => {
      const readGoals = async (actor: string) =>
        app.transaction(f.owner, (sql) =>
          readActorEventGoals(sql, awaitContext[actor]!, f.owner, new Set()),
        );
      const awaitContext: Record<string, ReturnType<typeof actorContext>> = {};
      for (const id of [firstId, secondId]) awaitContext[id] = await ctx(id);
      const a = await readGoals(firstId),
        b = await readGoals(secondId);
      assert.equal(a[0]?.want, 'PRIVATE_ACTOR_DIRECTION_0');
      assert.equal(b[0]?.want, 'PRIVATE_ACTOR_DIRECTION_1');
      assert.equal(a[0]?.goalKey, b[0]?.goalKey);
      const openingProgress = (
        await admin.query(
          'SELECT state FROM parallel_life.publication_story_progress WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].state;
      assert.equal(openingProgress.productiveBeats, 1);

      assert(!JSON.stringify(a).includes('PRIVATE_ACTOR_DIRECTION_1'));
      const turn = async (
        actor: string,
        text: string,
        kind: 'declined' | 'engaged' | 'closure',
        quote: string,
      ) => {
        const planner = publicationCharacterPlanner(app, f.owner, f.worldId, {
          async complete(messages) {
            const payload = JSON.parse(messages[1]!.content);
            assert.equal(payload.eventGoals[0].actorId, actor);
            return JSON.stringify({
              schemaVersion: 1,
              effects: [
                {
                  type: 'message.received',
                  id: 'reply',
                  actorId: actor,
                  text:
                    kind === 'closure' ? '我先结束这次请求。' : '我听明白了，会按这个安排处理。',
                },
              ],
              eventGoalAssessments: [
                {
                  goalKey: payload.eventGoals[0].goalKey,
                  target: kind === 'closure' ? 'npc' : 'user',
                  kind,
                  quote,
                  ...(kind === 'closure' ? { closure: 'withdrawn' } : {}),
                },
              ],
            });
          },
        });
        const current = await runtime.get({ userId: f.owner }, f.worldId);
        return resolveTurn(
          { worlds: runtime, planner, now: () => at, newId: randomUUID },
          { userId: f.owner },
          {
            id: randomUUID(),
            worldId: f.worldId,
            actorId: actor,
            expectedVersion: current.version,
            text,
          },
        );
      };
      const declined = await turn(firstId, '暂时不去，我先忙工作。', 'declined', '暂时不去');
      assert.equal(declined.state.version, 18);
      await turn(secondId, '我可以先听听你的安排。', 'engaged', '先听听你的安排');
      for (const id of [firstId, secondId]) awaitContext[id] = await ctx(id);
      const afterA = await readGoals(firstId),
        afterB = await readGoals(secondId);
      assert.equal(afterA[0]?.participation, 'declined');
      assert.equal(afterB[0]?.participation, 'engaged');
      assert.equal(afterA[0]?.phase, afterB[0]?.phase);
      assert.equal(afterA[0]?.status, 'deferred');
      const rows = (
        await admin.query(
          'SELECT state FROM parallel_life.publication_story_progress WHERE world_id=$1',
          [f.worldId],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].state.phase, 'engaged');
      assert.equal(rows[0].state.resolution, null);
      await turn(firstId, '你先按自己的安排来吧。', 'closure', '我先结束这次请求');
      const closed = (
        await admin.query(
          'SELECT state FROM parallel_life.publication_story_progress WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].state;
      assert.notEqual(closed.phase, 'resolved');
      assert.equal(closed.actorGoalStatus[firstId], 'withdrawn');
      assert.equal(closed.actorGoalStatus[secondId], 'active');
      assert.equal(closed.resolution, null);
      const observed = await readDirectorObservation(app, f.owner, f.worldId, 20, at);
      const sharedObservation = observed.eventProgress?.find(
        (e) => e.nodeKey === initial.opening.nodeKey,
      );
      assert.equal(sharedObservation?.phase, 'engaged');
      assert.equal(
        sharedObservation?.actors.find((a) => a.actorId === firstId)?.participation,
        'declined',
      );
      assert.equal(
        sharedObservation?.actors.find((a) => a.actorId === firstId)?.status,
        'withdrawn',
      );
      assert.equal(
        sharedObservation?.actors.find((a) => a.actorId === secondId)?.participation,
        'engaged',
      );
      assert.equal(sharedObservation?.actors.find((a) => a.actorId === secondId)?.status, 'active');
      const earlier = await readDirectorObservation(
        app,
        f.owner,
        f.worldId,
        20,
        '2026-10-14T07:00:00.000Z',
      );
      assert.equal(earlier.eventProgress?.length, 0);
      assert.equal(earlier.actorExchanges.length, 0);
      const futureRecord = (
        await admin.query(
          "SELECT id,document->>'at' AS at FROM parallel_life.world_messages WHERE world_id=$1 AND actor_id=$2 AND document->>'role'='user' AND document->>'text'='暂时不去，我先忙工作。'",
          [f.worldId, firstId],
        )
      ).rows[0];
      await admin.query(
        "UPDATE parallel_life.world_messages SET document=jsonb_set(document,'{at}',to_jsonb($3::text)) WHERE world_id=$1 AND id=$2",
        [f.worldId, futureRecord.id, '2026-10-16T07:00:00.000Z'],
      );
      try {
        const guarded = await readDirectorObservation(app, f.owner, f.worldId, 20, at);
        const view = guarded.eventProgress?.find((e) => e.nodeKey === initial.opening.nodeKey);
        assert.equal(view?.actors.find((a) => a.actorId === firstId)?.participation, 'unknown');
        assert.equal(view?.actors.find((a) => a.actorId === secondId)?.participation, 'engaged');
      } finally {
        await admin.query(
          "UPDATE parallel_life.world_messages SET document=jsonb_set(document,'{at}',to_jsonb($3::text)) WHERE world_id=$1 AND id=$2",
          [f.worldId, futureRecord.id, futureRecord.at],
        );
      }

      const latest = await runtime.get({ userId: f.owner }, f.worldId);
      assert.equal(latest.time, at);
      const beforeRevision = (
        await admin.query(
          'SELECT revision FROM parallel_life.publication_story_progress WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].revision;
      const invalid = publicationCharacterPlanner(app, f.owner, f.worldId, {
        async complete() {
          return JSON.stringify({
            schemaVersion: 1,
            effects: [
              {
                type: 'message.received',
                id: 'r',
                actorId: secondId,
                text: 'This cannot be committed.',
              },
            ],
            eventGoalAssessments: [
              {
                goalKey: 'publication:foreign_node',
                target: 'user',
                kind: 'engaged',
                quote: 'Go ahead',
              },
            ],
          });
        },
      });
      await assert.rejects(() =>
        resolveTurn(
          { worlds: runtime, planner: invalid, now: () => at, newId: randomUUID },
          { userId: f.owner },
          {
            id: randomUUID(),
            worldId: f.worldId,
            actorId: secondId,
            expectedVersion: latest.version,
            text: 'Go ahead',
          },
        ),
      );
      assert.equal((await runtime.get({ userId: f.owner }, f.worldId)).version, latest.version);
      assert.equal(
        (
          await admin.query(
            'SELECT revision FROM parallel_life.publication_story_progress WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].revision,
        beforeRevision,
      );
      const later = new Date(Date.parse(at) + 35 * 60000).toISOString();
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        f.worldId,
        later,
      ]);
      const pool = await story.opportunities(f.owner, f.worldId, false);
      const next = pool.candidates.find((c) => c.nodeKey === initial.opening.nodeKey);
      assert.equal(next?.actorId, secondId);
      assert.equal(next?.eventProgress?.ownGoal.want, 'PRIVATE_ACTOR_DIRECTION_1');
      const pending = await story.prepareProgressBeat(f.owner, f.worldId, initial.opening.nodeKey, {
        expectedVersion: latest.version,
        automatic: false,
      });
      assert.equal(pending.status, 'claimed');
      if (pending.status === 'claimed') {
        assert.equal(pending.claim.actorId, secondId);
        const competing = await story.prepareProgressBeat(
          f.owner,
          f.worldId,
          initial.opening.nodeKey,
          { expectedVersion: latest.version, automatic: false },
        );
        assert.notEqual(competing.status, 'claimed');
        const recovered = await story.retry(f.owner, f.worldId, pending.claim.claimId);
        assert.equal(recovered.status, 'claimed');
        if (recovered.status !== 'claimed') throw Error('EXPLICIT_RECOVERY_MISSING');
        assert.equal(recovered.claim.commandId, pending.claim.commandId);
        assert.equal(recovered.claim.actorId, secondId);
        await commit(
          f,
          secondId,
          latest.version,
          recovered.claim.commandId,
          'First autonomous follow-up',
        );
        await story.finishProgressBeat(f.owner, f.worldId, recovered.claim.claimId);
        const secondBeat = await story.prepareProgressBeat(
          f.owner,
          f.worldId,
          initial.opening.nodeKey,
          { expectedVersion: latest.version + 1, automatic: false },
        );
        assert.equal(secondBeat.status, 'claimed');
        if (secondBeat.status !== 'claimed') throw Error('SECOND_FOLLOWUP_MISSING');
        await commit(
          f,
          secondId,
          latest.version + 1,
          secondBeat.claim.commandId,
          'Second autonomous follow-up without closure',
        );
        await story.finishProgressBeat(f.owner, f.worldId, secondBeat.claim.claimId);
        const bounded = await story.opportunities(f.owner, f.worldId, false);
        assert(!bounded.candidates.some((c) => c.nodeKey === initial.opening.nodeKey));
        const quiet = await story.prepareProgressBeat(f.owner, f.worldId, initial.opening.nodeKey, {
          expectedVersion: latest.version + 2,
          automatic: false,
        });
        assert.equal(quiet.status, 'none');
        const notFinished = (
          await admin.query(
            'SELECT state FROM parallel_life.publication_story_progress WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].state;
        assert.equal(notFinished.resolution, null);
      }
    },
  );
  await t.test(
    'another opening participant can satisfy an authored criterion without inventing success for everyone',
    async () => {
      const other = await fixture(true),
        planId = randomUUID();
      await repository.beginPlan(other.owner, other.worldId, planId);
      await repository.savePlan(
        other.owner,
        other.worldId,
        planId,
        other.actors.map((a, i) => ({ actorId: a.id, brief: 'Independent goal ' + i })),
      );
      for (let version = 0; version < 2; version++) {
        const claim = (await repository.claimNext(other.owner, other.worldId))!;
        await commit(
          other,
          claim.actorId,
          version,
          claim.commandId,
          version === 1 ? 'CRITERION_CONFIRM' : 'Initial request',
        );
        await repository.finishDelivery(other.owner, other.worldId, claim.actorId, claim.commandId);
      }
      const current = await runtime.get({ userId: other.owner }, other.worldId);
      const goals = [];
      for (const actor of other.actors)
        goals.push(
          await app.transaction(other.owner, (sql) =>
            readActorEventGoals(sql, actorContext(current, actor.id), other.owner, new Set()),
          ),
        );
      assert.equal(goals[0]![0]?.phase, 'resolved');
      assert.equal(goals[1]![0]?.phase, 'resolved');
      assert.equal(goals[0]![0]?.nextMove, 'finished');
      assert.equal(goals[1]![0]?.status, 'fulfilled');
      assert.notEqual(goals[0]![0]?.status, 'fulfilled');
      const shared = (
        await admin.query(
          'SELECT state FROM parallel_life.publication_story_progress WHERE world_id=$1',
          [other.worldId],
        )
      ).rows[0].state;
      assert.equal(shared.resolution, 'fulfilled');
      assert.equal(shared.productiveBeats, 1);
    },
  );
});
