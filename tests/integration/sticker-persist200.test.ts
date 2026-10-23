import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const START_AT = '2026-10-20T08:00:00.000Z';

async function fixture() {
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clocks = new PostgresClockStore(db);
  const owner = randomUUID();
  const worldId = randomUUID();
  const actorA = randomUUID();
  const actorB = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: '44-170 version concurrency fixture',
    time: START_AT,
    actors: [
      { id: actorA, name: '甲', persona: '有自己的安排。' },
      { id: actorB, name: '乙', persona: '独立生活。' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  await worlds.initialize({ userId: owner }, world);
  await db.transaction(owner, async (sql) => {
    for (const actorId of [actorA, actorB])
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(world, actorId), 0),
      );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
  });
  await clocks.write(owner, worldId, {
    storyNow: START_AT,
    speed: 0,
    paused: false,
    lastTickAt: new Date().toISOString(),
    missedBeats: 0,
    summary: null,
  });
  return {
    admin,
    db,
    worlds,
    owner,
    worldId,
    actorA,
    actorB,
    close: async () => {
      await db.close();
      await admin.end();
    },
  };
}

const statements = [
  { text: '我把具体安排写在这里，先不要急。', dependsOnActionIds: [] },
  { text: '一起努力', stickerId: 'zan', dependsOnActionIds: [] },
  { text: '', stickerId: 'jiayou', dependsOnActionIds: [] },
  { text: '好的', stickerId: 'not_real', dependsOnActionIds: [] },
];
test('44-200 real PG: sticker marker, mixed/pure/invalid decoration persist and replay once', async (t) => {
  const f = await fixture();
  t.after(f.close);
  let calls = 0;
  let payload: any;
  const api = npcAgentServices(f.db, () => ({
    async complete(messages: any[]) {
      calls++;
      payload = JSON.parse(messages[1].content);
      return JSON.stringify({
        protocol: 'npc-wire-v15',
        statements,
        executions: [],
        changes: null,
      });
    },
  }));
  const cmd = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: '[[sticker:zan]]',
  };
  const receipt = await api.sendMessageIfEnabled(f.owner, cmd);
  assert.equal(receipt?.status, 'committed', JSON.stringify(receipt));
  const w = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(w.messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(w.messages.find((m) => m.role === 'user')?.text, '[[sticker:zan]]');
  const replies = w.messages.filter((m) => m.role === 'assistant');
  assert.equal(replies.length, 4);
  assert.equal(replies[0]?.text, statements[0]!.text);
  assert.equal(replies[1]?.stickerId, 'zan');
  assert.equal(replies[1]?.text, '一起努力');
  assert.equal(replies[2]?.stickerId, 'jiayou');
  assert.equal(replies[3]?.stickerId, undefined);
  assert.equal(replies[3]?.text, '好的');
  assert.match(JSON.stringify(payload), /欣赏|称赞/);
  await api.sendMessageIfEnabled(f.owner, cmd);
  assert.equal(calls, 1);
  const replay = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.deepEqual(replay.messages, w.messages);
});
test('44-200 real PG: stream and final do not duplicate sticker units', async (t) => {
  const f = await fixture();
  t.after(f.close);
  let calls = 0;
  const segments: any[] = [];
  const api = npcAgentServices(f.db, () => ({
    async complete() {
      throw Error('unexpected complete');
    },
    async *streamComplete() {
      calls++;
      yield '{"protocol":"npc-wire-v15","statements":[';
      for (let i = 0; i < statements.length; i++)
        yield (i ? ',' : '') + JSON.stringify(statements[i]);
      yield '],"executions":[],"changes":null}';
    },
  }));
  const cmd = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: '给我一点鼓励',
  };
  const receipt = await api.sendMessageIfEnabled(f.owner, cmd, {
    onSegment: (s) => {
      segments.push(s);
    },
  });
  assert.equal(receipt?.status, 'committed', JSON.stringify(receipt));
  const w = await f.worlds.get({ userId: f.owner }, f.worldId);
  const replies = w.messages.filter((m) => m.role === 'assistant');
  assert.equal(replies.length, 4);
  assert.equal(new Set(replies.map((m) => m.id)).size, 4);
  assert.equal(w.messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(replies.filter((m) => m.stickerId === 'jiayou').length, 1);
  assert.equal(replies.filter((m) => m.text === '好的').length, 1);
  await api.sendMessageIfEnabled(f.owner, cmd, {
    onSegment: (s) => {
      segments.push(s);
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual((await f.worlds.get({ userId: f.owner }, f.worldId)).messages, w.messages);
});
