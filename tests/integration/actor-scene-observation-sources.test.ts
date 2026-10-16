import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
  loadScene,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { MemoryRepository } from '../../src/modules/memory/infrastructure/memory-repository.ts';
import { forgetMemoryInStore } from '../../src/modules/memory/infrastructure/memory-store.ts';
import { readActorSceneObservationSourcesInTransaction as readSources } from '../../src/modules/world/infrastructure/actor-scene-observation-sources.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { projectCommittedWorldAwareness } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { nativeNpcTaskHandler } from '../../src/server/npc-agent-channel-services.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('scene observation adapter authenticates actual producer and historical audience before budgeting (real PG)', async (t) => {
  const config = await localConfig();
  const port = Number(process.env.ACTOR_SCENE_OBSERVATION_TEST_PORT ?? 55565);
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
  assert.equal(
    config.port,
    port,
    'dedicated local database configuration must match the assigned port',
  );
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const scenes = new SceneRepository(db);
  const tasks = new TaskRepository(db);
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
  type Fixture = { owner: string; worldId: string; a: string; b: string; sceneId: string };
  const proposal = (actorIds: string[], narration = '窗边放着一把椅子。') => ({
    location: 'Room',
    narration,
    presentActorIds: actorIds,
    outcome: null,
    observation: null,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [],
    npcActions: [],
  });
  async function fixture(): Promise<Fixture> {
    const owner = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
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
      title: 'Synthetic historical scene observation fixture',
      time: new Date().toISOString(),
      actors: [
        { id: a, name: '甲', persona: '只知道实际获准观察的事情。' },
        { id: b, name: '乙', persona: '有自己的生活。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'room',
        positionSource: source,
        places: [
          {
            id: 'room',
            name: 'Room',
            description: 'Explicit synthetic fixture place',
            source,
            contactActorIds: [a, b],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, world);
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 0,
      placeId: 'room',
    });
    const lease = await queue.claimForOwner(entered.task!.id, owner, ['world']);
    assert.ok(lease);
    // Actual old writer produces explicit historical presence. This is not a new-engine NPC action.
    const version = await db.transaction(owner, (sql) =>
      commitSceneProposal(
        sql,
        owner,
        worldId,
        lease.input as Parameters<typeof commitSceneProposal>[3],
        proposal([a]),
        randomUUID(),
      ),
    );
    await queue.finish(lease, { status: 'succeeded', resultVersion: version });
    return { owner, worldId, a, b, sceneId: entered.sceneId };
  }
  async function frame(f: Fixture, actorId = f.a) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return {
      worldId: f.worldId,
      actorId,
      sceneId: f.sceneId,
      worldVersion: world.version,
      storyAt: world.time,
    };
  }
  async function read(
    f: Fixture,
    actorId = f.a,
    budget: { maxBytes?: number; maxEntries?: number } = {},
  ) {
    const input = { ...(await frame(f, actorId)), ...budget };
    return db.transaction(f.owner, (sql) => readSources(sql, f.owner, input));
  }
  async function input(f: Fixture, text: string) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return scenes.input(f.owner, f.worldId, f.sceneId, {
      commandId: randomUUID(),
      expectedVersion: world.version,
      text,
      relatedMatterIds: [],
    });
  }
  async function cancel(f: Fixture, value: Awaited<ReturnType<typeof input>>) {
    if (value.task) await tasks.cancel(f.owner, value.task.id);
  }

  await t.test(
    'actual player claim remains speech, historical hearer only, reads do not change world facts or positions',
    async () => {
      const f = await fixture();
      const accepted = await input(f, '我说：我已经到公园了。');
      await cancel(f, accepted);
      const before = await worlds.get({ userId: f.owner }, f.worldId);
      const view = await read(f);
      const claim = view.observations.find((o) => o.text === '我说：我已经到公园了。');
      assert.ok(claim);
      assert.equal(claim.kind, 'speech');
      assert.equal(claim.evidenceKind, 'player_report');
      assert.equal(claim.learnedAt, claim.storyAt);
      assert.ok(Number.isFinite(Date.parse(claim.eventOccurredAt)));
      assert.ok(view.observations.some((o) => o.text === '窗边放着一把椅子。'));
      assert.deepEqual((await read(f, f.b)).observations, []);
      assert.deepEqual((await read(f, f.b)).omittedSourceIds, []);
      assert.deepEqual(await worlds.get({ userId: f.owner }, f.worldId), before);
      assert.equal(before.space?.currentPlaceId, 'room');
      const laterFrame = await frame(f);
      laterFrame.storyAt = new Date(Date.parse(laterFrame.storyAt) + 3600000).toISOString();
      const later = await db.transaction(f.owner, (sql) => readSources(sql, f.owner, laterFrame));
      assert.deepEqual(later.sources, view.sources);
      assert.equal(
        later.observations.find((o) => o.sourceId === claim.sourceId)!.learnedAt,
        claim.learnedAt,
      );
    },
  );

  await t.test('later real presence does not backfill an earlier scene entry', async () => {
    const f = await fixture();
    const accepted = await input(f, '我打算稍后再聊。');
    const lease = await queue.claimForOwner(accepted.task!.id, f.owner, ['world']);
    assert.ok(lease);
    const version = await db.transaction(f.owner, (sql) =>
      commitSceneProposal(
        sql,
        f.owner,
        f.worldId,
        lease.input as Parameters<typeof commitSceneProposal>[3],
        proposal([f.b], '新的声音从门边传来。'),
        randomUUID(),
      ),
    );
    await queue.finish(lease, { status: 'succeeded', resultVersion: version });
    const view = await read(f, f.b);
    assert.ok(view.observations.some((o) => o.text === '新的声音从门边传来。'));
    assert.ok(
      !view.observations.some(
        (o) => o.text === '窗边放着一把椅子。' || o.text === '我打算稍后再聊。',
      ),
    );
  });

  await t.test(
    'private thoughts stay hidden even if the derived entry audience is tampered',
    async () => {
      const f = await fixture();
      const secret = '我心里想：PRIVATE_THOUGHT_97';
      const accepted = await input(f, secret);
      assert.equal(accepted.task, null);
      const row = (
        await admin.query(
          "SELECT id,document FROM parallel_life.scene_items WHERE world_id=$1 AND kind='entry' AND document->>'text'=$2",
          [f.worldId, secret],
        )
      ).rows[0];
      assert.ok(row);
      await admin.query(
        "UPDATE parallel_life.scene_items SET document=jsonb_set(document,'{observableTo}',$2::jsonb) WHERE id=$1",
        [row.id, JSON.stringify([{ kind: 'player' }, { kind: 'actor', actorId: f.a }])],
      );
      try {
        assert.ok(!(await read(f)).observations.some((o) => o.text === secret));
      } finally {
        await admin.query('UPDATE parallel_life.scene_items SET document=$2 WHERE id=$1', [
          row.id,
          row.document,
        ]);
      }
    },
  );

  await t.test(
    'visible entry text must match the original producer, and exact source forgetting blocks it',
    async () => {
      const f = await fixture();
      const original = await read(f);
      const source = original.sources.find((s) =>
        original.observations.some((o) => o.sourceId === s.id && o.text === '窗边放着一把椅子。'),
      )!;
      assert.ok(source);
      const row = (
        await admin.query(
          'SELECT document FROM parallel_life.scene_items WHERE world_id=$1 AND id=$2',
          [f.worldId, source.recordId],
        )
      ).rows[0];
      await admin.query(
        "UPDATE parallel_life.scene_items SET document=jsonb_set(document,'{text}','\"FORGED_VISIBLE_TEXT_97\"'::jsonb) WHERE world_id=$1 AND id=$2",
        [f.worldId, source.recordId],
      );
      try {
        assert.ok(!(await read(f)).sources.some((s) => s.id === source.id));
      } finally {
        await admin.query(
          'UPDATE parallel_life.scene_items SET document=$3 WHERE world_id=$1 AND id=$2',
          [f.worldId, source.recordId, row.document],
        );
      }
      const memory = await new MemoryRepository(db).create(f.owner, {
        id: randomUUID(),
        ownerId: f.owner,
        scopeType: 'character',
        scopeId: f.a,
        branchId: f.worldId,
        characterId: f.a,
        kind: 'belief',
        text: 'Remembered scene record',
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
      const forgotten = await read(f);
      assert.ok(!forgotten.sources.some((s) => s.id === source.id));
      assert.ok(!forgotten.omittedSourceIds.includes(source.id));
    },
  );

  await t.test(
    'budget reports authorized omissions, retains whole text and does not hide older fitting records',
    async () => {
      const f = await fixture();
      const small = await input(f, '我打算稍后回复。');
      await cancel(f, small);
      const longText = '我打算保存长段原文：' + '长文段落\n'.repeat(250);
      const large = await input(f, longText);
      await cancel(f, large);
      // Hidden entries beyond the old 20-entry window must not evict authorized history.
      for (let i = 0; i < 21; i++) {
        const hidden = await input(f, '我心里想：HIDDEN_BUDGET_97_' + i);
        assert.equal(hidden.task, null);
      }
      const full = await read(f, f.a, { maxBytes: 100000 });
      assert.equal(full.observations.find((o) => o.text === longText)?.text, longText);
      const longSource = full.observations.find((o) => o.text === longText)!.sourceId;
      const limited = await read(f, f.a, { maxBytes: 1800 });
      assert.equal(limited.status, 'budget_limited');
      assert.ok(limited.omittedSourceIds.includes(longSource));
      assert.ok(limited.observations.some((o) => o.text === '我打算稍后回复。'));
      assert.ok(!limited.observations.some((o) => o.sourceId === longSource));
      assert.equal(limited.sources.length, limited.observations.length);
      const zero = await read(f, f.a, { maxBytes: 0 });
      assert.deepEqual(zero.sources, []);
      assert.deepEqual(
        zero.omittedSourceIds,
        full.sources.map((s) => s.id),
      );
      assert.ok(!JSON.stringify(limited).includes('HIDDEN_BUDGET_97_'));
    },
  );

  await t.test(
    'adjudicated result requires the genuine completed action resolution, never an entry label alone',
    async () => {
      const f = await fixture();
      const accepted = await input(f, '我看一下桌上的相册。');
      const lease = await queue.claimForOwner(accepted.task!.id, f.owner, ['world']);
      assert.ok(lease);
      const version = await db.transaction(f.owner, (sql) =>
        commitSceneProposal(
          sql,
          f.owner,
          f.worldId,
          lease.input as Parameters<typeof commitSceneProposal>[3],
          { ...proposal([f.a]), outcome: 'succeeded', observation: '相册封面有一道折痕。' },
          randomUUID(),
        ),
      );
      await queue.finish(lease, { status: 'succeeded', resultVersion: version });
      const view = await read(f);
      const resolved = view.observations.find((o) => o.text === '相册封面有一道折痕。');
      assert.ok(resolved);
      assert.equal(resolved.kind, 'result');
      assert.equal(resolved.evidenceKind, 'adjudicated_result');
      const action = (
        await admin.query(
          "SELECT id,document FROM parallel_life.scene_items WHERE world_id=$1 AND kind='action' AND document->>'text'=$2",
          [f.worldId, '我看一下桌上的相册。'],
        )
      ).rows[0];
      await admin.query(
        "UPDATE parallel_life.scene_items SET document=jsonb_set(document,'{resolution,outcome}','\"failed\"'::jsonb) WHERE id=$1",
        [action.id],
      );
      try {
        assert.ok(!(await read(f)).sources.some((s) => s.id === resolved.sourceId));
      } finally {
        await admin.query('UPDATE parallel_life.scene_items SET document=$2 WHERE id=$1', [
          action.id,
          action.document,
        ]);
      }
    },
  );

  await t.test(
    'owner, actor identity and current version are verified before returning records',
    async () => {
      const f = await fixture();
      const original = await frame(f);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          readSources(sql, f.owner, { ...original, actorId: randomUUID() }),
        ),
        { code: 'ACTOR_SCENE_OBSERVATION_FORBIDDEN' },
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          readSources(sql, f.owner, { ...original, worldVersion: original.worldVersion - 1 }),
        ),
        { code: 'ACTOR_SCENE_OBSERVATION_VERSION_CONFLICT' },
      );
      const other = randomUUID();
      await new IdentityRepository(db).ensureGuest(other);
      await assert.rejects(
        db.transaction(other, (sql) => readSources(sql, other, original)),
        { code: 'ACTOR_SCENE_OBSERVATION_FORBIDDEN' },
      );
    },
  );

  await t.test(
    'an actual native NPC commit is read from its exact projected dialogue, not from private state',
    async () => {
      const f = await fixture();
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      await db.transaction(f.owner, async (sql) => {
        for (const actorId of [f.a, f.b])
          await initializeActorAgentStateInTransaction(
            sql,
            f.owner,
            emptyActorAgentState(
              { worldId: f.worldId, actorId },
              agentDefinitionRef(world, actorId),
              world.version,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, f.owner, {
          worldId: f.worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: world.version,
        });
        const event = (
          await sql.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version=$2',
            [f.worldId, world.version],
          )
        ).rows[0].payload;
        await projectCommittedWorldAwareness(sql, f.owner, event);
      });
      const accepted = await input(f, '@甲 你听到了吗？');
      let calls = 0;
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete() {
          calls++;
          return JSON.stringify({
            statements: [
              { text: '我听到了你的话，但还没有核实你的位置。', dependsOnActionIds: [] },
            ],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          });
        },
      }));
      await runOne(
        {
          claim: (kinds) => queue.claimForOwner(accepted.task!.id, f.owner, kinds),
          renew: (lease) => queue.renew(lease),
          finish: (lease, outcome) => queue.finish(lease, outcome),
        },
        {
          world: async (lease, signal) => {
            assert.equal(await handler(lease, signal), true);
          },
        },
      );
      assert.equal(calls, 1, 'explicit local model substitute only, never a provider request');
      const view = await read(f);
      const spoken = view.observations.find(
        (o) => o.text === '我听到了你的话，但还没有核实你的位置。',
      );
      assert.ok(spoken);
      assert.equal(spoken.kind, 'speech');
      assert.equal(spoken.evidenceKind, 'actor_report');
      assert.deepEqual((await read(f, f.b)).observations, []);
      const scene = await db.transaction(f.owner, (sql) => loadScene(sql, f.worldId, f.sceneId));
      assert.ok(
        scene.entries.some(
          (e) => 'text' in e && e.text === spoken.text && `scene:${e.id}` === spoken.sourceId,
        ),
      );
    },
  );
});
