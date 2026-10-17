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

test('actor capability chain: item.use end-to-end execution, precondition enforcement, place verification, consumption and reuse prevention', async (t) => {
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
    const otherActorId = randomUUID();
    const placeLab = 'place_biotech_lab';
    const placeGarden = 'place_botanical_garden';
    const keyCardId = 'item_lab_keycard';
    const reagentId = 'item_enzyme_reagent';
    const otherItemId = 'item_personal_diary';
    const createdTime = '2026-10-17T09:00:00.000Z';
    const storyNow = '2026-10-17T10:00:00.000Z';
    const unlockGoalId = 'goal_unlock_lab';
    const unlockRespId = 'resp_unlock_lab';
    const reagentGoalId = 'goal_synthesize_antidote';
    const reagentRespId = 'resp_synthesize_antidote';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const initialWorldState: any = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 1,
      title: '道具使用与消耗闭环测试世界',
      time: storyNow,
      actors: [
        { id: actorId, name: '陈博士', persona: '专注严谨的生物学家' },
        { id: otherActorId, name: '小助手', persona: '实习研究员' },
      ],
      messages: [],
      appointments: [],
      facts: [],
      mediaRequests: [],
      items: [
        {
          id: keyCardId,
          title: '实验室高权限门禁卡',
          kind: 'tool',
          holderActorId: actorId,
          sourceEventId: event1Id,
          transferredAt: createdTime,
          status: 'held',
          note: '通往生化密封舱的门禁卡',
        },
        {
          id: reagentId,
          title: '一次性高纯度生物酶试剂',
          kind: 'material',
          holderActorId: actorId,
          sourceEventId: event1Id,
          transferredAt: createdTime,
          status: 'held',
          note: '用于合成中和解毒剂的限量试剂',
        },
        {
          id: otherItemId,
          title: '小助手的私人观察日记',
          kind: 'document',
          holderActorId: otherActorId,
          sourceEventId: event1Id,
          transferredAt: createdTime,
          status: 'held',
          note: '非陈博士所有的日记本',
        },
      ],
    };

    const actorInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:doctor',
      knowledgeSourceIds: ['source_init'],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: unlockGoalId,
          summary: '使用门禁卡解锁生化实验室',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
        {
          id: reagentGoalId,
          summary: '消耗酶试剂合成中和剂',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [
        {
          id: unlockRespId,
          revision: 0,
          subject: { kind: 'appointment', id: 'apt_lab_access' },
          summary: '开启实验室生化隔离门',
          status: 'open',
          waitingOn: null,
          sourceIds: ['source_init'],
          nextCheck: [],
        },
        {
          id: reagentRespId,
          revision: 0,
          subject: { kind: 'appointment', id: 'apt_reagent_use' },
          summary: '注入生物酶完成反应',
          status: 'open',
          waitingOn: null,
          sourceIds: ['source_init'],
          nextCheck: [],
        },
      ],
      decisions: [],
      focus: null,
    };

    const otherInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: otherActorId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:assistant',
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
        [worldId, owner, '道具使用与消耗闭环测试世界', JSON.stringify(initialWorldState)],
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
      await initializeActorAgentStateInTransaction(sql, owner, actorInitialState);
      await initializeActorAgentStateInTransaction(sql, owner, otherInitialState);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });

      // Authoritative position: actor is at placeLab
      await sql.query(
        `INSERT INTO parallel_life.world_authoritative_positions(
          world_id, owner_id, subject_key, source_version, source_event_id, document
        ) VALUES ($1, $2, $3, 1, $4, $5)`,
        [
          worldId,
          owner,
          `actor:${actorId}`,
          event1Id,
          {
            worldId,
            subject: { kind: 'actor', actorId },
            status: 'at',
            placeId: placeLab,
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
      actorId,
      otherActorId,
      placeLab,
      placeGarden,
      keyCardId,
      reagentId,
      otherItemId,
      createdTime,
      storyNow,
      unlockGoalId,
      unlockRespId,
      reagentGoalId,
      reagentRespId,
      event1Id,
    };
  }

  await t.test(
    '1. Precondition enforcement: rejects item.use when item not owned by actor, or wrong place specified',
    async () => {
      const f = await fixture();
      const kernel = new PostgresNpcAgentKernel(app, worlds);

      // Subtest 1A: cannot use item owned by other actor
      const notOwnedInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 1,
        inputHash: createHash('sha256').update('use-other-item').digest('hex'),
        text: '使用别人的日记本',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, notOwnedInput);

      const notOwnedProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_use_other_item',
            capability: 'item.use',
            targetIds: [f.otherItemId],
            parameters: {
              itemId: f.otherItemId,
              purpose: '查看机密记录',
            },
            sourceIds: ['source_init'],
            goalId: f.unlockGoalId,
            handlesResponsibilityIds: [f.unlockRespId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '我翻开了小助手的日记。', dependsOnActionIds: [] }],
      };

      const state0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const notOwnedSnapshot: AgentSnapshot = {
        state: state0,
        viewState: structuredClone(state0),
        redactedStateIds: [],
        worldVersion: 1,
        channel: {
          kind: 'private',
          threadId: f.actorId,
          audienceActorIds: [f.actorId],
          allowedCapabilities: ['item.use'],
        },
        input: {
          text: notOwnedInput.text,
          sourceId: notOwnedInput.id,
          origin: notOwnedInput.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: notOwnedInput.id,
            kind: 'accepted_input',
            recordId: notOwnedInput.id,
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
          name: '陈博士',
          persona: '专注严谨的生物学家',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:doctor',
        },

      };

      const claim1 = {
        id: randomUUID(),
        commandId: notOwnedInput.commandId!,
        inputReceiptId: notOwnedInput.id,
        worldId: f.worldId,
        actorId: f.actorId,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: notOwnedInput.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const res1 = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(notOwnedProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim1,
        notOwnedSnapshot,
      );
      assert.ok(res1.eventId);

      const actionResults1 = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows.map((r) => r.document);
      });
      const failedAction1 = actionResults1.find((r: any) => r.actionId === 'action_use_other_item');
      assert.ok(failedAction1);
      assert.equal(failedAction1.outcome, 'failed');
      assert.equal(failedAction1.failureCode, 'ITEM_NOT_OWNED_BY_ACTOR');

      // Subtest 1B: wrong placeId specified
      const wrongPlaceInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 2,
        inputHash: createHash('sha256').update('wrong-place-use').digest('hex'),
        text: '在植物园刷卡',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, wrongPlaceInput);

      const wrongPlaceProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_wrong_place_use',
            capability: 'item.use',
            targetIds: [f.keyCardId],
            parameters: {
              itemId: f.keyCardId,
              placeId: f.placeGarden, // Actor is at placeLab!
              purpose: '尝试在植物园刷门禁',
            },
            sourceIds: ['source_init'],
            goalId: f.unlockGoalId,
            handlesResponsibilityIds: [f.unlockRespId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '我在植物园刷卡。', dependsOnActionIds: [] }],
      };

      const state1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const wrongPlaceSnapshot: AgentSnapshot = {
        state: state1,
        viewState: structuredClone(state1),
        redactedStateIds: [],
        worldVersion: 2,
        channel: {
          kind: 'private',
          threadId: f.actorId,
          audienceActorIds: [f.actorId],
          allowedCapabilities: ['item.use'],
        },
        input: {
          text: wrongPlaceInput.text,
          sourceId: wrongPlaceInput.id,
          origin: wrongPlaceInput.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: wrongPlaceInput.id,
            kind: 'accepted_input',
            recordId: wrongPlaceInput.id,
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
          name: '陈博士',
          persona: '专注严谨的生物学家',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:doctor',
        },

      };

      const claim2 = {
        id: randomUUID(),
        commandId: wrongPlaceInput.commandId!,
        inputReceiptId: wrongPlaceInput.id,
        worldId: f.worldId,
        actorId: f.actorId,
        expectedWorldVersion: 2,
        expectedActorRevision: 1,
        inputHash: wrongPlaceInput.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const res2 = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(wrongPlaceProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim2,
        wrongPlaceSnapshot,
      );
      assert.ok(res2.eventId);

      const actionResults2 = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows.map((r) => r.document);
      });
      const failedAction2 = actionResults2.find((r: any) => r.actionId === 'action_wrong_place_use');
      assert.ok(failedAction2);
      assert.equal(failedAction2.outcome, 'failed');
      assert.equal(failedAction2.failureCode, 'ACTOR_NOT_AT_SPECIFIED_PLACE');
    },
  );

  await t.test(
    '2. Standard item usage (non-consumed): marks status=used, records place, updates responsibilities & goals to fulfilled',
    async () => {
      const f = await fixture();
      const kernel = new PostgresNpcAgentKernel(app, worlds);

      const unlockInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 1,
        inputHash: createHash('sha256').update('use-keycard').digest('hex'),
        text: '刷门禁卡开启实验室大门',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, unlockInput);

      const unlockProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_unlock_door',
            capability: 'item.use',
            targetIds: [f.keyCardId],
            parameters: {
              itemId: f.keyCardId,
              title: '实验室高权限门禁卡',
              purpose: '解锁生化隔离门',
              consumed: false,
              note: '在生化实验室读卡器上成功验证高权限证书',
            },
            sourceIds: ['source_init'],
            goalId: f.unlockGoalId,
            handlesResponsibilityIds: [f.unlockRespId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '验证通过，生化隔离门已解锁。',
            dependsOnActionIds: ['action_unlock_door'],
          },
        ],
      };

      const state0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const snapshot: AgentSnapshot = {
        state: state0,
        viewState: structuredClone(state0),
        redactedStateIds: [],
        worldVersion: 1,
        channel: {
          kind: 'private',
          threadId: f.actorId,
          audienceActorIds: [f.actorId],
          allowedCapabilities: ['item.use'],
        },
        input: {
          text: unlockInput.text,
          sourceId: unlockInput.id,
          origin: unlockInput.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: unlockInput.id,
            kind: 'accepted_input',
            recordId: unlockInput.id,
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
          name: '陈博士',
          persona: '专注严谨的生物学家',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:doctor',
        },

      };

      const claim = {
        id: randomUUID(),
        commandId: unlockInput.commandId!,
        inputReceiptId: unlockInput.id,
        worldId: f.worldId,
        actorId: f.actorId,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: unlockInput.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const res = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(unlockProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim,
        snapshot,
      );
      assert.ok(res.eventId);

      // Verify action result in database
      const actionResults = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows.map((r) => r.document);
      });
      const successAction = actionResults.find((r: any) => r.actionId === 'action_unlock_door');
      assert.ok(successAction);
      assert.equal(successAction.outcome, 'succeeded');
      assert.deepEqual(successAction.outputRefs, [{ kind: 'item', id: f.keyCardId }]);

      // Verify actor state transition: responsibility and goal fulfilled
      const updatedActorState = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const resp = updatedActorState.responsibilities.find((r) => r.id === f.unlockRespId);
      assert.ok(resp);
      assert.equal(resp.status, 'fulfilled');

      const goal = updatedActorState.goals.find((g) => g.id === f.unlockGoalId);
      assert.ok(goal);
      assert.equal(goal.status, 'fulfilled');

      // Verify world state update: item marked used
      const worldDoc = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            f.worldId,
            f.owner,
          ])
        ).rows[0].state;
      });
      const cardItem = worldDoc.items.find((i: any) => i.id === f.keyCardId);
      assert.ok(cardItem);
      assert.equal(cardItem.status, 'used');
      assert.equal(cardItem.holderActorId, f.actorId);
      assert.equal(cardItem.usedPlaceId, f.placeLab);
      assert.equal(cardItem.purpose, '解锁生化隔离门');
      assert.equal(cardItem.note, '在生化实验室读卡器上成功验证高权限证书');
      assert.ok(cardItem.usedAt);
      assert.ok(cardItem.usedAt.startsWith('2026-10-17T10:00:00'));
    },
  );

  await t.test(
    '3. Item consumption and prevention of re-use: consumed item cannot be reused, rejects with ITEM_ALREADY_CONSUMED',
    async () => {
      const f = await fixture();
      const kernel = new PostgresNpcAgentKernel(app, worlds);

      // Step 3A: Consume the enzyme reagent
      const consumeInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 1,
        inputHash: createHash('sha256').update('consume-reagent').digest('hex'),
        text: '消耗试剂合成解毒药剂',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, consumeInput);

      const consumeProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_consume_reagent',
            capability: 'item.use',
            targetIds: [f.reagentId],
            parameters: {
              itemId: f.reagentId,
              title: '一次性高纯度生物酶试剂',
              purpose: '完全中和化学污染物',
              consumed: true,
              note: '试剂已完全溶于反应釜中',
            },
            sourceIds: ['source_init'],
            goalId: f.reagentGoalId,
            handlesResponsibilityIds: [f.reagentRespId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '试剂已完全消耗，反应已进入不可逆阶段。',
            dependsOnActionIds: ['action_consume_reagent'],
          },
        ],
      };

      const state0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const consumeSnapshot: AgentSnapshot = {
        state: state0,
        viewState: structuredClone(state0),
        redactedStateIds: [],
        worldVersion: 1,
        channel: {
          kind: 'private',
          threadId: f.actorId,
          audienceActorIds: [f.actorId],
          allowedCapabilities: ['item.use'],
        },
        input: {
          text: consumeInput.text,
          sourceId: consumeInput.id,
          origin: consumeInput.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: consumeInput.id,
            kind: 'accepted_input',
            recordId: consumeInput.id,
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
          name: '陈博士',
          persona: '专注严谨的生物学家',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:doctor',
        },

      };

      const claim1 = {
        id: randomUUID(),
        commandId: consumeInput.commandId!,
        inputReceiptId: consumeInput.id,
        worldId: f.worldId,
        actorId: f.actorId,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: consumeInput.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const res1 = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(consumeProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim1,
        consumeSnapshot,
      );
      assert.ok(res1.eventId);

      // Verify item status in world is now 'consumed'
      const worldAfterConsume = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            f.worldId,
            f.owner,
          ])
        ).rows[0].state;
      });
      const reagentItem = worldAfterConsume.items.find((i: any) => i.id === f.reagentId);
      assert.ok(reagentItem);
      assert.equal(reagentItem.status, 'consumed');
      assert.equal(reagentItem.usedPlaceId, f.placeLab);
      assert.equal(reagentItem.purpose, '完全中和化学污染物');

      // Step 3B: Attempt to reuse the consumed item
      const reuseInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 2,
        inputHash: createHash('sha256').update('reuse-reagent').digest('hex'),
        text: '再次使用已消耗的试剂',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, reuseInput);

      const secondGoalId = 'goal_secondary_reagent_extraction';
      const reuseProposal: AgentProposal = {
        goals: [
          {
            id: secondGoalId,
            summary: '尝试再次提取生物酶试剂',
            status: 'active',
            sourceIds: ['source_init'],
            resultIds: [],
          },
        ],
        plans: [],
        actions: [
          {
            id: 'action_reuse_reagent',
            capability: 'item.use',
            targetIds: [f.reagentId],
            parameters: {
              itemId: f.reagentId,
              purpose: '尝试二次提取',
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
        statements: [
          {
            text: '试剂瓶已经空了，无法再次使用。',
            dependsOnActionIds: [],
          },
        ],
      };

      const state1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const reuseSnapshot: AgentSnapshot = {
        state: state1,
        viewState: structuredClone(state1),
        redactedStateIds: [],
        worldVersion: 2,
        channel: {
          kind: 'private',
          threadId: f.actorId,
          audienceActorIds: [f.actorId],
          allowedCapabilities: ['item.use'],
        },
        input: {
          text: reuseInput.text,
          sourceId: reuseInput.id,
          origin: reuseInput.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: reuseInput.id,
            kind: 'accepted_input',
            recordId: reuseInput.id,
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
          name: '陈博士',
          persona: '专注严谨的生物学家',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:doctor',
        },

      };

      const claim2 = {
        id: randomUUID(),
        commandId: reuseInput.commandId!,
        inputReceiptId: reuseInput.id,
        worldId: f.worldId,
        actorId: f.actorId,
        expectedWorldVersion: 2,
        expectedActorRevision: 1,
        inputHash: reuseInput.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const res2 = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(reuseProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim2,
        reuseSnapshot,
      );
      assert.ok(res2.eventId);

      const actionResults2 = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows.map((r) => r.document);
      });
      const failedReuse = actionResults2.find((r: any) => r.actionId === 'action_reuse_reagent');
      assert.ok(failedReuse);
      assert.equal(failedReuse.outcome, 'failed');
      assert.equal(failedReuse.failureCode, 'ITEM_ALREADY_CONSUMED');
    },
  );
});
