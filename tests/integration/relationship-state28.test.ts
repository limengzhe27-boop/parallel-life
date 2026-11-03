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
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

test('28 directional bond preserves both definitions and concurrent player conversation', async () => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  try {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID(),
      targetActorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '44-201 result reconsideration',
      time: new Date().toISOString(),
      actors: [
        {
          id: actorId,
          name: 'A',
          persona: 'An independent fictional shopkeeper',
          relationship: '玩家的同学',
        },
        {
          id: targetActorId,
          name: 'B',
          persona: 'Another fictional shopkeeper',
          relationship: '玩家的邻居',
        },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    const worlds = new PostgresWorldRepository(db);
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(world, actorId), 0),
      );
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState(
          { worldId, actorId: targetActorId },
          agentDefinitionRef(world, targetActorId),
          0,
        ),
      );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });

    const store = new PostgresAgentRuntimeRepository(db);
    let signalStarted!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const model: TextModel = {
      async complete(messages) {
        calls++;
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.input.text === 'B concurrent input') {
          signalStarted();
          await gate;
        }
        const source = p.wireCatalog.inputSourceRef;
        return JSON.stringify({
          protocol: 'npc-wire-v16',
          statements: [{ text: '收到，保留我的立场。', dependsOnActionIds: [] }],
          executions:
            p.input.text === 'A bonds B'
              ? [
                  {
                    ref: 'bond',
                    goal: { kind: 'new', summary: '记录我与另一人物的关系', sourceIds: [source] },
                    plan: { summary: '记录本人关系判断', sourceIds: [source] },
                    action: {
                      capability: 'relationship.bond',
                      targetIds: [],
                      parameters: [
                        { name: 'targetActorId', value: targetActorId },
                        { name: 'relationship', value: '工作伙伴' },
                        { name: 'mayShare', value: false },
                      ],
                      sourceIds: [source],
                      preconditions: [],
                      dependsOnActionIds: [],
                      handlesResponsibilityIds: [],
                    },
                  },
                ]
              : [],
          changes: null,
        });
      },
    };
    const service = npcAgentServices(db, () => model);
    const pending = service.sendMessageIfEnabled(owner, {
      id: randomUUID(),
      worldId,
      actorId: targetActorId,
      expectedVersion: 0,
      text: 'B concurrent input',
    });
    // Observe rejection without creating an unhandled rejection while A commits.
    const settled = pending.then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    await started;
    try {
      const a = await service.sendMessageIfEnabled(owner, {
        id: randomUUID(),
        worldId,
        actorId,
        expectedVersion: 0,
        text: 'A bonds B',
      });
      assert.equal(a?.status, 'committed');
      const current = await worlds.get({ userId: owner }, worldId);
      assert.deepEqual(
        current.actors.map((a) => a.relationship),
        world.actors.map((a) => a.relationship),
      );
      assert.deepEqual(current.actorTies, [
        {
          fromActorId: actorId,
          toActorId: targetActorId,
          relationship: '工作伙伴',
          mayShare: false,
        },
      ]);
      for (const id of [actorId, targetActorId]) {
        const state = await store.read(owner, { worldId, actorId: id });
        assert.equal(state!.definitionRef, agentDefinitionRef(current, id));
        const { snapshot } = await readPrivateAgentSnapshot(
          db,
          owner,
          current,
          id,
          null,
          current.time,
          state,
        );
        await Promise.all(
          createAgentScheduleSources({
            worldId,
            engineEpoch: 2,
            worldVersion: current.version,
            storyAt: current.time,
            actors: [{ snapshot, trustedResults: [], appointments: [] }],
            activeAttempts: [],
            consumedCandidateIds: [],
          }).map((x) => x.source.collect(owner, worldId)),
        );
      }
    } finally {
      release();
    }
    const old = await settled;
    if (old.error)
      assert.ok(
        ['VERSION_CONFLICT', 'INVALID_STATE'].includes(old.error.code ?? old.error.apiCode),
        String(old.error),
      );
    const current = await worlds.get({ userId: owner }, worldId);
    assert.deepEqual(
      current.actors.map((a) => a.relationship),
      world.actors.map((a) => a.relationship),
    );
    assert.equal(current.actorTies![0]!.relationship, '工作伙伴');
    for (const id of [actorId, targetActorId]) {
      const reply = await service.sendMessageIfEnabled(owner, {
        id: randomUUID(),
        worldId,
        actorId: id,
        expectedVersion: (await worlds.get({ userId: owner }, worldId)).version,
        text: '继续正常聊天',
      });
      assert.equal(reply?.status, 'committed');
    }
    assert.equal(calls, 4, 'one call per input, no automatic regeneration');
  } finally {
    await db.close();
    await admin.end();
  }
});
