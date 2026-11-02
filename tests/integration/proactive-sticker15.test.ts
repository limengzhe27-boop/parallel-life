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

import { readOwnAgendaReviewEvidenceInTransaction } from '../../src/modules/world/infrastructure/own-agenda-review-repository.ts';

test('retired sticker projection remains authenticated for own agenda; altered text still fails', async (t) => {
  const f = await fixture();
  t.after(f.close);
  let calls = 0;
  const api = npcAgentServices(f.db, () => ({
    async complete() {
      calls++;
      return JSON.stringify({
        protocol: 'npc-wire-v15',
        statements: [{ text: '', stickerId: 'jiayou', dependsOnActionIds: [] }],
        executions: [],
        changes: null,
      });
    },
  }));
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: '请鼓励一下',
  };
  assert.equal((await api.sendMessageIfEnabled(f.owner, command))?.status, 'committed');
  const read = () =>
    f.db.transaction(f.owner, (sql) =>
      readOwnAgendaReviewEvidenceInTransaction(sql, f.owner, {
        worldId: f.worldId,
        actorId: f.actorA,
        engineEpoch: 2,
        definitionRef: agentDefinitionRef(
          { id: f.worldId, actors: [{ id: f.actorA, name: '甲', persona: '有自己的安排。' }] },
          f.actorA,
        ),
      }),
    );
  const before = await read();
  assert.ok(before.anchor);
  const events = (
    await f.admin.query(
      'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
      [f.worldId],
    )
  ).rows;
  await f.admin.query(
    'UPDATE parallel_life.world_messages SET document=parallel_life.retire_text_sticker(document) WHERE world_id=$1',
    [f.worldId],
  );
  const after = await read();
  assert.deepEqual(after, before);
  assert.deepEqual(
    (
      await f.admin.query(
        'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
        [f.worldId],
      )
    ).rows,
    events,
  );
  await f.admin.query(
    `UPDATE parallel_life.world_messages SET document=jsonb_set(document,'{text}','"篡改"'::jsonb) WHERE world_id=$1 AND document->>'role'='assistant'`,
    [f.worldId],
  );
  await assert.rejects(read, {
    code: 'INVALID_OWN_AGENDA_REVIEW_EVIDENCE',
    reason: 'committed_source',
  });
  assert.equal(calls, 1);
});
