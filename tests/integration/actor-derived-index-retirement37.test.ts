import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';

// Dedicated synthetic database only; never reads or changes a player world.
test('0122 retains seed foreign keys and accepts compact/new or empty-index/legacy genesis', async () => {
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  try {
    await migrate(admin);
    const unique = await admin.query(`SELECT conname FROM pg_constraint
      WHERE conrelid='parallel_life.approved_seeds'::regclass AND contype='u'
      AND conkey=(SELECT conkey FROM pg_constraint
        WHERE conrelid='parallel_life.approved_seeds'::regclass AND conname='seed_owner_unique')`);
    assert.deepEqual(unique.rows, [{ conname: 'seed_owner_unique' }]);
    const foreignKeys = await admin.query(`SELECT c.conname,i.relname AS index_name
      FROM pg_constraint c JOIN pg_class i ON i.oid=c.conindid
      WHERE c.contype='f' AND c.confrelid='parallel_life.approved_seeds'::regclass`);
    assert.ok(foreignKeys.rows.length > 0);
    assert.equal(
      foreignKeys.rows.some((r) => r.index_name === 'seed_id_owner_unique'),
      false,
    );

    for (const legacy of [false, true]) {
      const ownerId = randomUUID(),
        id = randomUUID(),
        actorId = randomUUID();
      const world = {
        schemaVersion: 1,
        id,
        ownerId,
        version: 0,
        title: 'Compact state genesis',
        time: '2026-11-03T00:00:00.000Z',
        actors: [{ id: actorId, name: 'Synthetic actor', persona: 'Careful and independent' }],
        messages: [],
        facts: [],
        appointments: [],
        mediaRequests: [],
      };
      const state = emptyActorAgentState(
        { worldId: id, actorId },
        agentDefinitionRef(world, actorId),
        0,
      );
      if (legacy) Object.assign(state, { memoryIds: [], relationshipIds: [] });
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [ownerId]);
      await admin.query(
        "INSERT INTO parallel_life.worlds(id,owner_id,state,title) VALUES($1,$2,$3,'Compact state genesis')",
        [id, ownerId, world],
      );
      await admin.query(
        `INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed)
        VALUES($1,$2,$3,'{}')`,
        [id, ownerId, world],
      );
      await assert.rejects(
        db.transaction(ownerId, async (sql) => {
          await sql.query('SELECT parallel_life.initialize_built_agent_world($1,$2)', [
            id,
            JSON.stringify([{ ...state, memoryIds: ['unverified-memory'] }]),
          ]);
        }),
        /INVALID_INITIAL_AGENT/,
      );
      await db.transaction(ownerId, async (sql) => {
        await sql.query('SELECT parallel_life.initialize_built_agent_world($1,$2)', [
          id,
          JSON.stringify([state]),
        ]);
        const saved = (
          await sql.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
            [id],
          )
        ).rows[0].document;
        assert.equal(Object.hasOwn(saved, 'memoryIds'), false);
        assert.equal(Object.hasOwn(saved, 'relationshipIds'), false);
        assert.equal(saved.revision, 0);
        assert.deepEqual(saved.knowledgeSourceIds, []);
        // Genesis retry is idempotent, with no duplicate cast or state reset.
        await sql.query('SELECT parallel_life.initialize_built_agent_world($1,$2)', [
          id,
          JSON.stringify([state]),
        ]);
        assert.equal(
          (
            await sql.query(
              'SELECT count(*)::int n FROM parallel_life.actor_agent_states WHERE world_id=$1',
              [id],
            )
          ).rows[0].n,
          1,
        );
      });
    }

    // Exercise the migration's dependent-FK branch even on installations where all
    // original foreign keys happened to bind the earlier unique index. Everything
    // below is rolled back; no test modifies another test's persistent schema.
    await admin.query('BEGIN');
    try {
      const q = (name: string) => '"' + name.replaceAll('"', '""') + '"';
      const readFks = () =>
        admin.query(`SELECT n.nspname ns,r.relname rel,c.conname name,
          pg_get_constraintdef(c.oid) definition
        FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE c.contype='f' AND c.confrelid='parallel_life.approved_seeds'::regclass
          AND c.conindid=(SELECT conindid FROM pg_constraint
            WHERE conrelid='parallel_life.approved_seeds'::regclass AND conname='seed_owner_unique')
        ORDER BY c.conname`);
      const before = (await readFks()).rows;
      assert.ok(before.length > 0);
      for (const fk of before)
        await admin.query(`ALTER TABLE ${q(fk.ns)}.${q(fk.rel)} DROP CONSTRAINT ${q(fk.name)}`);
      await admin.query(
        'ALTER TABLE parallel_life.approved_seeds DROP CONSTRAINT seed_owner_unique',
      );
      await admin.query(
        'ALTER TABLE parallel_life.approved_seeds ADD CONSTRAINT seed_id_owner_unique UNIQUE(id,owner_id)',
      );
      for (const fk of before)
        await admin.query(
          `ALTER TABLE ${q(fk.ns)}.${q(fk.rel)} ADD CONSTRAINT ${q(fk.name)} ${fk.definition}`,
        );
      await admin.query(
        'ALTER TABLE parallel_life.approved_seeds ADD CONSTRAINT seed_owner_unique UNIQUE(id,owner_id)',
      );
      const countBefore = (
        await admin.query('SELECT count(*) n FROM parallel_life.actor_agent_states')
      ).rows;
      await admin.query(
        await readFile(
          new URL('../../db/migrations/0122_retire_actor_indexes.sql', import.meta.url),
          'utf8',
        ),
      );
      assert.deepEqual((await readFks()).rows, before);
      assert.deepEqual(
        (await admin.query('SELECT count(*) n FROM parallel_life.actor_agent_states')).rows,
        countBefore,
      );
    } finally {
      await admin.query('ROLLBACK');
    }
  } finally {
    await db.close();
    await admin.end();
  }
});
