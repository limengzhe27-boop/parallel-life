import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresGroupRepository,
  persistGroupEvent,
  groupReplyEvent,
} from '../../src/modules/world/infrastructure/group-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { PostgresStoryWaitRepository } from '../../src/modules/world/infrastructure/story-wait-repository.ts';
import { PostgresAppointmentWaitRepository } from '../../src/modules/world/infrastructure/appointment-wait-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

// Explicit local SQL/proposal fixtures. No real model calls or production saves.
test('actual player commands under the Agent engine: original receipts, atomic writes and old NPC fence', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.PLAYER_WORLD_COMMAND_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db),
    groups = new PostgresGroupRepository(db),
    scenes = new SceneRepository(db),
    space = new PostgresWorldSpace(db, officialLifeCatalog);
  const real = new Date().toISOString(),
    story = '2026-10-15T06:00:00.000Z';
  const fixtures: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      // Local fixtures stay auditable; do not exercise unsupported world deletion.
      for (const f of fixtures) {
        await admin.query(
          "UPDATE parallel_life.tasks SET status='cancelled',error_code='CANCELLED' WHERE owner_id=$1 AND scope_id=$2 AND status IN ('queued','running','unknown')",
          [f.owner, f.id],
        );
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
      }
    } finally {
      await db.close();
      await worker.close();
      await admin.end();
    }
  });
  async function fixture(epoch2 = true, appointment: 'proposed' | 'confirmed' | null = null) {
    const owner = randomUUID(),
      id = randomUUID(),
      a = randomUUID(),
      b = randomUUID(),
      invitationId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    fixtures.push({ owner, id });
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const state: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Explicit player gate SQL fixture',
      time: story,
      actors: [
        { id: a, name: 'A', persona: 'Fictional test actor' },
        { id: b, name: 'B', persona: 'Fictional test actor' },
      ],
      facts: [],
      messages: [],
      mediaRequests: [],
      appointments: appointment
        ? [
            {
              id: invitationId,
              title: '已保存的约定',
              at: '2026-10-15T07:00:00.000Z',
              participantIds: [a],
              status: appointment,
              sourceEventId: 'genesis:' + id,
            },
          ]
        : [],
      space: {
        currentPlaceId: 'home',
        positionSource: source,
        places: [
          {
            id: 'home',
            name: '测试客厅',
            description: '合成出发点',
            contactActorIds: [a, b],
            appointmentIds: appointment ? [invitationId] : [],
            source,
          },
          {
            id: 'shop',
            name: '测试商店',
            description: '合成目的地',
            contactActorIds: [b],
            appointmentIds: [],
            source,
          },
        ],
        routes: [
          {
            id: 'to_shop',
            fromPlaceId: 'home',
            toPlaceId: 'shop',
            durationMinutes: 10,
            modeLabel: '步行',
            source,
          },
        ],
      },
    };
    // Seeded appointments are immutable genesis, as in a compiled authored world.
    await db.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [id, owner, state.title, state],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [id, owner, state, {}],
      );
    });
    await clocks.setClock(owner, id, { paused: false, speed: 0 }, real);
    const f = { owner, id, a, b, invitationId, state };
    if (epoch2) await activate(f);
    return f;
  }
  async function activate(f: { owner: string; id: string; state: WorldState }) {
    const current = await worlds.get({ userId: f.owner }, f.id);
    await db.transaction(f.owner, async (sql) => {
      for (const actor of f.state.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          f.owner,
          emptyActorAgentState(
            { worldId: f.id, actorId: actor.id },
            'authored:fixture',
            current.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, f.owner, {
        worldId: f.id,
        expectedWorldVersion: current.version,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
  }
  async function count(table: string, id: string) {
    assert.ok(['world_events', 'agent_attempts', 'tasks', 'scene_items'].includes(table));
    const clause = table === 'tasks' ? 'scope_id' : 'world_id';
    return Number(
      (
        await admin.query(
          `SELECT count(*)::int AS n FROM parallel_life.${table} WHERE ${clause}=$1`,
          [id],
        )
      ).rows[0].n,
    );
  }
  await t.test(
    'note versions stay independent; replay predates epoch/version authorization; owner isolation remains',
    async () => {
      const f = await fixture(false);
      const first = {
        worldId: f.id,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: '第一版',
        text: '真实玩家笔记',
      };
      const saved = await worlds.saveNote({ userId: f.owner }, first);
      await activate(f);
      const edited = await worlds.saveNote(
        { userId: f.owner },
        {
          ...first,
          id: saved.note.id,
          commandId: randomUUID(),
          expectedVersion: 1,
          title: '第二版',
        },
      );
      assert.equal(edited.version, 2);
      assert.equal(edited.note.version, 2);
      assert.deepEqual(await worlds.saveNote({ userId: f.owner }, first), saved);
      await assert.rejects(worlds.saveNote({ userId: f.owner }, { ...first, text: '改变原请求' }), {
        code: 'IDEMPOTENCY_CONFLICT',
      });
      await assert.rejects(
        worlds.saveNote(
          { userId: f.owner },
          { ...first, id: saved.note.id, commandId: randomUUID(), expectedVersion: 1 },
        ),
        { code: 'VERSION_CONFLICT' },
      );
      const foreign = await fixture();
      await assert.rejects(worlds.saveNote({ userId: foreign.owner }, first), {
        code: 'NOT_FOUND',
      });
      assert.equal(await count('world_events', f.id), 2);
      assert.equal(await count('agent_attempts', f.id), 0);
    },
  );
  await t.test(
    'calendar response and exact appointment wait commit in epoch2; old receipt still replays',
    async () => {
      const f = await fixture(true, 'proposed');
      const input = {
        worldId: f.id,
        commandId: randomUUID(),
        expectedVersion: 0,
        id: f.invitationId,
        operation: 'accept' as const,
      };
      const accepted = await worlds.respondToInvitation({ userId: f.owner }, input);
      assert.equal(accepted.appointments[0]!.status, 'confirmed');
      const wait = new PostgresAppointmentWaitRepository(db, { now: () => real });
      const command = { commandId: randomUUID(), expectedVersion: 1, invitationId: f.invitationId };
      const receipt = await wait.wait(f.owner, f.id, command);
      assert.equal(receipt.storyNow, '2026-10-15T07:00:00.000Z');
      assert.deepEqual(await wait.wait(f.owner, f.id, command), receipt);
      assert.equal(
        (await worlds.respondToInvitation({ userId: f.owner }, input)).version,
        accepted.version,
      );
      assert.equal(await count('world_events', f.id), 2);
    },
  );
  await t.test(
    'travel persists position and receipt without leaking contact-linked destination facts',
    async () => {
      const f = await fixture();
      const input = { commandId: randomUUID(), expectedVersion: 0, routeId: 'to_shop' };
      const receipt = await space.travel(f.owner, f.id, input);
      const world = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(world.space?.currentPlaceId, 'shop');
      assert.equal(world.time, receipt.arrivedAt);
      assert.equal(world.facts.length, 0);
      await clocks.setClock(f.owner, f.id, { paused: true });
      assert.deepEqual(await space.travel(f.owner, f.id, input), receipt);
      assert.equal(await count('world_events', f.id), 1);
    },
  );
  await t.test(
    'player clock controls/lease replay work while legacy NPC clock writer is fenced',
    async () => {
      const f = await fixture();
      await clocks.setClock(f.owner, f.id, { paused: true, speed: 1 }, real);
      assert.equal((await clocks.read(f.owner, f.id)).paused, true);
      const input = {
        clientId: randomUUID(),
        sequence: 1,
        mode: 'conversation' as const,
        resume: true,
      };
      const active = await activity.update(f.owner, f.id, input, real);
      assert.equal(active.paused, false);
      assert.deepEqual(await activity.update(f.owner, f.id, input, real), active);
      await assert.rejects(
        clocks.setStoryTime(f.owner, f.id, '2026-10-16T08:00:00.000Z'),
        /ENGINE_EPOCH_CONFLICT/,
      );
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).time, story);
    },
  );
  await t.test(
    'explicit short wait still advances time and atomically stores clock and receipt',
    async () => {
      const f = await fixture();
      const wait = new PostgresStoryWaitRepository(db, { now: () => real });
      const input = {
        commandId: randomUUID(),
        expectedVersion: 0,
        clientId: randomUUID(),
        sequence: 1,
        target: 'short' as const,
      };
      const receipt = await wait.wait(f.owner, f.id, input);
      assert.equal(receipt.storyNow, '2026-10-15T06:30:00.000Z');
      assert.deepEqual(await wait.wait(f.owner, f.id, input), receipt);
      assert.equal((await clocks.read(f.owner, f.id)).storyNow, receipt.storyNow);
      assert.equal(await count('world_events', f.id), 1);
    },
  );
  await t.test(
    'group membership and real player message persist; task is durable queued, not a simulated NPC result',
    async () => {
      const f = await fixture();
      const create = {
        worldId: f.id,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: '真实玩家创建的群',
        actorIds: [f.a],
      };
      const group = await groups.create(f.owner, create);
      await groups.membership(f.owner, {
        worldId: f.id,
        groupId: group.groupId,
        commandId: randomUUID(),
        expectedVersion: 1,
        action: 'join',
        participant: { kind: 'actor', actorId: f.b },
      });
      const input = {
        worldId: f.id,
        groupId: group.groupId,
        commandId: randomUUID(),
        expectedVersion: 2,
        text: '下午在大厅汇合。',
      };
      const receipt = await groups.send(f.owner, input);
      assert.equal(receipt.task.status, 'queued');
      assert.deepEqual(await groups.send(f.owner, input), receipt);
      assert.deepEqual(await groups.create(f.owner, create), group);
      const read = await groups.read(f.owner, f.id, group.groupId);
      assert.equal(read.messages.length, 1);
      assert.equal(read.messages[0]!.sender.kind, 'player');
      assert.equal(await count('agent_attempts', f.id), 0);
      const world = await worlds.get({ userId: f.owner }, f.id);
      const before = await count('world_events', f.id);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          persistGroupEvent(
            sql,
            world,
            groupReplyEvent(
              f.owner,
              world,
              randomUUID(),
              group.groupId,
              [{ actorId: f.a, text: '旧NPC不得写入' }],
              real,
            ),
            'fixture-hash',
          ),
        ),
        /row-level security policy/,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          persistGroupEvent(
            sql,
            world,
            groupReplyEvent(f.owner, world, randomUUID(), group.groupId, [], real),
            'fixture-empty-hash',
          ),
        ),
        /ENGINE_EPOCH_CONFLICT/,
      );
      assert.equal(await count('world_events', f.id), before);
      assert.equal((await groups.read(f.owner, f.id, group.groupId)).messages.length, 1);
    },
  );
  await t.test(
    'new-engine scene entry is honest player presence and queued opening; public input awaits actual opening',
    async () => {
      const f = await fixture();
      const input = { commandId: randomUUID(), expectedVersion: 0, placeId: 'home' };
      const entered = await scenes.enterPlace(f.owner, f.id, input);
      assert.equal(entered.task?.status, 'queued');
      assert.deepEqual(await scenes.enterPlace(f.owner, f.id, input), entered);
      const read = await scenes.read(f.owner, f.id, entered.sceneId);
      assert.equal(read.scene!.presence.length, 1);
      assert.equal(read.entries.length, 0);
      assert.equal(read.scene!.presence[0]!.participant.kind, 'player');
      await assert.rejects(
        scenes.input(f.owner, f.id, entered.sceneId, {
          commandId: randomUUID(),
          expectedVersion: entered.version,
          text: '大家现在在做什么？',
          relatedMatterIds: [],
        }),
        { code: 'INVALID_COMMAND' },
      );
      const left = await scenes.navigate(
        f.owner,
        f.id,
        entered.sceneId,
        { commandId: randomUUID(), expectedVersion: entered.version },
        true,
      );
      assert.equal(left.task, null);
      assert.equal((await scenes.read(f.owner, f.id)).scene, null);
    },
  );
  await t.test(
    'existing actually opened scene accepts epoch2 player input; old scene NPC cannot finalize',
    async () => {
      const f = await fixture(false);
      const entered = await scenes.enterPlace(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: 0,
        placeId: 'home',
      });
      // A known synthetic legacy opening is committed before the epoch switch.
      const opening = {
        type: 'scene' as const,
        sceneId: entered.sceneId,
        actionId: null,
        expectedVersion: entered.version,
      };
      const proposal = {
        location: '测试客厅',
        narration: 'Explicit SQL fixture opening.',
        presentActorIds: [f.a],
        outcome: null,
        observation: null,
        matterTitle: null,
        initialMatters: [],
        matterUpdates: [],
        dialogues: [],
      };
      await db.transaction(f.owner, (sql) =>
        commitSceneProposal(sql, f.owner, f.id, opening, proposal, randomUUID()),
      );
      await admin.query("UPDATE parallel_life.tasks SET status='succeeded' WHERE id=$1", [
        entered.task!.id,
      ]);
      await activate(f);
      const before = await scenes.read(f.owner, f.id, entered.sceneId);
      const input = {
        commandId: randomUUID(),
        expectedVersion: before.worldVersion,
        text: '我们今天先核对约定的时间。',
        relatedMatterIds: [],
      };
      const receipt = await scenes.input(f.owner, f.id, entered.sceneId, input);
      assert.equal(receipt.task?.status, 'queued');
      assert.deepEqual(await scenes.input(f.owner, f.id, entered.sceneId, input), receipt);
      const after = await scenes.read(f.owner, f.id, entered.sceneId);
      assert.equal(after.actions.at(-1)!.text, input.text);
      const countBefore = await count('world_events', f.id);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          commitSceneProposal(
            sql,
            f.owner,
            f.id,
            { ...opening, actionId: after.actions.at(-1)!.id, expectedVersion: receipt.version },
            {
              ...proposal,
              narration: '旧NPC不得写入',
              outcome: 'partial',
              observation: 'Explicit synthetic observation',
            },
            randomUUID(),
          ),
        ),
        /ENGINE_EPOCH_CONFLICT/,
      );
      assert.equal(await count('world_events', f.id), countBefore);
    },
  );
  await t.test(
    'departure fact names only a sourced actual scene witness, never a contact or destination',
    async () => {
      const f = await fixture(false);
      const entered = await scenes.enterPlace(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: 0,
        placeId: 'home',
      });
      await db.transaction(f.owner, (sql) =>
        commitSceneProposal(
          sql,
          f.owner,
          f.id,
          {
            type: 'scene',
            sceneId: entered.sceneId,
            actionId: null,
            expectedVersion: entered.version,
          },
          {
            location: '测试客厅',
            narration: 'Explicit local opening with one physical witness.',
            presentActorIds: [f.a],
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
      await admin.query("UPDATE parallel_life.tasks SET status='succeeded' WHERE id=$1", [
        entered.task!.id,
      ]);
      await activate(f);
      const before = await worlds.get({ userId: f.owner }, f.id);
      const receipt = await space.travel(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: before.version,
        routeId: 'to_shop',
      });
      const current = await worlds.get({ userId: f.owner }, f.id);
      const fact = current.facts.find((f) => f.departure)!;
      assert.ok(fact);
      assert.deepEqual(fact.visibility, { kind: 'actors', actorIds: [f.a] });
      assert.equal(fact.sourceEventId, receipt.sourceEventId);
      assert.doesNotMatch(fact.text, /测试商店|shop/);
      assert.match(fact.text, /没有获知目的地/);
      const event = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
          receipt.sourceEventId,
        ])
      ).rows[0].payload;
      assert.equal(event.data.departedAt, receipt.departedAt);
      assert.equal(event.data.departureObservation.sourceEventId, fact.sourceEventId);
      assert.equal((await scenes.read(f.owner, f.id)).scene, null);
    },
  );
  await t.test(
    'worker cannot turn an actual player repository call into epoch2 write authority',
    async () => {
      const f = await fixture();
      await assert.rejects(
        new PostgresWorldRepository(worker).saveNote(
          { userId: f.owner },
          {
            worldId: f.id,
            commandId: randomUUID(),
            expectedVersion: 0,
            title: '禁止伪装',
            text: 'legacy worker',
          },
        ),
      );
      assert.equal(await count('world_events', f.id), 0);
    },
  );
});
