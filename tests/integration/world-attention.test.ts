import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { ApprovedSeedSchema } from '../../src/contracts/seeds.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { publicationWorldCompiler } from '../../src/server/publication-runtime.ts';
import { PublishedWorldContentSchema } from '../../src/contracts/published-world-content.ts';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { readWorldAttentionInTransaction } from '../../src/modules/world/infrastructure/world-attention-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const at = (seconds: number) =>
  new Date(Date.parse('2026-10-15T08:00:00.000Z') + seconds * 1000).toISOString();
test('actual owner-scoped conversation attention shares existing clock leases and derives business membership', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.WORLD_ATTENTION_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    worker = new PostgresDatabase(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  const worlds = new PostgresWorldRepository(app),
    clock = new PostgresClockStore(app),
    activity = new PostgresClockActivityRepository(app),
    groups = new PostgresGroupRepository(app, () => at(0)),
    scenes = new SceneRepository(app),
    owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await queue.close();
      await app.close();
      await worker.close();
      await admin.end();
    }
  });
  async function fixture(epoch2 = true, visibleContacts = true, personId?: string) {
    const owner = randomUUID(),
      id = randomUUID(),
      a = randomUUID(),
      b = randomUUID(),
      source = { kind: 'seed_genesis' as const, seedId: randomUUID(), snapshotVersion: 0 as const };
    await new IdentityRepository(app).ensureGuest(owner);
    owned.push({ owner, id });
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Only synthetic attention fixture',
      time: at(0),
      actors: [
        {
          id: a,
          name: '同名',
          persona: '虚构A',
          ...(personId ? { sourcePersonId: personId } : {}),
        },
        { id: b, name: '同名', persona: '虚构B' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'home',
        positionSource: source,
        places: [
          {
            id: 'home',
            name: '虚构客厅',
            description: '',
            source,
            contactActorIds: [a, b],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    // Persist synthetic genesis history exactly where the actual Phone hydrates it.
    // The public initializer deliberately rejects nonempty history; do not mutate its immutable baseline.
    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [id, owner, world.title, world],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [
          id,
          owner,
          {
            ...world,
            messages: visibleContacts
              ? [a, b].map((actorId) => ({
                  id: randomUUID(),
                  actorId,
                  role: 'assistant',
                  text: 'Explicit synthetic saved history',
                  at: at(0),
                  sourceEventId: `genesis:${id}`,
                }))
              : [],
          },
          {},
        ],
      );
    });
    if (epoch2)
      await app.transaction(owner, async (sql) => {
        for (const actor of world.actors)
          await initializeActorAgentStateInTransaction(
            sql,
            owner,
            emptyActorAgentState(
              { worldId: id, actorId: actor.id },
              agentDefinitionRef(world, actor.id),
              0,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId: id,
          expectedWorldVersion: 0,
          expectedEpoch: 1,
          nextEpoch: 2,
        });
      });
    await clock.write(owner, id, {
      storyNow: at(0),
      lastTickAt: at(0),
      speed: 0,
      paused: false,
      missedBeats: 0,
      summary: null,
    });
    return { owner, id, a, b };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  const target = (actor: string) => ({ channel: 'private' as const, threadId: actor });
  async function read(f: F, seconds: number) {
    const w = await worlds.get({ userId: f.owner }, f.id);
    return app.transaction(f.owner, (sql) =>
      readWorldAttentionInTransaction(sql, f.owner, {
        worldId: f.id,
        worldVersion: w.version,
        realNow: at(seconds),
      }),
    );
  }
  async function readNow(f: F) {
    const w = await worlds.get({ userId: f.owner }, f.id);
    return app.transaction(f.owner, (sql) =>
      readWorldAttentionInTransaction(sql, f.owner, {
        worldId: f.id,
        worldVersion: w.version,
        realNow: new Date().toISOString(),
      }),
    );
  }
  async function stored(f: F, client: string) {
    return (
      await admin.query(
        'SELECT sequence,mode,focus,expires_at FROM parallel_life.world_clock_activity WHERE world_id=$1 AND client_id=$2',
        [f.id, client],
      )
    ).rows[0];
  }
  await t.test(
    'cast and map contact hints alone never authorize a hidden private target',
    async () => {
      const f = await fixture(true, false),
        client = randomUUID();
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).messages.length, 0);
      await assert.rejects(
        activity.update(
          f.owner,
          f.id,
          { clientId: client, sequence: 0, mode: 'conversation', focus: target(f.a) },
          at(0),
        ),
        { code: 'INVALID_COMMAND' },
      );
      assert.equal(await stored(f, client), undefined);
      // Simulate a shape-valid lease saved by the earlier cast-only implementation.
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 0, mode: 'conversation' },
        at(0),
      );
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.world_clock_activity SET focus=$3 WHERE world_id=$1 AND client_id=$2',
          [f.id, client, target(f.a)],
        ),
      );
      assert.deepEqual(await read(f, 1), { focus: [], conversationWithoutTarget: true });
    },
  );
  await t.test(
    'actual historical player group overlap introduces an otherwise hidden contact',
    async () => {
      const f = await fixture(true, false);
      const g = await groups.create(f.owner, {
        worldId: f.id,
        expectedVersion: 0,
        commandId: randomUUID(),
        title: '合成初识群',
        actorIds: [f.a],
      });
      const client = randomUUID();
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 0, mode: 'conversation', focus: target(f.a) },
        new Date().toISOString(),
      );
      await assert.rejects(
        activity.update(
          f.owner,
          f.id,
          { clientId: randomUUID(), sequence: 0, mode: 'conversation', focus: target(f.b) },
          new Date().toISOString(),
        ),
        { code: 'INVALID_COMMAND' },
      );
      await groups.membership(f.owner, {
        worldId: f.id,
        expectedVersion: g.version,
        commandId: randomUUID(),
        groupId: g.groupId,
        participant: { kind: 'player' },
        action: 'leave',
      });
      // Leaving removes current group attention, but does not erase having met its members.
      assert.deepEqual((await readNow(f)).focus, [{ ...target(f.a), actorIds: [f.a] }]);
    },
  );
  await t.test(
    'selected person contacts require the actual saved seed person and matching immutable actor binding',
    async () => {
      for (const mode of ['exact', 'no_roles', 'different_person', 'no_binding'] as const) {
        const personId = randomUUID(),
          f = await fixture(true, false, personId);
        const profile = await new ProfileRepository(app).get(f.owner),
          seedId = randomUUID();
        const seed = ApprovedSeedSchema.parse({
          id: seedId,
          createdAt: at(0),
          profileVersion: 0,
          discoveryVersion: 0,
          directionId: randomUUID(),
          story: {
            title: 'Synthetic selection',
            premise: 'Fixture only',
            opening: 'Fixture only',
            tradeoff: 'Fixture only',
          },
          facts: [],
          people: [
            {
              id: mode === 'different_person' ? randomUUID() : personId,
              name: '合成人物',
              relationship: '朋友',
              assetId: null,
            },
          ],
          ...(mode === 'no_roles' ? {} : { personRoles: [] }),
          portraitAssetId: null,
          assets: [],
        });
        await app.transaction(f.owner, async (sql) => {
          await sql.query(
            'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
            [seedId, f.owner, profile.id, randomUUID(), 'explicit-fixture', seed],
          );
          await sql.query(
            'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id,opening) VALUES($1,$2,$3,$4)',
            [
              seedId,
              f.owner,
              f.id,
              { identity: 'Explicit synthetic protagonist', setting: 'Explicit synthetic setting' },
            ],
          );
        });
        if (mode !== 'no_binding')
          await admin.query(
            'INSERT INTO parallel_life.world_person_bindings(world_id,owner_id,person_id,actor_id,person_snapshot) VALUES($1,$2,$3,$4,$5)',
            [f.id, f.owner, personId, f.a, { id: personId }],
          );
        const phone = await new BuildRepository(app).phone(f.owner, f.id);
        assert.deepEqual(
          phone.actors.map((a) => a.id),
          mode === 'exact' ? [f.a] : [],
          mode,
        );
        const promise = activity.update(
          f.owner,
          f.id,
          { clientId: randomUUID(), sequence: 0, mode: 'conversation', focus: target(f.a) },
          at(0),
        );
        if (mode === 'exact') {
          await promise;
          assert.deepEqual((await read(f, 1)).focus, [{ ...target(f.a), actorIds: [f.a] }]);
        } else await assert.rejects(promise, { code: 'INVALID_COMMAND' }, mode);
      }
    },
  );
  await t.test(
    'a real compiled and bound trial exposes authored contacts even without any historical message',
    async () => {
      // The synthetic work stays an unpublished local draft, with no model/review or production calls.
      const pub = new PostgresDatabase(
        `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      );
      try {
        const staff = randomUUID();
        await admin.query(
          'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
          [staff, 'Local attention fixture'],
        );
        const raw = await readFile(
          new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
          'utf8',
        );
        const c = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
        c.world.startAt = at(0);
        c.history = [];
        c.initialKnowledge = [];
        c.protagonist.knownFactKeys = [];
        c.phone = { messages: [], moments: [], notes: [], invitations: [], album: [] };
        c.candidates = [];
        delete c.timeline;
        delete c.conditions;
        delete c.openingEventKey;
        const works = new PublicationRepository(pub, {
          async review() {
            throw Error('NO_REVIEW_AUTHORIZED_OR_NEEDED');
          },
        });
        const work = await works.create(staff, {
          commandId: randomUUID(),
          title: 'Synthetic contact trial',
          content: PublishedWorldContentSchema.parse(c),
        });
        const draft = (await works.get(staff, work.id)).draft;
        const trials = new PublicationWorldRepository(pub, publicationWorldCompiler);
        const trial = await trials.startTrial(staff, work.id, {
          commandId: randomUUID(),
          draftVersion: 0,
          contentHash: draft.contentHash,
        });
        const session = await trials.trialSession(staff, trial.trialId!);
        owned.push({ owner: session.ownerId, id: trial.worldId });
        const state = await worlds.get({ userId: session.ownerId }, trial.worldId);
        assert.equal(state.messages.length, 0);
        const phone = await new BuildRepository(app).phone(session.ownerId, trial.worldId);
        assert.equal(phone.actors.length, state.actors.length);
        assert(phone.actors.length > 0);
        await clock.write(session.ownerId, trial.worldId, {
          storyNow: at(0),
          lastTickAt: at(0),
          speed: 0,
          paused: false,
          missedBeats: 0,
          summary: null,
        });
        for (const actor of phone.actors)
          await activity.update(
            session.ownerId,
            trial.worldId,
            { clientId: randomUUID(), sequence: 0, mode: 'conversation', focus: target(actor.id) },
            at(0),
          );
      } finally {
        await pub.close();
      }
    },
  );
  await t.test(
    'exact private target survives reading/thinking heartbeats; explicit null and leaving clear it',
    async () => {
      const f = await fixture(),
        client = randomUUID();
      const first = await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 0, mode: 'conversation', focus: target(f.a) },
        at(0),
      );
      assert.equal(first.speed, 1);
      assert.deepEqual((await read(f, 1)).focus, [{ ...target(f.a), actorIds: [f.a] }]);
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 1, mode: 'conversation' },
        at(30),
      );
      assert.deepEqual((await stored(f, client)).focus, target(f.a));
      assert.equal((await read(f, 60)).focus[0]!.threadId, f.a);
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 2, mode: 'conversation', focus: null },
        at(61),
      );
      assert.deepEqual(await read(f, 62), { focus: [], conversationWithoutTarget: true });
      assert.equal((await clock.read(f.owner, f.id, at(62))).speed, 1);
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 3, mode: 'browsing', focus: target(f.a) },
        at(63),
      );
      assert.equal((await stored(f, client)).focus, null);
      assert.deepEqual(await read(f, 64), { focus: [], conversationWithoutTarget: false });
    },
  );
  await t.test(
    'legacy conversation is still 1x but has no inferred target; last messages are never consulted',
    async () => {
      const f = await fixture(),
        client = randomUUID();
      const c = await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 0, mode: 'conversation' },
        at(0),
      );
      assert.equal(c.speed, 1);
      assert.deepEqual(await read(f, 1), { focus: [], conversationWithoutTarget: true });
    },
  );
  await t.test('stale/duplicate sequence cannot change target or extend its lease', async () => {
    const f = await fixture(),
      client = randomUUID();
    await activity.update(
      f.owner,
      f.id,
      { clientId: client, sequence: 5, mode: 'conversation', focus: target(f.a) },
      at(0),
    );
    const before = await stored(f, client);
    for (const sequence of [5, 4])
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence, mode: 'conversation', focus: target(f.b) },
        at(10),
      );
    assert.deepEqual(await stored(f, client), before);
    assert.equal((await read(f, 11)).focus[0]!.threadId, f.a);
  });
  await t.test(
    'unknown actor and client actorIds injection are rejected without changing clock or focus',
    async () => {
      const f = await fixture(),
        client = randomUUID();
      for (const focus of [target(randomUUID()), { ...target(f.a), actorIds: [f.b] }])
        await assert.rejects(
          activity.update(
            f.owner,
            f.id,
            { clientId: client, sequence: 0, mode: 'conversation', focus: focus as any },
            at(0),
          ),
          { code: 'INVALID_COMMAND' },
        );
      assert.equal(await stored(f, client), undefined);
    },
  );
  await t.test(
    'multiple tabs derive all valid targets, conversation wins 1x, away does not close another live thread',
    async () => {
      const f = await fixture(),
        a = randomUUID(),
        b = randomUUID(),
        browse = randomUUID();
      await activity.update(
        f.owner,
        f.id,
        { clientId: a, sequence: 0, mode: 'conversation', focus: target(f.a) },
        at(0),
      );
      await activity.update(
        f.owner,
        f.id,
        { clientId: b, sequence: 0, mode: 'conversation', focus: target(f.b) },
        at(1),
      );
      const c = await activity.update(
        f.owner,
        f.id,
        { clientId: browse, sequence: 0, mode: 'browsing' },
        at(2),
      );
      assert.equal(c.speed, 1);
      assert.equal((await read(f, 3)).focus.length, 2);
      await activity.update(f.owner, f.id, { clientId: a, sequence: 1, mode: 'away' }, at(4));
      assert.deepEqual((await read(f, 4)).focus, [{ ...target(f.b), actorIds: [f.b] }]);
      const browsing = await activity.update(
        f.owner,
        f.id,
        { clientId: b, sequence: 1, mode: 'away' },
        at(5),
      );
      assert.equal(browsing.speed, 12);
      assert.deepEqual((await read(f, 6)).focus, []);
    },
  );
  await t.test(
    '45-second boundary and manual pause suppress attention; no offline time or focus resurrection',
    async () => {
      const f = await fixture(),
        client = randomUUID();
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 0, mode: 'conversation', focus: target(f.a) },
        at(0),
      );
      assert.equal((await read(f, 44.999)).focus.length, 1);
      assert.deepEqual(await read(f, 45), { focus: [], conversationWithoutTarget: false });
      const expired = await clock.read(f.owner, f.id, at(60));
      assert.equal(expired.paused, true);
      const retired = await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 1, mode: 'conversation' },
        at(60),
      );
      assert.equal(retired.paused, true);
      assert.equal((await stored(f, client)).focus, null);
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 2, mode: 'conversation', focus: target(f.a), resume: true },
        at(61),
      );
      await app.transaction(f.owner, (sql) =>
        sql.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [f.id]),
      );
      assert.deepEqual(await read(f, 62), { focus: [], conversationWithoutTarget: false });
    },
  );
  await t.test(
    'real group membership derives current actors, actor leave changes attention and player leave revokes it',
    async () => {
      const f = await fixture(),
        client = randomUUID(),
        g = await groups.create(f.owner, {
          worldId: f.id,
          expectedVersion: 0,
          commandId: randomUUID(),
          title: '真实合成群',
          actorIds: [f.a, f.b],
        });
      await activity.update(
        f.owner,
        f.id,
        {
          clientId: client,
          sequence: 0,
          mode: 'conversation',
          focus: { channel: 'group', threadId: g.groupId },
        },
        new Date().toISOString(),
      );
      assert.deepEqual((await readNow(f)).focus[0]!.actorIds, [f.a, f.b].sort());
      const left = await groups.membership(f.owner, {
        worldId: f.id,
        expectedVersion: g.version,
        commandId: randomUUID(),
        groupId: g.groupId,
        participant: { kind: 'actor', actorId: f.b },
        action: 'leave',
      });
      assert.deepEqual((await readNow(f)).focus[0]!.actorIds, [f.a]);
      await groups.membership(f.owner, {
        worldId: f.id,
        expectedVersion: left.version,
        commandId: randomUUID(),
        groupId: g.groupId,
        participant: { kind: 'player' },
        action: 'leave',
      });
      assert.deepEqual(await readNow(f), { focus: [], conversationWithoutTarget: true });
      await assert.rejects(
        activity.update(
          f.owner,
          f.id,
          {
            clientId: client,
            sequence: 1,
            mode: 'conversation',
            focus: { channel: 'group', threadId: g.groupId },
          },
          new Date().toISOString(),
        ),
        { code: 'INVALID_COMMAND' },
      );
    },
  );
  await t.test(
    'another world group cannot be focused, even for the same owner namespace guess',
    async () => {
      const f = await fixture(),
        other = await fixture(),
        g = await groups.create(other.owner, {
          worldId: other.id,
          expectedVersion: 0,
          commandId: randomUUID(),
          title: '其它世界群',
          actorIds: [other.a],
        });
      await assert.rejects(
        activity.update(
          f.owner,
          f.id,
          {
            clientId: randomUUID(),
            sequence: 0,
            mode: 'conversation',
            focus: { channel: 'group', threadId: g.groupId },
          },
          at(0),
        ),
        { code: 'INVALID_COMMAND' },
      );
    },
  );
  for (const hasDialogue of [false, true])
    await t.test(
      `real scene ${hasDialogue ? 'observed dialogue introduces a contact' : 'presence alone stays hidden'}; leaving revokes scene attention`,
      async () => {
        const f = await fixture(false, false),
          entered = await scenes.enterPlace(f.owner, f.id, {
            commandId: randomUUID(),
            expectedVersion: 0,
            placeId: 'home',
          });
        await runOne(
          {
            claim: (k) => queue.claimForOwner(entered.task!.id, f.owner, k),
            renew: (l) => queue.renew(l),
            finish: (l, o) => queue.finish(l, o),
          },
          {
            world: sceneTaskHandler(
              queue,
              {
                async propose() {
                  return {
                    location: '虚构客厅',
                    narration: '明确合成现场',
                    presentActorIds: [f.a],
                    outcome: null,
                    observation: null,
                    matterTitle: null,
                    matterUpdates: [],
                    dialogues: hasDialogue
                      ? [{ actorId: f.a, text: 'Explicit observed synthetic dialogue' }]
                      : [],
                  };
                },
              },
              'EXPLICIT_MOCK_NO_MODEL',
            ),
          },
        );
        const ready = await scenes.read(f.owner, f.id, entered.sceneId);
        assert.equal(ready.task?.status, 'succeeded');
        const privateClient = randomUUID();
        const privateFocus = activity.update(
          f.owner,
          f.id,
          { clientId: privateClient, sequence: 0, mode: 'conversation', focus: target(f.a) },
          at(0),
        );
        if (hasDialogue) {
          await privateFocus;
          await activity.update(
            f.owner,
            f.id,
            { clientId: privateClient, sequence: 1, mode: 'browsing' },
            at(0),
          );
        } else await assert.rejects(privateFocus, { code: 'INVALID_COMMAND' });
        await assert.rejects(
          activity.update(
            f.owner,
            f.id,
            { clientId: randomUUID(), sequence: 0, mode: 'conversation', focus: target(f.b) },
            at(0),
          ),
          { code: 'INVALID_COMMAND' },
        );
        const client = randomUUID();
        await activity.update(
          f.owner,
          f.id,
          {
            clientId: client,
            sequence: 0,
            mode: 'conversation',
            focus: { channel: 'scene', threadId: entered.sceneId },
          },
          at(0),
        );
        assert.deepEqual((await read(f, 1)).focus, [
          { channel: 'scene', threadId: entered.sceneId, actorIds: [f.a] },
        ]);
        await scenes.navigate(
          f.owner,
          f.id,
          entered.sceneId,
          { commandId: randomUUID(), expectedVersion: ready.worldVersion },
          true,
        );
        assert.deepEqual(await read(f, 2), { focus: [], conversationWithoutTarget: true });
      },
    );
  await t.test(
    'same-target heartbeat can renew during advisory work, a target switch cannot bypass that guard',
    async () => {
      const f = await fixture(),
        client = randomUUID();
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 0, mode: 'conversation', focus: target(f.a) },
        at(0),
      );
      const held = await app.pool.connect();
      try {
        await held.query('BEGIN');
        await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [f.id]);
        const renewed = await activity.update(
          f.owner,
          f.id,
          { clientId: client, sequence: 1, mode: 'conversation' },
          at(10),
        );
        assert.equal(renewed.speed, 1);
        assert.deepEqual((await stored(f, client)).focus, target(f.a));
        await assert.rejects(
          activity.update(
            f.owner,
            f.id,
            { clientId: client, sequence: 2, mode: 'conversation', focus: target(f.b) },
            at(11),
          ),
          { code: 'VERSION_CONFLICT' },
        );
      } finally {
        await held.query('ROLLBACK');
        held.release();
      }
    },
  );
  await t.test(
    'RR READ ONLY attention does not write, stale world version and owner/worker are fenced',
    async () => {
      const f = await fixture(),
        client = randomUUID();
      await activity.update(
        f.owner,
        f.id,
        { clientId: client, sequence: 0, mode: 'conversation', focus: target(f.a) },
        at(0),
      );
      const before = await stored(f, client),
        sql = await app.pool.connect();
      try {
        await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await sql.query("SELECT set_config('app.user_id',$1,true)", [f.owner]);
        assert.equal(
          (
            await readWorldAttentionInTransaction(sql, f.owner, {
              worldId: f.id,
              worldVersion: 0,
              realNow: at(1),
            })
          ).focus.length,
          1,
        );
        await sql.query('COMMIT');
      } finally {
        sql.release();
      }
      assert.deepEqual(await stored(f, client), before);
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          readWorldAttentionInTransaction(sql, f.owner, {
            worldId: f.id,
            worldVersion: 1,
            realNow: at(1),
          }),
        ),
        { code: 'VERSION_CONFLICT' },
      );
      const foreign = await fixture();
      await assert.rejects(
        app.transaction(foreign.owner, (sql) =>
          readWorldAttentionInTransaction(sql, foreign.owner, {
            worldId: f.id,
            worldVersion: 0,
            realNow: at(1),
          }),
        ),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        worker.transaction(f.owner, (sql) =>
          readWorldAttentionInTransaction(sql, f.owner, {
            worldId: f.id,
            worldVersion: 0,
            realNow: at(1),
          }),
        ),
        { code: '42501' },
      );
    },
  );
  await t.test(
    'SQL77 rejects extra actorIds and nonconversation focus without widening table grants',
    async () => {
      const f = await fixture();
      for (const [mode, focus] of [
        ['conversation', { ...target(f.a), actorIds: [f.b] }],
        ['browsing', target(f.a)],
      ] as const)
        await assert.rejects(
          app.transaction(f.owner, (sql) =>
            sql.query(
              'INSERT INTO parallel_life.world_clock_activity(world_id,owner_id,client_id,sequence,mode,expires_at,focus)VALUES($1,$2,$3,0,$4,$5,$6)',
              [f.id, f.owner, randomUUID(), mode, at(45), JSON.stringify(focus)],
            ),
          ),
          { code: '23514' },
        );
      assert.equal(
        (
          await admin.query(
            "SELECT has_table_privilege('pl_worker','parallel_life.world_clock_activity','SELECT') AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
    },
  );
});
