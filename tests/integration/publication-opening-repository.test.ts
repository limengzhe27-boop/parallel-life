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

test('opening batches retain real actor receipts, owner boundaries and explicit recovery', async (t) => {
  const config = await localConfig();
  const port = process.env.OPENING_TEST_PORT ?? '55503';
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
  const briefs = (f: { actors: { id: string }[] }) =>
    f.actors.map((a, i) => ({ actorId: a.id, brief: `本人独立意图${i}` }));
  await t.test(
    'refresh and concurrency do not fabricate delivery; ordinary/history messages cannot be adopted',
    async () => {
      const f = await fixture();
      await commit(f, f.actors[0]!.id, 0); // a real unrelated director message, no opening node
      const cmds = [randomUUID(), randomUUID()];
      const results = await Promise.all(
        cmds.map((c) => repository.beginPlan(f.owner, f.worldId, c)),
      );
      assert.equal(results.filter(Boolean).length, 1);
      const plan = (await repository.read(f.owner, f.worldId)).planCommandId!;
      assert.equal((await repository.read(f.owner, f.worldId)).phase, 'planning');
      for (const bad of [
        [],
        [briefs(f)[0]!, briefs(f)[0]!],
        [{ actorId: 'foreign', brief: 'x' }, briefs(f)[1]!],
      ])
        await assert.rejects(
          repository.savePlan(f.owner, f.worldId, plan, bad),
          (e: any) => e.code === 'INVALID_AI_OUTPUT',
        );
      await repository.savePlan(f.owner, f.worldId, plan, briefs(f));
      await repository.savePlan(f.owner, f.worldId, plan, briefs(f));
      let s = await repository.read(f.owner, f.worldId);
      assert.equal(s.deliveries.filter((d) => d.status === 'delivered').length, 0);
      await assert.rejects(
        repository.read(f.foreign, f.worldId),
        (e: any) => e.code === 'NOT_FOUND',
      );
      assert.equal(
        (
          await app.transaction(f.foreign, (sql) =>
            sql.query('SELECT * FROM parallel_life.publication_opening_batches WHERE world_id=$1', [
              f.worldId,
            ]),
          )
        ).rowCount,
        0,
      );
      const first = (await repository.claimNext(f.owner, f.worldId))!;
      assert.equal(first.expectedVersion, 1);
      assert.equal(await repository.claimNext(f.owner, f.worldId), null);
      await admin.query(
        "UPDATE parallel_life.publication_opening_deliveries SET updated_at=now()-interval '1 day' WHERE world_id=$1 AND actor_id=$2",
        [f.worldId, first.actorId],
      );
      assert.equal((await repository.read(f.owner, f.worldId)).deliveries[0]!.status, 'sending');
      await commit(f, first.actorId, first.expectedVersion!, first.commandId);
      assert.equal(
        await repository.finishDelivery(f.owner, f.worldId, first.actorId, first.commandId),
        true,
      );
      const second = (await repository.claimNext(f.owner, f.worldId))!;
      assert.equal(second.expectedVersion, 2);
      await commit(f, second.actorId, second.expectedVersion!, second.commandId);
      await repository.finishDelivery(f.owner, f.worldId, second.actorId, second.commandId);
      s = await repository.read(f.owner, f.worldId);
      assert.equal(s.phase, 'complete');
      assert.equal(s.deliveries.length, 2);
      assert.equal(await repository.claimNext(f.owner, f.worldId), null);
      assert.equal((await runtime.get({ userId: f.owner }, f.worldId)).version, 3);
      const events = await admin.query(
        "SELECT count(*)::int count FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='turn.resolved'",
        [f.worldId],
      );
      assert.equal(events.rows[0].count, 3);
    },
  );
  await t.test(
    'only the legacy opening exact successful source is adopted and its node is preserved',
    async () => {
      const f = await fixture();
      const actor = f.actors[0]!.id;
      const old = await story.prepare(f.owner, f.worldId, {
        automatic: false,
        nodeKey: 'start',
        actorId: actor,
        expectedVersion: 0,
      });
      assert.equal(old.status, 'claimed');
      if (old.status !== 'claimed') throw Error('NO_CLAIM');
      await commit(f, actor, 0, old.claim.commandId);
      await story.finish(f.owner, f.worldId, old.claim.claimId);
      const before = (
        await admin.query('SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1', [
          f.worldId,
        ])
      ).rows[0];
      const plan = randomUUID();
      await repository.beginPlan(f.owner, f.worldId, plan);
      await repository.savePlan(f.owner, f.worldId, plan, briefs(f));
      let s = await repository.read(f.owner, f.worldId);
      assert.equal(s.deliveries.find((d) => d.actorId === actor)?.status, 'delivered');
      assert.equal(s.deliveries.find((d) => d.actorId === actor)?.commandId, old.claim.commandId);
      const next = (await repository.claimNext(f.owner, f.worldId))!;
      assert.notEqual(next.actorId, actor);
      await commit(f, next.actorId, next.expectedVersion!, next.commandId);
      await repository.finishDelivery(f.owner, f.worldId, next.actorId, next.commandId);
      assert.deepEqual(
        (
          await admin.query(
            'SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0],
        before,
      );
      s = await repository.read(f.owner, f.worldId);
      assert.equal(s.phase, 'complete');
      assert.equal(
        (await runtime.get({ userId: f.owner }, f.worldId)).messages.filter((m) => !m.history)
          .length,
        2,
      );
    },
  );
  await t.test(
    'source-bound plans survive ordinary version changes; explicit retries fence old callbacks and reconcile late receipts',
    async () => {
      const f = await fixture();
      let plan = randomUUID();
      await repository.beginPlan(f.owner, f.worldId, plan);
      await commit(f, f.actors[1]!.id, 0);
      await repository.savePlan(f.owner, f.worldId, plan, briefs(f)); // planning is an intention, not executed world state
      const old = (await repository.claimNext(f.owner, f.worldId))!;
      assert.equal(old.expectedVersion, 1);
      await repository.failDelivery(f.owner, f.worldId, old.actorId, old.commandId);
      assert.equal((await repository.read(f.owner, f.worldId)).phase, 'unknown');
      assert.equal(await repository.claimNext(f.owner, f.worldId), null);
      await repository.retry(f.owner, f.worldId);
      const rotated = (await repository.read(f.owner, f.worldId)).deliveries.find(
        (d) => d.actorId === old.actorId,
      )!;
      assert.notEqual(rotated.commandId, old.commandId);
      await repository.failDelivery(f.owner, f.worldId, old.actorId, old.commandId);
      assert.equal(
        (await repository.read(f.owner, f.worldId)).deliveries.find(
          (d) => d.actorId === old.actorId,
        )?.status,
        'queued',
      );
      await commit(f, old.actorId, old.expectedVersion!, old.commandId);
      assert.equal(
        await repository.finishDelivery(f.owner, f.worldId, old.actorId, old.commandId),
        true,
      );
      assert.equal(
        (await repository.read(f.owner, f.worldId)).deliveries.find(
          (d) => d.actorId === old.actorId,
        )?.commandId,
        old.commandId,
      );
      const next = (await repository.claimNext(f.owner, f.worldId))!;
      await commit(f, next.actorId, next.expectedVersion!); // unrelated command wins the version while this item is in flight
      await assert.rejects(
        commit(f, next.actorId, next.expectedVersion!, next.commandId),
        (e: any) => e.code === 'VERSION_CONFLICT',
      );
      assert.equal(
        await repository.finishDelivery(f.owner, f.worldId, next.actorId, next.commandId),
        false,
      );
      await repository.failDelivery(f.owner, f.worldId, next.actorId, next.commandId);
      assert.equal((await repository.read(f.owner, f.worldId)).phase, 'unknown');
      const g = await fixture();
      plan = randomUUID();
      await repository.beginPlan(g.owner, g.worldId, plan);
      await repository.failPlan(g.owner, g.worldId, plan);
      await repository.retry(g.owner, g.worldId);
      const replacement = (await repository.read(g.owner, g.worldId)).planCommandId!;
      assert.notEqual(replacement, plan);
      await assert.rejects(
        repository.savePlan(g.owner, g.worldId, plan, briefs(g)),
        (e: any) => e.code === 'VERSION_CONFLICT',
      );
      await repository.failPlan(g.owner, g.worldId, plan);
      assert.equal((await repository.read(g.owner, g.worldId)).phase, 'planning');
      await repository.savePlan(g.owner, g.worldId, replacement, briefs(g));
    },
  );

  await t.test(
    'an exact legacy opening arriving after plan storage is adopted before another actor call',
    async () => {
      const f = await fixture(),
        plan = randomUUID();
      await repository.beginPlan(f.owner, f.worldId, plan);
      await repository.savePlan(f.owner, f.worldId, plan, briefs(f));
      const actor = f.actors[0]!.id;
      const old = await story.prepare(f.owner, f.worldId, {
        automatic: false,
        nodeKey: 'start',
        actorId: actor,
        expectedVersion: 0,
      });
      assert.equal(old.status, 'claimed');
      if (old.status !== 'claimed') throw Error('NO_CLAIM');
      await commit(f, actor, 0, old.claim.commandId);
      await story.finish(f.owner, f.worldId, old.claim.claimId);
      const next = (await repository.claimNext(f.owner, f.worldId))!;
      assert.notEqual(next.actorId, actor);
      assert.equal(next.expectedVersion, 1);
      const adopted = (await repository.read(f.owner, f.worldId)).deliveries.find(
        (d) => d.actorId === actor,
      )!;
      assert.equal(adopted.status, 'delivered');
      assert.equal(adopted.commandId, old.claim.commandId);
      const history = (
        await admin.query(
          'SELECT command_history FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND actor_id=$2',
          [f.worldId, actor],
        )
      ).rows[0].command_history;
      assert.equal(history.length, 1);
      assert.equal(history[0].expectedVersion, null);
    },
  );
});
