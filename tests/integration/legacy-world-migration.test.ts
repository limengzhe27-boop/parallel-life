import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import {
  inspectLegacyWorldReadiness,
  migrateLegacyWorldInTransaction,
} from '../../src/modules/world/infrastructure/legacy-world-migration.ts';
import {
  switchAgentEngineEpochInTransaction,
  AgentRuntimePersistenceError,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';

test('legacy world takeover and migration integration: state preservation, quiescent checks, atomicity and forward-only recovery', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );

  t.after(async () => {
    await app.close();
    await admin.end();
  });

  async function createSyntheticLegacyWorld(options?: {
    version?: number;
    withActiveTask?: boolean;
    withActiveCommand?: boolean;
  }) {
    const ownerId = randomUUID();
    const worldId = randomUUID();
    const version = options?.version ?? 3;
    const actor1Id = randomUUID();
    const actor2Id = randomUUID();
    const appointment1Id = randomUUID();
    const appointment2Id = randomUUID();

    const worldState = {
      title: '合成旧存档测试世界',
      time: {
        baseRealMs: 1729000000000,
        current: '2026-10-15T12:00:00.000Z',
        rate: 12,
      },
      actors: [
        {
          id: actor1Id,
          name: '林澈',
          persona: '严谨专注的研究员，与玩家有过学术探讨。',
        },
        {
          id: actor2Id,
          name: '苏晴',
          persona: '开朗的策展人，偶尔在微信交流。',
        },
      ],
      messages: [
        {
          id: randomUUID(),
          senderId: actor1Id,
          text: '上周的论文你看过了吗？',
          at: '2026-10-14T10:00:00.000Z',
        },
        {
          id: randomUUID(),
          senderId: 'player',
          text: '正在看第三章。',
          at: '2026-10-14T10:05:00.000Z',
        },
        {
          id: randomUUID(),
          senderId: actor1Id,
          text: '好，那我们周五图书馆见。',
          at: '2026-10-14T10:06:00.000Z',
        },
        {
          id: randomUUID(),
          senderId: actor2Id,
          text: '新展下周开幕，记得来！',
          at: '2026-10-14T11:00:00.000Z',
        },
      ],
      appointments: [
        {
          id: appointment1Id,
          title: '图书馆学术研讨',
          actorId: actor1Id,
          participantIds: [actor1Id, 'player'],
          at: '2026-10-16T14:00:00.000Z',
          status: 'scheduled',
          location: '市图书馆咖啡厅',
        },
        {
          id: appointment2Id,
          title: '上月咖啡聚会',
          actorId: actor2Id,
          participantIds: [actor2Id, 'player'],
          at: '2026-09-20T15:00:00.000Z',
          status: 'fulfilled',
          location: '旧城区红砖小馆',
        },
      ],
      places: [
        { id: 'place_library', name: '市图书馆' },
        { id: 'place_cafe', name: '旧城区红砖小馆' },
      ],
      notes: [{ id: 'note_1', title: '关于神经形态计算的几点灵感' }],
    };

    // Create corresponding account first
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [ownerId]);

    // Insert legacy world in Epoch 1
    await app.transaction(ownerId, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,$4,0,$5)',
        [worldId, ownerId, '合成旧存档测试世界', version, JSON.stringify(worldState)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [worldId, ownerId, worldState, {}],
      );
      await sql.query(
        'INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES($1,$2,1)',
        [worldId, ownerId],
      );

      if (options?.withActiveCommand) {
        await sql.query(
          `INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status)
           VALUES($1,$2,$3,$4,'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','{}'::jsonb,'queued')`,
          [randomUUID(), worldId, ownerId, version],
        );
      }

      if (options?.withActiveTask) {
        await sql.query(
          `INSERT INTO parallel_life.tasks(id,owner_id,kind,status,scope_kind,scope_id,input)
           VALUES($1,$2,'world_advance','running','world',$3,jsonb_build_object('worldId',$3))`,
          [randomUUID(), ownerId, worldId],
        );
      }
    });

    return {
      ownerId,
      worldId,
      version,
      actor1Id,
      actor2Id,
      appointment1Id,
      appointment2Id,
      worldState,
    };
  }

  await t.test(
    '1. inspectLegacyWorldReadiness correctly audits state and identifies eligible legacy world',
    async () => {
      const f = await createSyntheticLegacyWorld();

      const inventory = await app.transaction(f.ownerId, async (sql) => {
        return inspectLegacyWorldReadiness(sql, f.ownerId, f.worldId);
      });

      assert.equal(inventory.worldId, f.worldId);
      assert.equal(inventory.version, 3);
      assert.equal(inventory.engineEpoch, 1);
      assert.equal(inventory.actorCount, 2);
      assert.equal(inventory.messageCount, 4);
      assert.equal(inventory.appointmentCount, 2);
      assert.equal(inventory.openAppointmentsCount, 1);
      assert.equal(inventory.placeCount, 2);
      assert.equal(inventory.noteCount, 1);
      assert.equal(inventory.isEligibleForMigration, true);
      assert.deepEqual(inventory.blockers, []);
    },
  );

  await t.test(
    '2. inspectLegacyWorldReadiness detects busy tasks/commands and aborts migration with ATTEMPT_PENDING',
    async () => {
      const busyFixture = await createSyntheticLegacyWorld({ withActiveCommand: true });

      const inventory = await app.transaction(busyFixture.ownerId, async (sql) => {
        return inspectLegacyWorldReadiness(sql, busyFixture.ownerId, busyFixture.worldId);
      });

      assert.equal(inventory.isEligibleForMigration, false);
      assert.ok(inventory.blockers.includes('ACTIVE_PENDING_ATTEMPT_OR_TASK'));

      await assert.rejects(
        async () => {
          await app.transaction(busyFixture.ownerId, async (sql) => {
            return migrateLegacyWorldInTransaction(sql, busyFixture.ownerId, {
              worldId: busyFixture.worldId,
              expectedWorldVersion: busyFixture.version,
            });
          });
        },
        (err: any) => err instanceof AgentRuntimePersistenceError && err.code === 'ATTEMPT_PENDING',
      );
    },
  );

  await t.test(
    '3. migrateLegacyWorldInTransaction rejects on expectedWorldVersion conflict',
    async () => {
      const f = await createSyntheticLegacyWorld({ version: 3 });

      await assert.rejects(
        async () => {
          await app.transaction(f.ownerId, async (sql) => {
            return migrateLegacyWorldInTransaction(sql, f.ownerId, {
              worldId: f.worldId,
              expectedWorldVersion: 999, // Intentional conflict
            });
          });
        },
        (err: any) =>
          err instanceof AgentRuntimePersistenceError && err.code === 'VERSION_CONFLICT',
      );
    },
  );

  await t.test(
    '4. migrateLegacyWorldInTransaction atomically migrates world, maps appointments to responsibilities, and preserves history',
    async () => {
      const f = await createSyntheticLegacyWorld({ version: 3 });

      const result = await app.transaction(f.ownerId, async (sql) => {
        return migrateLegacyWorldInTransaction(sql, f.ownerId, {
          worldId: f.worldId,
          expectedWorldVersion: f.version,
        });
      });

      assert.equal(result.worldId, f.worldId);
      assert.equal(result.success, true);
      assert.equal(result.alreadyMigrated, false);
      assert.equal(result.engineEpoch, 2);
      assert.equal(result.worldVersion, 3);
      assert.equal(result.actorCount, 2);
      assert.equal(result.migratedResponsibilitiesCount, 1);

      // Verify database state post-migration
      await app.transaction(f.ownerId, async (sql) => {
        // 1. Engine epoch in agent_runtime_worlds is 2
        const epochRow = (
          await sql.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
            [f.worldId, f.ownerId],
          )
        ).rows[0];
        assert.equal(epochRow.engine_epoch, 2);

        // 2. Both actors have initialized actor_agent_states at revision 0
        const actorStates = (
          await sql.query(
            'SELECT actor_id, revision, projected_world_version, document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
            [f.worldId, f.ownerId],
          )
        ).rows;
        assert.equal(actorStates.length, 2);

        const actor1State = actorStates.find((r) => r.actor_id === f.actor1Id);
        const actor2State = actorStates.find((r) => r.actor_id === f.actor2Id);
        assert.ok(actor1State);
        assert.ok(actor2State);

        assert.equal(actor1State.revision, 0);
        assert.equal(actor1State.projected_world_version, 3);
        assert.equal(actor1State.document.goals.length, 0); // No fabricated goals
        assert.equal(actor1State.document.plans.length, 0); // No fabricated plans
        assert.equal(actor1State.document.decisions.length, 0); // No fabricated decisions
        assert.equal(actor1State.document.responsibilities.length, 1);
        assert.equal(actor1State.document.responsibilities[0].id, `resp_${f.appointment1Id}`);
        assert.equal(actor1State.document.responsibilities[0].subject.kind, 'appointment');
        assert.equal(actor1State.document.responsibilities[0].subject.id, f.appointment1Id);
        assert.equal(actor1State.document.responsibilities[0].summary, '图书馆学术研讨');
        assert.equal(actor1State.document.responsibilities[0].waitingOn, 'player');

        assert.equal(actor2State.revision, 0);
        assert.equal(actor2State.projected_world_version, 3);
        assert.equal(actor2State.document.responsibilities.length, 0); // Completed appointment is not carried over as open responsibility

        // 3. World version, time, places, and messages remain 100% untouched
        const worldRow = (
          await sql.query(
            'SELECT version, state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2',
            [f.worldId, f.ownerId],
          )
        ).rows[0];
        assert.equal(worldRow.version, 3);
        assert.equal(worldRow.state.messages.length, 4);
        assert.equal(worldRow.state.places.length, 2);
        assert.equal(worldRow.state.notes.length, 1);
        assert.deepEqual(worldRow.state.time, f.worldState.time);
      });
    },
  );

  await t.test(
    '5. Idempotent re-migration: second execution safely returns alreadyMigrated without data wipe',
    async () => {
      const f = await createSyntheticLegacyWorld({ version: 3 });

      // First migration
      await app.transaction(f.ownerId, async (sql) => {
        return migrateLegacyWorldInTransaction(sql, f.ownerId, {
          worldId: f.worldId,
        });
      });

      // Second migration attempt
      const replay = await app.transaction(f.ownerId, async (sql) => {
        return migrateLegacyWorldInTransaction(sql, f.ownerId, {
          worldId: f.worldId,
        });
      });

      assert.equal(replay.worldId, f.worldId);
      assert.equal(replay.success, true);
      assert.equal(replay.alreadyMigrated, true);
      assert.equal(replay.engineEpoch, 2);
      assert.equal(replay.worldVersion, 3);
    },
  );

  await t.test(
    '6. Forward-only recovery: cannot roll back engine epoch to 1 once in Epoch 2',
    async () => {
      const f = await createSyntheticLegacyWorld({ version: 3 });

      // Migrate to Epoch 2
      await app.transaction(f.ownerId, async (sql) => {
        return migrateLegacyWorldInTransaction(sql, f.ownerId, {
          worldId: f.worldId,
        });
      });

      // Attempt illegal downgrade to Epoch 1
      await assert.rejects(
        async () => {
          await app.transaction(f.ownerId, async (sql) => {
            await switchAgentEngineEpochInTransaction(sql, f.ownerId, {
              worldId: f.worldId,
              expectedEpoch: 2,
              nextEpoch: 1, // Illegal downgrade
              expectedWorldVersion: 3,
            });
          });
        },
        (err: any) =>
          err instanceof AgentRuntimePersistenceError && err.code === 'ENGINE_EPOCH_CONFLICT',
      );
    },
  );
});
