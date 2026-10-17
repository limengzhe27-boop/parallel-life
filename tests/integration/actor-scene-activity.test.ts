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

test('actor capability chain: activity.participate end-to-end execution, physical co-location verification, co-witnessing and responsibility fulfillment', async (t) => {
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
    const placeTeaHouse = 'place_tea_house';
    const placeGallery = 'place_art_gallery';
    const activityId = 'act_tea_tasting';
    const createdTime = '2026-10-18T09:00:00.000Z';
    const storyNow = '2026-10-18T10:00:00.000Z';
    const teaGoalId = 'goal_tea_tasting';
    const teaRespId = 'resp_tea_tasting';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const initialWorldState: any = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 1,
      title: '现场共同活动与见证闭环测试世界',
      time: storyNow,
      actors: [
        { id: actorLinId, name: '林白语', persona: '知性严谨的研究者' },
        { id: actorQingqingId, name: '青青', persona: '同场闺蜜' },
        { id: actorWangId, name: '王馆长', persona: '身在美术馆的艺术策展人' },
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
          id: teaGoalId,
          summary: '在茶馆与青青共同品鉴明前龙井',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [
        {
          id: teaRespId,
          revision: 0,
          subject: { kind: 'appointment', id: 'apt_tea_meeting' },
          summary: '现场茶道交流与水温探讨',
          status: 'open',
          waitingOn: null,
          sourceIds: ['source_init'],
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
        [worldId, owner, '现场共同活动与见证闭环测试世界', JSON.stringify(initialWorldState)],
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

      // Authoritative positions:
      // 林白语 & 青青 at placeTeaHouse
      // 王馆长 at placeGallery
      await sql.query(
        `INSERT INTO parallel_life.world_authoritative_positions(
          world_id, owner_id, subject_key, source_version, source_event_id, document
        ) VALUES 
        ($1, $2, $3, 1, $6, $7),
        ($1, $2, $4, 1, $6, $8),
        ($1, $2, $5, 1, $6, $9)`,
        [
          worldId,
          owner,
          `actor:${actorLinId}`,
          `actor:${actorQingqingId}`,
          `actor:${actorWangId}`,
          event1Id,
          {
            worldId,
            subject: { kind: 'actor', actorId: actorLinId },
            status: 'at',
            placeId: placeTeaHouse,
            sourceEventId: event1Id,
            worldVersion: 1,
            occurredAt: createdTime,
          },
          {
            worldId,
            subject: { kind: 'actor', actorId: actorQingqingId },
            status: 'at',
            placeId: placeTeaHouse,
            sourceEventId: event1Id,
            worldVersion: 1,
            occurredAt: createdTime,
          },
          {
            worldId,
            subject: { kind: 'actor', actorId: actorWangId },
            status: 'at',
            placeId: placeGallery,
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
      actorLinId,
      actorQingqingId,
      actorWangId,
      placeTeaHouse,
      placeGallery,
      activityId,
      createdTime,
      storyNow,
      teaGoalId,
      teaRespId,
      event1Id,
    };
  }

  await t.test(
    '1. Precondition enforcement: rejects activity.participate when participant not co-located or place mismatch',
    async () => {
      const f = await fixture();
      const kernel = new PostgresNpcAgentKernel(app, worlds);

      // Subtest 1A: cannot declare non-co-located participant (Wang is at placeGallery, Lin is at placeTeaHouse)
      const nonCoLocatedInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorLinId,
        recipientActorId: f.actorLinId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 1,
        inputHash: createHash('sha256').update('non-co-located-activity').digest('hex'),
        text: '邀请不在场的人参与茶道研讨',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, nonCoLocatedInput);

      const nonCoLocatedProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_non_colocated_activity',
            capability: 'activity.participate',
            targetIds: [f.activityId],
            parameters: {
              activityId: f.activityId,
              title: '茶道文化研讨会',
              participantActorIds: [f.actorWangId], // Wang is at placeGallery!
              note: '试图与远在美术馆的王馆长同场交流',
            },
            sourceIds: ['source_init'],
            goalId: f.teaGoalId,
            handlesResponsibilityIds: [f.teaRespId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '我和王馆长一起研讨。', dependsOnActionIds: [] }],
      };

      const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
      const nonCoLocatedSnapshot: AgentSnapshot = {
        state: linState0,
        viewState: structuredClone(linState0),
        redactedStateIds: [],
        worldVersion: 1,
        channel: {
          kind: 'private',
          threadId: f.actorLinId,
          audienceActorIds: [f.actorLinId],
          allowedCapabilities: ['activity.participate'],
        },
        input: {
          text: nonCoLocatedInput.text,
          sourceId: nonCoLocatedInput.id,
          origin: nonCoLocatedInput.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: nonCoLocatedInput.id,
            kind: 'accepted_input',
            recordId: nonCoLocatedInput.id,
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
          definitionRef: 'author:actor:lin',
        },
      };

      const claim1 = {
        id: randomUUID(),
        commandId: nonCoLocatedInput.commandId!,
        inputReceiptId: nonCoLocatedInput.id,
        worldId: f.worldId,
        actorId: f.actorLinId,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: nonCoLocatedInput.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const res1 = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(nonCoLocatedProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim1,
        nonCoLocatedSnapshot,
      );
      assert.ok(res1.eventId);

      const actionResults1 = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorLinId],
          )
        ).rows.map((r) => r.document);
      });
      const failedAction1 = actionResults1.find(
        (r: any) => r.actionId === 'action_non_colocated_activity',
      );
      assert.ok(failedAction1);
      assert.equal(failedAction1.outcome, 'failed');
      assert.equal(failedAction1.failureCode, 'PARTICIPANT_NOT_CO_LOCATED');

      // Subtest 1B: cannot declare mismatching placeId (Lin is at placeTeaHouse, proposes placeGallery)
      const wrongPlaceInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorLinId,
        recipientActorId: f.actorLinId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 2,
        inputHash: createHash('sha256').update('wrong-place-activity').digest('hex'),
        text: '在美术馆开展品茶',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, wrongPlaceInput);

      const wrongPlaceProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_wrong_place_activity',
            capability: 'activity.participate',
            targetIds: [f.activityId],
            parameters: {
              activityId: f.activityId,
              title: '茶道文化研讨会',
              placeId: f.placeGallery, // Lin is at placeTeaHouse!
              participantActorIds: [f.actorQingqingId],
            },
            sourceIds: ['source_init'],
            goalId: f.teaGoalId,
            handlesResponsibilityIds: [f.teaRespId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [{ text: '我在美术馆品茶。', dependsOnActionIds: [] }],
      };

      const linState1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
      const wrongPlaceSnapshot: AgentSnapshot = {
        state: linState1,
        viewState: structuredClone(linState1),
        redactedStateIds: [],
        worldVersion: 2,
        channel: {
          kind: 'private',
          threadId: f.actorLinId,
          audienceActorIds: [f.actorLinId],
          allowedCapabilities: ['activity.participate'],
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
          name: '林白语',
          persona: '知性严谨的研究者',
          boundaries: '不替用户做决定',
          definitionRef: 'author:actor:lin',
        },
      };

      const claim2 = {
        id: randomUUID(),
        commandId: wrongPlaceInput.commandId!,
        inputReceiptId: wrongPlaceInput.id,
        worldId: f.worldId,
        actorId: f.actorLinId,
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
            [f.worldId, f.actorLinId],
          )
        ).rows.map((r) => r.document);
      });
      const failedAction2 = actionResults2.find(
        (r: any) => r.actionId === 'action_wrong_place_activity',
      );
      assert.ok(failedAction2);
      assert.equal(failedAction2.outcome, 'failed');
      assert.equal(failedAction2.failureCode, 'ACTOR_NOT_AT_SPECIFIED_PLACE');
    },
  );

  await t.test(
    '2. End-to-end activity.participate execution: records authoritative activity event, fulfills responsibilities & goals',
    async () => {
      const f = await fixture();
      const kernel = new PostgresNpcAgentKernel(app, worlds);

      const activityInput: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        channel: 'private',
        threadId: f.actorLinId,
        recipientActorId: f.actorLinId,
        commandId: randomUUID(),
        origin: 'player',
        storyAt: f.storyNow,
        expectedWorldVersion: 1,
        inputHash: createHash('sha256').update('execute-tea-activity').digest('hex'),
        text: '在茶馆与青青一同品茶研讨',
        receivedAt: new Date().toISOString(),
      };
      await store.accept(f.owner, activityInput);

      const activityProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_execute_tea_activity',
            capability: 'activity.participate',
            targetIds: [f.activityId],
            parameters: {
              activityId: f.activityId,
              title: '明前龙井品鉴研讨',
              placeId: f.placeTeaHouse,
              participantActorIds: [f.actorQingqingId],
              outcome: '共同探讨了茶道温杯与投茶顺序，达成一致见解',
              note: '在茶馆临窗雅座共度午后时光',
            },
            sourceIds: ['source_init'],
            goalId: f.teaGoalId,
            handlesResponsibilityIds: [f.teaRespId],
            dependsOnActionIds: [],
            preconditions: [],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '温杯后投茶，香气格外纯正。我们达成了一致见解。',
            dependsOnActionIds: ['action_execute_tea_activity'],
          },
        ],
      };

      const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
      const activitySnapshot: AgentSnapshot = {
        state: linState0,
        viewState: structuredClone(linState0),
        redactedStateIds: [],
        worldVersion: 1,
        channel: {
          kind: 'private',
          threadId: f.actorLinId,
          audienceActorIds: [f.actorLinId],
          allowedCapabilities: ['activity.participate'],
        },
        input: {
          text: activityInput.text,
          sourceId: activityInput.id,
          origin: activityInput.origin,
        },
        storyAt: f.storyNow,
        sources: [
          {
            id: activityInput.id,
            kind: 'accepted_input',
            recordId: activityInput.id,
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
          definitionRef: 'author:actor:lin',
        },
      };

      const claim = {
        id: randomUUID(),
        commandId: activityInput.commandId!,
        inputReceiptId: activityInput.id,
        worldId: f.worldId,
        actorId: f.actorLinId,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        inputHash: activityInput.inputHash,
        engineEpoch: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const res = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(activityProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim,
        activitySnapshot,
      );
      assert.ok(res.eventId);

      // Verify action results in database
      const actionResults = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorLinId],
          )
        ).rows.map((r) => r.document);
      });
      const successAction = actionResults.find(
        (r: any) => r.actionId === 'action_execute_tea_activity',
      );
      assert.ok(successAction);
      assert.equal(successAction.outcome, 'succeeded');
      assert.deepEqual(successAction.outputRefs, [{ kind: 'activity', id: f.activityId }]);

      // Verify actor state transitions: responsibility & goal fulfilled
      const updatedLinState = (await store.read(f.owner, {
        worldId: f.worldId,
        actorId: f.actorLinId,
      }))!;
      const resp = updatedLinState.responsibilities.find((r) => r.id === f.teaRespId);
      assert.ok(resp);
      assert.equal(resp.status, 'fulfilled');

      const goal = updatedLinState.goals.find((g) => g.id === f.teaGoalId);
      assert.ok(goal);
      assert.equal(goal.status, 'fulfilled');

      // Verify world state update: activity persisted in authoritative activities list
      const worldDoc = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            f.worldId,
            f.owner,
          ])
        ).rows[0].state;
      });
      assert.ok(worldDoc.activities && worldDoc.activities.length > 0);
      const activity = worldDoc.activities.find((a: any) => a.activityId === f.activityId);
      assert.ok(activity);
      assert.equal(activity.title, '明前龙井品鉴研讨');
      assert.equal(activity.initiatorActorId, f.actorLinId);
      assert.deepEqual(activity.participantActorIds.sort(), [f.actorLinId, f.actorQingqingId].sort());
      assert.equal(activity.placeId, f.placeTeaHouse);
      assert.equal(activity.outcome, '共同探讨了茶道温杯与投茶顺序，达成一致见解');
      assert.equal(activity.note, '在茶馆临窗雅座共度午后时光');
      assert.ok(activity.occurredAt);
      assert.ok(activity.occurredAt.startsWith('2026-10-18T10:00:00'));
    },
  );
});
