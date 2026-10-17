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

test('actor capability chain: item.deliver end-to-end execution, precondition enforcement, co-location verification and ownership transfer', async (t) => {
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
    const actorSenderId = randomUUID();
    const actorRecipientId = randomUUID();
    const placeArchive = 'place_archive_room';
    const placeCafe = 'place_city_cafe';
    const itemId = 'item_project_blueprint';
    const createdTime = '2026-10-16T09:00:00.000Z';
    const storyNow = '2026-10-16T10:00:00.000Z';
    const goalId = 'goal_deliver_blueprint';
    const respId = 'resp_deliver_blueprint';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const initialWorldState: any = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 1,
      title: '档案移交与信物闭环测试世界',
      time: storyNow,
      actors: [
        { id: actorSenderId, name: '林白语', persona: '知性严谨的研究者' },
        { id: actorRecipientId, name: '青青', persona: '严谨认真的都市闺蜜' },
      ],
      messages: [],
      appointments: [],
      facts: [],
      mediaRequests: [],
      items: [
        {
          id: itemId,
          title: '绝密项目设计蓝图',
          kind: 'document',
          holderActorId: actorSenderId,
          sourceEventId: event1Id,
          transferredAt: createdTime,
          note: '项目初始档案',
        },
      ],
    };

    const senderInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: actorSenderId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:sender',
      knowledgeSourceIds: ['source_init'],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: goalId,
          summary: '将绝密项目设计蓝图交付给青青',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [
        {
          id: respId,
          revision: 0,
          subject: { kind: 'appointment', id: 'apt_blueprint_handover' },
          summary: '交付绝密项目设计蓝图',
          status: 'open',
          waitingOn: null,
          sourceIds: ['source_init'],
          nextCheck: [],
        },
      ],
      decisions: [],
      focus: null,
    };

    const recipientInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: actorRecipientId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:recipient',
      knowledgeSourceIds: ['source_init'],
      memoryIds: [],
      relationshipIds: [],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
      focus: null,
    };

    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,1,0,$4)',
        [worldId, owner, '档案移交与信物闭环测试世界', JSON.stringify(initialWorldState)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [worldId, owner, JSON.stringify({ ...initialWorldState, version: 0 }), {}],
      );
      const event1CommandId = randomUUID();
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status,result_event_id,result_state) VALUES($1,$2,$3,0,'0000000000000000000000000000000000000000000000000000000000000000','{}','succeeded',$4,$5)",
        [event1CommandId, worldId, owner, event1Id, JSON.stringify(initialWorldState)],
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
            occurredAt: createdTime,
            storyAt: createdTime,
            data: { effects: [] },
          },
          createdTime,
        ],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused,speed,managed,active_until) VALUES($1,$2,$3,false,1,false,null)',
        [worldId, owner, storyNow],
      );
      await initializeActorAgentStateInTransaction(sql, owner, senderInitialState);
      await initializeActorAgentStateInTransaction(sql, owner, recipientInitialState);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });

      // Authoritative positions: both at placeArchive initially
      await sql.query(
        `INSERT INTO parallel_life.world_authoritative_positions(
          world_id, owner_id, subject_key, source_version, source_event_id, document
        ) VALUES
        ($1, $2, $3, 1, $5, $6),
        ($1, $2, $4, 1, $5, $7)`,
        [
          worldId,
          owner,
          `actor:${actorSenderId}`,
          `actor:${actorRecipientId}`,
          event1Id,
          {
            worldId,
            subject: { kind: 'actor', actorId: actorSenderId },
            status: 'at',
            placeId: placeArchive,
            sourceEventId: event1Id,
            worldVersion: 1,
            occurredAt: createdTime,
          },
          {
            worldId,
            subject: { kind: 'actor', actorId: actorRecipientId },
            status: 'at',
            placeId: placeArchive,
            sourceEventId: event1Id,
            worldVersion: 1,
            occurredAt: createdTime,
          },
        ],
      );
    });

    return {
      owner,
      worldId,
      actorSenderId,
      actorRecipientId,
      placeArchive,
      placeCafe,
      itemId,
      createdTime,
      storyNow,
      goalId,
      respId,
      event1Id,
    };
  }

  await t.test(
    '1. Precondition enforcement: rejects item.deliver when self-delivery, recipient not found, not co-located, or item not owned',
    async () => {
      const f = await fixture();
      const kernel = new PostgresNpcAgentKernel(app, worlds);

      // Subtest 1A: cannot deliver to self
      const selfInputReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorSenderId,
        recipientActorId: f.actorSenderId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 1,
        inputHash: createHash('sha256').update('self-deliver').digest('hex'),
        text: '交给自己',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, selfInputReceipt);

      const selfDraftProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_self_deliver',
            capability: 'item.deliver',
            targetIds: [f.itemId],
            parameters: {
              itemId: f.itemId,
              recipientActorId: f.actorSenderId, // self
              title: '绝密设计蓝图',
            },
            sourceIds: ['source_init'],
            goalId: f.goalId,
            handlesResponsibilityIds: [f.respId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '我自己留着这份资料。', dependsOnActionIds: [] }],
      };

      const senderState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorSenderId }))!;
      const selfSnapshot: AgentSnapshot = {
        state: senderState0,
        viewState: structuredClone(senderState0),
        redactedStateIds: [],
        worldVersion: 1,
        channel: {
          kind: 'private',
          threadId: f.actorSenderId,
          audienceActorIds: [f.actorSenderId],
          allowedCapabilities: ['item.deliver'],
        },
        input: {
          text: selfInputReceipt.text,
          sourceId: selfInputReceipt.id,
          origin: selfInputReceipt.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: selfInputReceipt.id,
            kind: 'accepted_input',
            recordId: selfInputReceipt.id,
            worldVersion: 1,
            at: f.storyNow,
          },
          {
            id: 'source_init',
            kind: 'authored',
            recordId: 'source_init',
            worldVersion: 1,
            at: f.createdTime,
          },
        ],
        observations: [],
        actor: {
          name: '林白语',
          persona: '知性严谨的研究者',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:sender',
        },
      };

      const selfClaim = {
        id: randomUUID(),
        commandId: selfInputReceipt.commandId!,
        inputReceiptId: selfInputReceipt.id,
        worldId: f.worldId,
        actorId: f.actorSenderId,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: selfInputReceipt.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const selfRes = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(selfDraftProposal);
            },
          },
          kernel,
        },
        f.owner,
        selfClaim,
        selfSnapshot,
      );
      assert.ok(selfRes.eventId);
      const selfResults = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorSenderId }))!;
      assert.equal(selfResults.revision, 1);
      // Verify action failed with CANNOT_DELIVER_TO_SELF
      const selfActionResults = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorSenderId],
          )
        ).rows.map((r) => r.document);
      });
      const failedSelfAction = selfActionResults.find((r: any) => r.actionId === 'action_self_deliver');
      assert.ok(failedSelfAction);
      assert.equal(failedSelfAction.outcome, 'failed');
      assert.equal(failedSelfAction.failureCode, 'CANNOT_DELIVER_TO_SELF');

      // Subtest 1B: Recipient not co-located (recipient moved to cafe)
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_authoritative_positions
           SET document = jsonb_set(document, '{placeId}', to_jsonb($3::text))
           WHERE world_id=$1 AND owner_id=$2 AND subject_key=$4`,
          [f.worldId, f.owner, f.placeCafe, `actor:${f.actorRecipientId}`],
        );
      });

      const coLocInputReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorSenderId,
        recipientActorId: f.actorSenderId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 2,
        inputHash: createHash('sha256').update('coloc-deliver').digest('hex'),
        text: '尝试异地转交',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, coLocInputReceipt);

      const coLocDraft: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_coloc_deliver',
            capability: 'item.deliver',
            targetIds: [f.itemId],
            parameters: {
              itemId: f.itemId,
              recipientActorId: f.actorRecipientId,
              title: '绝密设计蓝图',
            },
            sourceIds: ['source_init'],
            goalId: f.goalId,
            handlesResponsibilityIds: [f.respId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '青青不在现场，无法直接递交。', dependsOnActionIds: [] }],
      };

      const senderState1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorSenderId }))!;
      const coLocSnapshot: AgentSnapshot = {
        state: senderState1,
        viewState: structuredClone(senderState1),
        redactedStateIds: [],
        worldVersion: 2,
        channel: {
          kind: 'private',
          threadId: f.actorSenderId,
          audienceActorIds: [f.actorSenderId],
          allowedCapabilities: ['item.deliver'],
        },
        input: {
          text: coLocInputReceipt.text,
          sourceId: coLocInputReceipt.id,
          origin: coLocInputReceipt.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: coLocInputReceipt.id,
            kind: 'accepted_input',
            recordId: coLocInputReceipt.id,
            worldVersion: 2,
            at: f.storyNow,
          },
          {
            id: 'source_init',
            kind: 'authored',
            recordId: 'source_init',
            worldVersion: 1,
            at: f.createdTime,
          },
        ],
        observations: [],
        actor: {
          name: '林白语',
          persona: '知性严谨的研究者',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:sender',
        },
      };

      const coLocClaim = {
        id: randomUUID(),
        commandId: coLocInputReceipt.commandId!,
        inputReceiptId: coLocInputReceipt.id,
        worldId: f.worldId,
        actorId: f.actorSenderId,
        expectedWorldVersion: 2,
        expectedActorRevision: 1,
        inputHash: coLocInputReceipt.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const coLocRes = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(coLocDraft);
            },
          },
          kernel,
        },
        f.owner,
        coLocClaim,
        coLocSnapshot,
      );
      assert.ok(coLocRes.eventId);
      const coLocActionResults = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorSenderId],
          )
        ).rows.map((r) => r.document);
      });
      const failedCoLocAction = coLocActionResults.find((r: any) => r.actionId === 'action_coloc_deliver');
      assert.ok(failedCoLocAction);
      assert.equal(failedCoLocAction.outcome, 'failed');
      assert.equal(failedCoLocAction.failureCode, 'RECIPIENT_NOT_CO_LOCATED');
    },
  );

  await t.test(
    '2. End-to-end item.deliver execution: atomic ownership transfer, responsibility & goal fulfillment',
    async () => {
      const f = await fixture();
      const kernel = new PostgresNpcAgentKernel(app, worlds);

      // Step 1: Valid co-located delivery
      const deliverReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorSenderId,
        recipientActorId: f.actorSenderId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 1,
        inputHash: createHash('sha256').update('valid-deliver').digest('hex'),
        text: '林白语，请把这份绝密项目设计蓝图正式移交给青青。',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, deliverReceipt);

      const deliverDraft: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_blueprint_deliver',
            capability: 'item.deliver',
            targetIds: [f.itemId],
            parameters: {
              itemId: f.itemId,
              recipientActorId: f.actorRecipientId,
              title: '绝密项目设计蓝图',
              note: '档案室现场交接完毕',
            },
            sourceIds: ['source_init'],
            goalId: f.goalId,
            handlesResponsibilityIds: [f.respId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '青青，这是绝密项目设计蓝图，请你妥善保管。', dependsOnActionIds: [] }],
      };

      const senderStateDeliver = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorSenderId }))!;
      const deliverSnapshot: AgentSnapshot = {
        state: senderStateDeliver,
        viewState: structuredClone(senderStateDeliver),
        redactedStateIds: [],
        worldVersion: 1,
        channel: {
          kind: 'private',
          threadId: f.actorSenderId,
          audienceActorIds: [f.actorSenderId],
          allowedCapabilities: ['item.deliver'],
        },
        input: {
          text: deliverReceipt.text,
          sourceId: deliverReceipt.id,
          origin: deliverReceipt.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: deliverReceipt.id,
            kind: 'accepted_input',
            recordId: deliverReceipt.id,
            worldVersion: 1,
            at: f.storyNow,
          },
          {
            id: 'source_init',
            kind: 'authored',
            recordId: 'source_init',
            worldVersion: 1,
            at: f.createdTime,
          },
        ],
        observations: [],
        actor: {
          name: '林白语',
          persona: '知性严谨的研究者',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:sender',
        },
      };

      const deliverClaim = {
        id: randomUUID(),
        commandId: deliverReceipt.commandId!,
        inputReceiptId: deliverReceipt.id,
        worldId: f.worldId,
        actorId: f.actorSenderId,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: deliverReceipt.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const deliverRes = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(deliverDraft);
            },
          },
          kernel,
        },
        f.owner,
        deliverClaim,
        deliverSnapshot,
      );
      assert.ok(deliverRes.eventId);

      // Verify world state version advanced to 2
      const updatedWorld = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(updatedWorld.version, 2);

      assert.ok(updatedWorld.items);
      const blueprintItem = updatedWorld.items.find((i: any) => i.id === f.itemId);
      assert.ok(blueprintItem);
      assert.equal(blueprintItem.holderActorId, f.actorRecipientId, 'Item must now be held by recipient');
      assert.ok(blueprintItem.transferredAt);
      assert.ok(Date.parse(blueprintItem.transferredAt) >= Date.parse(f.storyNow));
      assert.equal(blueprintItem.note, '档案室现场交接完毕');

      // Verify sender's responsibility and goal are marked fulfilled
      const senderState = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorSenderId }))!;
      assert.equal(senderState.revision, 1);
      const resp = senderState.responsibilities.find((r) => r.id === f.respId);
      assert.ok(resp);
      assert.equal(resp.status, 'fulfilled', 'Delivery responsibility must be fulfilled');
      assert.equal(resp.endReason, '已按约履行');

      const goal = senderState.goals.find((g) => g.id === f.goalId);
      assert.ok(goal);
      assert.equal(goal.status, 'fulfilled', 'Delivery goal must be fulfilled');
      assert.equal(goal.endReason, '目标已达成');

      // Verify agent_action_results records successful item outputRef
      const actionResults = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorSenderId],
          )
        ).rows.map((r) => r.document);
      });
      const succeedAction = actionResults.find((r: any) => r.actionId === 'action_blueprint_deliver');
      assert.ok(succeedAction);
      assert.equal(succeedAction.outcome, 'succeeded');
      assert.deepEqual(succeedAction.outputRefs, [{ kind: 'item', id: f.itemId }]);

      const secondReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorSenderId,
        recipientActorId: f.actorSenderId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 2,
        inputHash: createHash('sha256').update('second-deliver').digest('hex'),
        text: '再次移交',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, secondReceipt);

      const secondGoalId = 'goal_second_attempt';
      const secondDraft: AgentProposal = {
        goals: [
          {
            id: secondGoalId,
            summary: '尝试再次移交设计蓝图',
            status: 'active',
            sourceIds: ['source_init'],
            resultIds: [],
          },
        ],
        plans: [],
        actions: [
          {
            id: 'action_second_deliver',
            capability: 'item.deliver',
            targetIds: [f.itemId],
            parameters: {
              itemId: f.itemId,
              recipientActorId: f.actorRecipientId,
            },
            sourceIds: ['source_init'],
            goalId: secondGoalId,
            handlesResponsibilityIds: [],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '试图再次转交已送出的物品。', dependsOnActionIds: [] }],
      };

      const secondSnapshot: AgentSnapshot = {
        state: senderState,
        viewState: structuredClone(senderState),
        redactedStateIds: [],
        worldVersion: 2,
        channel: {
          kind: 'private',
          threadId: f.actorSenderId,
          audienceActorIds: [f.actorSenderId],
          allowedCapabilities: ['item.deliver'],
        },
        input: {
          text: secondReceipt.text,
          sourceId: secondReceipt.id,
          origin: secondReceipt.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: secondReceipt.id,
            kind: 'accepted_input',
            recordId: secondReceipt.id,
            worldVersion: 2,
            at: f.storyNow,
          },
          {
            id: 'source_init',
            kind: 'authored',
            recordId: 'source_init',
            worldVersion: 1,
            at: f.createdTime,
          },
        ],
        observations: [],
        actor: {
          name: '林白语',
          persona: '知性严谨的研究者',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:sender',
        },
      };

      const secondClaim = {
        id: randomUUID(),
        commandId: secondReceipt.commandId!,
        inputReceiptId: secondReceipt.id,
        worldId: f.worldId,
        actorId: f.actorSenderId,
        expectedWorldVersion: 2,
        expectedActorRevision: 1,
        inputHash: secondReceipt.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const secondRes = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(secondDraft);
            },
          },
          kernel,
        },
        f.owner,
        secondClaim,
        secondSnapshot,
      );
      assert.ok(secondRes.eventId);

      const secondActionResults = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorSenderId],
          )
        ).rows.map((r) => r.document);
      });
      const failedSecond = secondActionResults.find((r: any) => r.actionId === 'action_second_deliver');
      assert.ok(failedSecond);
      assert.equal(failedSecond.outcome, 'failed');
      assert.equal(failedSecond.failureCode, 'ITEM_NOT_OWNED_BY_ACTOR');
    },
  );
});
