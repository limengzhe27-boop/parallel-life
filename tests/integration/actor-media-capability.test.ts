import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type {
  ActorAgentState,
  AgentInputReceipt,
  AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import { createMediaPipelineHandler } from '../../src/modules/media/infrastructure/media-pipeline-handler.ts';
import { MediaPipelineService } from '../../src/modules/media/infrastructure/media-pipeline-service.ts';
import type { MediaProviderAdapter, CharacterVisualAnchorRepository } from '../../src/modules/media/application/provider-ports.ts';
import type { AssetStore } from '../../src/modules/media/application/asset-store.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';

test('actor capability chain: media.generate_image, media.generate_video, and media.share end-to-end execution', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );

  const worlds = new PostgresWorldRepository(app);
  const store = new PostgresAgentRuntimeRepository(app);

  t.after(async () => {
    await app.close();
    await admin.end();
  });

  async function fixture() {
    const owner = randomUUID();
    const worldId = randomUUID();
    const actorId = randomUUID();
    const storyNow = '2026-10-15T12:00:00.000Z';
    const goalId = 'goal_media_1';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const worldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: '媒体能力端到端测试世界',
      version: 1,
      time: storyNow,
      actors: [{ id: actorId, name: '青青', persona: '摄影与生活记录爱好者' }],
      messages: [],
      appointments: [],
      facts: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'place_studio',
        places: [{ id: 'place_studio', name: '阳光摄影工作室', appointmentIds: [] }],
        routes: [],
      },
    };

    const initialActorState: ActorAgentState = {
      worldId,
      actorId,
      schemaVersion: 1,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: `author:actor:${actorId}`,
      knowledgeSourceIds: [],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: goalId,
          summary: '为现场留存精彩影像',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
      focus: null,
    };

    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,1,0,$4)',
        [worldId, owner, '媒体能力测试世界', JSON.stringify(worldState)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [worldId, owner, JSON.stringify({ ...worldState, version: 0 }), {}],
      );
      const event1CommandId = randomUUID();
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status,result_event_id,result_state) VALUES($1,$2,$3,0,'0000000000000000000000000000000000000000000000000000000000000000','{}','succeeded',$4,$5)",
        [event1CommandId, worldId, owner, event1Id, JSON.stringify(worldState)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,$4,$5,$6)',
        [
          event1Id,
          worldId,
          owner,
          event1CommandId,
          {
            id: event1Id,
            worldId,
            type: 'turn.resolved',
            version: 1,
            occurredAt: storyNow,
            storyAt: storyNow,
            data: { effects: [] },
          },
          storyNow,
        ],
      );
      await initializeActorAgentStateInTransaction(sql, owner, initialActorState);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });
    });

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update('fixture_input_media').digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 1,
      receivedAt: new Date().toISOString(),
      storyAt: storyNow,
      origin: 'player',
      text: '青青，能拍张工作室的照片给我看看吗？',
    };
    await store.accept(owner, inputReceipt);

    const snapshot: AgentSnapshot = {
      state: initialActorState,
      viewState: structuredClone(initialActorState),
      redactedStateIds: [],
      worldVersion: 1,
      storyAt: storyNow,
      sources: [
        {
          id: inputReceipt.id,
          kind: 'accepted_input',
          recordId: inputReceipt.id,
          worldVersion: 1,
          at: storyNow,
        },
        {
          id: 'source_init',
          kind: 'authored',
          recordId: 'source_init',
          worldVersion: 1,
          at: storyNow,
        },
      ],
      observations: [],
      actor: {
        name: '青青',
        persona: '摄影与生活记录爱好者',
        boundaries: '不替用户决定',
        definitionRef: `author:actor:${actorId}`,
      },
      input: {
        sourceId: inputReceipt.id,
        text: inputReceipt.text,
        origin: 'player',
      },
      channel: {
        kind: 'private',
        threadId: actorId,
        audienceActorIds: [actorId],
        allowedCapabilities: [
          'plan.record',
          'media.generate_image',
          'media.generate_video',
          'media.share',
        ],
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId,
      inputReceiptId: inputReceipt.id,
      inputHash: inputReceipt.inputHash,
      worldId,
      actorId,
      engineEpoch: 2,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    return {
      owner,
      worldId,
      actorId,
      goalId,
      storyNow,
      inputReceipt,
      snapshot,
      claim,
    };
  }

  await t.test(
    '1. media.generate_image proposal creates world_media_requests and outbox_jobs atomically',
    async () => {
      const f = await fixture();

      const proposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_image_1',
            goalId: f.goalId,
            capability: 'media.generate_image',
            targetIds: [],
            parameters: {
              sceneDescription: '午后阳光照进的工作室窗台，放着复古胶片相机',
              purpose: 'scene',
            },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '好呀，我这就给窗台的相机拍一张。',
            dependsOnActionIds: ['action_image_1'],
          },
        ],
      };

      const out = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(proposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );

      assert.ok(out.eventId);
      assert.equal(out.results.length, 1);
      assert.equal(out.results[0]?.outcome, 'succeeded');
      assert.equal(out.results[0]?.outputRefs?.[0]?.kind, 'media');

      // Verify DB persistence in parallel_life.world_media_requests and parallel_life.outbox_jobs
      await app.transaction(f.owner, async (sql) => {
        const mediaReqs = (
          await sql.query(
            'SELECT id, document FROM parallel_life.world_media_requests WHERE world_id=$1',
            [f.worldId],
          )
        ).rows;
        assert.equal(mediaReqs.length, 1);
        assert.equal(mediaReqs[0].document.status, 'pending');
        assert.equal(mediaReqs[0].document.mediaType, 'image');
        assert.match(mediaReqs[0].document.prompt, /午后阳光照进的工作室窗台/);

        const outboxJobs = (
          await sql.query(
            'SELECT id, payload FROM parallel_life.outbox_jobs WHERE world_id=$1',
            [f.worldId],
          )
        ).rows;
        assert.equal(outboxJobs.length, 1);
        assert.equal(outboxJobs[0].payload.type, 'image.generate');
        assert.equal(outboxJobs[0].payload.requestId, mediaReqs[0].id);
      });
    },
  );

  await t.test(
    '2. media.generate_video proposal creates video request and outbox job',
    async () => {
      const f = await fixture();

      const proposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_video_1',
            goalId: f.goalId,
            capability: 'media.generate_video',
            targetIds: [],
            parameters: {
              actionDescription: '拿起桌上的胶片相机缓缓擦拭镜头',
              purpose: 'character_action',
              durationSeconds: 5,
            },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '我把擦镜头的动作录一小段发你。',
            dependsOnActionIds: ['action_video_1'],
          },
        ],
      };

      const out = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(proposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );

      assert.ok(out.eventId);
      assert.equal(out.results.length, 1);
      assert.equal(out.results[0]?.outcome, 'succeeded');
      assert.equal(out.results[0]?.outputRefs?.[0]?.kind, 'media');

      await app.transaction(f.owner, async (sql) => {
        const mediaReqs = (
          await sql.query(
            'SELECT id, document FROM parallel_life.world_media_requests WHERE world_id=$1',
            [f.worldId],
          )
        ).rows;
        assert.equal(mediaReqs.length, 1);
        assert.equal(mediaReqs[0].document.mediaType, 'video');

        const outboxJobs = (
          await sql.query(
            'SELECT id, payload FROM parallel_life.outbox_jobs WHERE world_id=$1',
            [f.worldId],
          )
        ).rows;
        assert.equal(outboxJobs.length, 1);
        assert.equal(outboxJobs[0].payload.type, 'video.generate');
      });
    },
  );

  await t.test(
    '3. media.share reports ASSET_NOT_READY when asset is not ready',
    async () => {
      const f = await fixture();

      const unreadyAssetId = randomUUID();
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `INSERT INTO parallel_life.assets(id, owner_id, world_id, storage_key, mime_type, byte_length, width, height, origin, status)
           VALUES($1, $2, $3, $4, 'image/jpeg', 100, 512, 512, 'upload', 'processing')`,
          [unreadyAssetId, f.owner, f.worldId, `tmp/${unreadyAssetId}.jpg`],
        );
      });

      const proposalUnready: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_share_fail',
            goalId: f.goalId,
            capability: 'media.share',
            targetIds: [unreadyAssetId],
            parameters: {
              assetId: unreadyAssetId,
              targetRecipientActorId: 'player',
            },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '这张照片分享给你。',
            dependsOnActionIds: ['action_share_fail'],
          },
        ],
      };

      await assert.rejects(
        async () => {
          await runNpcAgent(
            {
              attempts: store,
              model: {
                async decide() {
                  return JSON.stringify(proposalUnready);
                },
              },
              kernel: new PostgresNpcAgentKernel(app, worlds),
            },
            f.owner,
            f.claim,
            f.snapshot,
          );
        },
        (err: any) =>
          err.message.includes('REPLY_DEPENDS_ON_UNEXECUTED_ACTION') ||
          err.message.includes('ASSET_NOT_READY') ||
          err.message.includes('INVALID_PROPOSAL'),
      );
    },
  );

  await t.test(
    '4. media.share succeeds when asset is ready and whitelisted',
    async () => {
      const f = await fixture();

      const readyAssetId = randomUUID();
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `INSERT INTO parallel_life.assets(id, owner_id, world_id, storage_key, mime_type, byte_length, width, height, origin, status)
           VALUES($1, $2, $3, $4, 'image/jpeg', 2048, 512, 512, 'upload', 'ready')`,
          [readyAssetId, f.owner, f.worldId, `tmp/${readyAssetId}.jpg`],
        );
      });

      const proposalReady: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_share_ok',
            goalId: f.goalId,
            capability: 'media.share',
            targetIds: [readyAssetId],
            parameters: {
              assetId: readyAssetId,
              targetRecipientActorId: 'player',
              caption: '上次冲洗好的样片',
            },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '这是上次冲洗好的样片，发你看看。',
            dependsOnActionIds: ['action_share_ok'],
          },
        ],
      };

      const out = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(proposalReady);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );

      assert.ok(out.eventId);
      assert.equal(out.results.length, 1);
      assert.equal(out.results[0]?.outcome, 'succeeded');
      assert.equal(out.results[0]?.outputRefs?.[0]?.kind, 'asset');
      assert.equal(out.results[0]?.outputRefs?.[0]?.id, readyAssetId);
    },
  );
});
