import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldAwarenessRepository } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { attachAgentWorldContext } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('own inventory is authoritative, actor scoped and never a new source permission', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.ACTOR_OWNED_ITEMS_TEST_PORT ?? 55628));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await admin.end();
  });
  const owner = randomUUID(),
    foreign = randomUUID(),
    worldId = randomUUID();
  await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [owner, foreign]);
  const audit = randomUUID();
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: 'inventory fixture',
    time: '2026-10-19T08:00:00.000Z',
    actors: [
      { id: 'a', name: 'A', persona: 'A' },
      { id: 'b', name: 'B', persona: 'B' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
    items: [
      { id: 'held', title: 'Held', holderActorId: 'a', status: 'held', sourceEventId: audit },
      { id: 'legacy', title: 'Legacy', holderActorId: 'a', sourceEventId: audit },
      { id: 'used', title: 'Used', holderActorId: 'a', status: 'used', sourceEventId: audit },
      {
        id: 'consumed',
        title: 'Consumed',
        holderActorId: 'a',
        status: 'consumed',
        sourceEventId: audit,
      },
      { id: 'other', title: 'Other', holderActorId: 'b', sourceEventId: audit },
      { id: 'player', title: 'Player', holderActorId: 'player', sourceEventId: audit },
      { id: 'no-source', title: 'Unproven', holderActorId: 'a', sourceEventId: '' },
    ],
  };
  await admin.query(
    'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
    [worldId, owner, world.title, world],
  );
  const repo = new PostgresWorldAwarenessRepository(app);
  function snapshot(actorId: string): AgentSnapshot {
    const state = emptyActorAgentState({ worldId, actorId }, 'fixture', 0);
    return {
      state,
      viewState: state,
      redactedStateIds: [],
      worldVersion: 0,
      storyAt: world.time,
      actor: { name: actorId, persona: 'fixture', boundaries: '', definitionRef: 'fixture' },
      sources: [],
      observations: [],
      channel: {
        kind: 'private',
        threadId: actorId,
        audienceActorIds: [actorId],
        allowedCapabilities: [],
      },
      input: { sourceId: 'fixture', text: 'hello', origin: 'player' },
    };
  }
  await t.test(
    'holder filter preserves legacy held and used, excludes consumed and unproven',
    async () => {
      const context = await repo.readActorAwareness(owner, worldId, 'a');
      assert.deepEqual(
        context.ownedItems.map((i) => [i.id, i.status]),
        [
          ['held', 'held'],
          ['legacy', 'held'],
          ['used', 'used'],
        ],
      );
      assert.ok(context.ownedItems.every((i) => i.sourceEventId === audit));
      const attached = await attachAgentWorldContext(app, owner, snapshot('a'));
      assert.deepEqual(attached.worldContext?.ownedItems, context.ownedItems);
      assert.ok(attached.channel.allowedCapabilities.includes('item.deliver'));
      assert.ok(attached.channel.allowedCapabilities.includes('item.use'));
      assert.equal(
        attached.sources.some((s) => s.recordId === audit || s.id === audit),
        false,
      );
      assert.equal(
        attached.observations.some((o) => o.text.includes('Unproven') || o.text.includes('Other')),
        false,
      );
    },
  );
  await t.test(
    'other actor sees only own items; foreign owner and absent actor cannot read',
    async () => {
      assert.deepEqual(
        (await repo.readActorAwareness(owner, worldId, 'b')).ownedItems.map((i) => i.id),
        ['other'],
      );
      await assert.rejects(repo.readActorAwareness(foreign, worldId, 'a'), /NOT_FOUND/);
      await assert.rejects(repo.readActorAwareness(owner, worldId, 'missing'), /NOT_FOUND/);
    },
  );
  await t.test(
    'missing inventory grants no item actions, and late revision cannot enter an older snapshot',
    async () => {
      await admin.query("UPDATE parallel_life.worlds SET state=state-'items' WHERE id=$1", [
        worldId,
      ]);
      const attached = await attachAgentWorldContext(app, owner, snapshot('a'));
      assert.deepEqual(attached.worldContext?.ownedItems, []);
      assert.equal(attached.channel.allowedCapabilities.includes('item.deliver'), false);
      assert.equal(attached.channel.allowedCapabilities.includes('item.use'), false);
      await assert.rejects(
        attachAgentWorldContext(app, owner, { ...snapshot('a'), worldVersion: 1 }),
        /VERSION_CONFLICT/,
      );
    },
  );
});
