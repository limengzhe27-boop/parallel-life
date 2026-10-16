import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { readLocationReportAudience } from '../../src/modules/world/infrastructure/location-report-audience.ts';
import type { AgentInputReceipt } from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('location report audience uses actual historical group commands and receipts', async (t) => {
  const config = await localConfig();
  const expected = Number(process.env.LOCATION_REPORT_AUDIENCE_TEST_PORT ?? 55509);
  assert(Number.isSafeInteger(expected) && expected >= 1024 && expected <= 65535);
  assert.equal(config.port, expected, 'only this explicitly assigned loopback test cluster');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    worldId = randomUUID(),
    a = randomUUID(),
    b = randomUUID(),
    late = randomUUID();
  t.after(async () => {
    try {
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    } finally {
      await db.close();
      await admin.end();
    }
  });
  await new IdentityRepository(db).ensureGuest(owner);
  const worlds = new PostgresWorldRepository(db),
    groups = new PostgresGroupRepository(db),
    runtime = new PostgresAgentRuntimeRepository(db),
    tasks = new TaskRepository(db);
  const initial: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: 'Audience synthetic fixture',
    time: new Date().toISOString(),
    actors: [
      { id: a, name: '甲', persona: '独立' },
      { id: b, name: '乙', persona: '独立' },
      { id: late, name: '丙', persona: '独立' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  await worlds.initialize({ userId: owner }, initial);
  const created = await groups.create(owner, {
    worldId,
    commandId: randomUUID(),
    expectedVersion: 0,
    title: '原话可见性',
    actorIds: [a, b],
  });
  const commandId = randomUUID(),
    text = '我说我在咖啡馆。';
  const sent = await groups.send(owner, {
    worldId,
    groupId: created.groupId,
    commandId,
    expectedVersion: created.version,
    text,
  });
  await tasks.cancel(owner, sent.task!.id);
  const event = (
    await admin.query(
      'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND command_id=$2',
      [worldId, commandId],
    )
  ).rows[0].payload;
  const input: AgentInputReceipt = {
    id: randomUUID(),
    worldId,
    commandId,
    inputHash: createHash('sha256').update(text).digest('hex'),
    channel: 'group',
    threadId: created.groupId,
    recipientActorId: null,
    expectedWorldVersion: sent.version,
    origin: 'player',
    text,
    receivedAt: new Date().toISOString(),
    storyAt: event.storyAt,
  };
  await runtime.accept(owner, input);
  const read = async (value = input, responder = a) => {
    const world = await worlds.get({ userId: owner }, worldId);
    return db.transaction(owner, (sql) =>
      readLocationReportAudience(sql, owner, world, value, responder),
    );
  };
  await t.test('actual original group player message grants only original members', async () => {
    assert.deepEqual(new Set((await read())!.actorIds), new Set([a, b]));
  });
  const joined = await groups.membership(owner, {
    worldId,
    groupId: created.groupId,
    commandId: randomUUID(),
    expectedVersion: sent.version,
    participant: { kind: 'actor', actorId: late },
    action: 'join',
  });
  const left = await groups.membership(owner, {
    worldId,
    groupId: created.groupId,
    commandId: randomUUID(),
    expectedVersion: joined.version,
    participant: { kind: 'actor', actorId: b },
    action: 'leave',
  });
  assert(left.version > input.expectedWorldVersion);
  await t.test(
    'late join receives no old report; original departed member retains historical audience',
    async () => {
      assert.deepEqual(new Set((await read())!.actorIds), new Set([a, b]));
      assert.deepEqual(new Set((await read(input, b))!.actorIds), new Set([a, b]));
      await assert.rejects(read(input, late), /AUDIENCE_FORBIDDEN/);
    },
  );
  await t.test(
    'receipt tampering does not borrow existing group or command authority',
    async () => {
      for (const patch of [
        { text: '我在另一个地方' },
        { threadId: randomUUID() },
        { commandId: randomUUID() },
        { expectedWorldVersion: input.expectedWorldVersion + 1 },
        { storyAt: '2020-01-01T00:00:00Z' },
        { channel: 'private' as const },
      ])
        await assert.rejects(read({ ...input, ...patch }), /AUDIENCE_FORBIDDEN/);
    },
  );
  await t.test('independently accepted private input never gets shared audience', async () => {
    const privateInput: AgentInputReceipt = {
      ...input,
      id: randomUUID(),
      commandId: randomUUID(),
      channel: 'private',
      threadId: a,
      recipientActorId: a,
      expectedWorldVersion: left.version,
    };
    await runtime.accept(owner, privateInput);
    assert.equal(await read(privateInput), undefined);
  });
});
