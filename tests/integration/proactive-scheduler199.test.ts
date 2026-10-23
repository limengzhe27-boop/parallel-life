import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresSchedulerRepository } from '../../src/modules/world/infrastructure/scheduler-repository.ts';
import { runProactiveScheduler } from '../../src/modules/world/application/run-proactive-scheduler.ts';

test('real PG: 100 due worlds, bounded drain, lease fairness and cooldown without global six-row cap', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, 55659);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const repo = new PostgresSchedulerRepository(
    `postgresql://pl_scheduler:${config.schedulerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    ids: string[] = [];
  t.after(async () => {
    try {
      await admin.query('DELETE FROM parallel_life.world_proactive_leases WHERE owner_id=$1', [
        owner,
      ]);
      await admin.query('DELETE FROM parallel_life.world_clock WHERE owner_id=$1', [owner]);
      await admin.query('DELETE FROM parallel_life.agent_runtime_worlds WHERE owner_id=$1', [
        owner,
      ]);
      await admin.query('DELETE FROM parallel_life.worlds WHERE owner_id=$1', [owner]);
    } finally {
      await repo.close();
      await admin.end();
    }
  });
  // Dedicated test database: previous service fixtures are paused, preserving their audit records.
  await admin.query('UPDATE parallel_life.world_clock SET paused=true');
  await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
  for (let n = 0; n < 100; n++) {
    const id = randomUUID();
    ids.push(id);
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [
        id,
        owner,
        'Capacity fixture',
        {
          id,
          ownerId: owner,
          title: 'Capacity fixture',
          version: 0,
          time: new Date().toISOString(),
          actors: [],
          messages: [],
          facts: [],
          appointments: [],
          mediaRequests: [],
        },
      ],
    );
    await admin.query(
      'INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES($1,$2,2)',
      [id, owner],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now) VALUES($1,$2,now())',
      [id, owner],
    );
  }
  const seen = new Set<string>();
  let calls = 0;
  const started = Date.now();
  const advance = async (_owner: string, id: string) => {
    assert.equal(seen.has(id), false);
    seen.add(id);
    // Controlled two-actor execution workload. No claim that this benchmarks a paid model.
    calls += 2;
    return { played: 2 };
  };
  const first = await runProactiveScheduler(repo, advance);
  assert.equal(first.claimed, 50);
  const second = await runProactiveScheduler(repo, advance);
  assert.equal(second.claimed, 50);
  assert.equal(seen.size, 100);
  assert.equal(calls, 200);
  assert.equal((await repo.claimProactive()).length, 0);
  t.diagnostic(
    JSON.stringify({
      worlds: seen.size,
      controlledCalls: calls,
      ticks: 2,
      elapsedMs: Date.now() - started,
    }),
  );
  // 30-minute boundary is real SQL eligibility, separate from the 10-minute lease.
  await admin.query(
    "UPDATE parallel_life.world_proactive_leases SET last_started_at=now()-interval '29 minutes',lease_until=now()-interval '1 minute' WHERE world_id=$1",
    [ids[0]],
  );
  assert.equal((await repo.claimProactive()).length, 0);
  await admin.query(
    "UPDATE parallel_life.world_proactive_leases SET last_started_at=now()-interval '31 minutes' WHERE world_id=$1",
    [ids[0]],
  );
  const [a, b] = await Promise.all([repo.claimProactive(), repo.claimProactive()]);
  assert.equal(a.length + b.length, 1);
  assert.equal([...a, ...b][0]!.worldId, ids[0]);
  assert.equal(
    (
      await admin.query(
        "SELECT has_table_privilege('pl_scheduler','parallel_life.worlds','SELECT') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
});
