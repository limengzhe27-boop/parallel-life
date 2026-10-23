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
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { PostgresOutbox } from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';
import { createMediaPipelineHandler } from '../../src/modules/media/infrastructure/media-pipeline-handler.ts';
import type { MediaPipelineService } from '../../src/modules/media/infrastructure/media-pipeline-service.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

test('44-175 real media pipeline: pending, completed follow-up, and no duplicate generation', async () => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
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
    const wakeObservations: any[] = [];
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
        if (p.input.origin !== 'player')
          wakeObservations.push(
            ...(p.observations ?? []),
            ...(p.presentationContext?.internalContext ?? []).map(
              (entry: { observation: any }) => entry.observation,
            ),
          );
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
    const mediaEventId = String(media[0].document.sourceEventId);
    const dispatched = await dispatchOutbox(
      new PostgresOutbox(db).ports(owner, { worldId, eventId: mediaEventId }),
    );
    assert.equal(dispatched.submitted, 1);
    const lease = (await queue.claimForOwner(dispatched.taskIds[0]!, owner, ['media']))!;
    assert.ok(lease);
    const assetId = randomUUID();
    const pipeline: Partial<MediaPipelineService> = {
      async executeImagePipeline() {
        return {
          assetId,
          storageKey: 'synthetic/' + assetId,
          mimeType: 'image/webp',
          byteLength: 128,
          width: 8,
          height: 8,
          referenceAssetIds: [],
          prompt: 'Synthetic media adapter only',
          providerTaskId: 'synthetic-provider',
          deliveryDecision: { approved: true, deliverToChat: true, deliverToAlbum: true },
        };
      },
    };
    await createMediaPipelineHandler(queue, pipeline as MediaPipelineService)(lease);
    const ready = (
      await admin.query('SELECT document FROM parallel_life.world_media_requests WHERE id=$1', [
        media[0].id,
      ])
    ).rows[0].document;
    assert.equal(ready.status, 'ready');
    assert.equal(ready.assetId, assetId);
    await advance.advanceIfEnabled(owner, worldId);
    assert.equal(actorCalls, 2, 'completed media gives one follow-up chance');
    assert.ok(
      wakeObservations.some((observation) => {
        try {
          return JSON.parse(observation.text).kind === 'own_media_completion';
        } catch {
          return false;
        }
      }),
      'the actor receives the real own media completion observation',
    );
    await advance.advanceIfEnabled(owner, worldId);
    assert.equal(actorCalls, 2, 'same completed media must not repeatedly wake');
    const after = await store.read(owner, { worldId, actorId });
    assert.ok(after);
    assert.equal(after.goals[0]!.status, 'active');
  } finally {
    await queue.close();
    await db.close();
    await admin.end();
  }
});
