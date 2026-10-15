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
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { projectAgentWorldChange } from '../../src/modules/world/infrastructure/world-awareness-commit.ts';
import {
  sceneEnvironmentTaskHandler,
  sceneEnvironmentCommandId,
  replaySceneEnvironment,
} from '../../src/modules/world/infrastructure/agent-scene-environment.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TaskLease } from '../../src/modules/tasks/domain/types.ts';

test('deterministic scene environment: real owner SQL, actual entry/lease, atomic projection and task completion (no models)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_SCENE_ENV_TEST_PORT ?? 55565));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
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
      await worker.close();
      await db.close();
      await admin.end();
    }
  });
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db),
    tasks = new TaskRepository(db);
  const handler = sceneEnvironmentTaskHandler(db);
  const signal = () => new AbortController().signal;

  async function fixture(priorPosition = false, epoch = 2) {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actor = randomUUID(),
      contact = randomUUID();
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
      title: 'Synthetic environment fixture',
      time: new Date().toISOString(),
      actors: [
        { id: actor, name: '甲', persona: '有独立生活。' },
        { id: contact, name: '乙', persona: '地点联系人。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        places: [
          {
            id: 'room',
            name: '虚构客厅',
            description: '甲可能会来，但这只是地点概览。',
            source,
            contactActorIds: [actor, contact],
            appointmentIds: [],
          },
        ],
        routes: [],
        currentPlaceId: 'room',
        positionSource: source,
      },
    };
    await worlds.initialize({ userId: owner }, initial);
    if (priorPosition) {
      // Synthetic historical fixture through the real epoch-1 scene writer, never a new-runtime fallback.
      const old = await scenes.enterPlace(owner, worldId, {
        commandId: randomUUID(),
        expectedVersion: 0,
        placeId: 'room',
      });
      const oldLease = (await queue.claimForOwner(old.task!.id, owner, ['world']))!;
      const version = await db.transaction(owner, (sql) =>
        commitSceneProposal(
          sql,
          owner,
          worldId,
          oldLease.input as Parameters<typeof commitSceneProposal>[3],
          {
            location: '虚构客厅',
            narration: '历史现场记录。',
            presentActorIds: [actor],
            outcome: null,
            observation: null,
            matterTitle: null,
            matterUpdates: [],
            dialogues: [],
            initialMatters: [],
            stepProposals: [],
            npcActions: [],
          },
          randomUUID(),
        ),
      );
      await queue.finish(oldLease, { status: 'succeeded', resultVersion: version });
      await scenes.navigate(
        owner,
        worldId,
        old.sceneId,
        { commandId: randomUUID(), expectedVersion: version },
        true,
      );
    }
    const beforeSwitch = await worlds.get({ userId: owner }, worldId);
    if (epoch >= 2)
      await db.transaction(owner, async (sql) => {
        for (const id of [actor, contact])
          await initializeActorAgentStateInTransaction(
            sql,
            owner,
            emptyActorAgentState(
              { worldId, actorId: id },
              agentDefinitionRef(initial, id),
              beforeSwitch.version,
            ),
          );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: beforeSwitch.version,
        });
        if (priorPosition) {
          const latest = (
            await sql.query(
              'SELECT id FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version DESC LIMIT 1',
              [worldId],
            )
          ).rows[0];
          await projectAgentWorldChange(sql, owner, worldId, latest.id);
        }
      });
    const command = {
      commandId: randomUUID(),
      expectedVersion: beforeSwitch.version,
      placeId: 'room',
    };
    const entered = await scenes.enterPlace(owner, worldId, command);
    const beforeWorld = await worlds.get({ userId: owner }, worldId),
      beforeScene = (await scenes.read(owner, worldId, entered.sceneId)).scene!;
    const lease = (await queue.claimForOwner(entered.task!.id, owner, ['world']))!;
    return {
      owner,
      worldId,
      actor,
      contact,
      initial,
      command,
      entered,
      beforeWorld,
      beforeScene,
      lease,
    };
  }
  async function countOpen(worldId: string) {
    return Number(
      (
        await admin.query(
          "SELECT count(*) FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='scene.opened' AND payload->'data'->'environment' IS NOT NULL",
          [worldId],
        )
      ).rows[0].count,
    );
  }
  async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
    assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, f.beforeWorld.version);
    assert.equal(await countOpen(f.worldId), 0);
    assert.equal((await scenes.read(f.owner, f.worldId, f.entered.sceneId)).entries.length, 0);
    assert.equal((await tasks.get(f.owner, f.lease.id)).status, 'running');
    assert.equal(
      (
        await admin.query('SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
          f.worldId,
          sceneEnvironmentCommandId(f.lease.id, f.worldId, f.entered.sceneId),
        ])
      ).rowCount,
      0,
    );
    const observed = (
      await admin.query(
        'SELECT observed_through_version FROM parallel_life.director_observed_states WHERE world_id=$1',
        [f.worldId],
      )
    ).rows[0];
    if (observed) assert.equal(observed.observed_through_version, f.beforeWorld.version);
  }

  await t.test(
    'actual entry opens an empty NPC environment, unlocks input, and repeats without new work',
    async () => {
      const f = await fixture();
      const beforePositions = (
        await admin.query(
          'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 ORDER BY subject_key',
          [f.worldId],
        )
      ).rows;
      let outerFinish = 0;
      await runOne(
        {
          claim: async () => f.lease,
          renew: (l) => queue.renew(l),
          finish: async (l, o) => {
            outerFinish++;
            await queue.finish(l, o);
          },
        },
        {
          world: async (l, s) => {
            assert.equal(await handler(l, s), true);
          },
        },
      );
      assert.equal(outerFinish, 0);
      const read = await scenes.read(f.owner, f.worldId, f.entered.sceneId);
      assert.equal(read.task?.status, 'succeeded');
      assert.equal(read.worldVersion, f.entered.version + 1);
      assert.equal(
        read.scene!.presence.length,
        1,
        'contacts and promises never establish actual presence',
      );
      assert.deepEqual(
        read.entries.map((e) => e.kind),
        ['time_place'],
      );
      assert.equal((read.entries[0] as { storyAt: string }).storyAt, f.beforeWorld.time);
      assert(!JSON.stringify(read.entries).includes('可能会来'));
      assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).time, f.beforeWorld.time);
      assert.deepEqual(
        (
          await admin.query(
            'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 ORDER BY subject_key',
            [f.worldId],
          )
        ).rows,
        beforePositions,
      );
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1', [
            f.worldId,
          ])
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.outbox_jobs WHERE world_id=$1', [
            f.worldId,
          ])
        ).rowCount,
        0,
        'no fake notification or media jobs',
      );
      const event = (
        await admin.query(
          "SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND payload->'data'->'environment' IS NOT NULL",
          [f.worldId],
        )
      ).rows[0].payload;
      const rows = (
        await admin.query(
          'SELECT id,version,world_id AS "worldId",owner_id AS "ownerId",payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
          [f.worldId],
        )
      ).rows;
      const projection = replaySceneEnvironment(f.beforeWorld, f.beforeScene, event, rows);
      assert.deepEqual(projection.scene, read.scene);
      assert.deepEqual(projection.entries, read.entries);
      assert.equal(
        replayWorldHistory(
          f.initial,
          rows.map((r) => r.payload),
        ).world.time,
        f.beforeWorld.time,
      );
      const altered = structuredClone(event);
      altered.data.environment.entries[0].location = '虚构其他地点';
      assert.throws(() => replaySceneEnvironment(f.beforeWorld, f.beforeScene, altered, rows));
      assert.throws(
        () =>
          replaySceneEnvironment(
            { ...f.beforeWorld, version: read.worldVersion },
            read.scene!,
            event,
            rows,
          ),
        'cannot overwrite later scene state',
      );
      const repeat = await scenes.enterPlace(f.owner, f.worldId, f.command);
      assert.equal(repeat.task!.id, f.lease.id);
      assert.equal(await queue.claimForOwner(f.lease.id, f.owner, ['world']), null);
      await assert.rejects(handler(f.lease, signal()));
      assert.equal(await countOpen(f.worldId), 1);
      const accepted = await scenes.input(f.owner, f.worldId, f.entered.sceneId, {
        commandId: randomUUID(),
        expectedVersion: read.worldVersion,
        text: '你好',
        relatedMatterIds: [],
      });
      assert(accepted.task);
      assert.equal((await scenes.read(f.owner, f.worldId)).actions.length, 1);
    },
  );

  await t.test(
    'only an independently committed earlier same-place position admits an NPC; opening preserves its original source',
    async () => {
      const f = await fixture(true);
      const prior = (
        await admin.query(
          'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
          [f.worldId, `actor:${f.actor}`],
        )
      ).rows[0].document;
      assert(prior.worldVersion < f.entered.version);
      await handler(f.lease, signal());
      const read = await scenes.read(f.owner, f.worldId);
      assert.deepEqual(
        read.scene!.presence.map((p) => p.participant),
        [{ kind: 'player' }, { kind: 'actor', actorId: f.actor }],
      );
      assert.deepEqual(read.entries[0]!.observableTo, [
        { kind: 'player' },
        { kind: 'actor', actorId: f.actor },
      ]);
      assert.deepEqual(
        (
          await admin.query(
            'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
            [f.worldId, `actor:${f.actor}`],
          )
        ).rows[0].document,
        prior,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT 1 FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
            [f.worldId, `actor:${f.contact}`],
          )
        ).rowCount,
        0,
      );
      const event = (
        await admin.query(
          "SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND payload->'data'->'environment' IS NOT NULL",
          [f.worldId],
        )
      ).rows[0].payload;
      const rows = (
        await admin.query(
          'SELECT id,version,world_id AS "worldId",owner_id AS "ownerId" FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
          [f.worldId],
        )
      ).rows;
      assert.deepEqual(
        replaySceneEnvironment(f.beforeWorld, f.beforeScene, event, rows).scene,
        read.scene,
      );
      const circular = structuredClone(event);
      circular.data.environment.presenceProofs[1].sourceEventId = event.id;
      circular.data.environment.presenceProofs[1].worldVersion = event.version;
      assert.throws(() => replaySceneEnvironment(f.beforeWorld, f.beforeScene, circular, rows));
    },
  );

  await t.test(
    'wrong token/input/world/owner, raw worker and expired lease cannot authorize environment writes',
    async () => {
      const f = await fixture(),
        other = await fixture();
      for (const forged of [
        { ...f.lease, token: randomUUID() },
        {
          ...f.lease,
          input: { ...(f.lease.input as Record<string, unknown>), sceneId: other.entered.sceneId },
        },
        { ...f.lease, scopeId: other.worldId },
        { ...f.lease, ownerId: other.owner },
      ])
        await assert.rejects(handler(forged, signal()));
      await assert.rejects(sceneEnvironmentTaskHandler(worker)(f.lease, signal()));
      await unchanged(f);
      await admin.query(
        "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [f.lease.id],
      );
      await assert.rejects(handler(f.lease, signal()));
      await unchanged(f);
    },
  );

  await t.test(
    'an unmatched original entry receipt is rejected without partial command or scene writes',
    async () => {
      const f = await fixture();
      await db.transaction(f.owner, (sql) =>
        sql.query(
          "UPDATE parallel_life.scene_receipts SET document=jsonb_set(document,'{task,id}',to_jsonb($3::text)) WHERE world_id=$1 AND command_id=$2",
          [f.worldId, f.command.commandId, randomUUID()],
        ),
      );
      await assert.rejects(handler(f.lease, signal()), /SCENE_ENVIRONMENT_ENTRY_RECEIPT/);
      await unchanged(f);
    },
  );
  await t.test(
    'missing actual player position cannot be replaced by the scene or contact roster',
    async () => {
      const f = await fixture();
      await admin.query(
        'DELETE FROM parallel_life.world_authoritative_positions WHERE world_id=$1',
        [f.worldId],
      );
      await assert.rejects(handler(f.lease, signal()));
      await unchanged(f);
    },
  );
  await t.test(
    'pause and a later world version stop stale opening instead of silently changing time',
    async () => {
      const f = await fixture();
      await db.transaction(f.owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused) VALUES($1,$2,$3,true)',
          [f.worldId, f.owner, f.beforeWorld.time],
        ),
      );
      await assert.rejects(handler(f.lease, signal()), /WORLD_PAUSED/);
      await unchanged(f);
      await db.transaction(f.owner, (sql) =>
        sql.query('UPDATE parallel_life.world_clock SET paused=false WHERE world_id=$1', [
          f.worldId,
        ]),
      );
      await scenes.navigate(f.owner, f.worldId, f.entered.sceneId, {
        commandId: randomUUID(),
        expectedVersion: f.entered.version,
        view: 'phone',
      });
      await assert.rejects(handler(f.lease, signal()), /VERSION_CONFLICT/);
      assert.equal(await countOpen(f.worldId), 0);
    },
  );
  await t.test(
    'explicit player departure cancels the opening and a late worker cannot put the player back',
    async () => {
      const f = await fixture();
      await scenes.navigate(
        f.owner,
        f.worldId,
        f.entered.sceneId,
        { commandId: randomUUID(), expectedVersion: f.entered.version },
        true,
      );
      await assert.rejects(handler(f.lease, signal()));
      assert.equal(await countOpen(f.worldId), 0);
      assert.equal((await scenes.read(f.owner, f.worldId)).scene, null);
    },
  );

  for (const late of ['lease', 'epoch'] as const)
    await t.test(
      `a ${late} change at final receipt insertion rolls back event, world, scene and parent task together`,
      async () => {
        const f = await fixture(),
          suffix = randomUUID().replaceAll('-', ''),
          name = `env_test_${suffix}`;
        const commandId = sceneEnvironmentCommandId(f.lease.id, f.worldId, f.entered.sceneId);
        // Isolated local fault injection at the actual last receipt write, not a mock repository.
        const mutation =
          late === 'lease'
            ? `UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id='${f.lease.id}';`
            : `UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=engine_epoch+1 WHERE world_id='${f.worldId}';`;
        await admin.query(
          `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_id='${commandId}' THEN ${mutation} END IF; RETURN NEW; END $$`,
        );
        try {
          await admin.query(
            `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.scene_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}()`,
          );
          await assert.rejects(handler(f.lease, signal()));
          await unchanged(f);
          assert.equal(
            Number(
              (
                await admin.query(
                  'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
                  [f.worldId],
                )
              ).rows[0].engine_epoch,
            ),
            2,
          );
        } finally {
          await admin.query(`DROP TRIGGER IF EXISTS ${name} ON parallel_life.scene_receipts`);
          await admin.query(`DROP FUNCTION parallel_life.${name}()`);
        }
        assert.equal(
          await handler(f.lease, signal()),
          true,
          'same uncharged deterministic task remains recoverable after the rollback',
        );
      },
    );
  await t.test('epoch-1 scene work is left for its existing executor', async () => {
    const f = await fixture(false, 1);
    assert.equal(await handler(f.lease, signal()), false);
    await unchanged(f);
  });

  await t.test(
    'an in-transit or unknown NPC cannot be brought back by its older same-place scene',
    async () => {
      for (const status of ['in_transit', 'unknown']) {
        const f = await fixture(true);
        // Explicit synthetic spatial-projection fixture; no claim that a travel capability ran.
        await admin.query(
          "UPDATE parallel_life.world_authoritative_positions SET document=jsonb_set(jsonb_set(document,'{status}',to_jsonb($3::text)),'{placeId}','null'::jsonb) WHERE world_id=$1 AND subject_key=$2",
          [f.worldId, `actor:${f.actor}`, status],
        );
        await handler(f.lease, signal());
        assert.deepEqual(
          (await scenes.read(f.owner, f.worldId)).scene!.presence.map((p) => p.participant),
          [{ kind: 'player' }],
        );
      }
    },
  );

  await t.test(
    'a forged original event identity and a mixed-channel input fail before any environment write',
    async () => {
      const f = await fixture();
      await assert.rejects(
        handler(
          { ...f.lease, input: { ...(f.lease.input as object), channel: 'group' } },
          signal(),
        ),
      );
      await admin.query(
        "UPDATE parallel_life.world_events SET payload=jsonb_set(payload,'{id}',to_jsonb($2::text)) WHERE id=$1",
        [f.beforeScene.sourceEventId, randomUUID()],
      );
      await assert.rejects(handler(f.lease, signal()), /SCENE_ENVIRONMENT_ENTRY_NOT_COMMITTED/);
      await unchanged(f);
    },
  );
});
