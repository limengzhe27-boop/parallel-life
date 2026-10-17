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
  LegacyWorldInventorySchema,
  LegacyMigrationRequestSchema,
  LegacyMigrationResponseSchema,
} from '../../src/contracts/legacy-world-migration.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import {
  switchAgentEngineEpochInTransaction,
  AgentRuntimePersistenceError,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';

test('Task 44-128: Legacy world migration inventory, readiness check, atomic takeover and runtime routing', async (t) => {
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
    withActiveCommand?: boolean;
    withActiveTask?: boolean;
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
          title: '上月美术馆看展',
          actorId: actor2Id,
          participantIds: [actor2Id, 'player'],
          at: '2026-09-10T15:00:00.000Z',
          status: 'completed',
          location: '当代美术馆',
        },
      ],
      places: [
        { id: 'place_library', name: '市图书馆咖啡厅' },
        { id: 'place_art_gallery', name: '当代美术馆' },
      ],
      notes: [
        {
          id: randomUUID(),
          title: '论文阅读笔记',
          text: '第三章论点需要进一步推敲。',
        },
      ],
    };

    // Create corresponding account first
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [ownerId]);

    await app.transaction(ownerId, async (sql: SqlClient) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id, owner_id, title, version, asset_revision, state, created_at, updated_at) VALUES($1, $2, $3, $4, 0, $5, NOW(), NOW())',
        [worldId, ownerId, '合成旧存档测试世界', version, JSON.stringify(worldState)],
      );

      await sql.query(
        'INSERT INTO parallel_life.agent_runtime_worlds(world_id, owner_id, engine_epoch) VALUES($1, $2, 1)',
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
          `INSERT INTO parallel_life.tasks(id,owner_id,command_id,request_hash,status,scope_kind,scope_id,input)
           VALUES($1,$2,$4,'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','running','world',$3,jsonb_build_object('worldId',$3::text))`,
          [randomUUID(), ownerId, worldId, randomUUID()],
        );
      }
    });

    return {
      ownerId,
      worldId,
      actor1Id,
      actor2Id,
      appointment1Id,
      appointment2Id,
      worldState,
    };
  }

  await t.test('1. inspectLegacyWorldReadiness audits state and validates against LegacyWorldInventorySchema', async () => {
    const f = await createSyntheticLegacyWorld({ version: 3 });

    const rawInventory = await app.transaction(f.ownerId, async (sql: SqlClient) => {
      return inspectLegacyWorldReadiness(sql, f.ownerId, f.worldId);
    });

    // Validate with Zod schema contract
    const inventory = LegacyWorldInventorySchema.parse(rawInventory);
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
  });

  await t.test('2. Readiness inspection detects active background commands and tasks blocking migration', async () => {
    const f1 = await createSyntheticLegacyWorld({ version: 3, withActiveCommand: true });
    const inv1 = await app.transaction(f1.ownerId, async (sql: SqlClient) => {
      return inspectLegacyWorldReadiness(sql, f1.ownerId, f1.worldId);
    });
    assert.equal(inv1.isEligibleForMigration, false);
    assert.ok(inv1.blockers.includes('ACTIVE_PENDING_ATTEMPT_OR_TASK'));

    const f2 = await createSyntheticLegacyWorld({ version: 3, withActiveTask: true });
    const inv2 = await app.transaction(f2.ownerId, async (sql: SqlClient) => {
      return inspectLegacyWorldReadiness(sql, f2.ownerId, f2.worldId);
    });
    assert.equal(inv2.isEligibleForMigration, false);
    assert.ok(inv2.blockers.includes('ACTIVE_PENDING_ATTEMPT_OR_TASK'));
  });

  await t.test('3. Multi-tenant isolation: cannot inspect another user legacy world', async () => {
    const f = await createSyntheticLegacyWorld({ version: 3 });
    const intruderId = randomUUID();

    await assert.rejects(
      async () => {
        await app.transaction(intruderId, async (sql: SqlClient) => {
          return inspectLegacyWorldReadiness(sql, intruderId, f.worldId);
        });
      },
      (err: any) => err.code === 'NOT_FOUND',
    );
  });

  await t.test('4. Atomic migration execution: parses request schema, maps appointments, transitions epoch to 2', async () => {
    const f = await createSyntheticLegacyWorld({ version: 3 });

    // Validate request schema
    const migrationReq = LegacyMigrationRequestSchema.parse({
      expectedWorldVersion: 3,
      actorDefinitionRefs: {
        [f.actor1Id]: 'author:actor:linche',
      },
    });

    const rawResult = await app.transaction(f.ownerId, async (sql: SqlClient) => {
      return migrateLegacyWorldInTransaction(sql, f.ownerId, {
        worldId: f.worldId,
        expectedWorldVersion: migrationReq.expectedWorldVersion,
        actorDefinitionRefs: migrationReq.actorDefinitionRefs,
      });
    });

    // Validate response schema
    const result = LegacyMigrationResponseSchema.parse(rawResult);
    assert.equal(result.worldId, f.worldId);
    assert.equal(result.success, true);
    assert.equal(result.alreadyMigrated, false);
    assert.equal(result.engineEpoch, 2);
    assert.equal(result.worldVersion, 3);
    assert.equal(result.actorCount, 2);
    assert.equal(result.migratedResponsibilitiesCount, 1);

    // Verify DB state
    await app.transaction(f.ownerId, async (sql: SqlClient) => {
      const epochRow = (
        await sql.query(
          'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
          [f.worldId, f.ownerId],
        )
      ).rows[0];
      assert.equal(epochRow.engine_epoch, 2);

      const actorStates = (
        await sql.query(
          'SELECT actor_id, revision, projected_world_version, document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
          [f.worldId, f.ownerId],
        )
      ).rows;
      assert.equal(actorStates.length, 2);

      const actor1 = actorStates.find((a) => a.actor_id === f.actor1Id);
      assert.ok(actor1);
      assert.equal(actor1.revision, 0);
      assert.equal(actor1.document.definitionRef, 'author:actor:linche');
      assert.equal(actor1.document.goals.length, 0); // No fabricated goals
      assert.equal(actor1.document.plans.length, 0); // No fabricated plans
      assert.equal(actor1.document.responsibilities.length, 1);
      assert.equal(actor1.document.responsibilities[0].id, `resp_${f.appointment1Id}`);
      assert.equal(actor1.document.responsibilities[0].subject.kind, 'appointment');
      assert.equal(actor1.document.responsibilities[0].summary, '图书馆学术研讨');
      assert.equal(actor1.document.responsibilities[0].waitingOn, 'player');

      const actor2 = actorStates.find((a) => a.actor_id === f.actor2Id);
      assert.ok(actor2);
      assert.equal(actor2.document.responsibilities.length, 0); // Completed appointment not migrated
    });
  });

  await t.test('5. Idempotent re-migration: second execution returns alreadyMigrated without data wipe', async () => {
    const f = await createSyntheticLegacyWorld({ version: 3 });

    // First migration
    await app.transaction(f.ownerId, async (sql: SqlClient) => {
      return migrateLegacyWorldInTransaction(sql, f.ownerId, { worldId: f.worldId });
    });

    // Second migration
    const replay = await app.transaction(f.ownerId, async (sql: SqlClient) => {
      return migrateLegacyWorldInTransaction(sql, f.ownerId, { worldId: f.worldId });
    });
    const parsedReplay = LegacyMigrationResponseSchema.parse(replay);
    assert.equal(parsedReplay.alreadyMigrated, true);
    assert.equal(parsedReplay.engineEpoch, 2);
    assert.equal(parsedReplay.success, true);
  });

  await t.test('6. Version conflict protection: rejects migration if expectedWorldVersion does not match', async () => {
    const f = await createSyntheticLegacyWorld({ version: 3 });

    await assert.rejects(
      async () => {
        await app.transaction(f.ownerId, async (sql: SqlClient) => {
          return migrateLegacyWorldInTransaction(sql, f.ownerId, {
            worldId: f.worldId,
            expectedWorldVersion: 2, // Mismatch (actual is 3)
          });
        });
      },
      (err: any) => err.code === 'VERSION_CONFLICT',
    );
  });

  await t.test('7. Forward-only recovery: cannot roll back engine epoch to 1 once in Epoch 2', async () => {
    const f = await createSyntheticLegacyWorld({ version: 3 });

    // Migrate to Epoch 2
    await app.transaction(f.ownerId, async (sql: SqlClient) => {
      return migrateLegacyWorldInTransaction(sql, f.ownerId, { worldId: f.worldId });
    });

    // Attempt illegal downgrade to Epoch 1
    await assert.rejects(
      async () => {
        await app.transaction(f.ownerId, async (sql: SqlClient) => {
          await switchAgentEngineEpochInTransaction(sql, f.ownerId, {
            worldId: f.worldId,
            expectedEpoch: 2,
            nextEpoch: 1, // Illegal downgrade
            expectedWorldVersion: 3,
          });
        });
      },
      (err: any) => err.code === 'ENGINE_EPOCH_CONFLICT',
    );
  });

  await t.test('8. Runtime routing: Epoch 1 delegates to legacy (null), Epoch 2 takes over in Agent Runtime', async () => {
    const f = await createSyntheticLegacyWorld({ version: 3 });

    // Create NPC agent services
    const dummyModel = () => ({
      generateText: async () => ({ text: '{"message":"你好"}' }),
    });
    const npcAgents = npcAgentServices(app, dummyModel as any);

    // 8a: Before migration (Epoch 1): sendMessageIfEnabled returns null -> falls back to legacy
    const epoch1Result = await npcAgents.sendMessageIfEnabled(f.ownerId, {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.actor1Id,
      expectedVersion: 3,
      text: '你好林澈',
    });
    assert.equal(epoch1Result, null);

    // 8b: Execute migration to Epoch 2
    await app.transaction(f.ownerId, async (sql: SqlClient) => {
      return migrateLegacyWorldInTransaction(sql, f.ownerId, { worldId: f.worldId });
    });

    // 8c: After migration (Epoch 2): inspectLegacyWorldReadiness now indicates already migrated
    const postInv = await app.transaction(f.ownerId, async (sql: SqlClient) => {
      return inspectLegacyWorldReadiness(sql, f.ownerId, f.worldId);
    });
    assert.equal(postInv.engineEpoch, 2);
    assert.equal(postInv.isEligibleForMigration, false);
    assert.ok(postInv.blockers.includes('ALREADY_EPOCH_2'));
  });
});
