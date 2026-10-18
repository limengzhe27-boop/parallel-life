import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresSchedulerRepository } from '../../src/modules/world/infrastructure/scheduler-repository.ts';

test('daily scheduler claims at most two due worlds across owners without leaking private tables', async (t) => {
  const admin = await adminClient('parallel_life_test');
  t.after(() => admin.end().catch(() => {}));
  await migrate(admin);
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.WORLD_SCHEDULER_TEST_PORT ?? 55505));
  await admin.query('DELETE FROM parallel_life.world_scheduler_claims'); // Dedicated local fixture budget only.
  await admin.query(`ALTER ROLE pl_scheduler PASSWORD '${config.schedulerPassword}'`);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const schedulerUrl = `postgresql://pl_scheduler:${config.schedulerPassword}@127.0.0.1:${config.port}/parallel_life_test`;
  const scheduler = new PostgresSchedulerRepository(schedulerUrl);
  const limited = new pg.Client(schedulerUrl);
  const worlds = new PostgresWorldRepository(app);
  const clock = new PostgresClockStore(app);
  const old = '2000-01-01T00:00:00.000Z';
  const ids = Array.from({ length: 5 }, () => ({ ownerId: randomUUID(), worldId: randomUUID() }));
  try {
    for (const [index, item] of ids.entries()) {
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [item.ownerId]);
      await worlds.initialize(
        { userId: item.ownerId },
        {
          schemaVersion: 1,
          id: item.worldId,
          ownerId: item.ownerId,
          version: 0,
          title: '调度验收',
          time: old,
          actors: [{ id: randomUUID(), name: '朋友', persona: '有自己的生活' }],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
        },
      );
      const anchor = await clock.read(item.ownerId, item.worldId);
      await clock.write(item.ownerId, item.worldId, { ...anchor, lastTickAt: old });
      await admin.query(
        "UPDATE parallel_life.world_clock SET continuity_mode='continuous' WHERE world_id=$1",
        [item.worldId],
      );
      if (index === 2)
        await admin.query(
          "UPDATE parallel_life.world_clock SET continuity_mode='presence',managed=true,active_until=now()-interval '1 minute' WHERE world_id=$1",
          [item.worldId],
        );
      if (index === 4) {
        const state = await worlds.get({ userId: item.ownerId }, item.worldId);
        const actorId = state.actors[0]!.id;
        await app.transaction(item.ownerId, async (sql) => {
          await initializeActorAgentStateInTransaction(
            sql,
            item.ownerId,
            emptyActorAgentState(
              { worldId: item.worldId, actorId },
              agentDefinitionRef(state, actorId),
              0,
            ),
          );
          await switchAgentEngineEpochInTransaction(sql, item.ownerId, {
            worldId: item.worldId,
            expectedEpoch: 1,
            nextEpoch: 2,
            expectedWorldVersion: 0,
          });
        });
        const service = npcAgentServices(app, () => ({
          async complete() {
            throw Error('fixture interrupted after send');
          },
        }));
        await assert.rejects(
          service.sendMessageIfEnabled(item.ownerId, {
            id: randomUUID(),
            worldId: item.worldId,
            actorId,
            expectedVersion: 0,
            text: 'Synthetic unknown, never retry',
          }),
        );
        assert.equal(
          (
            await admin.query('SELECT status FROM parallel_life.agent_attempts WHERE world_id=$1', [
              item.worldId,
            ])
          ).rows[0].status,
          'unknown_after_send',
        );
      }
      if (index === 3) await clock.setClock(item.ownerId, item.worldId, { paused: true });
    }
    await limited.connect();
    await assert.rejects(
      limited.query('SELECT state FROM parallel_life.worlds'),
      /permission denied/,
    );
    const batches = await Promise.all([scheduler.claimDue(), scheduler.claimDue()]);
    const all = batches.flat();
    assert.equal(all.length, 2);
    assert.equal(new Set(all.map((item) => item.worldId)).size, 2);
    assert.ok(
      all.every((item) =>
        ids.some((known) => known.worldId === item.worldId && known.ownerId === item.ownerId),
      ),
    );
    assert.equal(
      all.some((item) => [ids[2]!, ids[4]!].some((excluded) => excluded.worldId === item.worldId)),
      false,
    );
    assert.equal(
      all.some((item) => item.worldId === ids[3]!.worldId),
      false,
    );
    assert.deepEqual(await scheduler.claimDue(), []);
  } finally {
    await limited.end().catch(() => {});
    await scheduler.close();
    await app.close();
    for (const item of ids) {
      await admin.query('DELETE FROM parallel_life.agent_runtime_worlds WHERE world_id=$1', [
        item.worldId,
      ]);
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [item.ownerId]);
    }
    await admin.end();
  }
});
