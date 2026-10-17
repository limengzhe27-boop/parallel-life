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

test('actor capability chain: appointment.cancel end-to-end execution, precondition enforcement, durable outcome and state resolution', async (t) => {
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
    const placeVenue = 'place_restaurant';
    const createdTime = '2026-10-15T10:00:00.000Z';
    const storyNow = '2026-10-15T12:00:00.000Z';
    const scheduledTime = '2026-10-15T14:00:00.000Z';
    const goalId = 'goal_cancel_dinner';
    const respId = 'resp_cancel_dinner';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const initialAppointment = {
      id: appointmentId,
      title: '青青假扮男友约定',
      at: scheduledTime,
      status: 'confirmed',
      participantIds: [actorId, 'player'],
      placeId: placeVenue,
      sourceEventId: event1Id,
    };

    const worldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: '取消能力闭环测试世界',
      version: 1,
      time: storyNow,
      actors: [{ id: actorId, name: '青青', persona: '活泼任性的学妹' }],
      messages: [],
      appointments: [],
      facts: [],
      mediaRequests: [],
      space: {
        currentPlaceId: placeVenue,
        places: [{ id: placeVenue, name: '假扮男友餐厅', appointmentIds: [appointmentId] }],
        routes: [],
      },
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
          summary: '去餐厅假扮男友共进晚餐',
          status: 'active',
          sourceIds: [`source_init`],
          resultIds: [],
        },
      ],
      plans: [
        {
          id: 'plan_cancel_1',
          goalId,
          summary: '前往假扮男友晚宴',
          status: 'active',
          actionIds: ['action_cancel_1'],
          nextActionId: 'action_cancel_1',
          triggers: [],
          missingConditions: [],
          sourceIds: [`source_init`],
        },
      ],
      actions: [],
      responsibilities: [
        {
          id: respId,
          subject: { kind: 'appointment', id: appointmentId },
          summary: '按时前往假扮男友晚宴',
          status: 'open',
          waitingOn: 'player',
          sourceIds: [`source_init`],
          nextCheck: [{ kind: 'at_or_after', at: scheduledTime, sourceId: appointmentId }],
        },
      ],
      decisions: [],
      focus: null,
    };

    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,1,0,$4)',
        [worldId, owner, '取消测试世界', JSON.stringify(worldState)],
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
        'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
        [appointmentId, worldId, owner, initialAppointment],
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
      inputHash: createHash('sha256').update('fixture_input_cancel').digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 1,
      receivedAt: new Date().toISOString(),
      storyAt: storyNow,
      origin: 'player',
      text: '青青，今天突发紧急事情，晚上的饭局去不了了，我们取消吧。',
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
        name: '青青',
        persona: '活泼任性的学妹',
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
      respId,
      goalId,
      scheduledTime,
      storyNow,
      inputReceipt,
      snapshot,
      claim,
    };
  }

  await t.test(
    '1. Precondition enforcement: rejects appointment.cancel when appointment does not exist or is already terminal',
    async () => {
      const f = await fixture();

      // Case A: non-existent appointment
      const fakeApptId = randomUUID();
      const proposalMissing: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_cancel_fake',
            goalId: f.goalId,
            capability: 'appointment.cancel',
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
          { text: '既然取消了，那就算了吧。', dependsOnActionIds: ['action_cancel_fake'] },
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

      // Case B: appointment already cancelled / terminal
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_appointments
           SET document = jsonb_set(document, '{status}', '"cancelled"')
           WHERE world_id=$1 AND id=$2`,
          [f.worldId, f.appointmentId],
        );
      });

      const receipt2: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('fixture_input_cancel_2').digest('hex'),
        channel: 'private',
        threadId: f.actorId,
        recipientActorId: f.actorId,
        expectedWorldVersion: 1,
        receivedAt: new Date().toISOString(),
        storyAt: f.storyNow,
        origin: 'player',
        text: '青青，再次确认取消。',
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

      const proposalTerminal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_cancel_already',
            goalId: f.goalId,
            capability: 'appointment.cancel',
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
        statements: [{ text: '这个已经取消了。', dependsOnActionIds: ['action_cancel_already'] }],
      };

      await assert.rejects(
        async () => {
          await runNpcAgent(
            {
              attempts: store,
              model: {
                async decide() {
                  return JSON.stringify(proposalTerminal);
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
          err.message.includes('APPOINTMENT_ALREADY_TERMINAL') ||
          err.message.includes('INVALID_PROPOSAL'),
      );

      // World state remains unchanged at version 1
      const worldRow = (
        await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId])
      ).rows[0];
      assert.equal(worldRow.version, 1);
    },
  );

  await t.test(
    '2. Complete closed loop: appointment.cancel succeeds, marks appointment cancelled, withdraws responsibility & goal, and advances world',
    async () => {
      const f = await fixture();

      const proposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_cancel_1',
            goalId: f.goalId,
            capability: 'appointment.cancel',
            targetIds: [f.appointmentId],
            parameters: {
              appointmentId: f.appointmentId,
              reason: '玩家因紧急事由取消假扮男友饭局',
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
            text: '好吧哥，那今天就先取消，你先忙正事要紧。',
            dependsOnActionIds: ['action_cancel_1'],
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
      assert.equal(out.state.responsibilities[0]?.status, 'withdrawn');
      assert.equal(out.state.responsibilities[0]?.endReason, '约定已撤回或取消');
      assert.equal(out.state.goals[0]?.status, 'withdrawn');
      assert.equal(out.state.goals[0]?.endReason, '约定目标已撤回');

      // Verification in real PostgreSQL:
      await app.transaction(f.owner, async (sql) => {
        // 1. world_appointments status is 'cancelled'
        const apptRow = (
          await sql.query(
            'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 AND id=$2',
            [f.worldId, f.appointmentId],
          )
        ).rows[0];
        assert.ok(apptRow);
        assert.equal(apptRow.document.status, 'cancelled');

        // 2. agent_action_results contains durable execution evidence
        const actionResults = (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows;
        assert.equal(actionResults.length, 1);
        const res = actionResults[0].document;
        assert.equal(res.actionId, 'action_cancel_1');
        assert.equal(res.outcome, 'succeeded');
        assert.deepEqual(res.handledResponsibilityIds, [f.respId]);
        assert.deepEqual(res.completedGoalIds, [f.goalId]);

        // 3. actor_agent_states is atomically updated to revision 1 with withdrawn status
        const stateRow = (
          await sql.query(
            'SELECT revision, projected_world_version, document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows[0];
        assert.equal(stateRow.revision, 1);
        assert.equal(stateRow.projected_world_version, 2);

        const actorDoc = stateRow.document as ActorAgentState;
        assert.equal(actorDoc.responsibilities[0]?.status, 'withdrawn');
        assert.equal(actorDoc.responsibilities[0]?.resolutionResultId, res.id);
        assert.equal(actorDoc.goals[0]?.status, 'withdrawn');
        assert.deepEqual(actorDoc.goals[0]?.resultIds, [res.id]);

        // 4. world version incremented from 1 to 2, hydrated world has cancelled appointment
        const worldRow = (
          await sql.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId])
        ).rows[0];
        assert.equal(worldRow.version, 2);

        const hydratedWorld = await worlds.get({ userId: f.owner }, f.worldId);
        assert.equal(hydratedWorld.version, 2);
        assert.equal(hydratedWorld.appointments[0]?.status, 'cancelled');
      });
    },
  );
});
