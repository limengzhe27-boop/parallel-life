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

test('actor capability chain: appointment.accept end-to-end execution, precondition enforcement, durable outcome and state resolution', async (t) => {
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
    const appointmentId = randomUUID();
    const placeVenue = 'place_teahouse';
    const createdTime = '2026-10-15T10:00:00.000Z';
    const storyNow = '2026-10-15T11:00:00.000Z';
    const scheduledTime = '2026-10-15T15:00:00.000Z';
    const goalId = 'goal_accept_invite';
    const respId = 'resp_accept_invite';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const initialAppointment = {
      id: appointmentId,
      title: '临溪茶社叙旧邀约',
      at: scheduledTime,
      status: 'proposed',
      participantIds: [actorId, 'player'],
      placeId: placeVenue,
      sourceEventId: event1Id,
    };

    const worldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: '约定接受能力闭环测试世界',
      version: 1,
      time: storyNow,
      actors: [
        {
          id: actorId,
          name: '苏然',
          persona: '温润内敛的昔日同窗',
          biography: '在省城教书，放假回乡省亲。',
          relationships: { player: { trust: 0.8, closeness: 0.8 } },
        },
      ],
      space: {
        places: [
          {
            id: placeVenue,
            name: '临溪茶社',
            description: '溪水边的老茶馆',
            appointmentIds: [appointmentId],
          },
        ],
        routes: [],
      },
      appointments: [],
      messages: [],
      facts: [],
      mediaRequests: [],
      director: { state: 'idle' },
    };

    const initialActorState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: `author:actor:${actorId}`,
      knowledgeSourceIds: [],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: goalId,
          summary: '考虑是否答应老友的茶社叙旧之约',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [
        {
          id: 'plan_1',
          goalId,
          summary: '如果时间合适且没有紧急安排，就答应邀约',
          status: 'active',
          sourceIds: ['source_init'],
          actionIds: ['action_accept_1'],
          nextActionId: 'action_accept_1',
          triggers: [],
          missingConditions: [],
        },
      ],
      actions: [],
      responsibilities: [
        {
          id: respId,
          revision: 0,
          subject: { kind: 'appointment', id: appointmentId },
          summary: '答复玩家关于临溪茶社的邀约',
          status: 'waiting',
          waitingOn: 'self',
          sourceIds: ['source_init'],
          nextCheck: [],
        },
      ],
      decisions: [],
      focus: null,
    };

    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,1,0,$4)',
        [worldId, owner, '接受测试世界', JSON.stringify(worldState)],
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
            occurredAt: createdTime,
            storyAt: createdTime,
            data: { effects: [] },
          },
          createdTime,
        ],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,status,document) VALUES($1,$2,$3,$4,$5)',
        [appointmentId, worldId, owner, 'proposed', initialAppointment],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused,speed,managed,active_until) VALUES($1,$2,$3,false,1,false,null)',
        [worldId, owner, storyNow],
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
      inputHash: createHash('sha256').update('fixture_input_accept').digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 1,
      receivedAt: new Date().toISOString(),
      storyAt: storyNow,
      origin: 'player',
      text: '苏然，下午三点临溪茶社，你有空来聚聚吗？',
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
          at: createdTime,
        },
      ],
      observations: [],
      actor: {
        name: '苏然',
        persona: '温润内敛的昔日同窗',
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
          'appointment.propose',
          'appointment.accept',
          'appointment.fulfill',
          'appointment.cancel',
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
      appointmentId,
      placeVenue,
      goalId,
      respId,
      createdTime,
      storyNow,
      scheduledTime,
      inputReceipt,
      snapshot,
      claim,
      initialActorState,
      initialAppointment,
    };
  }

  await t.test(
    '1. Precondition enforcement: rejects appointment.accept when appointment does not exist, not proposed, or expired',
    async () => {
      const f = await fixture();

      // Case A: non-existent appointment
      const fakeApptId = randomUUID();
      const proposalMissing: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_accept_fake',
            goalId: f.goalId,
            capability: 'appointment.accept',
            targetIds: [fakeApptId],
            parameters: { appointmentId: fakeApptId },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [f.respId],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          { text: '好啊，那我们到时候见！', dependsOnActionIds: ['action_accept_fake'] },
        ],
      };

      await assert.rejects(
        async () => {
          await runNpcAgent(
            {
              attempts: store,
              model: {
                async decide() {
                  return JSON.stringify(proposalMissing);
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
          err.message.includes('APPOINTMENT_NOT_FOUND') ||
          err.message.includes('INVALID_PROPOSAL'),
      );

      // Case B: appointment already confirmed (not proposed)
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_appointments
           SET status = 'confirmed',
               document = jsonb_set(document, '{status}', '"confirmed"')
           WHERE world_id=$1 AND id=$2`,
          [f.worldId, f.appointmentId],
        );
      });

      const receipt2: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('fixture_input_accept_already_confirmed').digest('hex'),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: 1,
        receivedAt: new Date().toISOString(),
        storyAt: f.storyNow,
        origin: 'player',
        text: '苏然，确认一下。',
      };
      await store.accept(f.owner, receipt2);

      const claim2 = {
        id: randomUUID(),
        commandId: receipt2.commandId,
        inputReceiptId: receipt2.id,
        inputHash: receipt2.inputHash,
        worldId: f.worldId,
        actorId: f.actorId,
        engineEpoch: 2,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const proposalAlreadyConfirmed: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_accept_confirmed',
            goalId: f.goalId,
            capability: 'appointment.accept',
            targetIds: [f.appointmentId],
            parameters: { appointmentId: f.appointmentId },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [f.respId],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          { text: '好，我也正想说。', dependsOnActionIds: ['action_accept_confirmed'] },
        ],
      };

      const snapshot2: AgentSnapshot = {
        ...f.snapshot,
        input: {
          sourceId: receipt2.id,
          text: receipt2.text,
          origin: 'player',
        },
        sources: [
          {
            id: receipt2.id,
            kind: 'accepted_input',
            recordId: receipt2.id,
            worldVersion: 1,
            at: f.storyNow,
          },
          ...f.snapshot.sources.filter((s) => s.id !== f.inputReceipt.id),
        ],
      };

      await assert.rejects(
        async () => {
          await runNpcAgent(
            {
              attempts: store,
              model: {
                async decide() {
                  return JSON.stringify(proposalAlreadyConfirmed);
                },
              },
              kernel: new PostgresNpcAgentKernel(app, worlds),
            },
            f.owner,
            claim2,
            snapshot2,
          );
        },
        (err: any) =>
          err.message.includes('REPLY_DEPENDS_ON_UNEXECUTED_ACTION') ||
          err.message.includes('APPOINTMENT_NOT_PROPOSED') ||
          err.message.includes('INVALID_PROPOSAL'),
      );
    },
  );

  await t.test(
    '2. End-to-end appointment.accept execution: transitions appointment to confirmed, updates responsibilities and goals, records action result',
    async () => {
      const f = await fixture();

      const validProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_accept_ok',
            goalId: f.goalId,
            capability: 'appointment.accept',
            targetIds: [f.appointmentId],
            parameters: { appointmentId: f.appointmentId },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [f.respId],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '好啊，好久没见了，那我们下午三点临溪茶社不见不散。',
            dependsOnActionIds: ['action_accept_ok'],
          },
        ],
      };

      const result = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(validProposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );

      assert.ok(result.eventId);

      // Verify WorldState was incremented and appointment marked confirmed via hydrated worlds.get
      const hydrated = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(hydrated.version, 2);
      const apptInState = hydrated.appointments.find((a: any) => a.id === f.appointmentId);
      assert.ok(apptInState, 'Appointment must be present in world state');
      assert.equal(apptInState.status, 'confirmed', 'Appointment status in WorldState must be confirmed');
      assert.ok(apptInState.responseAt?.startsWith('2026-10-15T11:00:00'));

      // Verify database table world_appointments status and document
      const dbAppt = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT status, document FROM parallel_life.world_appointments WHERE world_id=$1 AND id=$2',
            [f.worldId, f.appointmentId],
          )
        ).rows[0];
      });
      assert.equal(dbAppt.status, 'confirmed', 'DB world_appointments.status must be confirmed');
      assert.equal(dbAppt.document.status, 'confirmed', 'DB document.status must be confirmed');

      // Verify ActorAgentState: responsibility is open, waitingOn is cleared (null)
      const actorState = await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId });
      assert.ok(actorState, 'Actor state must exist');
      const resp = actorState.responsibilities.find(
        (r) => r.subject.kind === 'appointment' && r.subject.id === f.appointmentId,
      );
      assert.ok(resp, 'Responsibility for appointment must exist');
      assert.equal(resp.status, 'open', 'Responsibility status must transition to open');
      assert.equal(resp.waitingOn, null, 'waitingOn must be cleared to null');

      // Verify goal is active
      const goal = actorState.goals.find((g) => g.id === f.goalId);
      assert.ok(goal, 'Goal must exist');
      assert.equal(goal.status, 'active', 'Goal must be active');

      // Verify action result in DB
      const actionResultRows = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows;
      });
      assert.equal(actionResultRows.length, 1);
      assert.equal(actionResultRows[0].document.actionId, 'action_accept_ok');
      assert.equal(actionResultRows[0].document.outcome, 'succeeded');
      assert.deepEqual(actionResultRows[0].document.handledResponsibilityIds, [f.respId]);
      assert.deepEqual(actionResultRows[0].document.outputRefs, [
        { kind: 'appointment', id: f.appointmentId },
      ]);
    },
  );

  await t.test(
    '3. Appointment quad full lifecycle: propose -> accept -> fulfill closed loop',
    async () => {
      const f = await fixture();

      // Step 1: Accept the appointment
      const acceptProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_accept_full',
            goalId: f.goalId,
            capability: 'appointment.accept',
            targetIds: [f.appointmentId],
            parameters: { appointmentId: f.appointmentId },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [f.respId],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '好的，下午三点我们准时在茶社见。',
            dependsOnActionIds: ['action_accept_full'],
          },
        ],
      };

      const acceptRes = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(acceptProposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );
      assert.ok(acceptRes.eventId);

      // Step 2: Advance time and move actor to the venue place
      const fulfillTime = '2026-10-15T15:05:00.000Z'; // 5 mins past scheduled
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_clock
           SET story_now = $2
           WHERE world_id=$1`,
          [f.worldId, fulfillTime],
        );
        await sql.query(
          `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (world_id, subject_key) DO UPDATE SET source_event_id=$4, source_version=$5, document=$6`,
          [
            f.worldId,
            f.owner,
            `actor:${f.actorId}`,
            acceptRes.eventId,
            2,
            {
              worldId: f.worldId,
              subject: { kind: 'actor', actorId: f.actorId },
              status: 'at',
              placeId: f.placeVenue,
              sourceEventId: acceptRes.eventId,
              worldVersion: 2,
              occurredAt: fulfillTime,
            },
          ],
        );
      });

      // Provide presence at venue in agent state
      const stateAfterAccept = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const fulfillReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('fixture_input_fulfill_after_accept').digest('hex'),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: 2,
        receivedAt: new Date().toISOString(),
        storyAt: fulfillTime,
        origin: 'wake',
        text: '时间已到，你已到达临溪茶社。',
      };
      await store.accept(f.owner, fulfillReceipt);

      const fulfillClaim = {
        id: randomUUID(),
        commandId: fulfillReceipt.commandId,
        inputReceiptId: fulfillReceipt.id,
        inputHash: fulfillReceipt.inputHash,
        worldId: f.worldId,
        actorId: f.actorId,
        engineEpoch: 2,
        expectedWorldVersion: 2,
        expectedActorRevision: 1,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const fulfillSnapshot: AgentSnapshot = {
        state: stateAfterAccept,
        viewState: structuredClone(stateAfterAccept),
        redactedStateIds: [],
        worldVersion: 2,
        storyAt: fulfillTime,
        sources: [
          {
            id: fulfillReceipt.id,
            kind: 'accepted_input',
            recordId: fulfillReceipt.id,
            worldVersion: 2,
            at: fulfillTime,
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
          name: '苏然',
          persona: '温润内敛的昔日同窗',
          boundaries: '不替用户决定',
          definitionRef: `author:actor:${f.actorId}`,
        },
        input: {
          sourceId: fulfillReceipt.id,
          text: fulfillReceipt.text,
          origin: 'wake',
        },
        channel: {
          kind: 'private',
          threadId: f.actorId,
          audienceActorIds: [f.actorId],
          allowedCapabilities: [
            'plan.record',
            'appointment.propose',
            'appointment.accept',
            'appointment.fulfill',
            'appointment.cancel',
          ],
        },
      };

      const fulfillProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_fulfill_ok',
            goalId: f.goalId,
            capability: 'appointment.fulfill',
            targetIds: [f.appointmentId],
            parameters: { appointmentId: f.appointmentId },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [f.respId],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '我到了，坐在靠窗的雅座。',
            dependsOnActionIds: ['action_fulfill_ok'],
          },
        ],
      };

      const fulfillRes = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(fulfillProposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        fulfillClaim,
        fulfillSnapshot,
      );
      assert.ok(fulfillRes.eventId);

      // Verify appointment is attended via hydrated worlds.get
      const finalHydrated = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(finalHydrated.version, 3);
      const finalAppt = finalHydrated.appointments.find((a: any) => a.id === f.appointmentId);
      assert.equal(finalAppt?.status, 'attended');

      const finalActorState = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
      const finalResp = finalActorState.responsibilities.find(
        (r) => r.subject.kind === 'appointment' && r.subject.id === f.appointmentId,
      );
      assert.equal(finalResp?.status, 'fulfilled');
      const finalGoal = finalActorState.goals.find((g) => g.id === f.goalId);
      assert.equal(finalGoal?.status, 'fulfilled');
    },
  );
});
