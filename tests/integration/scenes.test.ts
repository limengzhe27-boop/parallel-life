import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import type { SceneProposal } from '../../src/modules/world/application/scene-ports.ts';
const proposal: SceneProposal = {
  location: '工作室',
  narration: '灯架旁有一面白墙。',
  presentActorIds: [],
  outcome: null,
  observation: null,
  matterTitle: '试拍一张',
  matterUpdates: [],
  dialogues: [],
};
test('scene durable runtime: ownership, idempotence, navigation, pause, rollback, presence and lease fencing', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
  const owner = randomUUID(),
    other = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID(),
    absentActorId = randomUUID(),
    appointmentId = `${randomUUID()}_effect_0`;
  let calls = 0;
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    await new IdentityRepository(db).ensureGuest(other);
    const now = new Date().toISOString(),
      state = {
        id: worldId,
        ownerId: owner,
        title: '现场合成测试',
        version: 0,
        time: now,
        actors: [
          { id: actorId, name: '小林', persona: '摄影师，认真检查用光' },
          { id: absentActorId, name: 'Absent actor', persona: 'Not invited' },
        ],
        facts: [],
        messages: [],
        appointments: [
          {
            id: appointmentId,
            title: '试灯',
            at: now,
            participantIds: [actorId],
            sourceEventId: 'genesis:' + worldId,
            status: 'confirmed',
          },
        ],
        mediaRequests: [],
      };
    await db.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [worldId, owner, state.title, state],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [worldId, owner, state, {}],
      );
    });
    const repo = new SceneRepository(db),
      tasks = new TaskRepository(db);
    await assert.rejects(repo.read(other, worldId), { code: 'NOT_FOUND' });
    const emptyHistory = await repo.history(owner, worldId);
    assert.equal(emptyHistory.scenes.length, 0);
    await assert.rejects(repo.history(other, worldId), { code: 'NOT_FOUND' });
    const request = { commandId: randomUUID(), expectedVersion: 0, appointmentId };
    const entered = await repo.enter(owner, worldId, request);
    assert.equal(entered.version, 1);
    assert.equal((await repo.enter(owner, worldId, request)).task?.id, entered.task?.id);
    await assert.rejects(repo.enter(owner, worldId, { ...request, appointmentId: randomUUID() }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(
      repo.enter(owner, worldId, { ...request, commandId: randomUUID(), expectedVersion: 1 }),
      { code: 'INVALID_COMMAND' },
    );
    const pending = await repo.read(owner, worldId);
    assert.equal(pending.entries.length, 0);
    assert.equal(pending.task?.status, 'queued');
    await assert.rejects(
      repo.input(owner, worldId, entered.sceneId, {
        commandId: randomUUID(),
        expectedVersion: 1,
        text: '我拿起灯',
        relatedMatterIds: [],
      }),
      { code: 'INVALID_COMMAND' },
    );
    // Returning to phone while opening is pending must not invalidate the saved task.
    const view = await repo.navigate(owner, worldId, entered.sceneId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      view: 'phone',
    });
    assert.equal(view.version, 2);
    const opening = sceneTaskHandler(
      queue,
      {
        async propose() {
          calls++;
          return {
            ...proposal,
            initialMatters: [{ title: 'Check the light stand' }, { title: 'Discuss framing' }],
            presentActorIds: [actorId],
            dialogues: [{ actorId, text: '先看看阴影。' }],
          };
        },
      },
      'fixture',
    );
    const run = async (id: string, handler = opening) =>
      runOne(
        {
          claim: (k) => queue.claimForOwner(id, owner, k),
          renew: (l) => queue.renew(l),
          finish: (l, o) => queue.finish(l, o),
        },
        { world: handler },
      );
    await run(entered.task!.id);
    let read = await repo.read(owner, worldId);
    assert.equal(read.task?.status, 'succeeded');
    assert.equal(read.worldVersion, 3);
    assert.equal(read.experience.view.kind, 'phone');
    assert.equal(read.scene?.presence.length, 2);
    assert.equal(read.matters[0]?.status, 'not_started');
    assert.equal(read.matters.length, 3);
    assert.equal(calls, 1);
    const history = await repo.history(owner, worldId);
    assert.equal(history.currentScene?.id, entered.sceneId);
    assert.equal(history.scenes[0]?.location, '工作室');
    assert.equal(history.appointmentScenes[0]?.id, entered.sceneId);
    assert.equal(history.nextBefore, null);
    assert.equal(
      (await repo.history(owner, worldId, history.scenes[0]!.sourceVersion)).scenes.length,
      0,
    );
    assert.ok(!JSON.stringify(history).includes('persona'));
    const { loadActorMemories } =
      await import('../../src/modules/memory/infrastructure/memory-store.ts');
    const seen = await db.transaction(owner, (sql) =>
      loadActorMemories(sql, owner, { actorId, worldId }),
    );
    assert.equal(seen.records.length, 1);
    assert.equal(seen.records[0]?.sourceType, 'world_event');
    const absent = await db.transaction(owner, (sql) =>
      loadActorMemories(sql, owner, { actorId: absentActorId, worldId }),
    );
    assert.equal(absent.records.length, 0);
    const beforeEntries = read.entries;
    await repo.navigate(owner, worldId, entered.sceneId, {
      commandId: randomUUID(),
      expectedVersion: 3,
      view: 'scene',
    });
    read = await repo.read(owner, worldId);
    assert.deepEqual(read.entries, beforeEntries);
    assert.equal(calls, 1);
    const actionInput = {
      commandId: randomUUID(),
      expectedVersion: read.worldVersion,
      text: '  我把灯调暗一级，观察墙上的影子。  ',
      relatedMatterIds: [read.matters[0]!.id],
    };
    const action = await repo.input(owner, worldId, entered.sceneId, actionInput);
    assert.equal(
      (await repo.input(owner, worldId, entered.sceneId, actionInput)).task?.id,
      action.task?.id,
    );
    read = await repo.read(owner, worldId);
    assert.equal(read.actions[0]?.text, actionInput.text);
    assert.equal(read.actions[0]?.status, 'pending');
    const bad = sceneTaskHandler(
      queue,
      {
        async propose() {
          return {
            ...proposal,
            matterTitle: null,
            presentActorIds: [actorId],
            outcome: 'succeeded',
            observation: '墙面的阴影边缘变柔了',
            dialogues: [{ actorId: randomUUID(), text: '越权的人物' }],
          };
        },
      },
      'fixture',
    );
    await run(action.task!.id, bad);
    read = await repo.read(owner, worldId);
    assert.equal(read.task?.status, 'failed');
    assert.equal(read.actions[0]?.status, 'pending');
    assert.equal(read.worldVersion, action.version);
    const memoryCount = (
      await admin.query('SELECT count(*) FROM parallel_life.memory_records WHERE branch_id=$1', [
        worldId,
      ])
    ).rows[0].count;
    assert.equal(memoryCount, '2');
    const retry = await tasks.retry(owner, action.task!.id, randomUUID());
    await run(
      retry.id,
      sceneTaskHandler(
        queue,
        {
          async propose(ctx) {
            assert.equal(ctx.action?.text, actionInput.text);
            assert.equal(ctx.memoriesByActor?.[actorId]?.length, 1);
            assert.equal(ctx.memoriesByActor?.[absentActorId]?.length, 0);
            return {
              ...proposal,
              matterTitle: null,
              presentActorIds: [actorId],
              outcome: 'partial',
              observation: '阴影柔了一些，但白墙上的光还没有均匀。',
              matterUpdates: [{ id: ctx.matters[0]!.id, status: 'in_progress' }],
              dialogues: [{ actorId, text: '再看看另一侧。' }],
            };
          },
        },
        'fixture',
      ),
    );
    read = await repo.read(owner, worldId);
    assert.equal(read.task?.status, 'succeeded');
    assert.equal(read.actions[0]?.status, 'resolved');
    assert.equal(read.matters[0]?.status, 'in_progress');
    assert.equal(read.matters[1]?.status, 'not_started');
    assert.equal(read.actions[0]?.resolution?.sourceVersion, read.worldVersion);
    const plan = await repo.input(owner, worldId, entered.sceneId, {
      commandId: randomUUID(),
      expectedVersion: read.worldVersion,
      text: '如果我把灯调暗，会怎样？',
      relatedMatterIds: [],
    });
    await run(
      plan.task!.id,
      sceneTaskHandler(
        queue,
        {
          async propose() {
            return { ...proposal, matterTitle: null, presentActorIds: [actorId], dialogues: [] };
          },
        },
        'fixture',
      ),
    );
    read = await repo.read(owner, worldId);
    assert.equal(read.actions[1]?.intent, 'hypothesis');
    assert.equal(read.actions[1]?.status, 'recorded');
    assert.equal(read.actions[1]?.resolution, undefined);
    const thought = await repo.input(owner, worldId, entered.sceneId, {
      commandId: randomUUID(),
      expectedVersion: read.worldVersion,
      text: '\u6211\u5fc3\u91cc\u60f3\u4eca\u665a\u7ed9\u670b\u53cb\u4e00\u4e2a\u60ca\u559c',
      relatedMatterIds: [],
    });
    assert.equal(thought.task, null);
    read = await repo.read(owner, worldId);
    assert.equal(read.actions.at(-1)?.status, 'recorded');
    const privateEntry = read.entries.at(-1);
    assert.deepEqual(privateEntry?.observableTo, [{ kind: 'player' }]);
    await assert.rejects(
      repo.input(owner, worldId, entered.sceneId, {
        commandId: randomUUID(),
        expectedVersion: read.worldVersion,
        text: '\u6211\u8033\u8bed\u544a\u8bc9\u5c0f\u6797',
        relatedMatterIds: [],
      }),
      { code: 'INVALID_COMMAND' },
    );
    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,last_tick_at,paused) VALUES($1,$2,$3,$3,true)',
        [worldId, owner, read.storyNow],
      ),
    );
    await assert.rejects(
      repo.input(owner, worldId, entered.sceneId, {
        commandId: randomUUID(),
        expectedVersion: read.worldVersion,
        text: '我拿起灯',
        relatedMatterIds: [],
      }),
      { code: 'INVALID_COMMAND' },
    );
    const left = await repo.navigate(
      owner,
      worldId,
      entered.sceneId,
      { commandId: randomUUID(), expectedVersion: read.worldVersion },
      true,
    );
    read = await repo.read(owner, worldId, entered.sceneId);
    assert.equal(read.paused, true);
    assert.equal(read.scene?.status, 'ended');
    assert.equal(read.experience.currentSceneId, undefined);
    assert.ok(read.scene?.presence.find((p) => p.participant.kind === 'player')?.leftVersion);
    assert.equal(left.version, read.worldVersion);
    // DB also refuses cross-world source references, irrespective of application assertions.
    await assert.rejects(
      db.transaction(other, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), worldId, other, read.scene?.sourceEventId, {}],
        ),
      ),
    );
    await db.transaction(owner, (sql) =>
      sql.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [worldId]),
    );
    const competing = await Promise.allSettled([
      repo.enter(owner, worldId, {
        commandId: randomUUID(),
        expectedVersion: read.worldVersion,
        appointmentId,
      }),
      repo.enter(owner, worldId, {
        commandId: randomUUID(),
        expectedVersion: read.worldVersion,
        appointmentId,
      }),
    ]);
    assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
    const winner = competing.find((r) => r.status === 'fulfilled');
    assert.ok(winner?.status === 'fulfilled');
    const cancellation = sceneTaskHandler(
      queue,
      {
        async propose() {
          await tasks.cancel(owner, winner.value.task!.id);
          return { ...proposal, presentActorIds: [actorId] };
        },
      },
      'fixture',
    );
    await run(winner.value.task!.id, cancellation);
    const cancelled = await repo.read(owner, worldId);
    assert.equal(cancelled.task?.status, 'cancelled');
    assert.equal(cancelled.entries.length, 0);
    assert.equal(cancelled.worldVersion, winner.value.version);
    const openingRetry = await tasks.retry(owner, winner.value.task!.id, randomUUID());
    const pauseDuringModel = sceneTaskHandler(
      queue,
      {
        async propose() {
          await db.transaction(owner, (sql) =>
            sql.query('UPDATE parallel_life.world_clock SET paused=true WHERE world_id=$1', [
              worldId,
            ]),
          );
          return { ...proposal, presentActorIds: [actorId] };
        },
      },
      'fixture',
    );
    await run(openingRetry.id, pauseDuringModel);
    const frozen = await repo.read(owner, worldId);
    assert.equal(frozen.task?.status, 'failed');
    assert.equal(frozen.entries.length, 0);
    assert.equal(frozen.worldVersion, winner.value.version);
    const lastRetry = await tasks.retry(owner, openingRetry.id, randomUUID());
    await repo.navigate(
      owner,
      worldId,
      winner.value.sceneId,
      { commandId: randomUUID(), expectedVersion: frozen.worldVersion },
      true,
    );
    assert.equal((await tasks.get(owner, lastRetry.id)).status, 'cancelled');
    await db.transaction(owner, (sql) =>
      sql.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [worldId]),
    );
    for (let i = 0; i < 51; i++) {
      const latest = await repo.read(owner, worldId);
      const visit = await repo.enter(owner, worldId, {
        commandId: randomUUID(),
        expectedVersion: latest.worldVersion,
        appointmentId,
      });
      await repo.navigate(
        owner,
        worldId,
        visit.sceneId,
        { commandId: randomUUID(), expectedVersion: visit.version },
        true,
      );
    }
    const firstPage = await repo.history(owner, worldId);
    assert.equal(firstPage.scenes.length, 50);
    assert.ok(firstPage.nextBefore !== null);
    assert.equal(firstPage.currentScene, null);
    const older = await repo.history(owner, worldId, firstPage.nextBefore!);
    assert.ok(older.scenes.length > 0);
    assert.equal(older.nextBefore, null);
    assert.equal(
      new Set([...firstPage.scenes, ...older.scenes].map((s) => s.id)).size,
      firstPage.scenes.length + older.scenes.length,
    );
    assert.equal(older.appointmentScenes[0]?.id, firstPage.appointmentScenes[0]?.id);

    assert.equal(
      (
        await admin.query('SELECT count(*) FROM parallel_life.outbox_jobs WHERE world_id=$1', [
          worldId,
        ])
      ).rows[0].count,
      '0',
    );
  } finally {
    await queue.close();
    await db.close();
    await admin.end();
  }
});
test('scene entry hydrates actual invitation confirmation and cancellation events', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const cfg = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID(),
    appointmentId = `${randomUUID()}_effect_0`,
    now = new Date().toISOString();
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const state = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: '日程事件集成',
      version: 0,
      time: now,
      actors: [{ id: actorId, name: '朋友', persona: '测试角色' }],
      facts: [],
      messages: [],
      appointments: [
        {
          id: appointmentId,
          title: '现场讨论',
          at: now,
          participantIds: [actorId],
          status: 'proposed',
          sourceEventId: 'genesis:' + worldId,
        },
      ],
      mediaRequests: [],
    };
    await db.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [worldId, owner, state.title, state],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [worldId, owner, state, {}],
      );
    });
    const { PostgresWorldRepository } =
        await import('../../src/modules/world/infrastructure/postgres-world-repository.ts'),
      worlds = new PostgresWorldRepository(db),
      scenes = new SceneRepository(db);
    await assert.rejects(
      scenes.enter(owner, worldId, { commandId: randomUUID(), expectedVersion: 0, appointmentId }),
      { code: 'INVALID_COMMAND' },
    );
    await worlds.respondToInvitation(
      { userId: owner },
      {
        worldId,
        commandId: randomUUID(),
        expectedVersion: 0,
        id: appointmentId,
        operation: 'accept',
      },
    );
    const entered = await scenes.enter(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      appointmentId,
    });
    assert.equal(entered.version, 2);
    assert.equal((await scenes.read(owner, worldId)).scene?.appointmentId, appointmentId);
    await scenes.navigate(
      owner,
      worldId,
      entered.sceneId,
      { commandId: randomUUID(), expectedVersion: 2 },
      true,
    );
    await worlds.respondToInvitation(
      { userId: owner },
      {
        worldId,
        commandId: randomUUID(),
        expectedVersion: 3,
        id: appointmentId,
        operation: 'cancel',
      },
    );
    await assert.rejects(
      scenes.enter(owner, worldId, { commandId: randomUUID(), expectedVersion: 4, appointmentId }),
      { code: 'INVALID_COMMAND' },
    );
  } finally {
    await db.close();
    await admin.end();
  }
});
