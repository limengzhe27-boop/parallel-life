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
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
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
test('real PG clipped already-presented invitation context', async (t) => {
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
  const end = '2026-10-12T12:00:00.000Z';
  const content = (count = 1) => {
    const c = structuredClone(base);
    c.world.startAt = start;
    c.world.hiddenContext = 'PRIVATE_DO_NOT_RETURN';
    c.history = [];
    c.initialKnowledge = [];
    c.protagonist.knownFactKeys = [];
    c.timeline = {
      initialStageKey: 'opening',
      stages: [
        {
          key: 'opening',
          title: '当前阶段',
          order: 0,
          afterStageKeys: [],
          window: { notBefore: start, expiresAt: end },
        },
      ],
    };
    c.candidates = Array.from({ length: count }, (_, i) => ({
      key: 'invite_' + i,
      kind: 'candidate',
      title: '候选' + i,
      editorialIntent: '仅本地合成机会',
      actorKeys: [a],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: {
        kind: 'offer_invitation',
        actorKeys: [a],
        placeKey: c.world.startPlaceKey,
        title: '实际邀约' + i,
        earliestAt: '2026-10-12T10:00:00.000Z',
      },
      timeline: {
        stageKey: 'opening',
        window: { notBefore: start, expiresAt: end },
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    }));
    return c;
  };
  const make = async (count = 1) => {
    const doc = PublishedWorldContentSchema.parse(content(count));
    const work = await works.create(staff, {
      commandId: randomUUID(),
      title: doc.work.title,
      content: doc,
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
    const p = await story.progress(owner, w.worldId);
    assert.equal(p.presented.length, 0);
    const plan = (
      await admin.query(
        'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1',
        [w.worldId],
      )
    ).rows[0].document;
    return {
      id: w.worldId,
      actor: plan.actors.find((x: { key: string }) => x.key === a).id,
      otherActor: plan.actors.find((x: { key: string }) => x.key === b).id,
      place: plan.places.find((x: { key: string }) => x.key === doc.world.startPlaceKey).name,
    };
  };
  const claim = async (w: string) => {
    const r = await story.prepare(owner, w, { automatic: false });
    assert.equal(r.status, 'claimed');
    if (r.status !== 'claimed') throw Error('NO_CLAIM');
    return r.claim;
  };
  const commit = async (w: string, c: PublicationStoryClaim, invite = false) => {
    const effects: WorldEffect[] = [
      {
        type: 'message.received',
        id: randomUUID(),
        actorId: c.actorId,
        text: '仅本地合成：19:00之后有空吗？',
      },
    ];
    if (invite && c.intent.kind === 'offer_invitation')
      effects.push({
        type: 'appointment.proposed',
        id: randomUUID(),
        title: c.intent.title,
        at: c.intent.earliestAt,
        participantIds: [c.actorId],
      });
    const command = {
      id: c.commandId,
      worldId: w,
      actorId: c.actorId,
      expectedVersion: c.expectedVersion,
      text: '本地合成导演',
      origin: 'director' as const,
    };
    await runtime.commit({ userId: owner }, command, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: w,
      version: c.expectedVersion + 1,
      commandId: c.commandId,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      storyAt: start,
      data: { actorId: c.actorId, userText: command.text, origin: 'director', effects },
    });
    return story.finish(owner, w, c.claimId);
  };
  const x = await make();
  let first: PublicationStoryClaim;
  await t.test('future and merely claimed/unknown opportunities reveal nothing', async () => {
    assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
    first = await claim(x.id);
    assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
    await story.finish(owner, x.id, first.claimId);
    assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
    await story.retry(owner, x.id, first.claimId);
  });
  await t.test(
    'actual failed reply returns exactly three clipped fields, no calendar or audit writes',
    async () => {
      const p = await commit(x.id, first);
      assert.equal(p.presented[0]!.status, 'failed');
      const before = (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.publication_story_receipts WHERE world_id=$1',
          [x.id],
        )
      ).rows[0].n;
      const expected = {
        title: '实际邀约0',
        placeName: x.place,
        earliestAt: '2026-10-12T10:00:00.000Z',
      };
      assert.deepEqual(await story.invitationContext(owner, x.id, x.actor), expected);
      assert.deepEqual(await story.invitationContext(owner, x.id, x.actor), expected);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_receipts WHERE world_id=$1',
            [x.id],
          )
        ).rows[0].n,
        before,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_appointments WHERE world_id=$1',
            [x.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal((await story.progress(owner, x.id)).presented[0]!.status, 'failed');
    },
  );
  await t.test('wrong actor and owner isolation', async () => {
    assert.equal(await story.invitationContext(owner, x.id, x.otherActor), null);
    await assert.rejects(story.invitationContext(other, x.id, x.actor), code('NOT_FOUND'));
    await assert.rejects(
      async () => story.invitationContext(owner, x.id, ''),
      code('INVALID_INPUT'),
    );
  });
  await t.test(
    'current clock before source or outside presentation window reveals nothing',
    async () => {
      for (const at of [end]) {
        await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
          x.id,
          at,
        ]);
        assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
      }
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        x.id,
        start,
      ]);
    },
  );
  await t.test('missing or mismatched actual assistant source cannot supply context', async () => {
    const m = (
      await admin.query(
        'SELECT m.id,m.document FROM parallel_life.world_messages m JOIN parallel_life.publication_story_nodes s ON s.source_message_id=m.id AND s.world_id=m.world_id WHERE m.world_id=$1',
        [x.id],
      )
    ).rows[0];
    await admin.query(
      'UPDATE parallel_life.world_messages SET document=$2 WHERE world_id=$1 AND id=$3',
      [x.id, { ...m.document, actorId: x.otherActor }, m.id],
    );
    assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
    await admin.query(
      'UPDATE parallel_life.world_messages SET document=$2 WHERE world_id=$1 AND id=$3',
      [x.id, m.document, m.id],
    );
  });
  await t.test(
    'owner skip resolves opportunity without erasing original failure evidence',
    async () => {
      await story.skip(owner, x.id, first.nodeKey, randomUUID());
      assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
      const rows = (
        await admin.query(
          'SELECT kind FROM parallel_life.publication_story_receipts WHERE world_id=$1',
          [x.id],
        )
      ).rows;
      assert.ok(rows.some((r: any) => r.kind === 'failure'));
      assert.ok(rows.some((r: any) => r.kind === 'owner_skip'));
    },
  );
  await t.test(
    'any pending claim suppresses old context; two actually presented candidates are ambiguous',
    async () => {
      const y = await make(2),
        one = await claim(y.id);
      await commit(y.id, one);
      assert.ok(await story.invitationContext(owner, y.id, y.actor));
      const two = await claim(y.id);
      assert.equal(await story.invitationContext(owner, y.id, y.actor), null);
      await commit(y.id, two);
      assert.equal(await story.invitationContext(owner, y.id, y.actor), null);
    },
  );
  await t.test('actual offered appointment is not returned as a failed opportunity', async () => {
    const y = await make(),
      c = await claim(y.id),
      p = await commit(y.id, c, true);
    assert.equal(p.presented[0]!.status, 'offered');
    assert.equal(await story.invitationContext(owner, y.id, y.actor), null);
  });
});
