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
import { PublicationOpeningRepository } from '../../src/modules/settings/infrastructure/publication-opening-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import type { OpeningDelivery } from '../../src/modules/settings/application/publication-opening-ports.ts';
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
  async function fixture() {
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
  ) {
    const eventId = randomUUID();
    await runtime.commit(
      { userId: f.owner },
      {
        id: commandId,
        worldId: f.worldId,
        actorId: actor,
        expectedVersion: version,
        origin: 'director',
        text: '合成导演调用，仅验证数据库。',
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
          userText: '合成导演调用，仅验证数据库。',
          origin: 'director',
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
});
