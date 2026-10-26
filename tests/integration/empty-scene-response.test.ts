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
  scenePlanning,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { sceneEnvironmentTaskHandler } from '../../src/modules/world/infrastructure/agent-scene-environment.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { nativeNpcTaskHandler } from '../../src/server/npc-agent-channel-services.ts';
import {
  emptySceneModelInput,
  emptySceneProposal,
} from '../../src/server/empty-scene-environment.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('empty scene uses original input/task/scene transaction for bounded environment response (real PG, no commercial model)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.EMPTY_SCENE_TEST_PORT ?? 55683));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db),
    tasks = new TaskRepository(db);
  const owners: string[] = [];
  t.after(async () => {
    try {
      for (const owner of owners) {
        await admin.query('DELETE FROM parallel_life.agent_runtime_worlds WHERE owner_id=$1', [
          owner,
        ]);
        await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
      }
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  async function fixture(name = '虚构办公室', description = '桌椅排列整齐。') {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actor = randomUUID();
    owners.push(owner);
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const initial: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '合成无人现场',
      time: new Date().toISOString(),
      actors: [{ id: actor, name: '尚未到场的人物', persona: 'PERSONA_PRIVATE_MARKER' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'room',
        positionSource: source,
        places: [
          { id: 'room', name, description, source, contactActorIds: [actor], appointmentIds: [] },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, initial);
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId: actor }, agentDefinitionRef(initial, actor), 0),
      );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 0,
      placeId: 'room',
    });
    const lease = (await queue.claimForOwner(entered.task!.id, owner, ['world']))!;
    assert.equal(await sceneEnvironmentTaskHandler(db)(lease, new AbortController().signal), true);
    return { owner, worldId, actor, sceneId: entered.sceneId };
  }
  async function send(f: Awaited<ReturnType<typeof fixture>>, text: string) {
    const before = await worlds.get({ userId: f.owner }, f.worldId);
    const command = {
      commandId: randomUUID(),
      expectedVersion: before.version,
      text,
      relatedMatterIds: [],
    };
    const receipt = await scenes.input(f.owner, f.worldId, f.sceneId, command);
    return {
      command,
      receipt,
      lease: (await queue.claimForOwner(receipt.task!.id, f.owner, ['world']))!,
    };
  }
  await t.test(
    'saved speech gets feedback, resolves action and task atomically; replay does not buy or duplicate',
    async () => {
      const f = await fixture();
      const s = await send(f, '我说了一声：有人吗？');
      let npcCalls = 0,
        environmentCalls = 0;
      const handler = nativeNpcTaskHandler(
        db,
        () => ({
          async complete() {
            npcCalls++;
            throw Error('NPC_MUST_NOT_BE_CALLED');
          },
        }),
        () => ({
          async complete(messages, _signal, maxTokens, format) {
            environmentCalls++;
            const payload = messages.at(-1)!.content;
            assert.ok(!payload.includes('PERSONA_PRIVATE_MARKER'));
            assert.ok(!payload.includes(f.actor));
            assert.equal(maxTokens, 700);
            assert.equal(format?.format, 'json_schema');
            return JSON.stringify({ feedback: '你的声音在房间里散开，暂时没有听到回应。' });
          },
        }),
      );
      await handler(s.lease, new AbortController().signal);
      const read = await scenes.read(f.owner, f.worldId, f.sceneId);
      assert.equal((await tasks.get(f.owner, s.receipt.task!.id)).status, 'succeeded');
      assert.equal(read.actions.at(-1)!.status, 'resolved');
      assert.equal(read.actions.at(-1)!.resolution?.outcome, 'partial');
      assert.ok(
        read.entries.some(
          (e) => e.kind === 'adjudicated_result' && e.text.includes('暂时没有听到回应'),
        ),
      );
      assert.ok(!read.entries.some((e) => e.kind === 'dialogue'));
      assert.equal(read.scene!.presence.length, 1);
      assert.equal(npcCalls, 0);
      assert.equal(environmentCalls, 1);
      const replay = await scenes.input(f.owner, f.worldId, f.sceneId, s.command);
      assert.equal(replay.task!.id, s.receipt.task!.id);
      assert.equal(await queue.claimForOwner(s.lease.id, f.owner, ['world']), null);
      await assert.rejects(handler(s.lease, new AbortController().signal));
      assert.equal(environmentCalls, 1);
      assert.equal(
        (await scenes.read(f.owner, f.worldId, f.sceneId)).entries.length,
        read.entries.length,
      );
    },
  );
  await t.test(
    'unverified operations cannot become world success, attendance, new NPCs or completed matters',
    async () => {
      const f = await fixture('虚构酒店', '大厅有服务台，值班人员可以办理公开业务。');
      const s = await send(f, '我打开保险柜并把钱转给别人');
      const context = await db.transaction(f.owner, (sql) =>
        scenePlanning(sql, f.owner, f.worldId, s.lease.input as any, true),
      );
      const prompt = JSON.stringify(emptySceneModelInput(context));
      assert.ok(!prompt.includes('PERSONA_PRIVATE_MARKER'));
      assert.throws(() =>
        emptySceneProposal(
          context,
          JSON.stringify({
            feedback: '已经完成',
            outcome: 'succeeded',
            presentActorIds: [f.actor],
          }),
        ),
      );
      const proposal = emptySceneProposal(
        context,
        JSON.stringify({
          feedback: '保险柜的操作与转账尚未得到确认，你可以先查看当前可用的操作。',
        }),
      );
      assert.equal(proposal.outcome, 'partial');
      assert.deepEqual(proposal.dialogues, []);
      assert.deepEqual(proposal.matterUpdates, []);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          commitSceneProposal(
            sql,
            f.owner,
            f.worldId,
            s.lease.input as any,
            { ...proposal, outcome: 'succeeded' },
            randomUUID(),
            true,
          ),
        ),
        (e: any) => e.message === 'ENVIRONMENT_CANNOT_EXECUTE_ACTIONS',
      );
      await nativeNpcTaskHandler(db, () => ({
        async complete() {
          return JSON.stringify({
            feedback: '保险柜的操作与转账尚未得到确认，你可以先查看当前可用的操作。',
          });
        },
      }))(s.lease, new AbortController().signal);
      const read = await scenes.read(f.owner, f.worldId, f.sceneId);
      assert.equal(read.actions.at(-1)!.status, 'resolved');
      assert.equal(read.scene!.presence.length, 1);
      const after = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(after.appointments.length, 0);
      assert.equal(after.facts.length, 0);
      assert.equal(after.messages.length, 0);
    },
  );
  await t.test(
    'an independent private reply during environment generation appends without rebuying feedback',
    async () => {
      const f = await fixture();
      const s = await send(f, '我看看窗边');
      let calls = 0;
      const handler = nativeNpcTaskHandler(
        db,
        () => ({
          async complete() {
            throw Error('NO_NPC_IN_SCENE');
          },
        }),
        () => ({
          async complete() {
            calls++;
            const service = npcAgentServices(db, () => ({
              async complete() {
                return JSON.stringify({
                  statements: [{ text: '我在安排自己的下午。', dependsOnActionIds: [] }],
                  goals: [],
                  plans: [],
                  actions: [],
                  responsibilities: [],
                  decisions: [],
                });
              },
            }));
            const receipt = await service.sendMessageIfEnabled(f.owner, {
              id: randomUUID(),
              worldId: f.worldId,
              actorId: f.actor,
              expectedVersion: s.receipt.version,
              text: '你最近怎么样？',
            });
            assert.equal(receipt?.status, 'committed');
            return JSON.stringify({ feedback: '你把视线移向窗边，房间里暂时没有新的动静。' });
          },
        }),
      );
      await handler(s.lease, new AbortController().signal);
      const read = await scenes.read(f.owner, f.worldId, f.sceneId);
      assert.equal(read.actions.at(-1)!.status, 'resolved');
      assert.equal(read.worldVersion, s.receipt.version + 2);
      assert.equal(calls, 1);
      assert.equal((await tasks.get(f.owner, s.lease.id)).status, 'succeeded');
      assert.equal(read.entries.filter((e) => e.kind === 'adjudicated_result').length, 1);
      assert.equal(read.scene!.presence.length, 1);
    },
  );
  await t.test(
    'network unknown remains unknown and original task cannot automatically buy again',
    async () => {
      const f = await fixture();
      const s = await send(f, '我看看四周');
      let calls = 0;
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete() {
          calls++;
          throw Object.assign(Error('NETWORK_RESULT_UNKNOWN'), { code: 'UPSTREAM_FAILED' });
        },
      }));
      await runOne(
        {
          claim: async () => s.lease,
          renew: (l) => queue.renew(l),
          finish: (l, o) => queue.finish(l, o),
        },
        {
          world: async (l, signal) => {
            await handler(l, signal);
          },
        },
      );
      assert.equal((await tasks.get(f.owner, s.lease.id)).status, 'unknown');
      assert.equal(await queue.claimForOwner(s.lease.id, f.owner, ['world']), null);
      assert.equal(calls, 1);
      assert.equal(
        (await scenes.read(f.owner, f.worldId, f.sceneId)).entries.filter(
          (e) => e.kind === 'adjudicated_result',
        ).length,
        0,
      );
    },
  );
  await t.test(
    'actual presence change during model generation cannot silently save stale feedback',
    async () => {
      const f = await fixture();
      const s = await send(f, '我观察房间');
      let calls = 0;
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete() {
          calls++;
          await admin.query(
            "UPDATE parallel_life.scene_sessions SET document=jsonb_set(document,'{presence}',(document->'presence')||$2::jsonb) WHERE id=$1",
            [
              f.sceneId,
              JSON.stringify([
                {
                  participant: { kind: 'actor', actorId: f.actor },
                  joinedVersion: s.receipt.version,
                  sourceEventId: randomUUID(),
                  sourceVersion: s.receipt.version,
                },
              ]),
            ],
          );
          return JSON.stringify({ feedback: '你暂时没有听到回应。' });
        },
      }));
      await assert.rejects(
        handler(s.lease, new AbortController().signal),
        (e: any) => e.message === 'SCENE_AUDIENCE_CHANGED',
      );
      assert.equal(calls, 1);
      assert.equal(
        (await scenes.read(f.owner, f.worldId, f.sceneId)).entries.filter(
          (e) => e.kind === 'adjudicated_result',
        ).length,
        0,
      );
      await queue.finish(s.lease, { status: 'conflict', errorCode: 'VERSION_CONFLICT' });
    },
  );
});
