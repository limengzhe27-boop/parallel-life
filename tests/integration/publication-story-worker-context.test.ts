import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import {
  PostgresTaskQueue,
  type TaskLease,
} from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
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
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import { inspectPublishedWorldSupport } from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';

async function before48(admin: Awaited<ReturnType<typeof adminClient>>) {
  await admin.query(
    'CREATE TABLE IF NOT EXISTS public.pl_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())',
  );
  for (const name of (await readdir(new URL('../../db/migrations/', import.meta.url)))
    .filter((n) => n.endsWith('.sql') && n < '0048')
    .sort()) {
    const raw = await readFile(new URL('../../db/migrations/' + name, import.meta.url), 'utf8'),
      checksum = createHash('sha256').update(raw).digest('hex'),
      old = (await admin.query('SELECT checksum FROM public.pl_migrations WHERE name=$1', [name]))
        .rows[0];
    if (old) {
      assert.equal(old.checksum, checksum);
      continue;
    }
    await admin.query('BEGIN');
    try {
      await admin.query(raw);
      await admin.query('INSERT INTO public.pl_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
      await admin.query('COMMIT');
    } catch (e) {
      await admin.query('ROLLBACK');
      throw e;
    }
  }
}
const localReview = randomUUID();
const review: PublicationReviewPort = {
  async review({ content }) {
    return {
      reviewerVersion: 'explicit_local_worker_fixture',
      runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
      media: { verified: true, manifestHash: 'a'.repeat(64) },
      trial: { verified: true, receiptId: localReview },
    };
  },
};
// Only the validated opening is initialized by the actual compiler; no synthetic provider success.
const compiler: PublicationWorldCompilerPort = {
  prepare(i) {
    const c = structuredClone(i.content) as Record<string, unknown>;
    delete c.timeline;
    c.candidates = [];
    const r = compilePublicationGenesis({
      ...i,
      content: c,
      originKind: i.originKind === 'trial' ? 'trial' : 'published',
      newId: randomUUID,
    });
    assert.equal(r.status, 'compiled');
    if (r.status !== 'compiled') throw Error('OPENING_INVALID');
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
test('real queue worker lease without app identity reads only scoped actual offer history and current scene intent', async (t) => {
  const c = await localConfig(),
    portText = process.env.PUBLICATION_STORY_WORKER_TEST_PORT ?? '55478';
  assert.match(portText, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(portText) <= 65535);
  assert.equal(c.port, Number(portText));
  const admin = await adminClient('parallel_life_test'),
    resources: PostgresDatabase[] = [];
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  t.after(async () => {
    await queue.close();
    for (const db of resources) await db.close();
    await admin.end();
  });
  await before48(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  resources.push(app);
  if (
    !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pl_worker_story_fixture'")).rowCount
  )
    await admin.query(
      `CREATE ROLE pl_worker_story_fixture LOGIN PASSWORD '${c.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  await admin.query('GRANT pl_publisher TO pl_worker_story_fixture');
  const pub = new PostgresDatabase(
    `postgresql://pl_worker_story_fixture:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  resources.push(pub);
  const owner = randomUUID(),
    other = randomUUID(),
    staff = randomUUID();
  for (const id of [owner, other]) await new IdentityRepository(app).ensureGuest(id);
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '仅本地worker回归夹具'],
  );
  const runtime = new PostgresWorldRepository(app),
    worlds = new PublicationWorldRepository(app, compiler),
    works = new PublicationRepository(pub, review),
    story = new PublicationStoryRepository(app);
  const report = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const doc = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(report)![1]!);
  const start = '2026-10-12T09:00:00.000Z';
  doc.world.startAt = start;
  doc.timeline = {
    initialStageKey: 'one',
    stages: [
      {
        key: 'one',
        title: '当下',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: start, expiresAt: '2026-10-12T10:00:00.000Z' },
      },
    ],
  };
  doc.candidates = [
    {
      key: 'inv',
      kind: 'candidate',
      title: '本地节点',
      editorialIntent: 'PRIVATE_CURRENT_SCENE_FRAGMENT_ONLY',
      actorKeys: [doc.actors[0].key],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: {
        kind: 'offer_invitation',
        actorKeys: [doc.actors[0].key],
        placeKey: doc.world.startPlaceKey,
        title: '实际本地邀约',
        earliestAt: '2026-10-12T09:30:00.000Z',
      },
      timeline: {
        stageKey: 'one',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    },
  ];
  const work = await works.create(staff, {
      commandId: randomUUID(),
      title: doc.work.title,
      content: doc,
    }),
    check = await works.check(staff, work.id, { commandId: randomUUID(), expectedDraftVersion: 0 });
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
  await admin.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
    world.worldId,
  ]);
  const prepared = await story.prepare(owner, world.worldId, { automatic: false });
  assert.equal(prepared.status, 'claimed');
  if (prepared.status !== 'claimed') throw Error('NO_CLAIM');
  const claim = prepared.claim;
  const command = {
    id: claim.commandId,
    worldId: world.worldId,
    actorId: claim.actorId,
    expectedVersion: 0,
    text: '明确本地单演员来源',
    origin: 'director' as const,
  };
  await runtime.commit({ userId: owner }, command, {
    schemaVersion: 1,
    id: randomUUID(),
    worldId: world.worldId,
    version: 1,
    commandId: claim.commandId,
    type: 'turn.resolved',
    occurredAt: new Date().toISOString(),
    storyAt: start,
    data: {
      actorId: claim.actorId,
      userText: command.text,
      origin: 'director',
      effects: [
        {
          type: 'message.received',
          id: randomUUID(),
          actorId: claim.actorId,
          text: '本地合成邀约源，不代表供应商成功',
        },
        {
          type: 'appointment.proposed',
          id: randomUUID(),
          title: '实际本地邀约',
          at: '2026-10-12T09:30:00.000Z',
          participantIds: [claim.actorId],
        },
      ],
    },
  });
  const progress = await story.finish(owner, world.worldId, claim.claimId),
    offered = progress.presented[0]!;
  assert.equal(offered.status, 'offered');
  const invitationId = offered.invitationId!;
  const legacy = randomUUID();
  await runtime.initialize(
    { userId: owner },
    {
      schemaVersion: 1,
      id: legacy,
      ownerId: owner,
      version: 0,
      time: start,
      title: '旧私人世界保持',
      actors: [{ id: randomUUID(), name: '旧角色', persona: '旧设定' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
  );
  const lease = async (worldId: string, asOwner = owner): Promise<TaskLease> => {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input) VALUES($1,$2,'world',$3,$4,$5,$6)",
      [id, asOwner, worldId, randomUUID(), 'a'.repeat(64), {}],
    );
    const leased = await queue.claimForOwner(id, asOwner, ['world']);
    assert.ok(leased);
    return leased!;
  };
  let actualLease = await lease(world.worldId);
  const legacyLease = await lease(legacy);
  const oldChecksum = (
    await admin.query(
      "SELECT checksum FROM public.pl_migrations WHERE name='0046_publication_story.sql'",
    )
  ).rows[0].checksum;
  if (
    !(
      await admin.query(
        "SELECT 1 FROM public.pl_migrations WHERE name='0048_publication_story_worker_context.sql'",
      )
    ).rowCount
  )
    await t.test(
      'reproduces original 46 rejection using real queue.read with only task and lease',
      async () => {
        await assert.rejects(
          queue.read(actualLease, (sql) =>
            readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
          ),
          (e) => (e as { code: string }).code === '42501',
        );
      },
    );
  await migrate(admin);
  await t.test('new additive migration leaves original 46 checksum untouched', async () => {
    assert.equal(
      (
        await admin.query(
          "SELECT checksum FROM public.pl_migrations WHERE name='0046_publication_story.sql'",
        )
      ).rows[0].checksum,
      oldChecksum,
    );
    assert.equal(
      createHash('sha256')
        .update(
          await readFile(
            new URL('../../db/migrations/0046_publication_story.sql', import.meta.url),
          ),
        )
        .digest('hex'),
      oldChecksum,
    );
  });
  await t.test(
    'real queue.read has no app identity yet reads exact actual offered link and scene fragment',
    async () => {
      const value = await queue.read(actualLease, async (sql) => {
        const identity = (await sql.query("SELECT current_setting('app.user_id',true) AS identity"))
          .rows[0].identity;
        assert.ok(!identity);
        return {
          links: await readPublicationInvitationLinks(sql, owner, world.worldId),
          brief: await readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        };
      });
      assert.equal(value.links[0]!.invitationId, invitationId);
      assert.equal(value.brief!.editorialIntent, 'PRIVATE_CURRENT_SCENE_FRAGMENT_ONLY');
    },
  );
  await t.test(
    'ordinary old world returns empty links and no brief under a valid queue lease',
    async () => {
      assert.deepEqual(
        await queue.read(legacyLease, (sql) => readPublicationInvitationLinks(sql, owner, legacy)),
        [],
      );
      assert.equal(
        await queue.read(legacyLease, (sql) =>
          readPublicationSceneBrief(sql, owner, legacy, invitationId),
        ),
        null,
      );
    },
  );
  await t.test(
    'opportunity story clock projects by authorized owner even when worker app identity is absent',
    async () => {
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        world.worldId,
        '2026-10-12T09:45:00.000Z',
      ]);
      assert.ok(
        await queue.read(actualLease, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
      );
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        world.worldId,
        '2026-10-12T10:00:00.000Z',
      ]);
      assert.equal(
        await queue.read(actualLease, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
        null,
      );
      assert.equal(
        (
          await queue.read(actualLease, (sql) =>
            readPublicationInvitationLinks(sql, owner, world.worldId),
          )
        )[0]!.invitationId,
        invitationId,
      );
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        world.worldId,
        '2026-10-12T09:05:00.000Z',
      ]);
    },
  );
  await t.test(
    'wrong owner, wrong world and borrowed/expired tokens are still rejected without widening any table rights',
    async () => {
      await assert.rejects(
        queue.read(actualLease, (sql) => readPublicationInvitationLinks(sql, other, world.worldId)),
        (e) => (e as { code: string }).code === '42501',
      );
      await assert.rejects(
        queue.read(actualLease, (sql) => readPublicationInvitationLinks(sql, owner, legacy)),
        (e) => (e as { code: string }).code === '42501',
      );
      await assert.rejects(
        queue.read({ ...actualLease, token: randomUUID() }, (sql) =>
          readPublicationInvitationLinks(sql, owner, world.worldId),
        ),
        (e) => (e as { code: string }).code === '42501',
      );
      for (const table of [
        'publication_story_plans',
        'publication_story_nodes',
        'publication_story_receipts',
        'publication_draft_revisions',
      ])
        await assert.rejects(
          queue.read(actualLease, (sql) => sql.query('SELECT * FROM parallel_life.' + table)),
          (e) => (e as { code: string }).code === '42501',
        );
      for (const fn of ['publication_story_source', 'publication_story_clock'])
        await assert.rejects(
          queue.read(actualLease, (sql) =>
            sql.query('SELECT parallel_life.' + fn + '($1)', [world.worldId]),
          ),
          (e) => (e as { code: string }).code === '42501',
        );
      const expired = actualLease;
      await admin.query(
        "UPDATE parallel_life.tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
        [expired.id],
      );
      await assert.rejects(
        queue.read(expired, (sql) => readPublicationInvitationLinks(sql, owner, world.worldId)),
        (e) => (e as { code: string }).code === '42501',
      );
      await admin.query(
        "UPDATE parallel_life.tasks SET lease_until=now()+interval '120 seconds' WHERE id=$1",
        [expired.id],
      );
    },
  );
  await t.test(
    'real queue.commit can read within the lease and finish the task without setting an app identity',
    async () => {
      const l = actualLease;
      const count = await queue.commit(l, async (sql) => {
        assert.ok(!(await sql.query("SELECT current_setting('app.user_id',true) AS x")).rows[0].x);
        const links = await readPublicationInvitationLinks(sql, owner, world.worldId);
        return { value: links.length, outcome: { status: 'succeeded' } };
      });
      assert.equal(count, 1);
      await assert.rejects(
        queue.read(l, (sql) => readPublicationInvitationLinks(sql, owner, world.worldId)),
        (e) => (e as { code: string }).code === '42501',
      );
      actualLease = await lease(world.worldId);
    },
  );
  await t.test(
    'actual acceptance then cancellation preserves historic source place link but removes current scene intent',
    async () => {
      let current = await runtime.get({ userId: owner }, world.worldId);
      await runtime.respondToInvitation(
        { userId: owner },
        {
          commandId: randomUUID(),
          worldId: world.worldId,
          id: invitationId,
          expectedVersion: current.version,
          operation: 'accept',
        },
      );
      await story.progress(owner, world.worldId);
      assert.ok(
        await queue.read(actualLease, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
      );
      current = await runtime.get({ userId: owner }, world.worldId);
      await runtime.respondToInvitation(
        { userId: owner },
        {
          commandId: randomUUID(),
          worldId: world.worldId,
          id: invitationId,
          expectedVersion: current.version,
          operation: 'cancel',
        },
      );
      // Read the cancellation directly before sidecar reconciliation to prove the bridge filters stale cache.
      assert.equal(
        await queue.read(actualLease, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
        null,
      );
      assert.equal(
        (
          await queue.read(actualLease, (sql) =>
            readPublicationInvitationLinks(sql, owner, world.worldId),
          )
        )[0]!.sourceEventId,
        offered.sourceEventId,
      );
      await story.progress(owner, world.worldId);
      const links = await queue.read(actualLease, (sql) =>
        readPublicationInvitationLinks(sql, owner, world.worldId),
      );
      assert.equal(links[0]!.invitationId, invitationId);
      assert.equal(links[0]!.placeId, doc.world.startPlaceKey);
      assert.equal(
        await app.transaction(owner, (sql) =>
          readPublicationSceneBrief(sql, owner, world.worldId, invitationId),
        ),
        null,
      );
    },
  );
  await t.test(
    'source-free claims and unrelated future nodes never become historical links',
    async () => {
      const source = (
        await admin.query(
          'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1',
          [world.worldId],
        )
      ).rows[0].document;
      assert.equal(source.nodes.length, 1);
      const links = await queue.read(actualLease, (sql) =>
        readPublicationInvitationLinks(sql, owner, world.worldId),
      );
      const serialized = JSON.stringify(links);
      assert.equal(serialized.includes('PRIVATE_CURRENT_SCENE_FRAGMENT_ONLY'), false);
      assert.equal(serialized.includes('actorIds'), false);
      const fn = (
        await admin.query(
          "SELECT has_function_privilege('pl_app',oid,'EXECUTE') app,has_function_privilege('pl_worker',oid,'EXECUTE') worker,has_function_privilege('pl_publisher',oid,'EXECUTE') staff,proconfig FROM pg_proc WHERE oid='parallel_life.publication_story_offer_context(text,text)'::regprocedure",
        )
      ).rows[0];
      assert.deepEqual(fn, {
        app: true,
        worker: true,
        staff: false,
        proconfig: ['search_path=pg_catalog'],
      });
    },
  );
});
