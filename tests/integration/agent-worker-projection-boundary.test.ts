import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { groupTaskHandler } from '../../src/modules/world/infrastructure/group-task-handler.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('real leased legacy workers keep epoch-1 scenes/groups working without acquiring epoch-2 authority (no models)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_WORKER_PROJECTION_TEST_PORT ?? 55565));
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

  async function fixture(epoch: 1 | 2, channel: 'group' | 'scene') {
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
      title: 'Synthetic worker boundary',
      version: 0,
      time: new Date().toISOString(),
      actors: [{ id: actor, name: '甲', persona: '独立的虚构人物。' }],
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
            name: '虚构客厅',
            description: '',
            source,
            contactActorIds: [actor],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, initial);
    if (epoch === 2)
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
    if (channel === 'group') {
      const created = await groups.create(owner, {
        worldId,
        commandId: randomUUID(),
        expectedVersion: 0,
        title: '真实队列群聊',
        actorIds: [actor],
      });
      const sent = await groups.send(owner, {
        worldId,
        groupId: created.groupId,
        commandId: randomUUID(),
        expectedVersion: created.version,
        text: '@甲 你好',
      });
      return {
        owner,
        worldId,
        actor,
        threadId: created.groupId,
        taskId: sent.task.id,
        version: sent.version,
      };
    }
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 0,
      placeId: 'room',
    });
    return {
      owner,
      worldId,
      actor,
      threadId: entered.sceneId,
      taskId: entered.task!.id,
      version: entered.version,
    };
  }

  for (const channel of ['group', 'scene'] as const)
    for (const epoch of [1, 2] as const)
      await t.test(
        `actual ${channel} worker at epoch ${epoch}: ${epoch === 1 ? 'commits successfully' : 'DB fence rejects all result writes'}`,
        async () => {
          const f = await fixture(epoch, channel);
          let proposals = 0;
          let failure: { code?: string; message?: string } | undefined;
          const execute =
            channel === 'group'
              ? groupTaskHandler(
                  queue,
                  {
                    async propose() {
                      proposals++;
                      return { text: 'SYNTHETIC_GROUP_WORKER_REPLY' };
                    },
                  },
                  'synthetic-planner',
                  { maxReplies: 1 },
                )
              : sceneTaskHandler(
                  queue,
                  {
                    async propose() {
                      proposals++;
                      return {
                        location: '虚构客厅',
                        narration: 'SYNTHETIC_SCENE_ENVIRONMENT',
                        presentActorIds: [],
                        outcome: null,
                        observation: null,
                        matterTitle: null,
                        initialMatters: [],
                        matterUpdates: [],
                        dialogues: [],
                        stepProposals: [],
                        npcActions: [],
                      };
                    },
                  },
                  'synthetic-planner',
                );
          const before = (
            await admin.query(
              'SELECT count(*) AS n FROM parallel_life.world_events WHERE world_id=$1',
              [f.worldId],
            )
          ).rows[0].n;
          await runOne(
            {
              claim: (k) => queue.claimForOwner(f.taskId, f.owner, k),
              renew: (l) => queue.renew(l),
              finish: (l, o) => queue.finish(l, o),
            },
            {
              world: async (lease, signal) => {
                const identity = await queue.read(
                  lease,
                  async (sql) =>
                    (
                      await sql.query(
                        "SELECT pg_has_role(current_user,'pl_worker','MEMBER') AS worker,pg_has_role(current_user,'pl_app','MEMBER') AS app",
                      )
                    ).rows[0],
                );
                assert.equal(identity.worker, true);
                assert.equal(identity.app, false);
                try {
                  await execute(lease, signal);
                } catch (error) {
                  failure = error as typeof failure;
                  throw error;
                }
              },
            },
          );
          assert.equal(
            proposals,
            1,
            'uses the actual leased legacy commit path after a marked synthetic planner result',
          );
          const task = await tasks.get(f.owner, f.taskId);
          const read =
            channel === 'group'
              ? await groups.read(f.owner, f.worldId, f.threadId)
              : await scenes.read(f.owner, f.worldId, f.threadId);
          if (epoch === 1) {
            assert.equal(failure, undefined);
            assert.equal(task.status, 'succeeded');
            assert.equal(task.resultVersion, f.version + 1);
            assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, f.version + 1);
            if ('messages' in read)
              assert(read.messages.some((m) => m.text === 'SYNTHETIC_GROUP_WORKER_REPLY'));
            else assert(read.entries.some((e) => e.kind === 'time_place'));
            assert.equal(
              (
                await admin.query(
                  'SELECT 1 FROM parallel_life.director_observed_states WHERE world_id=$1',
                  [f.worldId],
                )
              ).rowCount,
              0,
              'epoch-1 worker never enters owner-only Agent projections',
            );
          } else {
            assert.equal(failure?.code, '23514');
            assert.match(failure!.message!, /ENGINE_EPOCH_CONFLICT/);
            assert.equal(task.status, 'failed');
            assert.equal(task.resultVersion, null);
            assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, f.version);
            assert.equal(
              (
                await admin.query(
                  'SELECT count(*) AS n FROM parallel_life.world_events WHERE world_id=$1',
                  [f.worldId],
                )
              ).rows[0].n,
              before,
            );
            assert.equal(
              (
                await admin.query(
                  "SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND status IN ('queued','running')",
                  [f.worldId],
                )
              ).rowCount,
              0,
            );
            if ('messages' in read)
              assert(!read.messages.some((m) => m.text === 'SYNTHETIC_GROUP_WORKER_REPLY'));
            else assert.equal(read.entries.length, 0);
            assert.equal(
              Number(
                (
                  await admin.query(
                    'SELECT observed_through_version FROM parallel_life.director_observed_states WHERE world_id=$1',
                    [f.worldId],
                  )
                ).rows[0].observed_through_version,
              ),
              f.version,
            );
          }
          assert.equal(
            (
              await admin.query('SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1', [
                f.worldId,
              ])
            ).rowCount,
            0,
            'no fake NPC attempt',
          );
          assert.equal(
            await queue.claimForOwner(f.taskId, f.owner, ['world']),
            null,
            'no silent worker replay after terminal result',
          );
        },
      );

  await t.test(
    'the exact claimed worker role still has no SELECT grant on owner-only Agent/director tables',
    async () => {
      const f = await fixture(1, 'group'),
        lease = (await queue.claimForOwner(f.taskId, f.owner, ['world']))!;
      for (const table of [
        'agent_runtime_worlds',
        'actor_agent_states',
        'agent_input_receipts',
        'agent_attempts',
        'agent_action_results',
        'world_authoritative_positions',
        'director_runtime_attempts',
        'director_decisions',
        'shared_episodes',
      ]) {
        assert.equal(
          (
            await admin.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [
              'pl_worker',
              `parallel_life.${table}`,
              'SELECT',
            ])
          ).rows[0].allowed,
          false,
        );
        await assert.rejects(
          queue.read(lease, (sql) => sql.query(`SELECT 1 FROM parallel_life.${table} LIMIT 1`)),
          { code: '42501' },
        );
      }
      await queue.finish(lease, { status: 'cancelled', errorCode: 'CANCELLED' });
    },
  );
});
