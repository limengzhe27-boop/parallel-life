import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolveTurn } from '../src/modules/world/application/resolve-turn.ts';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import type { WorldState, WorldEvent } from '../src/modules/world/domain/types.ts';
import { PostgresCharacterVisualAnchorRepository } from '../src/modules/media/infrastructure/character-reference-resolver.ts';
import { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import { localConfig } from '../scripts/local-config.mjs';
import pg from 'pg';

import { MemoryWorldRepository } from '../src/modules/world/infrastructure/memory-world-repository.ts';

test('resolveTurn attaches targetActorId to media.requested effect', async () => {
  const actorId = randomUUID();
  const worldId = randomUUID();
  const ownerId = randomUUID();
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId,
    version: 0,
    title: '留影测试世界',
    time: '2026-10-18T12:00:00.000Z',
    actors: [{ id: actorId, name: '苏念', relationship: '好友', persona: '知性好友' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };

  const command = {
    id: randomUUID(),
    worldId,
    actorId,
    text: '发张自拍给我看看吧！',
    expectedVersion: 0,
  };

  const planner = {
    async prepareContext(context: any) {
      return context;
    },
    async propose() {
      return {
        schemaVersion: 1 as const,
        effects: [
          {
            type: 'message.received' as const,
            id: 'msg_reply',
            actorId,
            text: '好的，刚拍了一张！',
          },
        ],
      };
    },
  };

  const worlds = new MemoryWorldRepository([world]);
  const result = await resolveTurn(
    {
      worlds,
      planner,
      now: () => '2026-10-18T12:00:05.000Z',
      newId: randomUUID,
    },
    { userId: ownerId },
    command,
  );

  const mediaEffect = result.event.data.effects.find((e: any) => e.type === 'media.requested') as any;
  assert.ok(mediaEffect, 'media.requested effect must be created');
  assert.equal(mediaEffect.targetActorId, actorId, 'targetActorId must match the target character');
  assert.equal(mediaEffect.mediaType, 'image');
});

test('applyEvent preserves targetActorId in state.mediaRequests and outbox jobs', () => {
  const actorId = randomUUID();
  const worldId = randomUUID();
  const commandId = randomUUID();
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: randomUUID(),
    version: 0,
    title: '留影测试世界',
    time: '2026-10-18T12:00:00.000Z',
    actors: [{ id: actorId, name: '苏念', relationship: '好友', persona: '知性好友' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };

  const eventId = randomUUID();
  const reqId = randomUUID();
  const event: WorldEvent = {
    schemaVersion: 1,
    id: eventId,
    commandId,
    worldId,
    version: 1,
    occurredAt: '2026-10-18T12:00:05.000Z',
    type: 'turn.resolved',
    data: {
      actorId,
      userText: '发张自拍',
      effects: [
        {
          type: 'message.received',
          id: randomUUID(),
          actorId,
          text: '好的呀',
        },
        {
          type: 'media.requested',
          id: reqId,
          prompt: '苏念在书店微笑自拍',
          mediaType: 'image',
          targetActorId: actorId,
        },
      ],
    },
  };

  const { state: nextState, jobs } = applyEvent(world, event);

  // 1. Stored in mediaRequests
  const req = nextState.mediaRequests.find((r) => r.id === reqId);
  assert.ok(req);
  assert.equal(req.targetActorId, actorId);
  assert.equal(req.status, 'pending');

  // 2. Included in outbox job payload
  const job = jobs.find((j: any) => j.requestId === reqId) as any;
  assert.ok(job);
  assert.equal(job.targetActorId, actorId);
  assert.equal(job.type, 'image.generate');
});

test('PostgresCharacterVisualAnchorRepository resolves bound assets or falls back gracefully', async () => {
  const config = await localConfig();
  const admin = new pg.Client({
    host: '127.0.0.1',
    port: config.port,
    user: 'pl_admin',
    password: config.adminPassword,
    database: 'parallel_life_test',
  });
  await admin.connect();

  const ownerId = randomUUID();
  const worldId = randomUUID();
  const personId = randomUUID();
  const boundActorId = randomUUID();
  const fallbackActorId = randomUUID();
  const foreignActorId = randomUUID();
  const assetId = randomUUID();

  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );

  try {
    // 1. Provision account and world
    await admin.query(`INSERT INTO parallel_life.accounts (id) VALUES ($1)`, [ownerId]);
    await admin.query(
      `INSERT INTO parallel_life.worlds (id, owner_id, title, state)
       VALUES ($1, $2, '测试留影世界', $3::jsonb)`,
      [
        worldId,
        ownerId,
        JSON.stringify({
          schemaVersion: 1,
          id: worldId,
          ownerId,
          version: 1,
          title: '测试留影世界',
          time: '2026-10-18T12:00:00.000Z',
          actors: [
            { id: boundActorId, name: '已绑定人物', gender: 'female', age: 24 },
            { id: fallbackActorId, name: '未绑定人物', gender: 'male', age: 28 },
          ],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
        }),
      ],
    );

    // 2. Insert profile & asset & binding for boundActorId
    await admin.query(
      `INSERT INTO parallel_life.profiles (id, owner_id, version, document)
       VALUES ($1, $2, 1, $3::jsonb)`,
      [
        randomUUID(),
        ownerId,
        JSON.stringify({
          people: [{ id: personId, name: '已绑定人物', assetId }],
        }),
      ],
    );

    await admin.query(
      `INSERT INTO parallel_life.assets (id, owner_id, world_id, storage_key, mime_type, byte_length, width, height, origin, status, revision)
       VALUES ($1, $2, NULL, 'test.webp', 'image/webp', 1000, 512, 512, 'upload', 'ready', 1)`,
      [assetId, ownerId],
    );

    await admin.query(
      `INSERT INTO parallel_life.world_person_bindings (world_id, owner_id, person_id, actor_id, person_snapshot, asset_id, asset_revision)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1)`,
      [
        worldId,
        ownerId,
        personId,
        boundActorId,
        JSON.stringify({ id: personId, name: '已绑定人物', gender: 'female', age: 24 }),
        assetId,
      ],
    );

    const repo = new PostgresCharacterVisualAnchorRepository(admin);

    // A. Bound actor returns referenceAssetId
    const boundAnchor = await repo.findActorVisualAnchor(worldId, boundActorId, ownerId);
    assert.ok(boundAnchor);
    assert.equal(boundAnchor.referenceAssetId, assetId);
    assert.equal(boundAnchor.authorizedForWorld, true);
    assert.equal(boundAnchor.name, '已绑定人物');

    // B. Fallback actor (in world state but no binding) returns anchor without referenceAssetId (graceful text-anchored degradation)
    const fallbackAnchor = await repo.findActorVisualAnchor(worldId, fallbackActorId, ownerId);
    assert.ok(fallbackAnchor);
    assert.equal(fallbackAnchor.referenceAssetId, undefined);
    assert.equal(fallbackAnchor.authorizedForWorld, true);
    assert.equal(fallbackAnchor.name, '未绑定人物');

    // C. Foreign actor returns null
    const foreignAnchor = await repo.findActorVisualAnchor(worldId, foreignActorId, ownerId);
    assert.equal(foreignAnchor, null);

    // D. Player visual anchor falls back to world exists
    const playerAnchor = await repo.findPlayerVisualAnchor(worldId, ownerId);
    assert.ok(playerAnchor);
    assert.equal(playerAnchor.isPlayer, true);
    assert.equal(playerAnchor.authorizedForWorld, true);
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
    await db.close();
  }
});
