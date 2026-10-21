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
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

test('zero-candidate director opportunity reaches the actor and commits a message', async () => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55432, 'local synthetic cluster only');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  try {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Director wake test',
      time: '2026-10-21T06:00:00.000Z',
      actors: [{ id: actorId, name: 'A', persona: 'An independent fictional shopkeeper' }],
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
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });

    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [worldId, owner],
      ),
    );
    await new PostgresClockStore(db).setClock(owner, worldId, { paused: false, speed: 0 });
    let directorCalls = 0;
    let npcCalls = 0;
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages[1]!.content);
        if (p.promptVersion.startsWith('director-')) {
          directorCalls++;
          const source = p.wireCatalog.sources[0]?.ref;
          assert.ok(source);
          return JSON.stringify({
            protocol: 'director-wire-v14',
            openingContext: null,
            authoredChoices: {},
            candidates: [],
            opportunities: [
              {
                id: 'director-task-1',
                title: '导演安排的一次交流',
                description: '给人物一个待考虑的交流机会。',
                playerImpact: '由人物自主决定是否联系。',
                actors: ['actor:1'],
                places: [],
                activity: 'conversation',
                origin: { kind: 'emergent', sourceRefs: [source] },
                stagingIntents: [
                  {
                    actorRef: 'actor:1',
                    kind: 'future_task',
                    task: '考虑主动向玩家说明自己还在惦记这件未完成的事。',
                  },
                ],
              },
            ],
            audit: { reason: '零候选时给人物一个自主交流机会。', sourceRefs: [] },
          });
        }
        npcCalls++;
        const intent = JSON.parse(p.input.text);
        assert.equal(intent.type, 'npc_episode_consideration');
        return JSON.stringify({
          protocol: 'npc-wire-v15',
          statements: [{ text: '我还记得那件没完成的事。', dependsOnActionIds: [] }],
          executions: [],
          changes: {
            consideration: {
              choice: 'engage',
              reason: '愿意主动联系玩家。',
              basisSourceIds: [],
            },
          },
        });
      },
    };
    const advance = npcAgentAdvanceServices(
      db,
      () => model,
      new PostgresDirectorSnapshotRepository(db),
    );
    const first = await advance.advanceIfEnabled(owner, worldId);
    assert.equal(directorCalls, 1, 'director wakes with zero actor candidates');
    assert.equal(npcCalls, 1, 'director opportunity wakes the actor');
    const store = new PostgresAgentRuntimeRepository(db);
    const actor = await store.read(owner, { worldId, actorId });
    assert(actor);
    assert.equal(actor.episodeParticipations?.[0]?.choice, 'engage');
    assert.equal(actor.episodeParticipations?.[0]?.sourceIds?.length! > 0, true);
    await advance.advanceIfEnabled(owner, worldId);
    const finalWorld = await worlds.get({ userId: owner }, worldId);
    assert.equal(
      finalWorld.messages.filter((m) => m.text.includes('我还记得那件没完成的事')).length,
      1,
      'the director opportunity is delivered once',
    );
    assert.equal(directorCalls, 1, 'immediate advance does not repeat the director');
  } finally {
    await db.close();
    await admin.end();
  }
});
