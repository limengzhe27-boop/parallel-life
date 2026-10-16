import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  authorizeWorldCommandInTransaction,
  PLAYER_WORLD_COMMAND_KINDS,
} from '../../src/modules/world/infrastructure/world-command-uow.ts';

test('actual player world command gate stays separate from NPC and worker execution', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.WORLD_COMMAND_UOW_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await worker.close();
    await admin.end();
  });
  async function fixture(epoch2 = true) {
    const owner = randomUUID(),
      foreign = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    await new IdentityRepository(db).ensureGuest(foreign);
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [
        worldId,
        owner,
        'Player gate fixture',
        {
          id: worldId,
          ownerId: owner,
          version: 0,
          title: 'Player gate fixture',
          time: '2026-10-15T07:00:00.000Z',
          actors: [{ id: actorId, name: 'A', persona: 'Fictional' }],
          messages: [],
          facts: [],
          appointments: [],
          mediaRequests: [],
        },
      ],
    );
    if (epoch2)
      await db.transaction(owner, async (sql) => {
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId, actorId }, 'authored:fixture', 0),
        );
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        });
      });
    return { owner, foreign, worldId, actorId };
  }
  function command(
    f: { worldId: string },
    kind: (typeof PLAYER_WORLD_COMMAND_KINDS)[number] = 'note_save',
  ) {
    return { worldId: f.worldId, expectedWorldVersion: 0, commandId: randomUUID(), kind };
  }
  await t.test(
    'every listed player command uses the same scoped epoch but creates no AgentAttempt',
    async () => {
      const f = await fixture();
      for (const kind of PLAYER_WORLD_COMMAND_KINDS)
        await db.transaction(f.owner, async (sql) => {
          assert.deepEqual(
            await authorizeWorldCommandInTransaction(sql, f.owner, command(f, kind)),
            { engineEpoch: 2, worldVersion: 0 },
          );
          const s = (
            await sql.query(
              "SELECT current_setting('app.agent_world_id',true) AS world,current_setting('app.agent_engine_epoch',true) AS epoch,current_setting('app.agent_commit_attempt_id',true) AS attempt",
            )
          ).rows[0];
          assert.equal(s.world, f.worldId);
          assert.equal(s.epoch, '2');
          assert(!s.attempt);
        });
      for (const table of ['agent_attempts', 'agent_input_receipts', 'agent_action_results'])
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`,
              [f.worldId],
            )
          ).rows[0].n,
          0,
        );
    },
  );
  await t.test(
    'epoch1 remains compatible without creating control rows or updating world versions',
    async () => {
      const f = await fixture(false);
      await db.transaction(f.owner, async (sql) => {
        assert.deepEqual(
          await authorizeWorldCommandInTransaction(sql, f.owner, command(f, 'clock_control')),
          { engineEpoch: 1, worldVersion: 0 },
        );
        await sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
          f.worldId,
          'Actual player edit',
        ]);
      });
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].version,
        0,
      );
    },
  );
  await t.test(
    'epoch2 authorized writes work only inside the same transaction and are rolled back together',
    async () => {
      const f = await fixture();
      await assert.rejects(
        () =>
          db.transaction(f.owner, async (sql) => {
            await authorizeWorldCommandInTransaction(sql, f.owner, command(f));
            await sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
              f.worldId,
              'Must roll back',
            ]);
            throw Error('FAIL_AFTER_WRITE');
          }),
        /FAIL_AFTER_WRITE/,
      );
      assert.equal(
        (await admin.query('SELECT title FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].title,
        'Player gate fixture',
      );
      await db.transaction(f.owner, async (sql) => {
        await authorizeWorldCommandInTransaction(sql, f.owner, command(f));
        await sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
          f.worldId,
          'Accepted edit',
        ]);
      });
      await assert.rejects(
        () =>
          db.transaction(f.owner, (sql) =>
            sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
              f.worldId,
              'Unauthorized old writer',
            ]),
          ),
        /ENGINE_EPOCH_CONFLICT/,
      );
    },
  );
  await t.test(
    'another world cannot reuse the transaction settings of the authorized world',
    async () => {
      const a = await fixture(),
        b = await fixture();
      // Keep one real owner for both worlds, rather than relying on RLS rejection for this check.
      await admin.query(
        "INSERT INTO parallel_life.worlds(id,owner_id,title,state) SELECT $1,$2,title,jsonb_set(jsonb_set(state,'{id}',to_jsonb($1::text)),'{ownerId}',to_jsonb($2::text)) FROM parallel_life.worlds WHERE id=$3",
        [randomUUID(), a.owner, b.worldId],
      );
      const other = (
        await admin.query('SELECT id FROM parallel_life.worlds WHERE owner_id=$1 AND id<>$2', [
          a.owner,
          a.worldId,
        ])
      ).rows[0].id;
      await db.transaction(a.owner, async (sql) => {
        await initializeActorAgentStateInTransaction(
          sql,
          a.owner,
          emptyActorAgentState({ worldId: other, actorId: b.actorId }, 'authored:other', 0),
        );
        await switchAgentEngineEpochInTransaction(sql, a.owner, {
          worldId: other,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        });
      });
      await assert.rejects(
        () =>
          db.transaction(a.owner, async (sql) => {
            await authorizeWorldCommandInTransaction(sql, a.owner, command(a));
            await sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
              other,
              'Wrong world',
            ]);
          }),
        /ENGINE_EPOCH_CONFLICT/,
      );
    },
  );
  await t.test(
    'wrong owner, forged transaction owner and stale expected version are rejected',
    async () => {
      const f = await fixture();
      await assert.rejects(
        () =>
          db.transaction(f.foreign, (sql) =>
            authorizeWorldCommandInTransaction(sql, f.foreign, command(f)),
          ),
        /NOT_FOUND/,
      );
      await assert.rejects(
        () =>
          db.transaction(f.foreign, (sql) =>
            authorizeWorldCommandInTransaction(sql, f.owner, command(f)),
          ),
        /NOT_FOUND/,
      );
      await assert.rejects(
        () =>
          db.transaction(f.owner, (sql) =>
            authorizeWorldCommandInTransaction(sql, f.owner, {
              ...command(f),
              expectedWorldVersion: 1,
            }),
          ),
        /VERSION_CONFLICT/,
      );
    },
  );
  await t.test(
    'NPC, director, unknown or malformed command shapes never acquire player authority',
    async () => {
      const f = await fixture();
      for (const kind of [
        'npc_reply',
        'director',
        'agent_action',
        'note_save; DROP TABLE worlds',
        '',
      ])
        await assert.rejects(
          () =>
            db.transaction(f.owner, (sql) =>
              authorizeWorldCommandInTransaction(sql, f.owner, { ...command(f), kind } as any),
            ),
          /INVALID_COMMAND/,
        );
      await assert.rejects(
        () =>
          db.transaction(f.owner, (sql) =>
            authorizeWorldCommandInTransaction(sql, f.owner, {
              ...command(f),
              expectedWorldVersion: -1,
            }),
          ),
        /INVALID_COMMAND/,
      );
      await assert.rejects(
        () =>
          db.transaction(f.owner, (sql) =>
            authorizeWorldCommandInTransaction(sql, f.owner, {
              ...command(f),
              agentAttemptId: 'spoofed',
            } as any),
          ),
        /INVALID_COMMAND/,
      );
    },
  );
  await t.test('worker role cannot turn a task or app.user_id into a player command', async () => {
    const f = await fixture();
    await assert.rejects(
      () =>
        worker.transaction(f.owner, async (sql) => {
          await sql.query("SELECT set_config('app.task_id',$1,true)", [randomUUID()]);
          await authorizeWorldCommandInTransaction(sql, f.owner, command(f, 'clock_control'));
        }),
      /NOT_FOUND/,
    );
  });
  await t.test(
    'an existing NPC commit transaction cannot be repurposed as a player command gate',
    async () => {
      const f = await fixture();
      await assert.rejects(
        () =>
          db.transaction(f.owner, async (sql) => {
            await sql.query(
              "SELECT set_config('app.agent_commit_attempt_id','actual_npc_attempt',true)",
            );
            await authorizeWorldCommandInTransaction(sql, f.owner, command(f));
          }),
        { code: 'INVALID_COMMAND' },
      );
    },
  );
  await t.test(
    'an autocommit connection cannot carry authorization into a later world write',
    async () => {
      const f = await fixture(),
        sql = await db.pool.connect();
      try {
        await sql.query("SELECT set_config('app.user_id',$1,false)", [f.owner]);
        await assert.rejects(
          () => authorizeWorldCommandInTransaction(sql, f.owner, command(f)),
          /explicit player command transaction/,
        );
        await assert.rejects(
          () =>
            sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
              f.worldId,
              'Autocommit writer',
            ]),
          /ENGINE_EPOCH_CONFLICT/,
        );
      } finally {
        await sql.query('RESET ALL');
        sql.release();
      }
    },
  );
  await t.test(
    'world/control locks serialize an engine cutover with the actual player command',
    async () => {
      const f = await fixture();
      let release!: () => void, entered!: () => void;
      const inside = new Promise<void>((r) => {
          entered = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const player = db.transaction(f.owner, async (sql) => {
        await authorizeWorldCommandInTransaction(sql, f.owner, command(f));
        entered();
        await gate;
        await sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
          f.worldId,
          'Before cutover',
        ]);
      });
      await inside;
      let switched = false;
      const switching = db
        .transaction(f.owner, (sql) =>
          switchAgentEngineEpochInTransaction(sql, f.owner, {
            worldId: f.worldId,
            expectedEpoch: 2,
            nextEpoch: 3,
            expectedWorldVersion: 0,
          }),
        )
        .then(() => {
          switched = true;
        });
      assert.equal(switched, false);
      release();
      await Promise.all([player, switching]);
      await db.transaction(f.owner, async (sql) => {
        assert.equal(
          (await authorizeWorldCommandInTransaction(sql, f.owner, command(f))).engineEpoch,
          3,
        );
      });
    },
  );
});
