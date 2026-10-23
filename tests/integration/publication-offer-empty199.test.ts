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
test('0110 matches legacy offer reads while short circuiting empty native worlds', async (t) => {
  const config = await localConfig(),
    portText = process.env.PUBLICATION_OFFER_TEST_PORT ?? '55549';
  assert.match(portText, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(portText) <= 65535);
  assert.equal(config.port, Number(portText));
  const admin = await adminClient('parallel_life_test'),
    resources: PostgresDatabase[] = [];
  t.after(async () => {
    for (const db of resources) await db.close();
    await admin.query(
      'DROP FUNCTION IF EXISTS parallel_life.publication_story_offer_context_old199(text,text)',
    );
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
  const make = async (count = 1, amend?: (c: any) => void) => {
    const input = content(count);
    amend?.(input);
    const doc = PublishedWorldContentSchema.parse(input);
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

  const later = async (
    x: Awaited<ReturnType<typeof make>>,
    c: PublicationStoryClaim,
    options: {
      origin?: 'player' | 'director';
      title?: string;
      at?: string;
      actor?: string;
      invite?: boolean;
      participants?: string[];
      storyAt?: string;
    } = {},
  ) => {
    const state = await runtime.get({ userId: owner }, x.id);
    const commandId = randomUUID(),
      eventId = randomUUID(),
      invitationId = randomUUID(),
      actorId = options.actor ?? x.actor;
    const origin = options.origin === 'director' ? 'director' : undefined,
      at = options.storyAt ?? start;
    const effects: WorldEffect[] = [
      { type: 'message.received', id: randomUUID(), actorId, text: '明确本地合成回复' },
    ];
    if (options.invite !== false && c.intent.kind === 'offer_invitation')
      effects.push({
        type: 'appointment.proposed',
        id: invitationId,
        title: options.title ?? c.intent.title,
        at: options.at ?? c.intent.earliestAt,
        participantIds: options.participants ?? [actorId],
      });
    const result = await runtime.commit(
      { userId: owner },
      {
        id: commandId,
        worldId: x.id,
        actorId,
        expectedVersion: state.version,
        text: '玩家明确合成确认时间',
        origin,
      },
      {
        schemaVersion: 1,
        id: eventId,
        worldId: x.id,
        version: state.version + 1,
        commandId,
        type: 'turn.resolved',
        occurredAt: new Date().toISOString(),
        storyAt: at,
        data: { actorId, userText: '玩家明确合成确认时间', origin, effects },
      },
    );
    const m = (
      await admin.query(
        "SELECT id FROM parallel_life.world_messages WHERE world_id=$1 AND document->>'sourceEventId'=$2 AND document->>'role'='assistant'",
        [x.id, eventId],
      )
    ).rows[0].id;
    return { eventId, messageId: m, invitationId, version: result.state.version };
  };
  const failed = async () => {
    const x = await make(),
      c = await claim(x.id);
    await commit(x.id, c);
    return { x, c };
  };

  // Freeze the previous function under a test-only name; retain its exact body and
  // SECURITY DEFINER authorization. Never replace a historical migration file.
  const oldMigration = await readFile(
    new URL('../../db/migrations/0049_publication_story_followups.sql', import.meta.url),
    'utf8',
  );
  const from = oldMigration.indexOf(
    'CREATE OR REPLACE FUNCTION parallel_life.publication_story_offer_context(',
  );
  const to = oldMigration.indexOf('END $$;', from) + 'END $$;'.length;
  assert(from >= 0 && to > from);
  await admin.query(
    oldMigration
      .slice(from, to)
      .replace('publication_story_offer_context(', 'publication_story_offer_context_old199('),
  );
  await admin.query(
    'REVOKE ALL ON FUNCTION parallel_life.publication_story_offer_context_old199(text,text) FROM PUBLIC',
  );
  await admin.query(
    'GRANT EXECUTE ON FUNCTION parallel_life.publication_story_offer_context_old199(text,text) TO pl_app,pl_worker',
  );
  const read = (worldId: string, legacy = false, principal = owner, parameterOwner = owner) =>
    app
      .transaction(principal, (sql) =>
        sql.query(
          `SELECT parallel_life.${legacy ? 'publication_story_offer_context_old199' : 'publication_story_offer_context'}($1,$2) AS value`,
          [worldId, parameterOwner],
        ),
      )
      .then((r) => r.rows[0].value);
  const compare = async (worldId: string, expectedCount: number) => {
    const oldStart = performance.now();
    const before = await read(worldId, true);
    const oldMs = performance.now() - oldStart;
    const newStart = performance.now();
    const after = await read(worldId);
    const newMs = performance.now() - newStart;
    assert.deepEqual(after, before);
    assert.equal(after.length, expectedCount);
    t.diagnostic(JSON.stringify({ expectedCount, oldMs, newMs }));
    return after;
  };

  await t.test(
    'empty nodes and no offered invitation return exactly the old empty result',
    async () => {
      const empty = await make(0);
      await compare(empty.id, 0);
      const pending = await make();
      await claim(pending.id);
      await compare(pending.id, 0);
      const noOffer = await failed();
      await compare(noOffer.x.id, 0);
    },
  );
  await t.test(
    'authenticated original offer preserves provenance and scene eligibility',
    async () => {
      const x = await make();
      const c = await claim(x.id);
      await commit(x.id, c, true);
      const result = await compare(x.id, 1);
      assert.equal(result[0].sceneEligible, true);
      assert.equal(result[0].editorialIntent, '仅本地合成机会');
      assert.deepEqual(result[0].actorIds, [x.actor]);
    },
  );
  await t.test(
    'later genuine followup uses its actual event and invitation, not failed original',
    async () => {
      const { x, c } = await failed();
      const proof = await later(x, c);
      await story.progress(owner, x.id);
      const result = await compare(x.id, 1);
      assert.equal(result[0].invitationId, proof.invitationId);
      assert.equal(result[0].sourceEventId, proof.eventId);
      assert.equal(result[0].sceneEligible, true);
    },
  );
  await t.test(
    'empty fast path still checks tenant and worker authority before returning',
    async () => {
      const x = await make(0);
      for (const legacy of [true, false]) {
        await assert.rejects(read(x.id, legacy, other, owner), code('42501'));
        await assert.rejects(read(x.id, legacy, owner, other), code('42501'));
        const fn = legacy
          ? 'publication_story_offer_context_old199'
          : 'publication_story_offer_context';
        await assert.rejects(
          worker.transaction(owner, (sql) =>
            sql.query(`SELECT parallel_life.${fn}($1,$2)`, [x.id, owner]),
          ),
          code('42501'),
        );
        await assert.rejects(
          admin.query(`SELECT parallel_life.${fn}($1,$2)`, [x.id, owner]),
          code('42501'),
        );
      }
    },
  );
});
