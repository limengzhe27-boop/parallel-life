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

test('actor capability chain: relationship.bond end-to-end execution, self-bonding guard, target validation, tie persistence and responsibility fulfillment', async (t) => {
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
    const actorLinId = randomUUID();
    const actorQingqingId = randomUUID();
    const actorWangId = randomUUID();
    const storyNow = '2026-10-18T10:00:00.000Z';
    const createdTime = '2026-10-18T09:00:00.000Z';
    const bondGoalId = 'goal_bond_partner';
    const bondRespId = 'resp_bond_partner';
    const event1Id = randomUUID();

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const initialWorldState: any = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 1,
      title: '人际关系与羁绊深化闭环测试世界',
      time: storyNow,
      actors: [
        { id: actorLinId, name: '林白语', persona: '知性严谨的手作人' },
        { id: actorQingqingId, name: '青青', persona: '多年闺蜜与设计搭档' },
        { id: actorWangId, name: '王馆长', persona: '美术馆馆长' },
      ],
      actorTies: [
        {
          fromActorId: actorLinId,
          toActorId: actorQingqingId,
          relationship: '熟络的朋友',
          mayShare: true,
        },
      ],
      messages: [],
      appointments: [],
      facts: [],
      mediaRequests: [],
      items: [],
      activities: [],
    };

    const linInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: actorLinId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:lin',
      knowledgeSourceIds: ['source_init'],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: bondGoalId,
          summary: '与青青结成手作工坊合伙人羁绊',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [
        {
          id: bondRespId,
          revision: 0,
          status: 'open',
          waitingOn: null,
          summary: '确立合伙人关系与信任羁绊',
          sourceIds: ['source_init'],
          subject: { kind: 'matter', id: 'matter_partnership' },
          nextCheck: [],
        },
      ],
      decisions: [],
      focus: null,
    };

    const qingqingInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: actorQingqingId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:qingqing',
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

    const wangInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: actorWangId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:wang',
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
        [worldId, owner, '人际关系与羁绊深化闭环测试世界', JSON.stringify(initialWorldState)],
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
      await initializeActorAgentStateInTransaction(sql, owner, linInitialState);
      await initializeActorAgentStateInTransaction(sql, owner, qingqingInitialState);
      await initializeActorAgentStateInTransaction(sql, owner, wangInitialState);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });
    });

    return {
      owner,
      worldId,
      actorLinId,
      actorQingqingId,
      actorWangId,
      storyNow,
      createdTime,
      bondGoalId,
      bondRespId,
    };
  }

  await t.test('1. rejection: self-bonding is rejected with ACTOR_CANNOT_BOND_SELF', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorLinId,
      recipientActorId: f.actorLinId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('self-bond-check').digest('hex'),
      text: '我们认识这么久，关系该怎么定义？',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_self_bond';
    const proposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.bondGoalId,
          capability: 'relationship.bond',
          targetIds: [f.actorLinId],
          parameters: {
            targetActorId: f.actorLinId, // self-bond
            relationship: '自我灵魂伴侣',
          },
          sourceIds: ['source_init'],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '我与自己确立羁绊', dependsOnActionIds: [] }],
    };

    const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    const snapshot: AgentSnapshot = {
      state: linState0,
      viewState: structuredClone(linState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['relationship.bond'],
      },
      input: {
        text: inputReceipt.text,
        sourceId: inputReceipt.id,
        origin: inputReceipt.origin,
      },
      storyAt: f.storyNow,
      sources: [
        {
          id: inputReceipt.id,
          kind: 'accepted_input',
          recordId: inputReceipt.id,
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
        persona: '知性严谨的手作人',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:lin',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorLinId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const runResult = await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
        kernel,
      },
      f.owner,
      claim,
      snapshot,
    );

    assert.ok(runResult.eventId);
    const actionResults = await app.transaction(f.owner, async (sql) => {
      return (
        await sql.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
          [f.worldId, f.actorLinId],
        )
      ).rows.map((r) => r.document);
    });

    const failedAction = actionResults.find((r: any) => r.actionId === actionId);
    assert.ok(failedAction, 'Action result must exist');
    assert.equal(failedAction.outcome, 'failed');
    assert.equal(failedAction.failureCode, 'ACTOR_CANNOT_BOND_SELF');
  });

  await t.test('2. rejection: non-existent target is rejected with TARGET_ACTOR_NOT_FOUND', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorLinId,
      recipientActorId: f.actorLinId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('target-not-found-check').digest('hex'),
      text: '认识那个人吗？',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_unknown_target_bond';
    const nonExistentActorId = randomUUID();
    const proposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.bondGoalId,
          capability: 'relationship.bond',
          targetIds: [nonExistentActorId],
          parameters: {
            targetActorId: nonExistentActorId,
            relationship: '合作伙伴',
          },
          sourceIds: ['source_init'],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '我和他确立关系', dependsOnActionIds: [] }],
    };

    const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    const snapshot: AgentSnapshot = {
      state: linState0,
      viewState: structuredClone(linState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['relationship.bond'],
      },
      input: {
        text: inputReceipt.text,
        sourceId: inputReceipt.id,
        origin: inputReceipt.origin,
      },
      storyAt: f.storyNow,
      sources: [
        {
          id: inputReceipt.id,
          kind: 'accepted_input',
          recordId: inputReceipt.id,
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
        persona: '知性严谨的手作人',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:lin',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorLinId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const runResult = await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
        kernel,
      },
      f.owner,
      claim,
      snapshot,
    );

    assert.ok(runResult.eventId);
    const actionResults = await app.transaction(f.owner, async (sql) => {
      return (
        await sql.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
          [f.worldId, f.actorLinId],
        )
      ).rows.map((r) => r.document);
    });

    const failedAction = actionResults.find((r: any) => r.actionId === actionId);
    assert.ok(failedAction, 'Action result must exist');
    assert.equal(failedAction.outcome, 'failed');
    assert.equal(failedAction.failureCode, 'TARGET_ACTOR_NOT_FOUND');
  });

  await t.test('3. execution: relationship.bond succeeds, updates world.actorTies, saves relationshipIds, and fulfills goal & responsibility', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorLinId,
      recipientActorId: f.actorLinId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('bond-success-check').digest('hex'),
      text: '从今天起，我们就是手作工坊的正式合伙人了！',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_bond_partner';
    const proposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.bondGoalId,
          capability: 'relationship.bond',
          targetIds: [f.actorQingqingId],
          parameters: {
            targetActorId: f.actorQingqingId,
            relationship: '手作工坊合伙人',
            mayShare: true,
            reason: '共同创立阿那亚手作工坊并确立正式合伙信任',
            note: '经过长期设计与技艺磨合，双方达成全面合伙意向',
          },
          sourceIds: ['source_init'],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.bondRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [
        {
          text: '青青，从今天起，我们正式确立合伙人身份，一起把手作坊经营好！',
          dependsOnActionIds: [actionId],
        },
      ],
    };

    const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    const snapshot: AgentSnapshot = {
      state: linState0,
      viewState: structuredClone(linState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['relationship.bond'],
      },
      input: {
        text: inputReceipt.text,
        sourceId: inputReceipt.id,
        origin: inputReceipt.origin,
      },
      storyAt: f.storyNow,
      sources: [
        {
          id: inputReceipt.id,
          kind: 'accepted_input',
          recordId: inputReceipt.id,
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
        persona: '知性严谨的手作人',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:lin',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorLinId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const runResult = await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
        kernel,
      },
      f.owner,
      claim,
      snapshot,
    );

    assert.ok(runResult.eventId);
    const actionResults = await app.transaction(f.owner, async (sql) => {
      return (
        await sql.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
          [f.worldId, f.actorLinId],
        )
      ).rows.map((r) => r.document);
    });

    const successAction = actionResults.find((r: any) => r.actionId === actionId);
    assert.ok(successAction, 'Action result must exist');
    assert.equal(successAction.outcome, 'succeeded');
    assert.deepEqual(successAction.completedGoalIds, [f.bondGoalId]);
    assert.deepEqual(successAction.handledResponsibilityIds, [f.bondRespId]);
    assert.deepEqual(successAction.outputRefs, [
      { kind: 'relationship', id: `${f.actorLinId}:${f.actorQingqingId}` },
    ]);

    // Verify WorldState was updated via reducer
    const updatedWorld = await worlds.get({ userId: f.owner }, f.worldId);
    assert.equal(updatedWorld.version, 2);

    const tie = updatedWorld.actorTies?.find(
      (t) => t.fromActorId === f.actorLinId && t.toActorId === f.actorQingqingId,
    );
    assert.ok(tie, 'ActorTie must exist in WorldState');
    assert.equal(tie.relationship, '手作工坊合伙人');
    assert.equal(tie.mayShare, true);

    const qingqingActor = updatedWorld.actors.find((a) => a.id === f.actorQingqingId);
    assert.equal(qingqingActor?.relationship, '手作工坊合伙人');

    // Verify Lin's ActorAgentState
    const linState1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    assert.ok(linState1, 'Lin state must be persisted');
    assert.ok(
      linState1.relationshipIds.includes(`${f.actorLinId}:${f.actorQingqingId}`),
      'relationshipIds must include newly formed tie key',
    );

    const goal = linState1.goals.find((g) => g.id === f.bondGoalId);
    assert.equal(goal?.status, 'fulfilled', 'Goal must be fulfilled');

    const resp = linState1.responsibilities.find((r) => r.id === f.bondRespId);
    assert.equal(resp?.status, 'fulfilled', 'Responsibility must be fulfilled');
  });
});
