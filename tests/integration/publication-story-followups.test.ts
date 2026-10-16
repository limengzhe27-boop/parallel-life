import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
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
test('real PG immutable later invitation evidence', async (t) => {
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
  const insert = async (
    x: Awaited<ReturnType<typeof make>>,
    c: PublicationStoryClaim,
    p: Awaited<ReturnType<typeof later>>,
    asOwner = owner,
  ) =>
    app.transaction(asOwner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.publication_story_followups(world_id,owner_id,node_key,source_event_id,source_message_id,invitation_id) VALUES($1,$2,$3,$4,$5,$6)',
        [x.id, asOwner, c.nodeKey, p.eventId, p.messageId, p.invitationId],
      ),
    );
  const rejectProof = async (options: Parameters<typeof later>[2]) => {
    const { x, c } = await failed(),
      p = await later(x, c, options);
    await assert.rejects(insert(x, c, p), (e: any) => {
      assert.equal(e.code, '23514');
      return true;
    });
    const progress = await story.progress(owner, x.id);
    assert.equal(progress.presented[0]!.status, 'failed');
    assert.equal(progress.presented[0]!.invitationId, null);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.publication_story_followups WHERE world_id=$1',
          [x.id],
        )
      ).rows[0].n,
      0,
    );
  };
  let actual: Awaited<ReturnType<typeof failed>>, proof: Awaited<ReturnType<typeof later>>;
  await t.test(
    'later actual player invitation offers with its own source; original failed claim and receipt unchanged',
    async () => {
      actual = await failed();
      const { x, c } = actual;
      const before = (
        await admin.query('SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1', [
          x.id,
        ])
      ).rows[0];
      proof = await later(x, c);
      const p = await story.progress(owner, x.id);
      assert.equal(p.presented[0]!.status, 'offered');
      assert.equal(p.presented[0]!.sourceEventId, proof.eventId);
      assert.equal(p.presented[0]!.sourceMessageId, proof.messageId);
      assert.equal(p.presented[0]!.invitationId, proof.invitationId);
      assert.equal(p.presented[0]!.playerCompleted, false);
      assert.deepEqual(
        (
          await admin.query(
            'SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1',
            [x.id],
          )
        ).rows[0],
        before,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.publication_story_receipts WHERE world_id=$1 AND kind='failure'",
            [x.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
      const links = await story.invitationLinks(owner, x.id);
      assert.equal(links[0]!.sourceEventId, proof.eventId);
      assert.equal(links[0]!.invitationId, proof.invitationId);
      assert.ok(await story.sceneBrief(owner, x.id, proof.invitationId));
    },
  );
  await t.test(
    'repeat progress is idempotent and duplicate actual evidence cannot be inserted',
    async () => {
      await story.progress(owner, actual.x.id);
      await story.progress(owner, actual.x.id);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_followups WHERE world_id=$1',
            [actual.x.id],
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(insert(actual.x, actual.c, proof), (e: any) => {
        assert.equal(e.code, '23505');
        return true;
      });
      await assert.rejects(
        story.skip(owner, actual.x.id, actual.c.nodeKey, randomUUID()),
        code('INVALID_STATE'),
      );
    },
  );
  await t.test('director turn without player message cannot associate', () =>
    rejectProof({ origin: 'director' }),
  );
  await t.test('wrong actor cannot associate', async () => {
    const { x, c } = await failed();
    const p = await later(x, c, { actor: x.otherActor });
    await assert.rejects(insert(x, c, p), (e: any) => {
      assert.equal(e.code, '23514');
      return true;
    });
    assert.equal((await story.progress(owner, x.id)).presented[0]!.status, 'failed');
  });
  await t.test('wrong title cannot associate', () => rejectProof({ title: '无关真实邀约' }));
  await t.test('before authored earliest cannot associate', () =>
    rejectProof({ at: '2026-10-12T09:30:00.000Z' }),
  );
  await t.test('refusal or promise without actual effect cannot associate', async () => {
    const { x, c } = await failed();
    await later(x, c, { invite: false });
    assert.equal((await story.progress(owner, x.id)).presented[0]!.status, 'failed');
    assert.ok(await story.invitationContext(owner, x.id, x.actor));
  });
  await t.test('closed current window or skipped original prevents insertion', async () => {
    const { x, c } = await failed(),
      p = await later(x, c);
    await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
      x.id,
      end,
    ]);
    await assert.rejects(insert(x, c, p), (e: any) => {
      assert.equal(e.code, '23514');
      return true;
    });
    assert.equal((await story.progress(owner, x.id)).presented[0]!.status, 'expired');
    const y = await failed();
    await story.skip(owner, y.x.id, y.c.nodeKey, randomUUID());
    const q = await later(y.x, y.c);
    await assert.rejects(insert(y.x, y.c, q), (e: any) => {
      assert.equal(e.code, '23514');
      return true;
    });
  });
  await t.test('owner/world mismatch and foreign visibility denied', async () => {
    await assert.rejects(insert(actual.x, actual.c, proof, other));
    assert.equal(
      (
        await app.transaction(other, (sql) =>
          sql.query('SELECT * FROM parallel_life.publication_story_followups WHERE world_id=$1', [
            actual.x.id,
          ]),
        )
      ).rowCount,
      0,
    );
    const y = await failed();
    await assert.rejects(insert(y.x, y.c, proof), (e: any) => {
      assert.equal(e.code, '23514');
      return true;
    });
  });
  await t.test(
    'missing player projection and extra participants rejected by SQL even for synthetic admin tampering',
    async () => {
      const { x, c } = await failed(),
        p = await later(x, c);
      const u = (
        await admin.query(
          "SELECT id,document FROM parallel_life.world_messages WHERE world_id=$1 AND document->>'sourceEventId'=$2 AND document->>'role'='user'",
          [x.id, p.eventId],
        )
      ).rows[0];
      await admin.query('UPDATE parallel_life.world_messages SET document=$2 WHERE id=$1', [
        u.id,
        { ...u.document, text: '' },
      ]);
      await assert.rejects(insert(x, c, p), (e: any) => {
        assert.equal(e.code, '23514');
        return true;
      });
      await admin.query('UPDATE parallel_life.world_messages SET document=$2 WHERE id=$1', [
        u.id,
        u.document,
      ]);
      const appointment = (
        await admin.query('SELECT document FROM parallel_life.world_appointments WHERE id=$1', [
          p.invitationId,
        ])
      ).rows[0].document;
      await admin.query('UPDATE parallel_life.world_appointments SET document=$2 WHERE id=$1', [
        p.invitationId,
        { ...appointment, participantIds: [x.actor, x.otherActor] },
      ]);
      await assert.rejects(insert(x, c, p), (e: any) => {
        assert.equal(e.code, '23514');
        return true;
      });
      await admin.query('UPDATE parallel_life.world_appointments SET document=$2 WHERE id=$1', [
        p.invitationId,
        appointment,
      ]);
    },
  );
  await t.test('full transaction rollback leaves no followup or fake progress', async () => {
    const { x, c } = await failed(),
      p = await later(x, c);
    await assert.rejects(
      app.transaction(owner, async (sql) => {
        await sql.query(
          'INSERT INTO parallel_life.publication_story_followups(world_id,owner_id,node_key,source_event_id,source_message_id,invitation_id) VALUES($1,$2,$3,$4,$5,$6)',
          [x.id, owner, c.nodeKey, p.eventId, p.messageId, p.invitationId],
        );
        throw Error('ROLLBACK_LOCAL_PROOF');
      }),
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.publication_story_followups WHERE world_id=$1',
          [x.id],
        )
      ).rows[0].n,
      0,
    );
  });

  await t.test(
    'unknown/claimed, no original source, and another pending node cannot acquire a followup',
    async () => {
      const x = await make(),
        c = await claim(x.id),
        p = await later(x, c);
      await assert.rejects(insert(x, c, p), (e: any) => {
        assert.equal(e.code, '23514');
        return true;
      });
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_followups WHERE world_id=$1',
            [x.id],
          )
        ).rows[0].n,
        0,
      );
      const y = await make(2),
        one = await claim(y.id);
      await commit(y.id, one);
      const q = await later(y, one);
      await claim(y.id);
      await assert.rejects(insert(y, one, q), (e: any) => {
        assert.equal(e.code, '23514');
        return true;
      });
    },
  );
  await t.test(
    'source must be actual later succeeded turn with the real proposing effect',
    async () => {
      const { x, c } = await failed(),
        p = await later(x, c);
      const e = (
        await admin.query('SELECT payload,command_id FROM parallel_life.world_events WHERE id=$1', [
          p.eventId,
        ])
      ).rows[0];
      const savedCommand = (
        await admin.query('SELECT result_state FROM parallel_life.commands WHERE id=$1', [
          e.command_id,
        ])
      ).rows[0];
      await admin.query(
        "UPDATE parallel_life.commands SET status='failed',result_event_id=NULL,result_state=NULL WHERE id=$1",
        [e.command_id],
      );
      await assert.rejects(insert(x, c, p), (error: any) => {
        assert.equal(error.code, '23514');
        return true;
      });
      await admin.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$2,result_state=$3 WHERE id=$1",
        [e.command_id, p.eventId, savedCommand.result_state],
      );
      const altered = structuredClone(e.payload);
      altered.data.effects = altered.data.effects.filter(
        (effect: any) => effect.type !== 'appointment.proposed',
      );
      await admin.query('UPDATE parallel_life.world_events SET payload=$2 WHERE id=$1', [
        p.eventId,
        altered,
      ]);
      await assert.rejects(insert(x, c, p), (error: any) => {
        assert.equal(error.code, '23514');
        return true;
      });
      await admin.query('UPDATE parallel_life.world_events SET payload=$2 WHERE id=$1', [
        p.eventId,
        e.payload,
      ]);
      const original = (
        await admin.query(
          'SELECT source_event_id,source_message_id FROM parallel_life.publication_story_nodes WHERE world_id=$1',
          [x.id],
        )
      ).rows[0];
      await assert.rejects(
        insert(x, c, {
          ...p,
          eventId: original.source_event_id,
          messageId: original.source_message_id,
        }),
        (error: any) => {
          assert.equal(error.code, '23514');
          return true;
        },
      );
    },
  );
  await t.test(
    'multiple qualifying actual invitations remain ambiguous and immutable proof cannot be edited',
    async () => {
      const { x, c } = await failed();
      await later(x, c);
      await later(x, c);
      assert.equal((await story.progress(owner, x.id)).presented[0]!.status, 'failed');
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.publication_story_followups WHERE world_id=$1',
            [x.id],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        app.transaction(owner, (sql) =>
          sql.query(
            'UPDATE parallel_life.publication_story_followups SET source_event_id=$2 WHERE world_id=$1',
            [actual.x.id, randomUUID()],
          ),
        ),
      );
      await assert.rejects(
        app.transaction(owner, (sql) =>
          sql.query('DELETE FROM parallel_life.publication_story_followups WHERE world_id=$1', [
            actual.x.id,
          ]),
        ),
      );
    },
  );
  await t.test(
    'followup expires without fake completion and history retains exact actual provenance',
    async () => {
      const { x, c } = await failed();
      const p = await later(x, c);
      assert.equal((await story.progress(owner, x.id)).presented[0]!.status, 'offered');
      await admin.query('UPDATE parallel_life.world_clock SET story_now=$2 WHERE world_id=$1', [
        x.id,
        end,
      ]);
      assert.equal((await story.progress(owner, x.id)).presented[0]!.outcome, 'expired');
      assert.equal(await story.sceneBrief(owner, x.id, p.invitationId), null);
      assert.equal((await story.invitationLinks(owner, x.id))[0]!.sourceEventId, p.eventId);
      assert.equal(await story.invitationContext(owner, x.id, x.actor), null);
    },
  );

  await t.test(
    'actual followup acceptance opens next stage and clipped context uses effective prior outcome',
    async () => {
      const x = await make(2, (c) => {
        c.timeline.stages.push({
          key: 'later',
          title: '后续',
          order: 1,
          afterStageKeys: ['opening'],
          window: { notBefore: start, expiresAt: end },
        });
        c.candidates[1].timeline.stageKey = 'later';
        c.candidates[1].prerequisites = [{ kind: 'after_committed_node', nodeKey: 'invite_0' }];
      });
      const first = await claim(x.id);
      await commit(x.id, first);
      const p = await later(x, first);
      await story.progress(owner, x.id);
      const state = await runtime.get({ userId: owner }, x.id);
      await runtime.respondToInvitation(
        { userId: owner },
        {
          worldId: x.id,
          id: p.invitationId,
          commandId: randomUUID(),
          expectedVersion: state.version,
          operation: 'accept',
        },
      );
      const progress = await story.progress(owner, x.id);
      assert.deepEqual(progress.currentStageKeys, ['later']);
      const second = await claim(x.id);
      assert.equal(second.nodeKey, 'invite_1');
      await commit(x.id, second);
      assert.equal((await story.invitationContext(owner, x.id, x.actor))?.title, '实际邀约1');
    },
  );
  await t.test(
    'actual accept/cancel projected from actual response; historical later links retained',
    async () => {
      const { x } = actual;
      const respond = async (operation: 'accept' | 'cancel') => {
        const state = await runtime.get({ userId: owner }, x.id);
        return runtime.respondToInvitation(
          { userId: owner },
          {
            worldId: x.id,
            id: proof.invitationId,
            commandId: randomUUID(),
            expectedVersion: state.version,
            operation,
          },
        );
      };
      await respond('accept');
      assert.equal((await story.progress(owner, x.id)).presented[0]!.outcome, 'committed');
      await respond('cancel');
      assert.equal((await story.progress(owner, x.id)).presented[0]!.outcome, 'declined');
      assert.equal(await story.sceneBrief(owner, x.id, proof.invitationId), null);
      assert.equal((await story.invitationLinks(owner, x.id))[0]!.sourceEventId, proof.eventId);
    },
  );
  await t.test(
    'real queue task/lease without app identity reads only later actual provenance',
    async () => {
      const { x } = actual;
      const queue = new PostgresTaskQueue(
        `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
      );
      t.after(() => queue.close());

      const fresh = await failed(),
        freshProof = await later(fresh.x, fresh.c);
      await story.progress(owner, fresh.x.id);
      const freshTask = randomUUID();
      await admin.query(
        "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input) VALUES($1,$2,'world',$3,$4,$5,$6)",
        [freshTask, owner, fresh.x.id, randomUUID(), 'b'.repeat(64), {}],
      );
      const freshLease = await queue.claimForOwner(freshTask, owner, ['world']);
      assert.ok(freshLease);
      assert.equal(
        (
          await queue.read(freshLease!, (sql) =>
            readPublicationSceneBrief(sql, owner, fresh.x.id, freshProof.invitationId),
          )
        )?.sourceEventId,
        freshProof.eventId,
      );
      await assert.rejects(
        queue.read(freshLease!, (sql) => readPublicationInvitationLinks(sql, owner, x.id)),
      );
      const deadline = (
        await admin.query('SELECT lease_until FROM parallel_life.tasks WHERE id=$1', [freshTask])
      ).rows[0].lease_until;
      await admin.query(
        "UPDATE parallel_life.tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
        [freshTask],
      );
      await assert.rejects(
        queue.read(freshLease!, (sql) => readPublicationInvitationLinks(sql, owner, fresh.x.id)),
      );
      await admin.query('UPDATE parallel_life.tasks SET lease_until=$2 WHERE id=$1', [
        freshTask,
        deadline,
      ]);
      await queue.commit(freshLease!, async () => ({
        value: null,
        outcome: { status: 'succeeded' as const },
      }));
      const taskId = randomUUID();
      await admin.query(
        "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input) VALUES($1,$2,'world',$3,$4,$5,$6)",
        [taskId, owner, x.id, randomUUID(), 'a'.repeat(64), {}],
      );
      const lease = await queue.claimForOwner(taskId, owner, ['world']);
      assert.ok(lease);
      const links = await queue.read(lease!, async (sql) => {
        assert.equal(
          (await sql.query("SELECT current_setting('app.user_id',true) AS identity")).rows[0]
            .identity ?? '',
          '',
        );
        return readPublicationInvitationLinks(sql, owner, x.id);
      });
      assert.equal(links[0]!.sourceEventId, proof.eventId);
      assert.equal(
        await queue.read(lease!, (sql) =>
          readPublicationSceneBrief(sql, owner, x.id, proof.invitationId),
        ),
        null,
      );
      await assert.rejects(
        queue.read(lease!, (sql) => readPublicationInvitationLinks(sql, other, x.id)),
      );
      await assert.rejects(
        queue.read({ ...lease!, token: randomUUID() }, (sql) =>
          readPublicationInvitationLinks(sql, owner, x.id),
        ),
      );
      await assert.rejects(
        queue.read(lease!, (sql) =>
          sql.query('SELECT * FROM parallel_life.publication_story_followups'),
        ),
      );
      await queue.commit(lease!, async (sql) => {
        assert.equal(
          (await readPublicationInvitationLinks(sql, owner, x.id))[0]!.sourceEventId,
          proof.eventId,
        );
        return { value: null, outcome: { status: 'succeeded' as const } };
      });
      await assert.rejects(
        queue.read(lease!, (sql) => readPublicationInvitationLinks(sql, owner, x.id)),
      );
    },
  );
});
