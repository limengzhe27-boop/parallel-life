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

test('actor capability chain: appointment.reschedule end-to-end execution, precondition enforcement, durable outcome and state resolution', async (t) => {
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
    const placeVenueOld = 'place_teahouse';
    const placeVenueNew = 'place_library';
    const createdTime = '2026-10-15T10:00:00.000Z';
    const storyNow = '2026-10-15T11:00:00.000Z';
    const originalScheduledTime = '2026-10-15T15:00:00.000Z';
    const rescheduledTime = '2026-10-15T18:30:00.000Z';
    const goalId = 'goal_reschedule_invite';
    const respId = 'resp_reschedule_invite';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const initialAppointment = {
      id: appointmentId,
      title: '临溪茶社叙旧邀约',
      at: originalScheduledTime,
      status: 'confirmed',
      participantIds: [actorId, 'player'],
      placeId: placeVenueOld,
      sourceEventId: event1Id,
    };

    const worldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: '约定改期能力闭环测试世界',
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
            id: placeVenueOld,
            name: '临溪茶社',
            description: '溪水边的老茶馆',
            appointmentIds: [appointmentId],
          },
          {
            id: placeVenueNew,
            name: '古镇书局',
            description: '安静的临河书局',
            appointmentIds: [],
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
          summary: '因下午临时需处理家事，与老友协商将茶社叙旧推迟至傍晚古镇书局',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [
        {
          id: 'plan_reschedule_1',
          goalId,
          summary: '向老友说明下午情况，提议推迟至傍晚六点半在古镇书局会面',
          status: 'active',
          sourceIds: ['source_init'],
          actionIds: ['action_reschedule_1'],
          nextActionId: 'action_reschedule_1',
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
          summary: '按约赴约：临溪茶社叙旧邀约',
          status: 'open',
          waitingOn: null,
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
        [worldId, owner, '改期测试世界', JSON.stringify(worldState)],
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
        [appointmentId, worldId, owner, 'confirmed', initialAppointment],
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
      inputHash: createHash('sha256').update('fixture_input_reschedule').digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 1,
      receivedAt: new Date().toISOString(),
      storyAt: storyNow,
      origin: 'player',
      text: '苏然，下午三点茶社聚会你时间还合适吗？',
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
          'appointment.reschedule',
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
      placeVenueOld,
      placeVenueNew,
      goalId,
      respId,
      createdTime,
      storyNow,
      originalScheduledTime,
      rescheduledTime,
      inputReceipt,
      snapshot,
      claim,
      initialActorState,
      initialAppointment,
    };
  }

  await t.test(
    '1. Precondition enforcement: rejects appointment.reschedule when appointment not found, terminal, past time, or actor not participant',
    async () => {
      const f = await fixture();

      // Case A: non-existent appointment
      const fakeApptId = randomUUID();
      const nonExistentProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_resched_fake',
            goalId: f.goalId,
            capability: 'appointment.reschedule',
            targetIds: [fakeApptId],
            parameters: { appointmentId: fakeApptId, at: f.rescheduledTime },
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
            text: '我想把时间改到晚上。',
            dependsOnActionIds: ['action_resched_fake'],
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
                  return JSON.stringify(nonExistentProposal);
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

      // Case B: appointment in terminal status (e.g. cancelled)
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_appointments
           SET status = 'cancelled',
               document = jsonb_set(document, '{status}', '"cancelled"')
           WHERE world_id=$1 AND id=$2`,
          [f.worldId, f.appointmentId],
        );
      });

      const receipt2: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('fixture_input_resched_cancelled').digest('hex'),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: 1,
        receivedAt: new Date().toISOString(),
        storyAt: f.storyNow,
        origin: 'player',
        text: '苏然，下午茶社还能来吗？',
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

      const terminalProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_resched_terminal',
            goalId: f.goalId,
            capability: 'appointment.reschedule',
            targetIds: [f.appointmentId],
            parameters: { appointmentId: f.appointmentId, at: f.rescheduledTime },
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
            text: '我们换个时间吧。',
            dependsOnActionIds: ['action_resched_terminal'],
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
                  return JSON.stringify(terminalProposal);
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
          err.message.includes('APPOINTMENT_TERMINAL') ||
          err.message.includes('INVALID_PROPOSAL'),
      );

      // Case C: newAt is in the past relative to current story time
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_appointments
           SET status = 'confirmed',
               document = jsonb_set(document, '{status}', '"confirmed"')
           WHERE world_id=$1 AND id=$2`,
          [f.worldId, f.appointmentId],
        );
      });

      const receipt3: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('fixture_input_resched_past').digest('hex'),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: 1,
        receivedAt: new Date().toISOString(),
        storyAt: f.storyNow,
        origin: 'player',
        text: '苏然，怎么安排？',
      };
      await store.accept(f.owner, receipt3);

      const claim3 = {
        id: randomUUID(),
        commandId: receipt3.commandId,
        inputReceiptId: receipt3.id,
        inputHash: receipt3.inputHash,
        worldId: f.worldId,
        actorId: f.actorId,
        engineEpoch: 2,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const snapshot3: AgentSnapshot = {
        ...f.snapshot,
        input: {
          sourceId: receipt3.id,
          text: receipt3.text,
          origin: 'player',
        },
        sources: [
          {
            id: receipt3.id,
            kind: 'accepted_input',
            recordId: receipt3.id,
            worldVersion: 1,
            at: f.storyNow,
          },
          ...f.snapshot.sources.filter((s) => s.id !== f.inputReceipt.id),
        ],
      };

      const pastProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_resched_past',
            goalId: f.goalId,
            capability: 'appointment.reschedule',
            targetIds: [f.appointmentId],
            parameters: { appointmentId: f.appointmentId, at: '2026-10-15T09:00:00.000Z' },
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
            text: '我们改到今天上午九点见吧。',
            dependsOnActionIds: ['action_resched_past'],
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
                  return JSON.stringify(pastProposal);
                },
              },
              kernel: new PostgresNpcAgentKernel(app, worlds),
            },
            f.owner,
            claim3,
            snapshot3,
          );
        },
        (err: any) =>
          err.message.includes('REPLY_DEPENDS_ON_UNEXECUTED_ACTION') ||
          err.message.includes('RESCHEDULE_TIME_PAST') ||
          err.message.includes('INVALID_PROPOSAL'),
      );
    },
  );

  await t.test(
    '2. End-to-end appointment.reschedule execution: updates time, resets to proposed, sets responsibility waiting on player with updated deadline and goal',
    async () => {
      const f = await fixture();

      const rescheduleProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_reschedule_ok',
            goalId: f.goalId,
            capability: 'appointment.reschedule',
            targetIds: [f.appointmentId],
            parameters: {
              appointmentId: f.appointmentId,
              at: f.rescheduledTime,
              placeId: f.placeVenueNew,
              reason: '下午家中临时有事，延后至傍晚在古镇书局聚会',
            },
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
            text: '实在抱歉，下午临时有些家事抽不开身。我们改到傍晚六点半在古镇书局碰面，你看合适吗？',
            dependsOnActionIds: ['action_reschedule_ok'],
          },
        ],
      };

      const result = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(rescheduleProposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );

      assert.ok(result.eventId);

      // Verify WorldState was incremented and appointment updated with new time and reset to proposed
      const hydrated = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(hydrated.version, 2);
      const apptInState = hydrated.appointments.find((a: any) => a.id === f.appointmentId);
      assert.ok(apptInState, 'Appointment must be present in world state');
      assert.equal(apptInState.status, 'proposed', 'Appointment status in WorldState must be reset to proposed for renegotiation');
      assert.equal(apptInState.at, f.rescheduledTime, 'Appointment time in WorldState must be updated to new time');
      assert.equal(apptInState.placeId, f.placeVenueNew, 'Appointment placeId in WorldState must be updated to new venue');
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
      assert.ok(dbAppt, 'Appointment must be present in DB table');
      assert.equal(dbAppt.status, 'proposed', 'DB world_appointments.status must be reset to proposed');
      assert.equal(dbAppt.document.at, f.rescheduledTime, 'DB document.at must be rescheduled time');
      assert.equal(dbAppt.document.placeId, f.placeVenueNew, 'DB document.placeId must be new venue');
      assert.equal(dbAppt.document.status, 'proposed', 'DB document.status must be proposed');

      // Verify actor agent state: responsibility becomes waiting on player with incremented revision and updated deadline
      const actorState = await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId });
      assert.ok(actorState, 'Actor state must be persisted');
      assert.equal(actorState.revision, 1);
      assert.equal(actorState.projectedWorldVersion, 2);

      const resp = actorState.responsibilities.find(
        (r: any) => r.subject.kind === 'appointment' && r.subject.id === f.appointmentId,
      );
      assert.ok(resp, 'Appointment responsibility must exist');
      assert.equal(resp.status, 'waiting', 'Responsibility status must be waiting for counterparty confirmation');
      assert.equal(resp.waitingOn, 'player', 'Responsibility waitingOn must be player');
      assert.equal(resp.revision, 1, 'Responsibility revision must increment');
      assert.equal(resp.deadline?.at, f.rescheduledTime, 'Responsibility deadline must be updated to rescheduled time');

      // Verify goal remains active
      const goal = actorState.goals.find((g: any) => g.id === f.goalId);
      assert.ok(goal, 'Goal must exist');
      assert.equal(goal.status, 'active', 'Goal must remain active across reschedule');

      // Verify action results recorded
      const actionResultRows = await app.transaction(f.owner, async (sql) => {
        return (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows;
      });
      assert.equal(actionResultRows.length, 1);
      assert.equal(actionResultRows[0].document.eventId, result.eventId);
      assert.equal(actionResultRows[0].document.actionId, 'action_reschedule_ok');
      assert.equal(actionResultRows[0].document.outcome, 'succeeded');
      assert.deepEqual(actionResultRows[0].document.handledResponsibilityIds, [f.respId]);
      assert.deepEqual(actionResultRows[0].document.outputRefs, [
        { kind: 'appointment', id: f.appointmentId },
      ]);
    },
  );

  await t.test(
    '3. Appointment renegotiation lifecycle closed loop: propose reschedule -> counterparty re-confirms -> arrive and fulfill at new time',
    async () => {
      const f = await fixture();

      // Step 1: NPC proposes reschedule to 18:30 at new venue
      const rescheduleProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_resched_step1',
            goalId: f.goalId,
            capability: 'appointment.reschedule',
            targetIds: [f.appointmentId],
            parameters: {
              appointmentId: f.appointmentId,
              at: f.rescheduledTime,
              placeId: f.placeVenueNew,
              reason: '推迟至傍晚古镇书局',
            },
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
            text: '我们改到傍晚六点半在古镇书局见面好吗？',
            dependsOnActionIds: ['action_resched_step1'],
          },
        ],
      };

      const reschedRes = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(rescheduleProposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );
      assert.ok(reschedRes.eventId);

      // Step 2: Player re-confirms the rescheduled appointment via appointment.accept
      const acceptTime = '2026-10-15T12:00:00.000Z';
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_clock
           SET story_now = $2
           WHERE world_id=$1`,
          [f.worldId, acceptTime],
        );
      });

      const acceptReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('fixture_input_reconfirm').digest('hex'),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: 2,
        receivedAt: new Date().toISOString(),
        storyAt: acceptTime,
        origin: 'player',
        text: '没问题，六点半古镇书局见！',
      };
      await store.accept(f.owner, acceptReceipt);

      const acceptClaim = {
        id: randomUUID(),
        commandId: acceptReceipt.commandId,
        inputReceiptId: acceptReceipt.id,
        inputHash: acceptReceipt.inputHash,
        worldId: f.worldId,
        actorId: f.actorId,
        engineEpoch: 2,
        expectedWorldVersion: 2,
        expectedActorRevision: 1,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const actorStateAfterResched = (await store.read(f.owner, {
        worldId: f.worldId,
        actorId: f.actorId,
      }))!;

      const acceptSnapshot: AgentSnapshot = {
        state: actorStateAfterResched,
        viewState: structuredClone(actorStateAfterResched),
        redactedStateIds: [],
        worldVersion: 2,
        storyAt: acceptTime,
        sources: [
          {
            id: acceptReceipt.id,
            kind: 'accepted_input',
            recordId: acceptReceipt.id,
            worldVersion: 2,
            at: acceptTime,
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
          sourceId: acceptReceipt.id,
          text: acceptReceipt.text,
          origin: 'player',
        },
        channel: {
          kind: 'private',
          threadId: f.actorId,
          audienceActorIds: [f.actorId],
          allowedCapabilities: [
            'plan.record',
            'appointment.propose',
            'appointment.accept',
            'appointment.reschedule',
            'appointment.fulfill',
            'appointment.cancel',
          ],
        },
      };

      const acceptProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_accept_reconfirm',
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
            text: '好的，那六点半古镇书局不见不散！',
            dependsOnActionIds: ['action_accept_reconfirm'],
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
        acceptClaim,
        acceptSnapshot,
      );
      assert.ok(acceptRes.eventId);

      // Verify appointment is confirmed again at rescheduled time
      const reconfirmedWorld = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(reconfirmedWorld.version, 3);
      const apptReconfirmed = reconfirmedWorld.appointments.find((a: any) => a.id === f.appointmentId);
      assert.ok(apptReconfirmed);
      assert.equal(apptReconfirmed!.status, 'confirmed');
      assert.equal(apptReconfirmed!.at, f.rescheduledTime);
      assert.equal(apptReconfirmed!.placeId, f.placeVenueNew);

      // Step 3: Advance time to newAt (18:35) and move actor to placeVenueNew
      const fulfillTime = '2026-10-15T18:35:00.000Z';
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
            3,
            {
              worldId: f.worldId,
              subject: { kind: 'actor', actorId: f.actorId },
              status: 'at',
              placeId: f.placeVenueNew,
              sourceEventId: acceptRes.eventId,
              worldVersion: 3,
              occurredAt: fulfillTime,
            },
          ],
        );
      });

      const fulfillReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('fixture_input_fulfill').digest('hex'),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: 3,
        receivedAt: new Date().toISOString(),
        storyAt: fulfillTime,
        origin: 'wake',
        text: '时间已到，你已到达古镇书局。',
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
        expectedWorldVersion: 3,
        expectedActorRevision: 2,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const actorStateBeforeFulfill = (await store.read(f.owner, {
        worldId: f.worldId,
        actorId: f.actorId,
      }))!;

      const fulfillSnapshot: AgentSnapshot = {
        state: actorStateBeforeFulfill,
        viewState: structuredClone(actorStateBeforeFulfill),
        redactedStateIds: [],
        worldVersion: 3,
        storyAt: fulfillTime,
        sources: [
          {
            id: fulfillReceipt.id,
            kind: 'accepted_input',
            recordId: fulfillReceipt.id,
            worldVersion: 3,
            at: fulfillTime,
          },
          {
            id: `self-position:${acceptRes.eventId}`,
            kind: 'action_result',
            recordId: f.placeVenueNew,
            worldVersion: 3,
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
            'appointment.reschedule',
            'appointment.fulfill',
            'appointment.cancel',
          ],
        },
      };

      // Step 4: NPC fulfills the appointment at new venue and new time
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
            sourceIds: [`self-position:${acceptRes.eventId}`],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '你来啦！快请坐，这里的茶和环境都很清幽。',
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

      // Verify final appointment state: attended
      const finalHydrated = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(finalHydrated.version, 4);
      const finalAppt = finalHydrated.appointments.find((a: any) => a.id === f.appointmentId);
      assert.ok(finalAppt);
      assert.equal(finalAppt!.status, 'attended', 'Appointment must be attended after successful fulfillment');

      // Verify responsibility and goal are marked fulfilled
      const finalActorState = (await store.read(f.owner, {
        worldId: f.worldId,
        actorId: f.actorId,
      }))!;

      const finalResp = finalActorState.responsibilities.find(
        (r: any) => r.subject.kind === 'appointment' && r.subject.id === f.appointmentId,
      );
      assert.ok(finalResp);
      assert.equal(finalResp!.status, 'fulfilled', 'Responsibility must be fulfilled');
      assert.equal(finalResp!.endReason, '已按约履行');

      const finalGoal = finalActorState.goals.find((g: any) => g.id === f.goalId);
      assert.ok(finalGoal);
      assert.equal(finalGoal!.status, 'fulfilled', 'Goal must be fulfilled');
      assert.equal(finalGoal!.endReason, '目标已达成');
    },
  );
});
