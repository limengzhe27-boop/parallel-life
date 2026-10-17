import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { migrateLegacyWorldInTransaction } from '../../src/modules/world/infrastructure/legacy-world-migration.ts';
import { readDirectorBootstrapCauseInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { initializeNewAgentWorld } from '../../src/modules/world/infrastructure/new-agent-world.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
test('unified engine: continuation preserves world and invitation distinctions; no opening replay; new genesis initialized atomically', async () => {
  const cfg = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  try {
    for (const version of [0, 4]) {
      const owner = randomUUID(),
        id = randomUUID(),
        actorId = randomUUID();
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
      const state = {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version,
        title: '合成迁移',
        time: '2026-10-18T01:00:00.000Z',
        actors: [{ id: actorId, name: '合成甲', persona: '谨慎的伙伴', relationship: '朋友' }],
        facts: [],
        messages: [],
        mediaRequests: [],
        appointments: [
          {
            id: 'pending',
            actorId,
            title: '待回应',
            status: 'proposed',
            at: '2026-10-18T03:00:00.000Z',
          },
          {
            id: 'confirmed',
            actorId,
            title: '已约定',
            status: 'confirmed',
            at: '2026-10-18T04:00:00.000Z',
          },
          {
            id: 'cancelled',
            actorId,
            title: '已取消',
            status: 'cancelled',
            at: '2026-10-18T02:00:00.000Z',
          },
        ],
      } as unknown as WorldState;
      await app.transaction(owner, async (sql) => {
        await sql.query(
          'INSERT INTO parallel_life.worlds(id,owner_id,title,version,state) VALUES($1,$2,$3,$4,$5)',
          [id, owner, state.title, version, state],
        );
        await sql.query(
          'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
          [id, owner, { ...state, version: 0 }, {}],
        );
      });
      if (version === 0) {
        await app.transaction(owner, (sql) => initializeNewAgentWorld(sql, state));
        const x = (
          await admin.query(
            'SELECT kind FROM parallel_life.agent_narrative_admissions WHERE world_id=$1',
            [id],
          )
        ).rows[0];
        assert.equal(x.kind, 'new_genesis');
        continue;
      }
      const before = (await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [id]))
        .rows[0].state;
      const result = await app.transaction(owner, (sql) =>
        migrateLegacyWorldInTransaction(sql, owner, { worldId: id, expectedWorldVersion: version }),
      );
      assert.equal(result.engineEpoch, 2);
      const after = (
        await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [id])
      ).rows[0];
      assert.deepEqual(after.state, before);
      assert.equal(after.version, version);
      const actor = (
        await admin.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
          [id],
        )
      ).rows[0].document;
      assert.equal(actor.definitionRef, agentDefinitionRef(state, actorId));
      assert.equal(actor.responsibilities.length, 2);
      assert.equal(
        actor.responsibilities.find((r: any) => r.subject.id === 'pending').status,
        'waiting',
      );
      assert.equal(
        actor.responsibilities.find((r: any) => r.subject.id === 'pending').nextCheck.length,
        0,
      );
      assert.equal(
        await app.transaction(owner, (sql) =>
          readDirectorBootstrapCauseInTransaction(sql, owner, {
            worldId: id,
            engineEpoch: 2,
            worldVersion: version,
          }),
        ),
        null,
      );
      const replay = await app.transaction(owner, (sql) =>
        migrateLegacyWorldInTransaction(sql, owner, { worldId: id }),
      );
      assert.equal(replay.alreadyMigrated, true);
    }
  } finally {
    await app.close();
    await admin.end();
  }
});
