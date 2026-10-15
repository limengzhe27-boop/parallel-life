import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentProposal,
  AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { applyWorldHistoryEvent } from '../../src/modules/world/domain/world-history.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const at = '2026-10-15T07:00:00.000Z';
test('actual NPC kernel and private service commit actor state with world receipts atomically', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.NPC_KERNEL_TEST_PORT ?? 55564));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    store = new PostgresAgentRuntimeRepository(db);
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  async function fixture(
    origin: AgentInputReceipt['origin'] = 'player',
    persona = '认真，有自己的安排。',
  ) {
    const ownerId = randomUUID(),
      actorId = randomUUID(),
      otherActor = randomUUID();
    await new IdentityRepository(db).ensureGuest(ownerId);
    const world: WorldState = {
      schemaVersion: 1,
      id: randomUUID(),
      ownerId,
      title: 'Synthetic runtime integration',
      version: 0,
      time: at,
      actors: [
        { id: actorId, name: '甲', persona },
        { id: otherActor, name: '乙', persona: '独立安排工作。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: ownerId }, world);
    const actor = emptyActorAgentState(
      { worldId: world.id, actorId },
      agentDefinitionRef(world, actorId),
      0,
    );
    await db.transaction(ownerId, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, ownerId, actor);
      await initializeActorAgentStateInTransaction(
        sql,
        ownerId,
        emptyActorAgentState(
          { worldId: world.id, actorId: otherActor },
          agentDefinitionRef(world, otherActor),
          0,
        ),
      );
      await switchAgentEngineEpochInTransaction(sql, ownerId, {
        worldId: world.id,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    const input: AgentInputReceipt = {
      id: randomUUID(),
      worldId: world.id,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update('fixture').digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 0,
      origin,
      text: '这次我不参与，你自行安排吧。',
      receivedAt: new Date().toISOString(),
      storyAt: at,
    };
    await store.accept(ownerId, input);
    const state = (await store.read(ownerId, { worldId: world.id, actorId }))!;
    const snapshot: AgentSnapshot = {
      state,
      viewState: structuredClone(state),
      redactedStateIds: [],
      worldVersion: 0,
      storyAt: at,
      sources: [{ id: input.id, kind: 'accepted_input', recordId: input.id, worldVersion: 0, at }],
      observations: [],
      actor: {
        name: '甲',
        persona: world.actors[0]!.persona,
        boundaries: '不替用户决定',
        definitionRef: state.definitionRef,
      },
      input: { sourceId: input.id, text: input.text, origin },
      channel: {
        kind: 'private',
        threadId: actorId,
        audienceActorIds: [actorId],
        allowedCapabilities: ['plan.record', 'appointment.propose'],
      },
    };
    const claim = {
      id: randomUUID(),
      commandId: input.commandId,
      inputReceiptId: input.id,
      inputHash: input.inputHash,
      worldId: world.id,
      actorId,
      engineEpoch: 2,
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    return { ownerId, actorId, world, input, snapshot, claim };
  }
  const proposal = (): AgentProposal => ({
    statements: [{ text: '知道了，我另作安排。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  });

  await t.test('real private service uses one model call and exact receipt replay', async () => {
    const f = await fixture();
    let count = 0;
    const service = npcAgentServices(db, () => ({
      async complete() {
        count++;
        assert.equal(db.pool.totalCount, db.pool.idleCount);
        return JSON.stringify(proposal());
      },
    }));
    const command = {
      id: randomUUID(),
      worldId: f.world.id,
      expectedVersion: 0,
      actorId: f.actorId,
      text: '我这次不参与，你自己安排。',
    };
    const first = await service.sendMessageIfEnabled(f.ownerId, command);
    assert.equal(first?.version, 1);
    assert.deepEqual(await service.sendMessageIfEnabled(f.ownerId, command), first);
    assert.equal(count, 1);
    const state = await store.read(f.ownerId, { worldId: f.world.id, actorId: f.actorId });
    assert.equal(state?.revision, 1);
    const world = await worlds.get({ userId: f.ownerId }, f.world.id);
    assert.equal(world.messages.length, 2);
    const oldProgress = await admin.query(
      'SELECT 1 FROM parallel_life.memory_records WHERE owner_id=$1 AND text LIKE $2',
      [f.ownerId, 'actor_event_progress_v1:%'],
    );
    assert.equal(oldProgress.rowCount, 0);
  });
  await t.test(
    'quiet plan execution has a real event/result and creates zero messages',
    async () => {
      const f = await fixture('wake'),
        p = proposal();
      p.statements = [];
      p.goals.push({
        id: 'g',
        summary: '自己安排核对',
        sourceIds: [f.input.id],
        status: 'active',
        resultIds: [],
      });
      p.plans.push({
        id: 'p',
        goalId: 'g',
        summary: '先保存自己的计划，等待材料',
        sourceIds: [f.input.id],
        status: 'waiting',
        actionIds: ['a'],
        nextActionId: null,
        triggers: [],
        missingConditions: ['材料'],
      });
      p.actions.push({
        id: 'a',
        goalId: 'g',
        capability: 'plan.record',
        targetIds: [],
        parameters: { planId: 'p' },
        sourceIds: [f.input.id],
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        status: 'ready',
      });
      const out = await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(p);
            },
          },
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        f.ownerId,
        f.claim,
        f.snapshot,
      );
      assert.equal(out.state.actions[0]?.status, 'succeeded');
      const world = await worlds.get({ userId: f.ownerId }, f.world.id);
      assert.equal(world.messages.length, 0);
      assert.equal(world.version, 1);
      const event = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
          out.eventId,
        ])
      ).rows[0].payload;
      assert.equal(event.type, 'agent.state_committed');
      assert.equal(applyWorldHistoryEvent(f.world, event).state.version, 1);
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.agent_action_results WHERE world_id=$1', [
            f.world.id,
          ])
        ).rowCount,
        1,
      );
    },
  );
  await t.test(
    'an autonomous calendar proposal needs no fabricated message or attendance',
    async () => {
      const f = await fixture('wake'),
        p = proposal();
      p.statements = [];
      p.goals.push({
        id: 'invite',
        summary: '提出见面时间',
        sourceIds: [f.input.id],
        status: 'active',
        resultIds: [],
      });
      p.actions.push({
        id: 'invite-a',
        goalId: 'invite',
        capability: 'appointment.propose',
        targetIds: [],
        parameters: { title: '讨论材料', at: '2026-10-16T07:00:00.000Z' },
        sourceIds: [f.input.id],
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        status: 'ready',
      });
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(p);
            },
          },
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        f.ownerId,
        f.claim,
        f.snapshot,
      );
      const world = await worlds.get({ userId: f.ownerId }, f.world.id);
      assert.equal(world.messages.length, 0);
      assert.equal(world.appointments.length, 1);
      assert.equal(world.appointments[0]?.status, 'proposed');
    },
  );
  await t.test(
    'invalid capability is a known result and rolls back every world and actor write',
    async () => {
      const f = await fixture(),
        p = proposal();
      p.goals.push({
        id: 'g',
        summary: '安排',
        sourceIds: [f.input.id],
        status: 'active',
        resultIds: [],
      });
      p.actions.push({
        id: 'a',
        goalId: 'g',
        capability: 'plan.record',
        targetIds: [],
        parameters: { planId: 'invented' },
        sourceIds: [f.input.id],
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        status: 'ready',
      });
      await assert.rejects(
        runNpcAgent(
          {
            attempts: store,
            model: {
              async decide() {
                return JSON.stringify(p);
              },
            },
            kernel: new PostgresNpcAgentKernel(db, worlds),
          },
          f.ownerId,
          f.claim,
          f.snapshot,
        ),
        /PLAN_RECORD_TARGET/,
      );
      assert.equal((await worlds.get({ userId: f.ownerId }, f.world.id)).version, 0);
      assert.equal(
        (await store.read(f.ownerId, { worldId: f.world.id, actorId: f.actorId }))?.revision,
        0,
      );
      assert.equal(
        (await store.lookup(f.ownerId, f.world.id, f.input.commandId))?.status,
        'invalid_output',
      );
      assert.equal(
        (
          await admin.query('SELECT 1 FROM parallel_life.world_events WHERE world_id=$1', [
            f.world.id,
          ])
        ).rowCount,
        0,
      );
    },
  );
  await t.test('an old acceptance cannot execute work after a later refusal', async () => {
    const f = await fixture();
    let call = 0;
    const service = npcAgentServices(db, () => ({
      async complete(messages) {
        const payload = JSON.parse(messages[1]!.content);
        const source = payload.input.sourceId;
        const p = proposal();
        call++;
        if (call === 1) {
          p.goals = [
            { id: 'g', summary: '安排核对', sourceIds: [source], status: 'active', resultIds: [] },
          ];
          p.responsibilities = [
            {
              id: 'r',
              subject: { kind: 'request', id: 'request-r' },
              summary: '是否参与核对',
              sourceIds: [source],
              status: 'waiting',
              waitingOn: 'player',
              nextCheck: [],
            },
          ];
          p.decisions = [
            {
              id: 'yes',
              responsibilityId: 'r',
              sourceId: source,
              quote: '我答应参与',
              kind: 'accepted',
            },
          ];
        } else {
          p.decisions = [
            {
              id: 'no',
              responsibilityId: 'r',
              sourceId: source,
              quote: '我不参与了',
              kind: 'declined',
            },
          ];
          p.plans = [
            {
              id: 'p',
              goalId: 'g',
              summary: '等明确参与后记录安排',
              sourceIds: [source],
              status: 'waiting',
              actionIds: ['a'],
              nextActionId: 'a',
              triggers: [],
              missingConditions: [],
            },
          ];
          p.actions = [
            {
              id: 'a',
              goalId: 'g',
              capability: 'plan.record',
              targetIds: [],
              parameters: { planId: 'p' },
              sourceIds: [source],
              preconditions: [
                { kind: 'player_decision', responsibilityId: 'r', decision: 'accepted' },
              ],
              dependsOnActionIds: [],
              handlesResponsibilityIds: [],
              status: 'ready',
            },
          ];
        }
        return JSON.stringify(p);
      },
    }));
    await service.sendMessageIfEnabled(f.ownerId, {
      id: randomUUID(),
      worldId: f.world.id,
      expectedVersion: 0,
      actorId: f.actorId,
      text: '我答应参与',
    });
    await service.sendMessageIfEnabled(f.ownerId, {
      id: randomUUID(),
      worldId: f.world.id,
      expectedVersion: 1,
      actorId: f.actorId,
      text: '我不参与了',
    });
    const state = (await store.read(f.ownerId, { worldId: f.world.id, actorId: f.actorId }))!;
    assert.equal(state.decisions.at(-1)?.kind, 'declined');
    assert.equal(state.actions[0]?.status, 'waiting');
    assert.equal(
      (
        await admin.query('SELECT 1 FROM parallel_life.agent_action_results WHERE world_id=$1', [
          f.world.id,
        ])
      ).rowCount,
      0,
    );
  });
  await t.test(
    'forgetting an actual player message also hides state sourced by its accepted-input alias',
    async () => {
      const f = await fixture();
      let call = 0;
      const secret = '合成保密事项-不应复活';
      const service = npcAgentServices(db, () => ({
        async complete(messages) {
          const payload = JSON.parse(messages[1]!.content);
          const p = proposal();
          call++;
          if (call === 1) {
            p.statements[0]!.text = secret;
            p.goals = [
              {
                id: 'secret-goal',
                summary: secret,
                sourceIds: [payload.input.sourceId],
                status: 'active',
                resultIds: [],
              },
            ];
          } else assert.ok(!JSON.stringify(payload).includes(secret));
          return JSON.stringify(p);
        },
      }));
      await service.sendMessageIfEnabled(f.ownerId, {
        id: randomUUID(),
        worldId: f.world.id,
        expectedVersion: 0,
        actorId: f.actorId,
        text: secret,
      });
      const prior = await worlds.get({ userId: f.ownerId }, f.world.id);
      const message = prior.messages.find((m) => m.role === 'user')!;
      await admin.query(
        "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Forgotten synthetic source','forgotten_alias','agent_inference',$5,'forgotten')",
        [randomUUID(), f.ownerId, f.actorId, f.world.id, JSON.stringify([message.id])],
      );
      await service.sendMessageIfEnabled(f.ownerId, {
        id: randomUUID(),
        worldId: f.world.id,
        expectedVersion: 1,
        actorId: f.actorId,
        text: '我们聊点别的',
      });
      const current = (await store.read(f.ownerId, { worldId: f.world.id, actorId: f.actorId }))!;
      assert.equal(current.goals.find((g) => g.id === 'secret-goal')?.summary, secret);
    },
  );
  await t.test(
    'a nonexistent local calendar date is rejected without silently rolling to the next month',
    async () => {
      const f = await fixture('wake'),
        p = proposal();
      p.statements = [];
      p.goals = [
        { id: 'g', summary: '邀请', sourceIds: [f.input.id], status: 'active', resultIds: [] },
      ];
      p.actions = [
        {
          id: 'a',
          goalId: 'g',
          capability: 'appointment.propose',
          targetIds: [],
          parameters: { title: '见面', at: '2026-11-31T10:00:00+08:00' },
          sourceIds: [f.input.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          status: 'ready',
        },
      ];
      await assert.rejects(
        runNpcAgent(
          {
            attempts: store,
            model: {
              async decide() {
                return JSON.stringify(p);
              },
            },
            kernel: new PostgresNpcAgentKernel(db, worlds),
          },
          f.ownerId,
          f.claim,
          f.snapshot,
        ),
        /APPOINTMENT_PROPOSAL/,
      );
      const world = await worlds.get({ userId: f.ownerId }, f.world.id);
      assert.equal(world.version, 0);
      assert.equal(world.appointments.length, 0);
    },
  );
  await t.test(
    'an accepted player input keeps its original time after another actor advances the world',
    async () => {
      const f = await fixture();
      await new PostgresClockStore(db).write(f.ownerId, f.world.id, {
        storyNow: '2026-10-15T07:01:00.000Z',
        speed: 1,
        paused: false,
        lastTickAt: new Date().toISOString(),
        missedBeats: 0,
        summary: null,
      });
      const other = f.world.actors[1]!.id;
      const service = npcAgentServices(db, () => ({
        async complete() {
          return JSON.stringify(proposal());
        },
      }));
      await service.sendMessageIfEnabled(f.ownerId, {
        id: randomUUID(),
        worldId: f.world.id,
        expectedVersion: 0,
        actorId: other,
        text: '先处理你的事情',
      });
      const clock = await new PostgresClockStore(db).read(f.ownerId, f.world.id);
      f.snapshot.worldVersion = 1;
      f.snapshot.storyAt = clock.storyNow;
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(proposal());
            },
          },
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        f.ownerId,
        { ...f.claim, expectedWorldVersion: 1 },
        f.snapshot,
      );
      const world = await worlds.get({ userId: f.ownerId }, f.world.id);
      assert.equal(world.version, 2);
      assert.ok(Date.parse(world.time) >= Date.parse('2026-10-15T07:01:00.000Z'));
      assert.equal(
        world.messages.find((m) => m.actorId === f.actorId && m.role === 'user')?.at,
        at,
      );
    },
  );
  await t.test(
    'long authored personas keep one definition identity across budgeted turns and different topics',
    async () => {
      const raw = '长期背景'.repeat(10000),
        f = await fixture('player', raw);
      const service = npcAgentServices(db, () => ({
        async complete() {
          return JSON.stringify(proposal());
        },
      }));
      await service.sendMessageIfEnabled(f.ownerId, {
        id: randomUUID(),
        worldId: f.world.id,
        expectedVersion: 0,
        actorId: f.actorId,
        text: '今天有什么安排？',
      });
      await service.sendMessageIfEnabled(f.ownerId, {
        id: randomUUID(),
        worldId: f.world.id,
        expectedVersion: 1,
        actorId: f.actorId,
        text: '聊聊以前的事情',
      });
      const actor = (await store.read(f.ownerId, { worldId: f.world.id, actorId: f.actorId }))!;
      assert.equal(actor.revision, 2);
      assert.equal(actor.definitionRef, agentDefinitionRef(f.world, f.actorId));
      assert.equal(
        (await worlds.get({ userId: f.ownerId }, f.world.id)).actors.find((a) => a.id === f.actorId)
          ?.persona,
        raw,
      );
    },
  );
  await t.test(
    'a received result survives a failed commit and resumes without a second model call',
    async () => {
      const f = await fixture();
      let count = 0;
      const kernel = new PostgresNpcAgentKernel(db, worlds);
      await assert.rejects(
        runNpcAgent(
          {
            attempts: store,
            model: {
              async decide() {
                count++;
                return JSON.stringify(proposal());
              },
            },
            kernel: {
              parse: kernel.parse.bind(kernel),
              async commit() {
                throw Error('DB_OFFLINE');
              },
            },
          },
          f.ownerId,
          f.claim,
          f.snapshot,
        ),
        /DB_OFFLINE/,
      );
      assert.equal(
        (await store.lookup(f.ownerId, f.world.id, f.input.commandId))?.status,
        'response_received',
      );
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              count++;
              throw Error('must not re-pay');
            },
          },
          kernel,
        },
        f.ownerId,
        f.claim,
        null,
      );
      assert.equal(count, 1);
      assert.equal((await worlds.get({ userId: f.ownerId }, f.world.id)).messages.length, 2);
    },
  );
});
