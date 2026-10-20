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

test('44-174 pending old media plan does not re-review or repurchase and goal stays active', async () => {
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
      title: '44-174 old media plan',
      time: new Date().toISOString(),
      actors: [{ id: actorId, name: 'A', persona: 'Independent photographer' }],
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
          assert.ok(accepted);
          const source = String(accepted.id);
          return JSON.stringify({
            statements: [{ text: 'I will prepare the picture.', dependsOnActionIds: [] }],
            goals: [
              {
                id: 'g-media',
                summary: 'Offer my own picture',
                status: 'active',
                sourceIds: [source],
                resultIds: [],
              },
            ],
            plans: [
              {
                id: 'p-media',
                goalId: 'g-media',
                summary: 'Make one picture',
                status: 'active',
                sourceIds: [source],
                actionIds: ['a-media'],
                nextActionId: 'a-media',
                triggers: [],
                missingConditions: [],
              },
            ],
            actions: [
              {
                id: 'a-media',
                goalId: 'g-media',
                capability: 'media.generate_image',
                targetIds: [actorId],
                parameters: {
                  sceneDescription: 'A natural front camera selfie',
                  purpose: 'portrait',
                },
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
      text: 'Prepare a picture.',
    });
    assert.equal(reply?.status, 'committed');
    assert.equal(actorCalls, 1);
    const store = new PostgresAgentRuntimeRepository(db);
    const afterFirst = await store.read(owner, { worldId, actorId });
    assert.ok(afterFirst);
    assert.equal(afterFirst.actions[0]!.status, 'succeeded');
    assert.equal(afterFirst.goals[0]!.status, 'active');
    const media = (
      await admin.query(
        "SELECT id,document FROM parallel_life.world_media_requests WHERE world_id=$1 AND document->>'sourceEventId' IS NOT NULL",
        [worldId],
      )
    ).rows;
    assert.equal(media.length, 1);
    assert.ok(['pending', 'submitted'].includes(media[0].document.status));
    const advance = npcAgentAdvanceServices(
      db,
      () => model,
      new PostgresDirectorSnapshotRepository(db),
    );
    await advance.advanceIfEnabled(owner, worldId);
    assert.equal(actorCalls, 1, 'pending media must not re-review the same plan');
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM parallel_life.world_media_requests WHERE world_id=$1',
          [worldId],
        )
      ).rows[0].n,
      1,
    );
    const after = await store.read(owner, { worldId, actorId });
    assert.ok(after);
    assert.equal(after.goals[0]!.status, 'active');
  } finally {
    await db.close();
    await admin.end();
  }
});
