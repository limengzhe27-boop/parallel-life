import test from 'node:test';
import { canWaitInAppointmentScene } from '../../src/modules/world/domain/appointment-wait.ts';
import { readSceneWaitContext } from '../../src/modules/world/infrastructure/scene-wait-context.ts';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresAppointmentWaitRepository } from '../../src/modules/world/infrastructure/appointment-wait-repository.ts';
import { PostgresStoryWaitRepository } from '../../src/modules/world/infrastructure/story-wait-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('early ordinary scene waits safely and continues the same scene without manufacturing attendance (real PG)', async (t) => {
  const cfg = await localConfig();
  if (process.env.SCENE_EARLY_WAIT_TEST_PORT)
    assert.equal(cfg.port, Number(process.env.SCENE_EARLY_WAIT_TEST_PORT));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  t.after(async () => {
    await queue.close();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db);
  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID(),
      appointmentId = randomUUID();
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
      title: 'Early arrival fixture',
      version: 0,
      time: '2026-10-26T04:00:00.000Z',
      actors: [{ id: actorId, name: 'A', persona: 'Independent' }],
      facts: [],
      messages: [],
      mediaRequests: [],
      appointments: [],
      space: {
        currentPlaceId: 'cafe',
        positionSource: source,
        places: ['cafe', 'other'].map((id) => ({
          id,
          name: id,
          description: '',
          source,
          contactActorIds: [],
          appointmentIds: id === 'cafe' ? [appointmentId] : [],
        })),
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, world);
    const cmd = {
      id: randomUUID(),
      worldId,
      actorId,
      expectedVersion: 0,
      text: 'Synthetic invitation',
    };
    await worlds.commit({ userId: owner }, cmd, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: cmd.id,
      version: 1,
      occurredAt: new Date().toISOString(),
      type: 'turn.resolved',
      data: {
        actorId,
        userText: cmd.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: 'Synthetic proposal' },
          {
            type: 'appointment.proposed',
            id: appointmentId,
            title: 'Confirmed meeting',
            at: '2026-10-26T05:00:00.000Z',
            participantIds: [actorId],
          },
        ],
      },
    });
    await worlds.respondToInvitation(
      { userId: owner },
      {
        commandId: randomUUID(),
        worldId,
        id: appointmentId,
        operation: 'accept',
        expectedVersion: 1,
      },
    );

    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 2,
      placeId: 'cafe',
    });
    const handler = sceneTaskHandler(
      queue,
      {
        async propose() {
          return {
            location: 'cafe',
            narration: 'An empty table is available.',
            presentActorIds: [],
            outcome: null,
            observation: null,
            matterTitle: null,
            matterUpdates: [],
            dialogues: [],
          };
        },
      },
      'controlled',
    );
    const open = async () => {
      await runOne(
        {
          claim: (k) => queue.claimForOwner(entered.task!.id, owner, k),
          renew: (l) => queue.renew(l),
          finish: (l, o) => queue.finish(l, o),
        },
        { world: handler },
      );
      const current = await worlds.get({ userId: owner }, worldId);
      await db.transaction(owner, async (sql) => {
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
    };
    return { owner, worldId, actorId, appointmentId, entered, open };
  }
  await t.test(
    'early opening task is a real blocker; after opening both wait entry and same-scene appointment work',
    async () => {
      const f = await fixture(),
        wait = new PostgresAppointmentWaitRepository(db);
      await assert.rejects(
        wait.wait(f.owner, f.worldId, {
          commandId: randomUUID(),
          expectedVersion: f.entered.version,
          invitationId: f.appointmentId,
        }),
        { code: 'BUSY' },
      );
      await f.open();
      let read = await scenes.read(f.owner, f.worldId);
      assert.equal(read.task?.status, 'succeeded');
      assert.equal(read.scene?.appointmentId, undefined);
      const oldEntries = structuredClone(read.entries),
        oldPresence = structuredClone(read.scene!.presence);
      const story = new PostgresStoryWaitRepository(db);
      const protectedWait = await story.wait(f.owner, f.worldId, {
        commandId: randomUUID(),
        clientId: randomUUID(),
        sequence: 1,
        expectedVersion: read.worldVersion,
        target: 'next_appointment',
      });
      assert.equal(protectedWait.storyNow, '2026-10-26T04:50:00.000Z');
      const request = {
        commandId: randomUUID(),
        expectedVersion: protectedWait.version,
        invitationId: f.appointmentId,
      };
      const waited = await wait.wait(f.owner, f.worldId, request);
      assert.equal(waited.storyNow, '2026-10-26T05:00:00.000Z');
      assert.deepEqual(await wait.wait(f.owner, f.worldId, request), waited);
      read = await scenes.read(f.owner, f.worldId);
      assert.equal(read.scene?.id, f.entered.sceneId);
      assert.deepEqual(read.entries, oldEntries);
      assert.deepEqual(read.scene?.presence, oldPresence);
      const input = {
        commandId: randomUUID(),
        expectedVersion: read.worldVersion,
        appointmentId: f.appointmentId,
      };
      const resumed = await scenes.enter(f.owner, f.worldId, input);
      assert.equal(resumed.sceneId, f.entered.sceneId);
      assert.deepEqual(await scenes.enter(f.owner, f.worldId, input), resumed);
      read = await scenes.read(f.owner, f.worldId);
      assert.equal(read.scene?.appointmentId, f.appointmentId);
      assert.deepEqual(read.scene?.presence, oldPresence);
      assert.deepEqual(read.entries, oldEntries);
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.scene_sessions WHERE world_id=$1', [
            f.worldId,
          ])
        ).rowCount,
        1,
      );
      assert.equal(
        (await worlds.get({ userId: f.owner }, f.worldId)).appointments[0]!.status,
        'confirmed',
      );
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.npc_journeys WHERE world_id=$1', [
            f.worldId,
          ])
        ).rowCount,
        0,
      );
    },
  );
  await t.test('pending scene action cannot be skipped even with no running task', async () => {
    const f = await fixture();
    await f.open();
    const read = await scenes.read(f.owner, f.worldId);
    const action = await scenes.input(f.owner, f.worldId, f.entered.sceneId, {
      commandId: randomUUID(),
      expectedVersion: read.worldVersion,
      text: '我看看桌子',
      relatedMatterIds: [],
    });
    await admin.query(
      "UPDATE parallel_life.tasks SET status='cancelled' WHERE scope_id=$1 AND status='queued'",
      [f.worldId],
    );
    await assert.rejects(
      new PostgresAppointmentWaitRepository(db).wait(f.owner, f.worldId, {
        commandId: randomUUID(),
        expectedVersion: action.version,
        invitationId: f.appointmentId,
      }),
      { reason: 'ACTIVE_SCENE' },
    );
  });
  await t.test('cancellation and revised place cannot bind an unrelated scene', async () => {
    const f = await fixture();
    await f.open();
    const w = await worlds.get({ userId: f.owner }, f.worldId);
    const cancelled = await worlds.respondToInvitation(
      { userId: f.owner },
      {
        commandId: randomUUID(),
        worldId: f.worldId,
        id: f.appointmentId,
        operation: 'cancel',
        expectedVersion: w.version,
      },
    );
    await assert.rejects(
      new PostgresAppointmentWaitRepository(db).wait(f.owner, f.worldId, {
        commandId: randomUUID(),
        expectedVersion: cancelled.version,
        invitationId: f.appointmentId,
      }),
      { code: 'INVALID_COMMAND' },
    );
    assert.equal((await scenes.read(f.owner, f.worldId)).scene?.appointmentId, undefined);
  });
  await t.test(
    'certified scene remains scoped to actual place, player, appointment and pending decisions',
    async () => {
      const f = await fixture();
      await f.open();
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const valid = await db.transaction(f.owner, (sql) =>
        readSceneWaitContext(sql, f.owner, world, f.entered.sceneId),
      );
      assert.ok(canWaitInAppointmentScene(world, f.appointmentId, f.entered.sceneId, valid));
      for (const invalid of [
        null,
        { ...valid!, id: 'other' },
        { ...valid!, worldId: 'other' },
        { ...valid!, ownerId: 'other' },
        { ...valid!, placeId: 'other' },
        { ...valid!, appointmentId: 'other' },
        { ...valid!, status: 'ended' as const },
        { ...valid!, playerPresent: false },
        { ...valid!, pending: true },
      ])
        assert.equal(
          canWaitInAppointmentScene(world, f.appointmentId, f.entered.sceneId, invalid),
          false,
        );
      assert.equal(
        await db.transaction(f.owner, (sql) =>
          readSceneWaitContext(sql, randomUUID(), world, f.entered.sceneId),
        ),
        null,
      );
    },
  );
});
