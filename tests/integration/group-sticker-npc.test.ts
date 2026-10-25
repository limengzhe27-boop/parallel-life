import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresGroupRepository,
  groupReplyEvent,
  persistGroupEvent,
} from '../../src/modules/world/infrastructure/group-repository.ts';

const time = '2026-10-09T09:00:00.000Z';

async function fixture() {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const groups = new PostgresGroupRepository(db, () => time);
  const owner = randomUUID();
  const id = randomUUID();
  const a = randomUUID();
  const b = randomUUID();
  await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
  await worlds.initialize(
    { userId: owner },
    {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: '周末试拍小组',
      time,
      actors: [
        { id: a, name: '小陈', persona: '摄影搭档' },
        { id: b, name: '小林', persona: '录音朋友' },
      ],
      facts: [
        {
          id: 'public',
          text: '三个人约好周末去江边试拍。',
          kind: 'canonical',
          visibility: { kind: 'world' },
          sourceEventId: 'genesis:' + id,
        },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
  );
  const receipt = await groups.create(owner, {
    worldId: id,
    commandId: randomUUID(),
    expectedVersion: 0,
    title: '周末试拍小组',
    actorIds: [a, b],
  });
  return { admin, db, worlds, groups, owner, id, a, b, groupId: receipt.groupId };
}

test('epoch-2 group sticker replies need the runtime epoch and persist as separate messages', async () => {
  const f = await fixture();
  try {
    await f.admin.query(
      'INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES($1,$2,2)',
      [f.id, f.owner],
    );
    const world = await f.worlds.get({ userId: f.owner }, f.id);
    const replies = [
      { actorId: f.a, text: '周六下午可以。', stickerId: 'xswl' },
      { actorId: f.b, text: '', stickerId: 'wole' },
    ];
    const sql = f.admin as unknown as Parameters<typeof persistGroupEvent>[0];

    const rejected = groupReplyEvent(f.owner, world, randomUUID(), f.groupId, replies, time);
    await f.admin.query('BEGIN');
    await assert.rejects(
      persistGroupEvent(sql, world, rejected, 'sticker-reply-rejected'),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, '23514');
        assert.match(String(error.message), /ENGINE_EPOCH_CONFLICT/);
        return true;
      },
    );
    await f.admin.query('ROLLBACK');

    const accepted = groupReplyEvent(f.owner, world, randomUUID(), f.groupId, replies, time);
    await f.admin.query('BEGIN');
    await f.admin.query(
      "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch','2',true)",
      [f.id],
    );
    await persistGroupEvent(sql, world, accepted, 'sticker-reply-accepted');
    await f.admin.query('COMMIT');

    const read = await f.groups.read(f.owner, f.id, f.groupId);
    assert.deepEqual(
      read.messages.map((m) => [m.sender.kind === 'actor' ? m.sender.actorId : 'player', m.text]),
      [
        [f.a, '周六下午可以。'],
        [f.a, '[[sticker:xswl]]'],
        [f.b, '[[sticker:wole]]'],
      ],
    );
    assert.equal(read.version, world.version + 1);
  } finally {
    await f.db.close();
    await f.admin.end();
  }
});

test('epoch-1 group sticker replies keep working without a runtime row', async () => {
  const f = await fixture();
  try {
    const world = await f.worlds.get({ userId: f.owner }, f.id);
    const event = groupReplyEvent(
      f.owner,
      world,
      randomUUID(),
      f.groupId,
      [{ actorId: f.a, text: '', stickerId: 'wole' }],
      time,
    );
    const sql = f.admin as unknown as Parameters<typeof persistGroupEvent>[0];
    await f.admin.query('BEGIN');
    await persistGroupEvent(sql, world, event, 'sticker-reply-epoch-1');
    await f.admin.query('COMMIT');
    const read = await f.groups.read(f.owner, f.id, f.groupId);
    assert.deepEqual(
      read.messages.map((m) => m.text),
      ['[[sticker:wole]]'],
    );
  } finally {
    await f.db.close();
    await f.admin.end();
  }
});
