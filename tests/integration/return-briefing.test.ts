import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';

test('a resumed absence creates exactly one pending return briefing', async (t) => {
  const cfg = await localConfig();
  const port = process.env.RETURN_BRIEFING_TEST_PORT ?? '55503';
  assert.match(port, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(port) <= 65535);
  assert.equal(cfg.port, Number(port), 'return briefing test requires its assigned local test port');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close().catch(() => {});
    await admin.end().catch(() => {});
  });
  const owner = randomUUID(),
    worldId = randomUUID();
  const at = (seconds: number) =>
    new Date(Date.parse('2026-10-15T00:00:00Z') + seconds * 1000).toISOString();
  await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
  const worlds = new PostgresWorldRepository(db);
  await worlds.initialize(
    { userId: owner },
    {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '回访补演测试',
      time: at(0),
      actors: [],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
  );
  await admin.query(
    `INSERT INTO parallel_life.world_clock(
       world_id,owner_id,story_now,last_tick_at,speed,paused,missed_beats,summary,managed,active_until,continuity_mode,pause_reason,last_present_at
     ) VALUES($1,$2,$3,$4,3,true,0,NULL,true,NULL,'continuous','idle',$4)`,
    [worldId, owner, at(0), at(-300)],
  );
  const activity = new PostgresClockActivityRepository(db);
  const clientId = randomUUID();
  const first = await activity.update(
    owner,
    worldId,
    { clientId, sequence: 0, mode: 'browsing', resume: true },
    at(1),
  );
  assert.equal(first.returnBriefing?.status, 'pending');
  assert.equal(first.paused, true);
  const briefingId = first.returnBriefing!.id;
  const second = await activity.update(
    owner,
    worldId,
    { clientId, sequence: 1, mode: 'browsing', resume: true },
    at(2),
  );
  assert.equal(second.returnBriefing?.id, briefingId);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int n FROM parallel_life.world_return_briefings WHERE world_id=$1',
        [worldId],
      )
    ).rows[0].n,
    1,
  );
  // The pending briefing owns the clock; an unrelated heartbeat cannot resume it.
  assert.equal(second.paused, true);
});
