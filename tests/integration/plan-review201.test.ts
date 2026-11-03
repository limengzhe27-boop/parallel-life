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
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

for (const outcome of ['succeeded', 'failed'] as const) {
  test(`44-201 real ${outcome} action result preserves current terminal-goal review semantics`, async () => {
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
          { id: actorId, name: 'A', persona: 'An independent fictional shopkeeper' },
          { id: targetActorId, name: 'B', persona: 'Another fictional shopkeeper' },
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
      let actorCalls = 0,
        reviewCalls = 0;
      const model: TextModel = {
        async complete(messages) {
          const p = JSON.parse(messages[1]!.content);
          if (p.promptVersion?.startsWith('director-'))
            return JSON.stringify({
              protocol: 'director-wire-v14',
              candidates: p.wireCatalog.candidates.map((c: { ref: string }) => ({
                ref: c.ref,
                decision: 'defer',
                reason: 'No global coordination needed.',
              })),
              authoredChoices: {},
              opportunities: [],
              openingContext: null,
              audit: { reason: 'no director action', sourceRefs: [] },
            });
          actorCalls++;
          if (p.input.origin === 'player') {
            const source = p.wireCatalog.inputSourceRef;
            return JSON.stringify({
              protocol: 'npc-wire-v16',
              statements: [{ text: 'I will record the next step.', dependsOnActionIds: [] }],
              executions: [
                {
                  ref: 'result',
                  goal: { kind: 'new', summary: 'Keep my own shop in order', sourceIds: [source] },
                  plan: { summary: 'Record the next step', sourceIds: [source] },
                  action: {
                    capability: outcome === 'succeeded' ? 'moment.publish' : 'relationship.bond',
                    targetIds: [],
                    parameters:
                      outcome === 'succeeded'
                        ? [{ name: 'text', value: '整理好了今天的店铺清单。' }]
                        : [
                            { name: 'targetActorId', value: actorId },
                            { name: 'relationship', value: 'colleague' },
                          ],
                    sourceIds: [source],
                    preconditions: [],
                    dependsOnActionIds: [],
                    handlesResponsibilityIds: [],
                  },
                },
              ],
              changes: null,
            });
          }
          const wake = JSON.parse(p.input.text);
          if (wake.source === 'actor_local')
            return JSON.stringify({
              protocol: 'npc-wire-v15',
              statements: [],
              executions: [],
              changes: null,
            });
          assert.equal(wake.source, 'actor_plan');
          reviewCalls++;
          const saved = await new PostgresAgentRuntimeRepository(db).read(owner, {
            worldId,
            actorId,
          });
          assert.equal(wake.planReview?.planId, saved!.plans[0]!.id);
          assert.equal(wake.planReview?.goalId, saved!.goals[0]!.id);
          assert.equal(wake.planReview?.result?.actionId, saved!.actions[0]!.id);
          assert.equal(wake.planReview?.result?.outcome, outcome);
          assert.ok(wake.planReview?.result?.id);
          return JSON.stringify({
            protocol: 'npc-wire-v16',
            statements: [],
            executions: [],
            changes: null,
          });
        },
      };
      const reply = await npcAgentServices(db, () => model).sendMessageIfEnabled(owner, {
        id: randomUUID(),
        worldId,
        actorId,
        expectedVersion: 0,
        text: 'Do the next step.',
      });
      assert.equal(reply?.status, 'committed');
      const store = new PostgresAgentRuntimeRepository(db);
      const afterFirst = await store.read(owner, { worldId, actorId });
      assert.ok(afterFirst?.actions[0]);
      assert.equal(afterFirst.actions[0]!.status, outcome);
      assert.ok(afterFirst.actions[0]!.resultId);
      const results = (
        await admin.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
          [worldId, actorId],
        )
      ).rows.map((row) => row.document);
      assert.equal(results.length, 1);
      assert.equal(results[0].outcome, outcome);
      const advance = npcAgentAdvanceServices(
        db,
        () => model,
        new PostgresDirectorSnapshotRepository(db),
      );
      await advance.advanceIfEnabled(owner, worldId);
      assert.equal(
        reviewCalls,
        outcome === 'failed' ? 1 : 0,
        'only an unfinished goal needs result reconsideration',
      );
      await advance.advanceIfEnabled(owner, worldId);
      assert.equal(
        reviewCalls,
        outcome === 'failed' ? 1 : 0,
        'same terminal result must not buy another review',
      );
      const directorStates = (
        await admin.query(
          'SELECT status FROM parallel_life.director_runtime_attempts WHERE world_id=$1',
          [worldId],
        )
      ).rows;
      assert.ok(directorStates.length > 0);
      assert.ok(
        directorStates.every((r) => r.status === 'committed'),
        JSON.stringify(directorStates),
      );
      const afterWake = await store.read(owner, { worldId, actorId });
      assert.ok(afterWake);
      assert.equal(afterWake.goals[0]!.status, outcome === 'failed' ? 'active' : 'fulfilled');
      assert.equal(afterWake.goals[0]!.resultIds.length, outcome === 'failed' ? 0 : 1);
      assert.equal(afterWake.actions[0]!.status, outcome);
    } finally {
      await db.close();
      await admin.end();
    }
  });
}
