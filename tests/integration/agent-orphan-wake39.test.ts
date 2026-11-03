import { readUnclaimedWakeInTransaction } from '../../src/modules/world/infrastructure/agent-orphan-wake-recovery.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const ACTOR_A = '11111111-1111-4111-8111-111111111111',
  ACTOR_B = '22222222-2222-4222-8222-222222222222';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('unclaimed wake keeps original receipt and fences delayed or duplicate claim', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55684);
  const admin = await adminClient('parallel_life_test');
  assert.equal((await admin.query('SELECT inet_server_port() port')).rows[0].port, 55684);
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    store = new PostgresAgentRuntimeRepository(db);
  const fixtures: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    for (const f of fixtures) await clocks.setClock(f.owner, f.worldId, { paused: true });
    await db.close();
    await admin.end();
  });
  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic evidence fixture',
      time: '2026-10-19T00:00:00.000Z',
      actors: [
        { id: ACTOR_A, name: 'A', persona: 'Independent quiet planner' },
        { id: ACTOR_B, name: 'B', persona: 'Reserved shopkeeper', relationship: 'Acquaintance' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(sql, owner, {
          ...emptyActorAgentState({ worldId, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
          responsibilities:
            a.id === ACTOR_A
              ? [
                  {
                    id: 'own-duty',
                    subject: { kind: 'matter', id: 'own-duty' },
                    summary: 'Consider own arrangement',
                    status: 'open',
                    waitingOn: 'self',
                    sourceIds: [`definition:${agentDefinitionRef(world, a.id)}`],
                    nextCheck: [
                      {
                        kind: 'observation',
                        sourceId: `definition:${agentDefinitionRef(world, a.id)}`,
                      },
                    ],
                  },
                ]
              : [],
        });
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await clocks.write(owner, worldId, {
      storyNow: world.time,
      speed: 12,
      paused: false,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const identity = {
      worldId,
      engineEpoch: 2,
      actorId: ACTOR_A,
      definitionRef: agentDefinitionRef(world, ACTOR_A),
    };
    fixtures.push({ owner, worldId });
    return { owner, worldId, world, identity };
  }
  const f = await fixture();
  const source = `definition:${agentDefinitionRef(f.world, ACTOR_A)}`;
  const text = JSON.stringify({
    type: 'npc_own_condition_ready',
    candidateId: 'duty',
    source: 'responsibility',
    basisSourceIds: [source],
    nudges: [],
  });
  const commandId = randomUUID();
  const { receipt } = await store.accept(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    commandId,
    inputHash: hash(text),
    channel: 'private',
    threadId: ACTOR_A,
    recipientActorId: ACTOR_A,
    expectedWorldVersion: 0,
    receivedAt: new Date().toISOString(),
    storyAt: f.world.time,
    origin: 'wake',
    text,
  });
  const original = structuredClone(receipt);
  await worlds.saveNote(
    { userId: f.owner },
    {
      commandId: randomUUID(),
      worldId: f.worldId,
      title: 'Unrelated change',
      text: 'Preserved',
      expectedVersion: 0,
    },
  );
  const input = {
    worldId: f.worldId,
    actorId: ACTOR_A,
    commandId,
    candidateId: 'duty',
    worldVersion: 1,
    engineEpoch: 2,
    visibleSourceIds: [source],
    candidateSourceIds: [source],
    candidateSource: 'responsibility',
  };
  const read = () =>
    db.transaction(f.owner, (sql) => readUnclaimedWakeInTransaction(sql, f.owner, input));
  const [a, b] = await Promise.all([read(), read()]);
  assert.deepEqual(a, original);
  assert.deepEqual(b, original);
  await assert.rejects(
    db.transaction(f.owner, (sql) =>
      readUnclaimedWakeInTransaction(sql, f.owner, { ...input, actorId: ACTOR_B }),
    ),
    { code: 'INPUT_SCOPE_FORBIDDEN' },
  );
  await assert.rejects(
    db.transaction(f.owner, (sql) =>
      readUnclaimedWakeInTransaction(sql, f.owner, { ...input, visibleSourceIds: [] }),
    ),
    { code: 'INPUT_SCOPE_FORBIDDEN' },
  );
  await assert.rejects(
    db.transaction(f.owner, (sql) =>
      readUnclaimedWakeInTransaction(sql, f.owner, { ...input, candidateSourceIds: [] }),
    ),
    { code: 'INPUT_SCOPE_FORBIDDEN' },
  );
  await assert.rejects(
    db.transaction(f.owner, (sql) =>
      readUnclaimedWakeInTransaction(sql, f.owner, { ...input, actionId: 'new-action' }),
    ),
    { code: 'INPUT_SCOPE_FORBIDDEN' },
  );
  const attempt = () => ({
    id: randomUUID(),
    worldId: f.worldId,
    actorId: ACTOR_A,
    commandId,
    inputReceiptId: receipt.id,
    inputHash: receipt.inputHash,
    engineEpoch: 2,
    expectedWorldVersion: 1,
    expectedActorRevision: 0,
    token: randomUUID(),
    leaseUntil: new Date(Date.now() + 240000).toISOString(),
  });
  await assert.rejects(store.claim(f.owner, { ...attempt(), expectedWorldVersion: 0 }), {
    code: 'VERSION_CONFLICT',
  });
  const claims = await Promise.all([
    store.claim(f.owner, attempt()),
    store.claim(f.owner, attempt()),
  ]);
  assert.equal(claims.filter((c) => !c.replay).length, 1);
  assert.equal(claims[0].attempt.id, claims[1].attempt.id);
  assert.equal(await read(), null);
  await assert.rejects(store.claim(f.owner, { ...attempt(), expectedWorldVersion: 0 }), {
    code: 'COMMAND_CONFLICT',
  });
  const current = await worlds.get({ userId: f.owner }, f.worldId);
  const actor = await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_A });
  const snapshot = (
    await readPrivateAgentSnapshot(db, f.owner, current, ACTOR_A, receipt, current.time, actor)
  ).snapshot;
  const sent = await store.markRequestSentWithSources(f.owner, claims[0].attempt, snapshot);
  assert.equal(await read(), null);
  await store.mark(f.owner, sent, 'unknown_after_send');
  assert.equal(await read(), null);
  const replay = await store.claim(f.owner, attempt());
  assert.equal(replay.replay, true);
  assert.equal(replay.attempt.status, 'unknown_after_send');
  assert.deepEqual(
    (
      await admin.query('SELECT document FROM parallel_life.agent_input_receipts WHERE id=$1', [
        receipt.id,
      ])
    ).rows[0].document,
    original,
  );
  assert.equal(
    Number(
      (
        await admin.query('SELECT count(*) n FROM parallel_life.agent_attempts WHERE world_id=$1', [
          f.worldId,
        ])
      ).rows[0].n,
    ),
    1,
  );
});
