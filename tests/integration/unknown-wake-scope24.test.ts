import { setTimeout as delay } from 'node:timers/promises';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

test('expired unknown wake fences its own cause while independent work continues', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const ownedWorlds: string[] = [];
  t.after(async () => {
    try {
      if (ownedWorlds.length)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=ANY($1::text[])',
          [ownedWorlds],
        );
    } finally {
      await db.close();
      await admin.end();
    }
  });
  const worlds = new PostgresWorldRepository(db);
  const now = Date.now() - 235_000;
  t.mock.timers.enable({ apis: ['Date'], now });
  async function fixture(failFirst = false) {
    const owner = randomUUID(),
      id = randomUUID();
    const actors = [randomUUID(), randomUUID()];
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Unknown wake scope fixture',
      time: new Date(now).toISOString(),
      actors: actors.map((actorId, index) => ({
        id: actorId,
        name: index ? '乙' : '甲',
        persona: index ? '独立、直率，愿意表达心情。' : '温和、关心朋友，有自己的生活。',
      })),
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    ownedWorlds.push(id);
    await db.transaction(owner, async (sql) => {
      for (const actorId of actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId: id, actorId }, agentDefinitionRef(world, actorId), 0),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
    });
    await new PostgresClockStore(db).write(owner, id, {
      storyNow: world.time,
      speed: 0,
      paused: false,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const calls: string[] = [];
    let directorCalls = 0;
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.promptVersion?.startsWith('director-')) {
          directorCalls++;
          return JSON.stringify({
            protocol: 'director-wire-v14',
            openingContext: null,
            authoredChoices: {},
            candidates: p.wireCatalog.candidates.map((c: { ref: string }) => ({
              candidateRef: c.ref,
              decision: 'defer',
              reason: '没有额外协调需求。',
            })),
            opportunities: [],
            audit: { reason: '无关人物可自行交流。', sourceRefs: [] },
          });
        }
        const actorId = p.replyAs.actorId as string;
        calls.push(actorId);
        assert.equal((p.state.goals ?? []).length, 0);
        assert.equal((p.state.plans ?? []).length, 0);
        assert.equal(p.input.origin, 'wake');
        assert.equal(JSON.parse(p.input.text).source, 'actor_local');
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename='pl_app' AND state='idle in transaction'",
            )
          ).rows[0].n,
          0,
          'model does not hold a database transaction',
        );
        if (failFirst && calls.length === 1) throw Error('CONTROLLED_UNKNOWN_AFTER_SEND');
        const text =
          actorId === actors[0]
            ? `我今天心情不错，想和你分享。第${calls.filter((a) => a === actorId).length}轮`
            : `想到你最近的忙碌，想问问你还好吗。第${calls.filter((a) => a === actorId).length}轮`;
        return JSON.stringify({
          protocol: 'npc-wire-v16',
          statements: [{ text, dependsOnActionIds: [] }],
          executions: [],
          changes: null,
        });
      },
    };
    const service = npcAgentAdvanceServices(
      db,
      () => model,
      new PostgresDirectorSnapshotRepository(db),
      { maxActors: 1, maxModelCalls: 4, maxSteps: 4 },
    );
    return { owner, id, actors, calls, service, directorCalls: () => directorCalls };
  }
  const f = await fixture(true);
  await f.service
    .advanceIfEnabled(f.owner, f.id)
    .catch((e) => assert.match(e.message, /CONTROLLED_UNKNOWN_AFTER_SEND/));
  assert.equal(f.calls.length, 1, 'initial batch issues only A');
  assert.equal((await worlds.get({ userId: f.owner }, f.id)).messages.length, 0);
  const unknownActor = f.calls[0]!;
  assert.ok(unknownActor);
  const readUnknown = async () =>
    (
      await admin.query(
        `SELECT a.*,r.document receipt_document FROM parallel_life.agent_attempts a
     JOIN parallel_life.agent_input_receipts r ON r.id=a.input_receipt_id
     WHERE a.world_id=$1 AND a.actor_id=$2 AND a.status='unknown_after_send'`,
        [f.id, unknownActor],
      )
    ).rows;
  assert.equal((await readUnknown()).length, 1);
  // Let the originally issued short remaining lease expire; do not mutate protected identity.
  const expiry = (
    await admin.query(
      `SELECT greatest(0,extract(epoch FROM (lease_until-clock_timestamp()))*1000)::float8 ms
     FROM parallel_life.agent_attempts WHERE id=$1`,
      [(await readUnknown())[0].id],
    )
  ).rows[0].ms;
  await delay(Math.ceil(expiry) + 20);
  t.mock.timers.setTime(now + 240_100);
  const original = (await readUnknown())[0];
  // One independent append moves the world beyond the original accepted input.
  await worlds.saveNote(
    { userId: f.owner },
    {
      commandId: randomUUID(),
      worldId: f.id,
      expectedVersion: 0,
      title: 'Independent player note',
      text: 'A note does not resolve the unknown NPC request.',
    },
  );
  await f.service.advanceIfEnabled(f.owner, f.id);
  assert.equal(f.calls.filter((a) => a === unknownActor).length, 1);
  assert.equal(new Set(f.calls).size, 2, 'the other actor can still present independent work');
  const world = await worlds.get({ userId: f.owner }, f.id);
  assert.equal(world.messages.filter((m) => m.role === 'assistant').length, 1);
  assert.notEqual(world.messages.find((m) => m.role === 'assistant')!.actorId, unknownActor);
  for (let i = 0; i < 2; i++) await f.service.advanceIfEnabled(f.owner, f.id);
  assert.equal(
    f.calls.filter((a) => a === unknownActor).length,
    1,
    'expired unknown is never repurchased',
  );
  assert.deepEqual(
    await readUnknown(),
    [original],
    'unknown attempt and immutable receipt are untouched',
  );
  assert.deepEqual((await worlds.get({ userId: f.owner }, f.id)).messages, world.messages);
  await new PostgresClockStore(db).setClock(f.owner, f.id, { paused: true });
});
