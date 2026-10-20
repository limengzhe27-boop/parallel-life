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
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { nativeNpcTaskHandler } from '../../src/server/npc-agent-channel-services.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const reply = (text: string) => ({
  statements: [{ text, dependsOnActionIds: [] }],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});

test('native group and scene keep model basis while unrelated private chat advances the append head', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.NATIVE_COMMIT168_TEST_PORT ?? 55432));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    groups = new PostgresGroupRepository(db),
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
  for (const channel of ['group', 'scene'] as const)
    await t.test(channel, async () => {
      const owner = randomUUID(),
        worldId = randomUUID(),
        a = randomUUID(),
        b = randomUUID();
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
        title: 'Synthetic native append',
        time: new Date().toISOString(),
        actors: [
          { id: a, name: '甲', persona: '自然交流。' },
          { id: b, name: '乙', persona: '独立生活。' },
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
              name: '客厅',
              description: '',
              source,
              contactActorIds: [a],
              appointmentIds: [],
            },
          ],
          routes: [],
        },
      };
      await worlds.initialize({ userId: owner }, initial);
      let threadId: string;
      if (channel === 'group')
        threadId = (
          await groups.create(owner, {
            worldId,
            commandId: randomUUID(),
            expectedVersion: 0,
            title: '合成群',
            actorIds: [a],
          })
        ).groupId;
      else {
        const entered = await scenes.enterPlace(owner, worldId, {
          commandId: randomUUID(),
          expectedVersion: 0,
          placeId: 'room',
        });
        threadId = entered.sceneId;
        const lease = (await queue.claimForOwner(entered.task!.id, owner, ['world']))!;
        const version = await db.transaction(owner, (sql) =>
          commitSceneProposal(
            sql,
            owner,
            worldId,
            lease.input as Parameters<typeof commitSceneProposal>[3],
            {
              location: '客厅',
              narration: '合成已保存的现场。',
              presentActorIds: [a],
              outcome: null,
              observation: null,
              matterTitle: null,
              initialMatters: [],
              matterUpdates: [],
              dialogues: [],
              stepProposals: [],
              npcActions: [],
            },
            randomUUID(),
          ),
        );
        await queue.finish(lease, { status: 'succeeded', resultVersion: version });
      }
      const ready = await worlds.get({ userId: owner }, worldId);
      await db.transaction(owner, async (sql) => {
        for (const actorId of [a, b])
          await initializeActorAgentStateInTransaction(
            sql,
            owner,
            emptyActorAgentState(
              { worldId, actorId },
              agentDefinitionRef(initial, actorId),
              ready.version,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: ready.version,
        });
      });
      let nativeCalls = 0,
        privateCalls = 0,
        modelBasis = -1,
        privateVersion = -1;
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete(messages) {
          nativeCalls++;
          const payload = JSON.parse(messages[1]!.content);
          assert.equal(payload.state.actorId, a);
          assert(!messages[1]!.content.includes('乙的私人暗号'));
          if (nativeCalls === 2) assert(messages[1]!.content.includes('甲在原渠道回复。'));
          modelBasis = (await worlds.get({ userId: owner }, worldId)).version;
          if (nativeCalls === 1) {
            const dm = npcAgentServices(db, () => ({
              async complete() {
                privateCalls++;
                return JSON.stringify(reply('乙的私人暗号，仅私聊可见。'));
              },
            }));
            const result = await dm.sendMessageIfEnabled(owner, {
              id: randomUUID(),
              worldId,
              actorId: b,
              expectedVersion: modelBasis,
              text: '随便聊聊',
            });
            assert.equal(result?.status, 'committed');
            privateVersion = result!.version;
          }
          return JSON.stringify(
            reply(nativeCalls === 1 ? '甲在原渠道回复。' : '甲继续承接刚才的话。'),
          );
        },
      }));
      const send = async () => {
        const w = await worlds.get({ userId: owner }, worldId);
        return channel === 'group'
          ? groups.send(owner, {
              worldId,
              groupId: threadId,
              commandId: randomUUID(),
              expectedVersion: w.version,
              text: '@甲 随便聊聊',
            })
          : scenes.input(owner, worldId, threadId, {
              commandId: randomUUID(),
              expectedVersion: w.version,
              text: '@甲 随便聊聊',
              relatedMatterIds: [],
            });
      };
      const run = async (taskId: string) =>
        runOne(
          {
            claim: (k) => queue.claimForOwner(taskId, owner, k),
            renew: (l) => queue.renew(l),
            finish: (l, o) => queue.finish(l, o),
          },
          {
            world: async (l, s) => {
              assert(await handler(l, s));
            },
          },
        );
      const sent = await send();
      assert.ok(sent.task);
      await run(sent.task.id);
      assert.equal((await tasks.get(owner, sent.task.id)).status, 'succeeded');
      const row = (
        await admin.query(
          `SELECT a.expected_world_version,e.version,c.expected_version,e.payload FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.id=a.event_id AND e.world_id=a.world_id JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id WHERE a.world_id=$1 AND a.actor_id=$2 AND a.status='committed'`,
          [worldId, a],
        )
      ).rows[0];
      assert.equal(row.expected_world_version, modelBasis);
      assert.equal(row.version, privateVersion + 1);
      assert.equal(row.expected_version, row.version - 1);
      assert.equal(row.payload.data.agentRuntime.stateAfter.projectedWorldVersion, row.version);
      const originalEvent = row.payload;
      // A second real channel turn must authenticate the earlier, cross-version native source.
      const again = await send();
      assert.ok(again.task);
      await run(again.task.id);
      assert.equal((await tasks.get(owner, again.task.id)).status, 'succeeded');
      const history =
        channel === 'group'
          ? (await groups.read(owner, worldId, threadId)).messages
          : (await scenes.read(owner, worldId, threadId)).entries;
      assert.equal(history.filter((x) => 'text' in x && x.text === '甲在原渠道回复。').length, 1);
      assert.equal(
        history.filter((x) => 'text' in x && x.text === '甲继续承接刚才的话。').length,
        1,
      );
      assert(!history.some((x) => 'text' in x && x.text?.includes('乙的私人暗号')));
      assert.deepEqual(
        (
          await admin.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND id=$2',
            [worldId, originalEvent.id],
          )
        ).rows[0].payload,
        originalEvent,
      );
      await run(sent.task.id);
      assert.equal(nativeCalls, 2);
      assert.equal(privateCalls, 1);
    });
});
