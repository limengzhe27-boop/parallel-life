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
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

test('actionless plan advances into one proactive review and does not repeat on immediate re-advance', async () => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55432, 'local synthetic cluster only');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  try {
    const owner = randomUUID(),
      id = randomUUID(),
      actorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Own plan test',
      time: new Date().toISOString(),
      actors: [{ id: actorId, name: 'A', persona: 'An independent fictional shopkeeper' }],
      facts: [
        {
          id: 'basis',
          text: 'An authorized agreed material list is available.',
          kind: 'canonical',
          visibility: { kind: 'world' },
          sourceEventId: 'genesis:' + id,
        },
      ],
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
        emptyActorAgentState({ worldId: id, actorId }, agentDefinitionRef(world, actorId), 0),
      );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    let npcCalls = 0;
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages[1]!.content);
        if (p.promptVersion.startsWith('director-'))
          return JSON.stringify({
            protocol: 'director-wire-v14',
            openingContext: null,
            authoredChoices: {},
            candidates: [],
            opportunities: [],
            audit: { reason: 'No director work for this actionless plan.', sourceRefs: [] },
          });
        npcCalls++;
        if (p.input.origin === 'player')
          return JSON.stringify({
            protocol: 'npc-wire-v15',
            statements: [{ text: 'I will remember the unfinished plan.', dependsOnActionIds: [] }],
            executions: [],
            changes: {
              planIntents: [
                {
                  kind: 'create',
                  ref: 'remember',
                  goal: {
                    kind: 'new',
                    summary: 'Remember the unfinished plan',
                    sourceIds: [p.input.sourceId],
                  },
                  summary: 'Continue when the time is right',
                  sourceIds: [p.input.sourceId],
                },
              ],
            },
          });
        assert.equal(p.input.origin, 'wake');
        assert.equal(JSON.parse(p.input.text).actionId, null);
        return JSON.stringify({
          protocol: 'npc-wire-v15',
          statements: [],
          executions: [],
          changes: null,
        });
      },
    };
    const command = {
      id: randomUUID(),
      worldId: id,
      actorId,
      expectedVersion: 0,
      text: 'Please take responsibility for checking the list.',
    };
    const reply = await npcAgentServices(db, () => model).sendMessageIfEnabled(owner, command);
    assert.equal(reply?.status, 'committed');
    const current = await worlds.get({ userId: owner }, id);
    const store = new PostgresAgentRuntimeRepository(db);
    const state = await store.read(owner, { worldId: id, actorId });
    assert(state);
    const snap = (
      await readPrivateAgentSnapshot(db, owner, current, actorId, null, current.time, state)
    ).snapshot;
    const inputs = {
      worldId: id,
      engineEpoch: 2,
      worldVersion: current.version,
      storyAt: current.time,
      actors: [{ snapshot: snap, trustedResults: [], appointments: [] }],
      activeAttempts: [],
      consumedCandidateIds: [],
    };
    const source = createAgentScheduleSources(inputs).find((s) => s.id.startsWith('actor_plan:'))!;
    const collected = await source.source.collect(owner, id);
    assert.equal(collected.candidates.length, 1);
    assert.equal(collected.candidates[0]!.actionId, null);
    const advance = npcAgentAdvanceServices(
      db,
      () => model,
      new PostgresDirectorSnapshotRepository(db),
    );
    await advance.advanceIfEnabled(owner, id);
    assert.equal(npcCalls, 2, 'one original message and one actionless plan review');
    await advance.advanceIfEnabled(owner, id);
    assert.equal(npcCalls, 2, 'same evidence quiet wake must never repeat');
    const after = await store.read(owner, { worldId: id, actorId });
    assert(after);
    assert.equal(after.goals[0]!.status, 'active');
    assert.deepEqual(after.goals[0]!.resultIds, []);
    assert.deepEqual(after.actions, []);
    assert.equal(after.plans[0]!.nextActionId, null);
    await assert.rejects(
      npcAgentServices(db, () => model).sendMessageIfEnabled(randomUUID(), {
        ...command,
        id: randomUUID(),
      }),
    );
    assert.equal(npcCalls, 2);
  } finally {
    await db.close();
    await admin.end();
  }
});
