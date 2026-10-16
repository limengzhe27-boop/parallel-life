import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { nativeNpcTaskHandler } from '../../src/server/npc-agent-channel-services.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { MemoryRepository } from '../../src/modules/memory/infrastructure/memory-repository.ts';
import { forgetMemoryInStore } from '../../src/modules/memory/infrastructure/memory-store.ts';
import {
  readActorGroupObservationSourcesInTransaction as readSources,
  type ActorGroupObservationFrame,
} from '../../src/modules/world/infrastructure/actor-group-observation-sources.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('actual group producer and historical membership authenticate observation sources (real PG)', async (t) => {
  const cfg = await localConfig();
  const port = Number(process.env.ACTOR_GROUP_OBSERVATION_TEST_PORT ?? 55579);
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
  assert.equal(cfg.port, port);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    groups = new PostgresGroupRepository(db),
    tasks = new TaskRepository(db);
  const generated: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    try {
      for (const f of generated)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.worldId, f.owner],
        );
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  type Fixture = {
    owner: string;
    worldId: string;
    a: string;
    b: string;
    c: string;
    groupId: string;
  };
  async function fixture(twoMembers = false): Promise<Fixture> {
    const owner = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID(),
      c = randomUUID();
    generated.push({ owner, worldId });
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic actual group observation',
      time: new Date().toISOString(),
      actors: [
        { id: a, name: '甲', persona: '只按真实所知自然回应。' },
        { id: b, name: '乙', persona: '保留自己的判断。' },
        { id: c, name: '丙', persona: '不是群成员。' },
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
            name: '家',
            description: 'Initial fixture location',
            source,
            contactActorIds: [],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, world);
    const created = await groups.create(owner, {
      worldId,
      commandId: randomUUID(),
      expectedVersion: 0,
      title: '原群',
      actorIds: twoMembers ? [a, b] : [a],
    });
    const current = await worlds.get({ userId: owner }, worldId);
    await db.transaction(owner, async (sql) => {
      for (const actorId of [a, b, c])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId },
            agentDefinitionRef(current, actorId),
            current.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: current.version,
      });
    });
    return { owner, worldId, a, b, c, groupId: created.groupId };
  }
  async function frame(f: Fixture, actorId = f.a): Promise<ActorGroupObservationFrame> {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return {
      worldId: f.worldId,
      actorId,
      engineEpoch: 2,
      worldVersion: world.version,
      storyAt: world.time,
      groupId: f.groupId,
    };
  }
  async function read(
    f: Fixture,
    actorId = f.a,
    options: Partial<ActorGroupObservationFrame> = {},
  ) {
    const scope = { ...(await frame(f, actorId)), ...options };
    return db.transaction(f.owner, (sql) => readSources(sql, f.owner, scope));
  }
  async function send(f: Fixture, text: string, keepTask = false) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const commandId = randomUUID();
    const result = await groups.send(f.owner, {
      worldId: f.worldId,
      groupId: f.groupId,
      commandId,
      expectedVersion: world.version,
      text,
    });
    if (!keepTask) await tasks.cancel(f.owner, result.task.id);
    return { ...result, commandId };
  }
  async function membership(f: Fixture, actorId: string, action: 'join' | 'leave') {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return groups.membership(f.owner, {
      worldId: f.worldId,
      groupId: f.groupId,
      commandId: randomUUID(),
      expectedVersion: world.version,
      participant: { kind: 'actor', actorId },
      action,
    });
  }

  await t.test(
    'player statement is heard only by original members and never changes actual location',
    async () => {
      const f = await fixture();
      await send(f, '我已经在公园了。');
      const before = await worlds.get({ userId: f.owner }, f.worldId);
      const packet = await read(f);
      assert.equal(packet.sources.length, 1);
      assert.equal(packet.sources[0]!.kind, 'group_message');
      assert.equal(packet.observations[0]!.kind, 'speech');
      assert.equal(packet.observations[0]!.evidenceKind, 'player_report');
      assert.equal(packet.observations[0]!.learnedAt, packet.observations[0]!.storyAt);
      assert.deepEqual((await read(f, f.b)).sources, []);
      assert.deepEqual((await read(f, f.c)).omittedSourceIds, []);
      assert.deepEqual(await worlds.get({ userId: f.owner }, f.worldId), before);
      assert.equal(before.space?.currentPlaceId, 'home');
    },
  );

  await t.test(
    'late joiners do not see old speech; leave preserves acquired history and rejoin does not fill the gap',
    async () => {
      const f = await fixture();
      await send(f, '入群前的第一条。');
      await membership(f, f.b, 'join');
      await send(f, '两个人都听到的第二条。');
      const originalA = await read(f);
      await membership(f, f.a, 'leave');
      assert.deepEqual(
        (await read(f)).sources,
        originalA.sources,
        'later leave must not change acquired source hashes',
      );
      await send(f, '甲离群期间的第三条。');
      await membership(f, f.a, 'join');
      await send(f, '重入后的第四条。');
      assert.deepEqual(
        (await read(f)).observations.map((o) => o.text),
        ['入群前的第一条。', '两个人都听到的第二条。', '重入后的第四条。'],
      );
      assert.deepEqual(
        (await read(f, f.b)).observations.map((o) => o.text),
        ['两个人都听到的第二条。', '甲离群期间的第三条。', '重入后的第四条。'],
      );
      assert.deepEqual((await read(f, f.c)).observations, []);
    },
  );

  await t.test(
    'native NPC reply has exact projector identity; own reply does not recursively wake oneself',
    async () => {
      const f = await fixture(true);
      const sent = await send(f, '@甲 你听到了吗？', true);
      let calls = 0;
      await runOne(
        {
          claim: (kinds) => queue.claimForOwner(sent.task.id, f.owner, kinds),
          renew: (lease) => queue.renew(lease),
          finish: (lease, outcome) => queue.finish(lease, outcome),
        },
        {
          world: async (lease, signal) => {
            assert.equal(
              await nativeNpcTaskHandler(db, () => ({
                async complete() {
                  calls++;
                  return JSON.stringify({
                    statements: [
                      { text: '我听说他已经在公园，但没有亲眼确认。', dependsOnActionIds: [] },
                    ],
                    goals: [],
                    plans: [],
                    actions: [],
                    responsibilities: [],
                    decisions: [],
                  });
                },
              }))(lease, signal),
              true,
            );
          },
        },
      );
      assert.equal(calls, 1);
      const b = await read(f, f.b);
      const spoken = b.observations.find((o) => o.evidenceKind === 'actor_report');
      assert.ok(spoken);
      const source = b.sources.find((s) => s.id === spoken.sourceId)!;
      assert.ok(!(await read(f)).sources.some((s) => s.id === source.id));
      assert.equal(
        (await read(f, f.a, { sourceIds: [source.id] })).observations[0]?.text,
        spoken.text,
      );
      const row = (
        await admin.query(
          'SELECT document FROM parallel_life.world_group_messages WHERE world_id=$1 AND id=$2',
          [f.worldId, source.recordId],
        )
      ).rows[0];
      const forged = { ...row.document, sender: { kind: 'actor', actorId: f.b } };
      await assert.rejects(
        admin.query(
          'UPDATE parallel_life.world_group_messages SET document=$3 WHERE world_id=$1 AND id=$2',
          [f.worldId, source.recordId, forged],
        ),
        { code: '23514' },
      );
      assert.equal(
        (await read(f, f.a, { sourceIds: [source.id] })).observations[0]?.text,
        spoken.text,
      );
      assert.equal(
        (await worlds.get({ userId: f.owner }, f.worldId)).space?.currentPlaceId,
        'home',
      );
    },
  );

  await t.test('successful unrelated source event is not membership authority', async () => {
    const f = await fixture();
    await send(f, '有真实消息，但不是入群许可。');
    const entry = (
      await admin.query(
        'SELECT source_event_id FROM parallel_life.world_group_messages WHERE world_id=$1 LIMIT 1',
        [f.worldId],
      )
    ).rows[0];
    const member = (
      await admin.query(
        "SELECT source_event_id FROM parallel_life.world_group_memberships WHERE world_id=$1 AND participant->>'actorId'=$2",
        [f.worldId, f.a],
      )
    ).rows[0];
    await assert.rejects(
      admin.query(
        "UPDATE parallel_life.world_group_memberships SET source_event_id=$3 WHERE world_id=$1 AND participant->>'actorId'=$2",
        [f.worldId, f.a, entry.source_event_id],
      ),
      { code: '23514' },
    );
    assert.equal((await read(f)).sources.length, 1);
  });

  await t.test(
    'message id and original text must match the canonical player producer',
    async () => {
      const f = await fixture();
      await send(f, '原文末尾不可丢失。');
      const source = (await read(f)).sources[0]!;
      const row = (
        await admin.query(
          'SELECT document FROM parallel_life.world_group_messages WHERE world_id=$1 AND id=$2',
          [f.worldId, source.recordId],
        )
      ).rows[0];
      for (const patch of [{ text: '伪造的新正文。' }, { id: randomUUID() }]) {
        try {
          await admin.query(
            'UPDATE parallel_life.world_group_messages SET document=$3 WHERE world_id=$1 AND id=$2',
            [f.worldId, source.recordId, { ...row.document, ...patch }],
          );
        } catch (error) {
          assert.equal((error as { code?: string }).code, '23514');
          continue;
        }
        try {
          assert.deepEqual((await read(f)).sources, []);
        } finally {
          await admin.query(
            'UPDATE parallel_life.world_group_messages SET document=$3 WHERE world_id=$1 AND id=$2',
            [f.worldId, source.recordId, row.document],
          );
        }
      }
    },
  );

  await t.test(
    'exact consumed hash is removed before capacity and old backlog can drain; precise reads do not disclose siblings',
    async () => {
      const f = await fixture();
      for (let i = 0; i < 5; i++) await send(f, '长原文' + i + '：' + '段落\n'.repeat(250));
      const full = await read(f, f.a, { maxBytes: 100000 });
      assert.equal(full.sources.length, 5);
      assert.equal(full.observations[0]!.text, '长原文0：' + '段落\n'.repeat(250));
      const consumedSources: { sourceId: string; contentHash: string }[] = [];
      for (let i = 0; i < 5; i++) {
        const packet = await read(f, f.a, { maxEntries: 1, consumedSources });
        assert.equal(packet.sources.length, 1);
        const source = packet.sources[0]!;
        assert.ok(!consumedSources.some((s) => s.sourceId === source.id));
        consumedSources.push({ sourceId: source.id, contentHash: source.contentHash! });
      }
      assert.deepEqual((await read(f, f.a, { maxEntries: 1, consumedSources })).sources, []);
      const target = full.sources[0]!;
      const exact = await read(f, f.a, {
        sourceIds: [target.id],
        consumedSources: [{ sourceId: target.id, contentHash: 'f'.repeat(64) }],
      });
      assert.deepEqual(
        exact.sources.map((s) => s.id),
        [target.id],
      );
      const zero = await read(f, f.a, { maxBytes: 0 });
      assert.deepEqual(zero.sources, []);
      assert.equal(zero.status, 'budget_limited');
      assert.deepEqual(
        zero.omittedSourceIds,
        full.sources.map((s) => s.id),
      );
      assert.deepEqual((await read(f, f.c, { maxBytes: 0 })).omittedSourceIds, []);
    },
  );

  await t.test('real source forgetting blocks only that observer', async () => {
    const f = await fixture(true);
    await send(f, '这段群原文已由双方听到。');
    const source = (await read(f)).sources[0]!;
    const memory = await new MemoryRepository(db).create(f.owner, {
      id: randomUUID(),
      ownerId: f.owner,
      scopeType: 'character',
      scopeId: f.a,
      branchId: f.worldId,
      characterId: f.a,
      text: 'Group source memory',
      kind: 'belief',
      sourceType: 'agent_inference',
      sourceIds: [source.id],
      status: 'active',
      importance: 5,
      createdAt: new Date().toISOString(),
    });
    await db.transaction(f.owner, (sql) =>
      forgetMemoryInStore(sql, {
        ownerId: f.owner,
        targetMemoryId: memory.id,
        playerVisibleOnly: false,
      }),
    );
    const a = await read(f);
    assert.deepEqual(a.sources, []);
    assert.deepEqual(a.omittedSourceIds, []);
    assert.equal((await read(f, f.b)).sources.length, 1);
  });

  await t.test('owner, epoch and world version fence every read', async () => {
    const f = await fixture();
    await send(f, '只有原owner和原epoch能读取。');
    const original = await frame(f);
    await assert.rejects(read(f, f.a, { worldVersion: original.worldVersion - 1 }), {
      code: 'ACTOR_GROUP_OBSERVATION_VERSION_CONFLICT',
    });
    await assert.rejects(read(f, f.a, { engineEpoch: 3 }), {
      code: 'ACTOR_GROUP_OBSERVATION_VERSION_CONFLICT',
    });
    const other = randomUUID();
    await new IdentityRepository(db).ensureGuest(other);
    await assert.rejects(
      db.transaction(other, (sql) => readSources(sql, other, original)),
      { code: 'ACTOR_GROUP_OBSERVATION_FORBIDDEN' },
    );
    const f2 = await fixture();
    await assert.rejects(read(f, f.a, { worldId: f2.worldId }), {
      code: 'ACTOR_GROUP_OBSERVATION_FORBIDDEN',
    });
  });
});
