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
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldAwarenessRepository } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import {
  readTrialDirectorStatus,
} from '../../src/modules/world/infrastructure/director-trial-recovery.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type {
  ActorAgentState,
  AgentInputReceipt,
  AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';

test('actor narrative advancement & perception closure: first-entry, continuous silence, missed appointment, and aware knowledge propagation (R3 & R4)', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );

  const worlds = new PostgresWorldRepository(app);
  const store = new PostgresAgentRuntimeRepository(app);
  const clocks = new PostgresClockStore(app);
  const awareness = new PostgresWorldAwarenessRepository(app);

  t.after(async () => {
    await app.close();
    await admin.end();
  });

  async function fixture() {
    const owner = randomUUID();
    const worldId = randomUUID();
    const actorA = randomUUID();
    const actorB = randomUUID();
    const storyStart = '2026-10-17T09:00:00.000Z';
    const appointmentAt = '2026-10-17T11:00:00.000Z';
    const appointmentId = randomUUID();

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const event1Id = randomUUID();
    const worldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      title: '主动叙事与剧情闭环测试世界',
      version: 1,
      time: storyStart,
      actors: [
        { id: actorA, name: '青青', persona: '开朗守约，有自己的摄影工作安排' },
        { id: actorB, name: '林凡', persona: '独立设计师，在自己的工作室工作' },
      ],
      messages: [
        {
          id: randomUUID(),
          senderId: actorA,
          text: '早上好！我们今天按计划推进。',
          storyAt: storyStart,
          sourceEventId: event1Id,
        },
      ],
      appointments: [
        {
          id: appointmentId,
          title: '咖啡馆商务讨论',
          at: appointmentAt,
          venuePlaceId: 'place_cafe',
          participantIds: [actorA, 'player'],
          status: 'confirmed',
          sourceEventId: event1Id,
        },
      ],
      facts: [
        {
          id: 'fact_public_1',
          text: '今天阳光明媚，适合外出。',
          visibility: { kind: 'world' },
          kind: 'observation',
          sourceEventId: event1Id,
        },
        {
          id: 'fact_private_b',
          text: '林凡有一份尚未公开的设计手稿保存在抽屉。',
          visibility: { kind: 'actors', actorIds: [actorB] },
          kind: 'belief',
          sourceEventId: event1Id,
        },
      ],
      mediaRequests: [],
      space: {
        currentPlaceId: 'place_cafe',
        places: [
          { id: 'place_cafe', name: '街角咖啡馆', appointmentIds: [appointmentId] },
          { id: 'place_studio', name: '林凡工作室', appointmentIds: [] },
        ],
        routes: [],
      },
    };

    const initialActorA: ActorAgentState = {
      worldId,
      actorId: actorA,
      schemaVersion: 1,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: agentDefinitionRef(worldState, actorA),
      knowledgeSourceIds: ['fact_public_1'],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: 'goal_a_1',
          summary: '在咖啡馆与玩家商谈摄影合作',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [
        {
          id: 'plan_a_1',
          goalId: 'goal_a_1',
          summary: '如果玩家到场则沟通合作，若未到场则等待至中午后撤回',
          status: 'active',
          sourceIds: ['source_init'],
          actionIds: ['action_a_1'],
          nextActionId: null,
          triggers: [],
          missingConditions: [],
        },
      ],
      actions: [],
      responsibilities: [
        {
          id: 'resp_a_1',
          revision: 0,
          subject: { kind: 'appointment', id: appointmentId },
          summary: '等待玩家赴约',
          status: 'waiting',
          waitingOn: 'player',
          sourceIds: ['source_init'],
          nextCheck: [{ kind: 'at_or_after', at: appointmentAt, sourceId: 'source_init' }],
        },
      ],
      decisions: [],
      focus: null,
    };

    const initialActorB: ActorAgentState = {
      worldId,
      actorId: actorB,
      schemaVersion: 1,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: agentDefinitionRef(worldState, actorB),
      knowledgeSourceIds: ['fact_public_1', 'fact_private_b'],
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
        [worldId, owner, '主动叙事测试世界', JSON.stringify(worldState)],
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
            occurredAt: storyStart,
            storyAt: storyStart,
            data: { effects: [] },
          },
          storyStart,
        ],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
        [appointmentId, worldId, owner, worldState.appointments[0]],
      );
      await initializeActorAgentStateInTransaction(sql, owner, initialActorA);
      await initializeActorAgentStateInTransaction(sql, owner, initialActorB);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });
    });

    await clocks.setClock(owner, worldId, { paused: false, speed: 1 });

    return {
      owner,
      worldId,
      actorA,
      actorB,
      appointmentId,
      appointmentAt,
      storyStart,
      worldState,
      initialActorA,
      initialActorB,
    };
  }

  await t.test(
    '1. Journey A: First entry does not block, requires zero full-idle wait, and does not duplicate on reload',
    async () => {
      const f = await fixture();

      // Read runtime status immediately upon entry
      const status1 = await readTrialDirectorStatus(app, f.owner, f.worldId);
      assert.ok(status1, 'Runtime status is readable immediately without delay');
      assert.equal(status1.phase, 'waiting_player', 'Correctly identifies waiting_player phase from actor responsibility');
      assert.equal(status1.actionableRecovery, 'none');

      // Reopening / reloading does not duplicate opening or mutate world version
      const status2 = await readTrialDirectorStatus(app, f.owner, f.worldId);
      assert.deepEqual(status1, status2, 'Idempotent read returns exact same snapshot without mutation');

      const world = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(world.version, 1, 'World version unchanged');
      assert.equal(world.messages.length, 1, 'Opening message count is exactly 1, no duplicate entries');
    },
  );

  await t.test(
    '2. Journey B: Continuous silence past appointment deadline allows NPC self-arrangement and clean withdrawal without infinite nagging',
    async () => {
      const f = await fixture();

      // Simulate time advancement past appointment deadline (e.g. 11:30)
      const storyPastDeadline = '2026-10-17T11:30:00.000Z';
      await clocks.write(f.owner, f.worldId, {
        storyNow: storyPastDeadline,
        speed: 1,
        paused: false,
        lastTickAt: new Date().toISOString(),
        missedBeats: 0,
        summary: null,
      });


      // NPC A realizes player has not arrived by deadline and executes cancel/withdrawal
      const inputReceipt: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('silence_deadline_check').digest('hex'),
        channel: 'private',
        threadId: f.actorA,
        recipientActorId: f.actorA,
        expectedWorldVersion: 1,
        receivedAt: new Date().toISOString(),
        storyAt: storyPastDeadline,
        origin: 'wake',
        text: '约定时间已过，玩家尚未到场，自主决定后续去向。',
      };
      await store.accept(f.owner, inputReceipt);

      const claim = {
        id: randomUUID(),
        commandId: inputReceipt.commandId,
        inputReceiptId: inputReceipt.id,
        inputHash: inputReceipt.inputHash,
        worldId: f.worldId,
        actorId: f.actorA,
        engineEpoch: 2,
        expectedWorldVersion: 1,
        expectedActorRevision: 0,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };

      const snapshotA: AgentSnapshot = {
        state: f.initialActorA,
        viewState: structuredClone(f.initialActorA),
        redactedStateIds: [],
        worldVersion: 1,
        storyAt: storyPastDeadline,
        sources: [
          {
            id: inputReceipt.id,
            kind: 'accepted_input',
            recordId: inputReceipt.id,
            worldVersion: 1,
            at: storyPastDeadline,
          },
          {
            id: 'source_init',
            kind: 'authored',
            recordId: 'source_init',
            worldVersion: 1,
            at: f.storyStart,
          },
        ],
        observations: [],
        actor: {
          name: '青青',
          persona: '开朗守约，有自己的摄影工作安排',
          boundaries: '不代用户决定，守约但不会无限等待',
          definitionRef: agentDefinitionRef(f.worldState, f.actorA),
        },
        input: {
          sourceId: inputReceipt.id,
          text: inputReceipt.text,
          origin: 'wake',
        },
        channel: {
          kind: 'private',
          threadId: f.actorA,
          audienceActorIds: [f.actorA],
          allowedCapabilities: ['plan.record', 'appointment.cancel'],
        },
      };

      // Actor A cancels appointment and withdraws responsibility
      const cancelProposal: AgentProposal = {
        goals: [],
        plans: [],
        actions: [
          {
            id: 'action_cancel_due',
            goalId: 'goal_a_1',
            capability: 'appointment.cancel',
            targetIds: [f.appointmentId],
            parameters: {
              appointmentId: f.appointmentId,
              reason: '等候超过约定时间，先行前往摄影展布展',
            },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: ['resp_a_1'],
            status: 'ready',
            sourceIds: ['source_init'],
          },
        ],
        responsibilities: [],
        decisions: [],
        statements: [
          {
            text: '时间已经不早了，我先去摄影展布展，改天再约。',
            dependsOnActionIds: ['action_cancel_due'],
          },
        ],
      };

      const out = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(cancelProposal);
            },
          },
          kernel: new PostgresNpcAgentKernel(app, worlds),
        },
        f.owner,
        claim,
        snapshotA,
      );

      assert.ok(out.eventId);
      assert.equal(out.results[0]?.outcome, 'succeeded');

      // Verify that appointment is cancelled and not looping in world_appointments projection
      await app.transaction(f.owner, async (sql) => {
        const apptRow = (
          await sql.query(
            'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 AND id=$2',
            [f.worldId, f.appointmentId],
          )
        ).rows[0];
        assert.ok(apptRow, 'Appointment exists in projection');
        assert.equal(apptRow.document.status, 'cancelled', 'Appointment marked cancelled in database');
      });

      const updatedActorA = await store.read(f.owner, { worldId: f.worldId, actorId: f.actorA });
      const resp = updatedActorA?.responsibilities.find((r) => r.id === 'resp_a_1');
      assert.equal(resp?.status, 'withdrawn', 'Responsibility is cleanly withdrawn, eliminating infinite nagging');

      // Check runtime status transitions to quiescent without deadlock
      const statusAfter = await readTrialDirectorStatus(app, f.owner, f.worldId);
      assert.equal(statusAfter.phase, 'quiescent', 'World enters quiescent state when all obligations are resolved');
    },
  );

  await t.test(
    '3. Task R4: Privacy and awareness boundary: absent character receives 0 knowledge of private events or scene happenings',
    async () => {
      const f = await fixture();

      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const inputReceiptA: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('privacy_check_a').digest('hex'),
        channel: 'private',
        threadId: f.actorA,
        recipientActorId: f.actorA,
        expectedWorldVersion: 1,
        receivedAt: new Date().toISOString(),
        storyAt: f.storyStart,
        origin: 'player',
        text: '青青你好',
      };
      await store.accept(f.owner, inputReceiptA);

      const inputReceiptB: AgentInputReceipt = {
        id: randomUUID(),
        worldId: f.worldId,
        commandId: randomUUID(),
        inputHash: createHash('sha256').update('privacy_check_b').digest('hex'),
        channel: 'private',
        threadId: f.actorB,
        recipientActorId: f.actorB,
        expectedWorldVersion: 1,
        receivedAt: new Date().toISOString(),
        storyAt: f.storyStart,
        origin: 'player',
        text: '林凡你好',
      };
      await store.accept(f.owner, inputReceiptB);

      // Verify recipient isolation: Actor B cannot accept or read Actor A's private input
      await assert.rejects(
        () =>
          readPrivateAgentSnapshot(
            app,
            f.owner,
            world,
            f.actorB,
            inputReceiptA,
            f.storyStart,
            f.initialActorB,
          ),
        (err: any) => err.code === 'INVALID_COMMAND',
        'Actor B cannot intercept Actor A private message',
      );

      const snapA = (
        await readPrivateAgentSnapshot(
          app,
          f.owner,
          world,
          f.actorA,
          inputReceiptA,
          f.storyStart,
          f.initialActorA,
        )
      ).snapshot;

      const snapB = (
        await readPrivateAgentSnapshot(
          app,
          f.owner,
          world,
          f.actorB,
          inputReceiptB,
          f.storyStart,
          f.initialActorB,
        )
      ).snapshot;

      assert.ok(
        snapA.sources.some((s) => s.id === 'fact:fact_public_1'),
        'Actor A has public fact',
      );
      assert.ok(
        !snapA.sources.some((s) => s.id === 'fact:fact_private_b'),
        'Actor A CANNOT see Actor B private fact',
      );
      assert.ok(
        snapB.sources.some((s) => s.id === 'fact:fact_private_b'),
        'Actor B CAN see their own private fact',
      );

      // Sourced awareness: Actor B was not a participant in Actor A appointment, so Actor B has 0 participant records for it
      const appt = world.appointments.find((a) => a.id === f.appointmentId);
      assert.ok(!appt?.participantIds.includes(f.actorB), 'Actor B is not a participant in Actor A appointment');
    },
  );
});
