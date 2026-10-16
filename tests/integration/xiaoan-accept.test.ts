import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
test('XIAOAN-ACCEPT real PostgreSQL: director matter pipeline, replay, rollback and isolation', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const cfg = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const identity = new IdentityRepository(db),
    worlds = new PostgresWorldRepository(db),
    records = new PostgresPlayerRecords(db);
  const owner = randomUUID(),
    other = randomUUID(),
    worldId = randomUUID(),
    actor = randomUUID(),
    at = '2026-10-11T10:00:00.000Z';
  try {
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const initial: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '修车铺',
      time: at,
      actors: [{ id: actor, name: '小李', persona: '机械师' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, initial);
    let calls = 0;
    const deps = {
      worlds,
      now: () => at,
      newId: randomUUID,
      planner: {
        async propose() {
          calls++;
          return {
            schemaVersion: 1,
            effects: [
              {
                type: 'message.received',
                id: 'local_reply',
                actorId: actor,
                text: '先检查旧车轮胎，再决定需要什么配件。',
              },
              {
                type: 'matter.proposed',
                id: 'local_matter',
                span: 'near_term',
                title: '检查旧车轮胎',
                description: '先检查，再决定配件。',
                quote: '先检查旧车轮胎',
              },
            ],
          };
        },
      },
    };
    const command = {
      id: randomUUID(),
      worldId,
      expectedVersion: 0,
      actorId: actor,
      text: '承接已经说过的机会',
      origin: 'director' as const,
    };
    const committed = await resolveTurn(deps, { userId: owner }, command);
    assert.equal(calls, 1);
    assert.equal(committed.state.matters!.length, 1);
    const m = committed.state.matters![0]!;
    assert.equal(m.status, 'not_started');
    assert.ok('eventId' in m.source);
    assert.equal(m.source.eventId, committed.event.id);
    assert.equal(m.source.eventVersion, 1);
    assert.equal(m.assertion, 'actor_statement');
    const read = await records.read(owner, worldId),
      row = read.current.find((r) => r.kind === 'world_matter');
    assert.ok(row);
    assert.equal(row.state, 'not_started');
    assert.equal(row.navigation?.app, 'wechat');
    assert.deepEqual(await resolveTurn(deps, { userId: owner }, command), committed);
    assert.equal(calls, 1);
    await assert.rejects(records.read(other, worldId), { code: 'NOT_FOUND' });
    const badCommand = { ...command, id: randomUUID(), expectedVersion: 1 };
    await assert.rejects(
      resolveTurn(
        {
          ...deps,
          planner: {
            async propose() {
              return {
                schemaVersion: 1,
                effects: [
                  {
                    type: 'message.received',
                    id: 'reply_bad',
                    actorId: actor,
                    text: '我说它已完成。',
                  },
                  {
                    type: 'matter.updated',
                    id: 'bad',
                    matterId: m.id,
                    status: 'completed',
                    evidence: {
                      kind: 'world_event',
                      reason: '没有真实行动',
                      eventId: randomUUID(),
                      eventVersion: 2,
                      at,
                    },
                  },
                ],
              };
            },
          },
        },
        { userId: owner },
        badCommand,
      ),
      { code: 'INVALID_PROPOSAL' },
    );
    assert.equal((await worlds.get({ userId: owner }, worldId)).version, 1);
    assert.equal(
      (await records.read(owner, worldId)).current.find((r) => r.kind === 'world_matter')!.state,
      'not_started',
    );
    const repeat = { ...command, id: randomUUID(), expectedVersion: 1 };
    const repeated = await resolveTurn(deps, { userId: owner }, repeat);
    assert.equal(repeated.state.matters!.length, 1);
    assert.equal(repeated.state.matters![0]!.id, m.id);
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await db.close();
    await admin.end();
  }
});
