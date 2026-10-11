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
import { createWorldMatter } from '../../src/modules/world/domain/matters.ts';
import type { WorldState, WorldEvent } from '../../src/modules/world/domain/types.ts';

test('real PostgreSQL persistence, versioning, and player-records projection of matters', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    'postgresql://pl_app:' + c.appPassword + '@127.0.0.1:' + c.port + '/parallel_life_test',
  );
  const identity = new IdentityRepository(db);
  const owner = randomUUID();
  const other = randomUUID();
  try {
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);

  const worldRepo = new PostgresWorldRepository(db);
  const recordsRepo = new PostgresPlayerRecords(db);
  const worldId = randomUUID();
  const now = '2026-10-11T12:00:00.000Z';

  const initialWorld: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: '演艺之路',
    time: now,
    actors: [{ id: 'actor_director', name: '陈导', persona: '电影导演' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
    matters: [],
  };

  await worldRepo.initialize({ userId: owner }, initialWorld);

  await t.test('matters persist atomically through turn events in real PostgreSQL', async () => {
    const matter1 = createWorldMatter({
      id: 'matter_audition_pass',
      worldId,
      span: 'near_term',
      title: '前往1号影棚拿试镜剧本',
      description: '跟陈导当面打听试镜具体要求。',
      source: {
        kind: 'director_proposal',
        eventId: 'evt_m1',
        eventVersion: 1,
        at: now,
      },
      now,
    });

    const pursuit1 = createWorldMatter({
      id: 'matter_become_lead',
      worldId,
      span: 'pursuit',
      title: '争取院线电影主角',
      description: '完成试镜并通过两轮选角复试。',
      source: {
        kind: 'director_proposal',
        eventId: 'evt_m1',
        eventVersion: 1,
        at: now,
      },
      now,
    });

    const cmdId1 = randomUUID();
    const command1 = {
      id: cmdId1,
      worldId,
      expectedVersion: 0,
      actorId: 'actor_director',
      text: '陈导，我想拿试镜剧本。',
      origin: 'director' as const,
    };
    const event1: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: cmdId1,
      version: 1,
      type: 'turn.resolved',
      occurredAt: now,
      storyAt: now,
      data: {
        actorId: 'actor_director',
        userText: '陈导，我想拿试镜剧本。',
        origin: 'director',
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: 'actor_director',
            text: '剧本在影棚桌上，你拿去看吧。',
          },
          {
            type: 'matter.created',
            id: 'eff_m1',
            matter: matter1,
          },
          {
            type: 'matter.created',
            id: 'eff_p1',
            matter: pursuit1,
          },
        ],
      },
    };

    const result1 = await worldRepo.commit({ userId: owner }, command1, event1);
    assert.equal(result1.state.version, 1);

    // Read back through player-records projection from real database
    const records1 = await recordsRepo.read(owner, worldId);
    assert.equal(records1.worldVersion, 1);

    // Near-term matter should appear in current
    const currentNear = records1.current.find((r) => r.id.includes('matter_audition_pass'));
    assert.ok(currentNear);
    assert.equal(currentNear!.title, '前往1号影棚拿试镜剧本');
    assert.equal(currentNear!.state, 'in_progress');
    assert.equal(currentNear!.assertion, 'actor_statement');

    // Pursuit should appear in about
    const aboutPursuit = records1.about.find((r) => r.id.includes('matter_become_lead'));
    assert.ok(aboutPursuit);
    assert.equal(aboutPursuit!.title, '争取院线电影主角');
    assert.equal(aboutPursuit!.stateLabel, '长期追求');

    // Cross-owner cannot read records
    await assert.rejects(recordsRepo.read(other, worldId), { code: 'NOT_FOUND' });
  });

  await t.test('matters transition and reflect in history upon completion in real PostgreSQL', async () => {
    const cmdId2 = randomUUID();
    const command2 = {
      id: cmdId2,
      worldId,
      expectedVersion: 1,
      actorId: 'actor_director',
      text: '陈导，我已经拿到了剧本并通读了一遍。',
      origin: 'director' as const,
    };
    const event2: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: cmdId2,
      version: 2,
      type: 'turn.resolved',
      occurredAt: '2026-10-11T12:30:00.000Z',
      storyAt: '2026-10-11T12:30:00.000Z',
      data: {
        actorId: 'actor_director',
        userText: '陈导，我已经拿到了剧本并通读了一遍。',
        origin: 'director',
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: 'actor_director',
            text: '很好，准备得很充分。',
          },
          {
            type: 'matter.updated',
            id: 'eff_m1_complete',
            matterId: 'matter_audition_pass',
            status: 'completed',
            evidence: {
              kind: 'world_event',
              reason: '已拿到剧本并通读完成',
              eventId: 'evt_m2',
              eventVersion: 2,
              at: '2026-10-11T12:30:00.000Z',
            },
          },
        ],
      },
    };

    const result2 = await worldRepo.commit({ userId: owner }, command2, event2);
    assert.equal(result2.state.version, 2);

    const records2 = await recordsRepo.read(owner, worldId);
    assert.equal(records2.worldVersion, 2);

    // Completed matter moves to history!
    const inCurrent = records2.current.some((r) => r.id.includes('matter_audition_pass'));
    assert.equal(inCurrent, false);

    const inHistory = records2.history.find((r) => r.id.includes('matter_audition_pass'));
    assert.ok(inHistory);
    assert.equal(inHistory!.state, 'completed');
    assert.equal(inHistory!.stateLabel, '已达成');
    assert.equal(inHistory!.assertion, 'world_verified');
  });

  await t.test('idempotent replay returns same receipt without duplicating matters', async () => {
    const cmdId3 = randomUUID();
    const command3 = {
      id: cmdId3,
      worldId,
      expectedVersion: 2,
      actorId: 'actor_director',
      text: '谢谢陈导。',
      origin: 'director' as const,
    };
    const event3: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: cmdId3,
      version: 3,
      type: 'turn.resolved',
      occurredAt: '2026-10-11T13:00:00.000Z',
      storyAt: '2026-10-11T13:00:00.000Z',
      data: {
        actorId: 'actor_director',
        userText: '谢谢陈导。',
        origin: 'director',
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId: 'actor_director',
            text: '明天继续努力。',
          },
        ],
      },
    };

    const first = await worldRepo.commit({ userId: owner }, command3, event3);
    const replay = await worldRepo.commit({ userId: owner }, command3, event3);

    assert.equal(first.state.version, replay.state.version);
    assert.equal(first.state.matters?.length, replay.state.matters?.length);
  });
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await db.close();
    await admin.end();
  }
});
