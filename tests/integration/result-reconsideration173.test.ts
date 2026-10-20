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
  test(`44-173 real ${outcome} action result wakes one plan review, not episode completion`, async () => {
    const cfg = await localConfig();
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
        title: '44-173 result reconsideration',
        time: new Date().toISOString(),
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
      let actorCalls = 0;
      const model: TextModel = {
        async complete(messages) {
          const p = JSON.parse(messages[1]!.content);
          if (p.promptVersion.startsWith('director-'))
            return JSON.stringify({
              protocol: 'director-wire-v14',
              candidates: [],
              authoredChoices: {},
              opportunities: [],
              openingContext: null,
              audit: { reason: 'no director action', sourceRefs: [] },
            });
          actorCalls++;
          if (p.input.origin === 'player') {
            const accepted = (
              await admin.query(
                "SELECT id FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND document->>'recipientActorId'=$3 AND document->>'text'=$4 ORDER BY created_at DESC LIMIT 1",
                [worldId, owner, actorId, p.input.text],
              )
            ).rows[0];
            assert.ok(accepted, 'accepted input source exists');
            const source = String(accepted.id);
            return JSON.stringify({
              statements: [{ text: 'I will record the next step.', dependsOnActionIds: [] }],
              goals: [
                {
                  id: 'g-result',
                  summary: 'Keep my own shop in order',
                  status: 'active',
                  sourceIds: [source],
                  resultIds: [],
                },
              ],
              plans: [
                {
                  id: 'p-result',
                  goalId: 'g-result',
                  summary: 'Record the next step',
                  status: 'active',
                  sourceIds: [source],
                  actionIds: ['a-result'],
                  nextActionId: 'a-result',
                  triggers: [],
                  missingConditions: [],
                },
              ],
              actions: [
                {
                  id: 'a-result',
                  goalId: 'g-result',
                  capability: outcome === 'succeeded' ? 'plan.record' : 'appointment.cancel',
                  targetIds: [],
                  parameters:
                    outcome === 'succeeded'
                      ? { planId: 'p-result' }
                      : { appointmentId: randomUUID(), reason: 'synthetic missing booking' },
                  sourceIds: [source],
                  preconditions: [],
                  dependsOnActionIds: [],
                  handlesResponsibilityIds: [],
                  status: 'ready',
                },
              ],
              responsibilities: [],
              decisions: [],
            });
          }
          return JSON.stringify({
            statements: [],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
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
      assert.equal(actorCalls, 2, 'one paid response and one result-driven reconsideration');
      await advance.advanceIfEnabled(owner, worldId);
      assert.equal(actorCalls, 2, 'same terminal result must not buy another review');
      const afterWake = await store.read(owner, { worldId, actorId });
      assert.ok(afterWake);
      assert.equal(afterWake.goals[0]!.status, 'active');
      assert.deepEqual(afterWake.goals[0]!.resultIds, []);
      assert.equal(afterWake.actions[0]!.status, outcome);
    } finally {
      await db.close();
      await admin.end();
    }
  });
}
