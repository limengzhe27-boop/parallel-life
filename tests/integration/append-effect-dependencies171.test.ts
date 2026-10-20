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
    'a late action cannot revive an appointment cancelled while the model is generating',
    async () => {
      const f = await fixture();
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        release = () => resolve();
      });
      let modelCalls = 0;
      let modelStarted!: () => void;
      const modelGate = new Promise<void>((resolve) => {
        modelStarted = resolve;
      });
      const proposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_cancel_late',
            goalId: f.goalId,
            capability: 'appointment.cancel',
            targetIds: [f.appointmentId],
            parameters: {
              appointmentId: f.appointmentId,
              reason: '迟到的取消行动',
            },
            sourceIds: ['source_init'],
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [f.respId],
            status: 'ready',
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          { text: '我先确认一下这个约定。', dependsOnActionIds: [] },
          { text: '这个约定已经处理好了。', dependsOnActionIds: ['action_cancel_late'] },
        ],
      };
      const run = runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              modelCalls++;
              modelStarted();
              await new Promise<void>((resolve) => {
                release = resolve;
              });
              return JSON.stringify(proposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        f.claim,
        f.snapshot,
      );
      await modelGate;
      await admin.query(
        "UPDATE parallel_life.world_appointments SET document=jsonb_set(document,'{status}','\"cancelled\"') WHERE world_id=$1 AND id=$2",
        [f.worldId, f.appointmentId],
      );
      release();
      let error: unknown = null;
      try {
        await run;
      } catch (caught) {
        error = caught;
      }
      const appointment = (
        await admin.query(
          'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 AND id=$2',
          [f.worldId, f.appointmentId],
        )
      ).rows[0].document;
      assert.equal(appointment.status, 'cancelled');
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(
        world.messages.some((m) => m.text.includes('这个约定已经处理好了')),
        false,
      );
      assert.equal(world.messages.filter((m) => m.text === f.inputReceipt.text).length, 1);
      assert.equal(
        world.messages.some((m) => m.text.includes('我先确认一下这个约定')),
        true,
      );
      assert.equal(modelCalls, 1);
      const actionResults = (
        await admin.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND action_id=$2',
          [f.worldId, 'action_cancel_late'],
        )
      ).rows;
      t.diagnostic('action-results:' + JSON.stringify(actionResults));
      assert.ok(actionResults.length >= 1);
      assert.equal(
        actionResults.some((row) => row.document.status === 'succeeded'),
        false,
      );
      t.diagnostic(
        JSON.stringify({
          error: error instanceof Error ? error.message : error,
          messages: world.messages.map((m) => m.text),
        }),
      );
    },
  );
});
