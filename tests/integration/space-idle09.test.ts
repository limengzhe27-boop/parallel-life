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
  PostgresWorldSpace,
  lockWorldActivity,
} from '../../src/modules/world/infrastructure/space-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { sceneEnvironmentTaskHandler } from '../../src/modules/world/infrastructure/agent-scene-environment.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { enqueue, requestHash } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('space idle keeps execution boundaries without global deadlock from epoch2 empty-scene unknown', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.SPACE_IDLE_TEST_PORT ?? 55676));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await queue.close();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    space = new PostgresWorldSpace(db, officialLifeCatalog),
    scenes = new SceneRepository(db);
  async function fixture(epoch = 2) {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID();
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
      title: 'Synthetic map idle',
      version: 0,
      time: new Date().toISOString(),
      actors: [{ id: actorId, name: '甲', persona: '独立' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'room',
        positionSource: source,
        places: ['room', 'hotel'].map((id) => ({
          id,
          name: id,
          description: '平静的环境',
          source,
          contactActorIds: [],
          appointmentIds: [],
        })),
        routes: [
          {
            id: 'to_hotel',
            fromPlaceId: 'room',
            toPlaceId: 'hotel',
            durationMinutes: 5,
            modeLabel: '步行',
            source,
          },
        ],
      },
    };
    await worlds.initialize({ userId: owner }, world);
    if (epoch === 2)
      await db.transaction(owner, async (sql) => {
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(world, actorId), 0),
        );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        });
      });
    return { owner, worldId };
  }
  await t.test(
    'unknown empty-scene result remains recorded, player travels, late scene commit cannot land in hotel',
    async () => {
      const f = await fixture();
      const entered = await scenes.enterPlace(f.owner, f.worldId, {
        commandId: randomUUID(),
        expectedVersion: 0,
        placeId: 'room',
      });
      const openingLease = (await queue.claimForOwner(entered.task!.id, f.owner, ['world']))!;
      assert.equal(
        await sceneEnvironmentTaskHandler(db)(openingLease, new AbortController().signal),
        true,
      );
      const before = await worlds.get({ userId: f.owner }, f.worldId);
      const sent = await scenes.input(f.owner, f.worldId, entered.sceneId, {
        commandId: randomUUID(),
        expectedVersion: before.version,
        text: '有人吗',
        relatedMatterIds: [],
      });
      const lease = (await queue.claimForOwner(sent.task!.id, f.owner, ['world']))!;
      await queue.finish(lease, { status: 'unknown', errorCode: 'UNKNOWN' });
      assert.equal((await space.read(f.owner, f.worldId)).busy, false);
      const moved = await space.travel(f.owner, f.worldId, {
        commandId: randomUUID(),
        expectedVersion: sent.version,
        routeId: 'to_hotel',
      });
      assert.equal(moved.toPlaceId, 'hotel');
      const atHotel = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(atHotel.space!.currentPlaceId, 'hotel');
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          commitSceneProposal(
            sql,
            f.owner,
            f.worldId,
            lease.input as any,
            {
              location: 'room',
              narration: '',
              presentActorIds: [],
              outcome: 'partial',
              observation: '旧现场回声',
              matterTitle: null,
              initialMatters: [],
              matterUpdates: [],
              dialogues: [],
              stepProposals: [],
              npcActions: [],
            },
            randomUUID(),
            true,
          ),
        ),
        { code: 'INVALID_COMMAND' },
      );
      assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, atHotel.version);
      const oldTask = (
        await admin.query('SELECT status,error_code FROM parallel_life.tasks WHERE id=$1', [
          lease.id,
        ])
      ).rows[0];
      assert.deepEqual(oldTask, { status: 'unknown', error_code: 'UNKNOWN' });
    },
  );
  for (const config of [
    { epoch: 1, status: 'unknown', input: { type: 'scene' } },
    { epoch: 2, status: 'unknown', input: { type: 'director' } },
    { epoch: 2, status: 'unknown', input: {} },
    { epoch: 2, status: 'queued', input: { type: 'scene' } },
    { epoch: 2, status: 'running', input: { type: 'scene' } },
  ]) {
    await t.test(
      `epoch${config.epoch} ${JSON.stringify(config.input)} ${config.status} still blocks`,
      async () => {
        const f = await fixture(config.epoch);
        const task = await db.transaction(f.owner, (sql) =>
          enqueue(
            sql,
            f.owner,
            'world',
            f.worldId,
            randomUUID(),
            config.input,
            requestHash(config.input),
          ),
        );
        if (config.status !== 'queued') {
          const lease = (await queue.claimForOwner(task.id, f.owner, ['world']))!;
          if (config.status === 'unknown')
            await queue.finish(lease, { status: 'unknown', errorCode: 'UNKNOWN' });
        }
        assert.equal((await space.read(f.owner, f.worldId)).busy, true);
        await assert.rejects(
          space.travel(f.owner, f.worldId, {
            commandId: randomUUID(),
            expectedVersion: 0,
            routeId: 'to_hotel',
          }),
          { code: 'BUSY' },
        );
      },
    );
  }
  await t.test(
    'transient advisory owner does not freeze map read, but travel retains the write lock',
    async () => {
      const f = await fixture();
      await db.transaction(f.owner, async (sql) => {
        await lockWorldActivity(sql, f.worldId);
        assert.equal((await space.read(f.owner, f.worldId)).busy, false);
        await assert.rejects(
          space.travel(f.owner, f.worldId, {
            commandId: randomUUID(),
            expectedVersion: 0,
            routeId: 'to_hotel',
          }),
          { code: 'BUSY' },
        );
      });
      assert.equal((await space.read(f.owner, f.worldId)).busy, false);
      assert.equal(
        (
          await space.travel(f.owner, f.worldId, {
            commandId: randomUUID(),
            expectedVersion: 0,
            routeId: 'to_hotel',
          })
        ).toPlaceId,
        'hotel',
      );
    },
  );
});
