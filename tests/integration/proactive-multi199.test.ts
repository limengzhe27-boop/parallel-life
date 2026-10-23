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

test('199 original advance persists independent task-free contact, stable windows and actor-scoped unknown', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55660, 'isolated local synthetic cluster only');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db);
  const now = Math.ceil(Date.now() / 60_000) * 60_000;
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
      title: '199 controlled contact fixture',
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
    });
    await new PostgresClockStore(db).setClock(owner, id, { paused: false, speed: 0 });
    const calls: string[] = [];
    let directorCalls = 0;
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.promptVersion.startsWith('director-')) {
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
        const actorId = p.state.actorId as string;
        calls.push(actorId);
        assert.equal(p.state.goals.length, 0);
        assert.equal(p.state.plans.length, 0);
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
          protocol: 'npc-wire-v15',
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
      { maxActors: 2, maxModelCalls: 4, maxSteps: 4 },
    );
    return { owner, id, actors, calls, service, directorCalls: () => directorCalls };
  }
  await t.test(
    'one batch executes two task-free actors, refresh consumes nothing, next real window continues',
    async () => {
      const f = await fixture();
      await f.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(f.calls.length, 2);
      assert.equal(f.directorCalls(), 0, 'independent contact requires no prior director approval');
      assert.equal(new Set(f.calls).size, 2);
      let world = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(world.messages.filter((m) => m.role === 'assistant').length, 2);
      const firstIds = world.messages.map((m) => m.id);
      await f.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(f.calls.length, 2, 'same minute cannot buy the same independent work twice');
      assert.deepEqual(
        (await worlds.get({ userId: f.owner }, f.id)).messages.map((m) => m.id),
        firstIds,
      );
      t.mock.timers.setTime(now + 60_000);
      await f.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(f.calls.length, 4);
      world = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(world.messages.filter((m) => m.role === 'assistant').length, 4);
      assert.equal(new Set(world.messages.map((m) => m.id)).size, world.messages.length);
      assert.equal(
        f.directorCalls(),
        1,
        'one existing no-candidate director review, not a new approval per contact',
      );
      await f.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(f.calls.length, 4);
      assert.equal(f.directorCalls(), 1, 'repeated refresh does not repurchase the quiet review');
      const attempts = await admin.query(
        "SELECT count(*)::int n FROM parallel_life.agent_attempts WHERE world_id=$1 AND status='committed'",
        [f.id],
      );
      assert.equal(
        attempts.rows[0].n,
        4,
        'four paid-attempt identities match four committed NPC messages',
      );
    },
  );
  await t.test(
    'unknown belongs to one actor, another persists contact without retrying the unknown',
    async () => {
      const f = await fixture(true);
      await f.service
        .advanceIfEnabled(f.owner, f.id)
        .catch((e) => assert.match(e.message, /CONTROLLED_UNKNOWN_AFTER_SEND/));
      const unknownActor = f.calls[0]!;
      await f.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(f.calls.filter((a) => a === unknownActor).length, 1);
      assert.equal(new Set(f.calls).size, 2);
      const world = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(world.messages.filter((m) => m.role === 'assistant').length, 1);
      assert.notEqual(world.messages.find((m) => m.role === 'assistant')!.actorId, unknownActor);
      const unknown = await admin.query(
        "SELECT count(*)::int n FROM parallel_life.agent_attempts WHERE world_id=$1 AND actor_id=$2 AND status='unknown_after_send'",
        [f.id, unknownActor],
      );
      assert.equal(unknown.rows[0].n, 1);
      await f.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(f.calls.length, 2);
    },
  );
});
