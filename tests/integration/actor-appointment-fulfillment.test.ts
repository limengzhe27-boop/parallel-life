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

test('actor capability chain: appointment.fulfill end-to-end execution, precondition enforcement, durable outcome and state resolution', async (t) => {
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
    const placeVenue = 'place_cafe';
    const placeOther = 'place_park';
    const scheduledTime = '2026-10-15T14:00:00.000Z';
    const storyNow = '2026-10-15T14:30:00.000Z';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const initialAppointment = {
      id: appointmentId,
      title: '红砖小馆学术探讨',
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
      title: '履约能力闭环测试世界',
      version: 1,
      time: storyNow,
      actors: [{ id: actorId, name: '林白语', persona: '知性严谨的研究者' }],
      messages: [],
      appointments: [],
      facts: [],
      mediaRequests: [],
      space: {
        currentPlaceId: placeVenue,
        places: [
          { id: placeVenue, name: '红砖小馆', appointmentIds: [appointmentId] },
          { id: placeOther, name: '城西街心公园', appointmentIds: [] },
        ],
        routes: [
          {
            id: 'route_1',
            fromPlaceId: placeVenue,
            toPlaceId: placeOther,
            distanceMeters: 500,
            timeSec: 300,
          },
        ],
      },
    };

    const respId = `resp_${appointmentId}`;
    const goalId = `goal_meet_${appointmentId}`;

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
          summary: '赴约并交付学术探讨资料',
          status: 'active',
          sourceIds: [`source_init`],
          resultIds: [],
        },
      ],
      plans: [
        {
          id: 'plan_1',
          goalId,
          summary: '按时到达小馆与玩家会面',
          status: 'active',
          actionIds: ['action_fulfill_1'],
          nextActionId: 'action_fulfill_1',
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
          summary: '红砖小馆学术探讨',
          status: 'open',
          waitingOn: 'player',
          sourceIds: [`source_init`],
          nextCheck: [{ kind: 'at_or_after', at: scheduledTime, sourceId: appointmentId }],
        },
      ],
      decisions: [],
      focus: null,
    };

    // Setup world and switch to epoch 2
    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,1,0,$4)',
        [worldId, owner, '履约测试世界', JSON.stringify(worldState)],
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
            occurredAt: scheduledTime,
            storyAt: scheduledTime,
            data: { effects: [] },
          },
          scheduledTime,
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

      // Record authoritative position of actor at the venue
      await sql.query(
        `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
         VALUES($1,$2,$3,NULL,0,$4)`,
        [
          worldId,
          owner,
          `actor:${actorId}`,
          {
            worldId,
            subject: { kind: 'actor', actorId },
            status: 'at',
            placeId: placeVenue,
            sourceEventId: null,
            worldVersion: 0,
            occurredAt: scheduledTime,
          },
        ],
      );
    });

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update('fixture_input').digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 1,
      receivedAt: new Date().toISOString(),
      storyAt: storyNow,
      origin: 'player',
      text: '我已到达小馆。',
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
          at: scheduledTime,
        },
      ],
      observations: [],
      actor: {
        name: '林白语',
        persona: '知性严谨的研究者',
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
        allowedCapabilities: ['plan.record', 'appointment.propose', 'appointment.fulfill'],
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
      placeOther,
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
    '1. Precondition enforcement: rejects appointment.fulfill when actor is not at venue',
    async () => {
      const f = await fixture();

      // Move actor's authoritative position away from venue to placeOther
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_authoritative_positions
         SET document = jsonb_set(document, '{placeId}', to_jsonb($1::text))
         WHERE world_id=$2 AND subject_key=$3`,
          [f.placeOther, f.worldId, `actor:${f.actorId}`],
        );
      });

      // Proposal attempting to fulfill appointment while at wrong location
      const proposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_fulfill_1',
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
        statements: [{ text: '我已按时到达红砖小馆。', dependsOnActionIds: ['action_fulfill_1'] }],
      };

      // Committing should fail because appointment.fulfill outcome is failed (ACTOR_NOT_AT_VENUE),
      // and statement depends on an unexecuted/failed action
      await assert.rejects(
        async () => {
          await runNpcAgent(
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
        },
        (err: any) =>
          err.message.includes('REPLY_DEPENDS_ON_UNEXECUTED_ACTION') ||
          err.message.includes('UNCONFIRMED_RESPONSIBILITY_RESULT') ||
          err.message.includes('ACTOR_NOT_AT_VENUE') ||
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
    '2. Complete closed loop: appointment.fulfill succeeds, updates appointment, fulfills responsibility & goal, and syncs awareness',
    async () => {
      const f = await fixture();

      const proposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_fulfill_1',
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
            text: '我们已经顺利碰面并交付了学术研讨资料。',
            dependsOnActionIds: ['action_fulfill_1'],
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
      assert.equal(out.state.responsibilities[0]?.status, 'fulfilled');
      assert.equal(out.state.goals[0]?.status, 'fulfilled');

      // Verification in real PostgreSQL:
      await app.transaction(f.owner, async (sql) => {
        // 1. world_appointments status is 'attended'
        const apptRow = (
          await sql.query(
            'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 AND id=$2',
            [f.worldId, f.appointmentId],
          )
        ).rows[0];
        assert.ok(apptRow);
        assert.equal(apptRow.document.status, 'attended');

        // 2. agent_action_results contains durable execution evidence
        const actionResults = (
          await sql.query(
            'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows;
        assert.equal(actionResults.length, 1);
        const res = actionResults[0].document;
        assert.equal(res.actionId, 'action_fulfill_1');
        assert.equal(res.outcome, 'succeeded');
        assert.deepEqual(res.handledResponsibilityIds, [f.respId]);
        assert.deepEqual(res.completedGoalIds, [f.goalId]);

        // 3. actor_agent_states is atomically updated to revision 1 with fulfilled status
        const stateRow = (
          await sql.query(
            'SELECT revision, projected_world_version, document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
            [f.worldId, f.actorId],
          )
        ).rows[0];
        assert.equal(stateRow.revision, 1);
        assert.equal(stateRow.projected_world_version, 2);

        const actorDoc = stateRow.document as ActorAgentState;
        assert.equal(actorDoc.responsibilities[0]?.status, 'fulfilled');
        assert.equal(actorDoc.responsibilities[0]?.resolutionResultId, res.id);
        assert.equal(actorDoc.goals[0]?.status, 'fulfilled');
        assert.deepEqual(actorDoc.goals[0]?.resultIds, [res.id]);

        // 4. world version incremented from 1 to 2, hydrated world has attended appointment
        const worldRow = (
          await sql.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId])
        ).rows[0];
        assert.equal(worldRow.version, 2);

        const hydratedWorld = await worlds.get({ userId: f.owner }, f.worldId);
        assert.equal(hydratedWorld.version, 2);
        assert.equal(hydratedWorld.appointments[0]?.status, 'attended');
      });
    },
  );
});
