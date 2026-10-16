import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { worldTaskDispatcher } from '../../src/server/world-task-dispatcher.ts';
import {
  nativeNpcTaskHandler,
  nativeAgentCommandId,
} from '../../src/server/npc-agent-channel-services.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { GroupClient } from '../../src/features/phone/groups/client.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const privateQuote = '这次不见，我明确拒绝。PRIVATE_ONLY_QUOTE_44_9';
const reply = (text: string, requestsPlayerReply = false): AgentProposal => ({
  statements: [
    { text, dependsOnActionIds: [], ...(requestsPlayerReply ? { requestsPlayerReply: true } : {}) },
  ],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});

test('actual leased native service and phone DTO use one persistent NPC runtime (real PG, mock models)', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.NPC_NATIVE_SERVICE_TEST_PORT ?? 55565));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const owners: string[] = [];
  t.after(async () => {
    try {
      for (const owner of owners) {
        await admin.query('DELETE FROM parallel_life.agent_runtime_worlds WHERE owner_id=$1', [
          owner,
        ]);
        await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
      }
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  const worlds = new PostgresWorldRepository(db),
    groups = new PostgresGroupRepository(db),
    store = new PostgresAgentRuntimeRepository(db),
    tasks = new TaskRepository(db);

  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    owners.push(owner);
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic actual native service',
      time: new Date().toISOString(),
      actors: [
        { id: a, name: '甲', persona: '有自己的计划，尊重拒绝。' },
        { id: b, name: '乙', persona: '有独立生活。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    const group = await groups.create(owner, {
      worldId,
      commandId: randomUUID(),
      expectedVersion: 0,
      title: '实际群入口',
      actorIds: [a, b],
    });
    await db.transaction(owner, async (sql) => {
      for (const actorId of [a, b])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId },
            agentDefinitionRef(world, actorId),
            group.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: group.version,
      });
    });
    let privateCalls = 0;
    const privateService = npcAgentServices(db, () => ({
      async complete(messages) {
        privateCalls++;
        const input = JSON.parse(messages[1]!.content).input;
        assert.equal(input.text, privateQuote);
        const proposal: AgentProposal = {
          ...reply('明白，这次不约了。'),
          goals: [
            {
              id: 'private-goal',
              summary: '保留本人长期安排',
              status: 'active',
              resultIds: [],
              sourceIds: [input.sourceId],
            },
          ],
          plans: [
            {
              id: 'private-plan',
              goalId: 'private-goal',
              summary: '尊重拒绝，改换自己的安排',
              status: 'waiting',
              sourceIds: [input.sourceId],
              actionIds: [],
              nextActionId: null,
              triggers: [],
              missingConditions: [],
            },
          ],
          responsibilities: [
            {
              id: 'private-request',
              subject: { kind: 'request', id: 'own-request' },
              summary: '本次请求已被拒绝',
              status: 'deferred',
              waitingOn: null,
              sourceIds: [input.sourceId],
              nextCheck: [],
            },
          ],
          decisions: [
            {
              id: 'private-decline',
              responsibilityId: 'private-request',
              kind: 'declined',
              sourceId: input.sourceId,
              quote: input.text,
            },
          ],
        };
        return JSON.stringify(proposal);
      },
    }));
    const receipt = await privateService.sendMessageIfEnabled(owner, {
      id: randomUUID(),
      worldId,
      actorId: a,
      expectedVersion: group.version,
      text: privateQuote,
    });
    assert.equal(receipt?.status, 'committed');
    assert.equal(privateCalls, 1);
    return { owner, worldId, a, b, groupId: group.groupId };
  }

  async function readOnPhone(owner: string, worldId: string, groupId: string) {
    const dto = await groups.read(owner, worldId, groupId);
    const client = new GroupClient(
      (async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/session') ? { kind: 'guest', csrfToken: 'x'.repeat(48) } : dto,
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as typeof fetch,
    );
    return client.read(worldId, groupId);
  }

  await t.test(
    'a group location report reaches original hearers while actual position stays unknown',
    async () => {
      const f = await fixture();
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const sent = await groups.send(f.owner, {
        worldId: f.worldId,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: world.version,
        text: '@甲 我在外面，稍后再聊。',
      });
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete(messages) {
          const payload = JSON.parse(messages[1]!.content);
          return JSON.stringify({
            ...reply('知道了，你先忙。'),
            locationReports: [
              {
                subject: { kind: 'player' },
                placeId: null,
                sourceId: payload.input.sourceId,
                quote: '我在外面',
                assertion: 'reported',
              },
            ],
          });
        },
      }));
      await runOne(
        {
          claim: (kinds) => queue.claimForOwner(sent.task.id, f.owner, kinds),
          renew: (lease) => queue.renew(lease),
          finish: (lease, outcome) => queue.finish(lease, outcome),
        },
        {
          world: async (lease, signal) => {
            assert(await handler(lease, signal));
          },
        },
      );
      assert.equal((await tasks.get(f.owner, sent.task.id)).status, 'succeeded');
      const rows = (
        await admin.query(
          'SELECT observer_actor_id,document FROM parallel_life.actor_position_knowledge WHERE world_id=$1',
          [f.worldId],
        )
      ).rows;
      assert.deepEqual(rows.map((r) => r.observer_actor_id).sort(), [f.a, f.b].sort());
      assert.ok(
        rows.every(
          (r) =>
            r.document.sourceKind === 'player_report' &&
            r.document.occurredAt === null &&
            r.document.evidence.quote === '我在外面',
        ),
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_authoritative_positions WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n,
        0,
      );
    },
  );

  await t.test(
    'group task completes atomically, preserves prior actual DM refusal, and the short reply returns to its actual questioner',
    async () => {
      const f = await fixture();
      let nativeCalls = 0,
        legacyCalls = 0,
        failureFinalizers = 0;
      const captured: Record<string, any>[] = [];
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete(messages) {
          nativeCalls++;
          assert.equal(
            db.pool.totalCount,
            db.pool.idleCount,
            'no model call inside SQL transaction',
          );
          const raw = messages[1]!.content;
          assert(!raw.includes(privateQuote));
          const payload = JSON.parse(raw);
          captured.push(payload);
          assert.equal(payload.state.actorId, f.a);
          assert.equal(
            payload.state.decisions.find((d: { id: string }) => d.id === 'private-decline').kind,
            'declined',
          );
          assert.equal(
            payload.state.decisions.find((d: { id: string }) => d.id === 'private-decline').quote,
            '',
          );
          const proposal = reply(
            nativeCalls === 1 ? '我有自己的安排。要改天再聊吗？' : '好，那就先随意聊聊。',
            nativeCalls === 1,
          );
          if (nativeCalls === 2) {
            const question = payload.state.questions.find(
              (q: { status: string; channel: string }) =>
                q.status === 'open' && q.channel === 'group',
            );
            assert.ok(question, 'the actual pending question reaches its same-channel speaker');
            proposal.replyAssessments = [
              {
                questionId: question.id,
                sourceId: payload.input.sourceId,
                quote: '好',
                relation: 'answer',
              },
            ];
          }
          return JSON.stringify(proposal);
        },
      }));
      const dispatcher = worldTaskDispatcher({
        agent: async (lease, signal) => {
          try {
            return await handler(lease, signal);
          } catch (error) {
            t.diagnostic(
              error instanceof Error ? (error.stack ?? error.message) : 'Native handler failed',
            );
            throw error;
          }
        },
        group: async () => {
          legacyCalls++;
          throw Error('LEGACY_GROUP_CALLED');
        },
        scene: async () => {
          legacyCalls++;
          throw Error('LEGACY_SCENE_CALLED');
        },
      });
      const run = (taskId: string) =>
        runOne(
          {
            claim: (kinds) => queue.claimForOwner(taskId, f.owner, kinds),
            renew: (lease) => queue.renew(lease),
            finish: async (lease, outcome) => {
              failureFinalizers++;
              await queue.finish(lease, outcome);
            },
          },
          { world: dispatcher },
        );
      const current = await worlds.get({ userId: f.owner }, f.worldId);
      const firstCommand = {
        worldId: f.worldId,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: current.version,
        text: '@甲 说说你的安排',
      };
      const first = await groups.send(f.owner, firstCommand);
      const inputReceipt = (
        await admin.query(
          'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
          [f.worldId, firstCommand.commandId],
        )
      ).rows[0].document;
      assert.equal(inputReceipt.expectedWorldVersion, first.version);
      assert.equal(inputReceipt.text, firstCommand.text);
      assert(await run(first.task.id));
      assert.equal((await tasks.get(f.owner, first.task.id)).status, 'succeeded');
      assert.equal(nativeCalls, 1);
      assert.equal(legacyCalls, 0);
      assert.equal(failureFinalizers, 0);
      const attempt = await store.lookup(
        f.owner,
        f.worldId,
        nativeAgentCommandId(first.task.id, f.a),
      );
      assert.equal(attempt?.status, 'committed');
      assert.equal(attempt?.inputReceiptId, inputReceipt.id);
      const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
      const phone = await readOnPhone(f.owner, f.worldId, f.groupId);
      const question = phone.messages.find(
        (m) => m.sender.kind === 'actor' && m.text.includes('改天再聊'),
      )!;
      assert.equal(state.focus?.questionSourceId, `group:${question.id}`);
      assert(!JSON.stringify(phone).includes(privateQuote));
      assert.equal(
        (
          await admin.query(
            "SELECT 1 FROM parallel_life.world_messages WHERE world_id=$1 AND document->>'sourceEventId'=$2",
            [f.worldId, attempt!.eventId],
          )
        ).rowCount,
        0,
      );
      const same = await groups.send(f.owner, firstCommand);
      assert.equal(same.task.id, first.task.id);
      assert.equal(await run(first.task.id), false);
      assert.equal(nativeCalls, 1);
      const second = await groups.send(f.owner, {
        worldId: f.worldId,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: phone.version,
        text: '好',
      });
      assert(await run(second.task.id));
      assert.equal((await tasks.get(f.owner, second.task.id)).status, 'succeeded');
      assert.equal(nativeCalls, 2);
      assert.equal(captured[1]!.input.text, '好');
      assert.equal(captured[1]!.state.actorId, f.a);
      assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.b }))!.revision, 0);
      const finalPhone = await readOnPhone(f.owner, f.worldId, f.groupId);
      assert(
        finalPhone.messages.some(
          (m) => m.sender.kind === 'actor' && m.text === '好，那就先随意聊聊。',
        ),
      );
      const finalState = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
      const originalDecision = finalState.decisions.find((d) => d.id === 'private-decline')!;
      assert.equal(originalDecision.kind, 'declined');
      assert.equal(
        originalDecision.quote,
        privateQuote,
        'canonical private evidence is not erased',
      );
      assert.equal(finalState.goals.find((g) => g.id === 'private-goal')!.status, 'active');
      assert.equal(finalState.plans.find((p) => p.id === 'private-plan')!.status, 'waiting');
      assert.equal(
        finalState.focus?.questionSourceId,
        null,
        'the actual answer closes the question',
      );
      assert.equal(
        finalState.questions?.find((q) => q.sourceId === `group:${question.id}`)?.status,
        'answered',
      );
    },
  );

  await t.test(
    'unknown transport is not recharged or rerouted to another actor on duplicate input',
    async () => {
      const f = await fixture();
      let calls = 0;
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete() {
          calls++;
          throw Object.assign(Error('SYNTHETIC_TRANSPORT_UNCERTAIN'), { code: 'UPSTREAM_FAILED' });
        },
      }));
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const command = {
        worldId: f.worldId,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: world.version,
        text: '@甲 聊聊',
      };
      const accepted = await groups.send(f.owner, command);
      const run = () =>
        runOne(
          {
            claim: (kinds) => queue.claimForOwner(accepted.task.id, f.owner, kinds),
            renew: (lease) => queue.renew(lease),
            finish: (lease, outcome) => queue.finish(lease, outcome),
          },
          {
            world: async (lease, signal) => {
              assert(await handler(lease, signal));
            },
          },
        );
      await run();
      assert.equal(calls, 1);
      assert.equal((await tasks.get(f.owner, accepted.task.id)).status, 'unknown');
      assert.equal(
        (await store.lookup(f.owner, f.worldId, nativeAgentCommandId(accepted.task.id, f.a)))!
          .status,
        'unknown_after_send',
      );
      assert.equal((await groups.send(f.owner, command)).task.id, accepted.task.id);
      assert.equal(await run(), false);
      assert.equal(calls, 1);
      assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.b }))!.revision, 0);
    },
  );

  await t.test('forged task lease fails before any NPC model call', async () => {
    const f = await fixture();
    let calls = 0;
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const accepted = await groups.send(f.owner, {
      worldId: f.worldId,
      groupId: f.groupId,
      commandId: randomUUID(),
      expectedVersion: world.version,
      text: '@甲 在吗',
    });
    const lease = (await queue.claimForOwner(accepted.task.id, f.owner, ['world']))!;
    const handler = nativeNpcTaskHandler(db, () => ({
      async complete() {
        calls++;
        return JSON.stringify(reply('不应执行'));
      },
    }));
    await assert.rejects(handler({ ...lease, token: randomUUID() }, new AbortController().signal));
    assert.equal(calls, 0);
    await assert.rejects(
      handler(
        { ...lease, input: { ...(lease.input as Record<string, unknown>), text: '@乙 改派' } },
        new AbortController().signal,
      ),
    );
    assert.equal(calls, 0);
    await queue.finish(lease, { status: 'failed', errorCode: 'CANCELLED' });
  });

  await t.test('late rejoining first actor cannot hear or steal the original input', async () => {
    const f = await fixture();
    async function membership(action: 'leave' | 'join') {
      const current = await worlds.get({ userId: f.owner }, f.worldId);
      await groups.membership(f.owner, {
        worldId: f.worldId,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: current.version,
        participant: { kind: 'actor', actorId: f.a },
        action,
      });
    }
    await membership('leave');
    const current = await worlds.get({ userId: f.owner }, f.worldId);
    const sent = await groups.send(f.owner, {
      worldId: f.worldId,
      groupId: f.groupId,
      commandId: randomUUID(),
      expectedVersion: current.version,
      text: '接下来怎么安排？',
    });
    await membership('join');
    let calls = 0;
    const handler = nativeNpcTaskHandler(db, () => ({
      async complete(messages) {
        calls++;
        const payload = JSON.parse(messages[1]!.content);
        assert.equal(payload.nativeTurn, undefined);
        assert.equal(payload.state.actorId, f.b);
        return JSON.stringify(reply('我听到了，来说说自己的安排。'));
      },
    }));
    await runOne(
      {
        claim: (kinds) => queue.claimForOwner(sent.task.id, f.owner, kinds),
        renew: (lease) => queue.renew(lease),
        finish: (lease, outcome) => queue.finish(lease, outcome),
      },
      {
        world: worldTaskDispatcher({
          agent: handler,
          group: async () => assert.fail('legacy route'),
          scene: async () => assert.fail('legacy route'),
        }),
      },
    );
    assert.equal((await tasks.get(f.owner, sent.task.id)).status, 'succeeded');
    assert.equal(calls, 1);
    assert.equal(
      await store.lookup(f.owner, f.worldId, nativeAgentCommandId(sent.task.id, f.a)),
      null,
    );
  });

  for (const mode of ['quiet', 'selected', 'unknown'] as const)
    await t.test('ambiguous native group Director coordination: ' + mode, async () => {
      const f = await fixture();
      let directors = 0,
        npcs = 0,
        legacy = 0;
      const current = await worlds.get({ userId: f.owner }, f.worldId);
      const sent = await groups.send(f.owner, {
        worldId: f.worldId,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: current.version,
        text: '我们接下来怎么安排？',
      });
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete(messages) {
          const p = JSON.parse(messages[1]!.content);
          if (p.nativeTurn) {
            directors++;
            assert.equal(p.nativeTurn.taskId, sent.task.id);
            assert.equal(p.authoredMaterials, undefined);
            if (mode === 'unknown')
              throw Object.assign(Error('SYNTHETIC_ROUTING_UNCERTAIN'), {
                code: 'UPSTREAM_FAILED',
              });
            const choice =
              mode === 'selected'
                ? p.candidates.find((c: { actorId: string }) => c.actorId === f.b)
                : null;
            if (mode === 'selected') assert.ok(choice);
            return JSON.stringify({
              mode: choice ? 'coordinate' : 'quiet',
              selectedCandidateIds: choice ? [choice.id] : [],
              deferred: p.candidates
                .filter((c: { id: string }) => c.id !== choice?.id)
                .map((c: { id: string }) => ({ candidateId: c.id, reason: '承接协调未选择此人' })),
              nudges: [],
              opportunities: [],
              audit: { reason: '按当前发言与本人责任协调', basisSourceIds: [] },
            });
          }
          npcs++;
          assert.equal(p.state.actorId, f.b);
          assert.ok(!messages[1]!.content.includes(privateQuote));
          return JSON.stringify(reply('我来说说自己的安排。'));
        },
      }));
      const dispatcher = worldTaskDispatcher({
        agent: handler,
        group: async () => {
          legacy++;
        },
        scene: async () => {
          legacy++;
        },
      });
      const run = () =>
        runOne(
          {
            claim: (kinds) => queue.claimForOwner(sent.task.id, f.owner, kinds),
            renew: (lease) => queue.renew(lease),
            finish: (lease, outcome) => queue.finish(lease, outcome),
          },
          { world: dispatcher },
        );
      await run();
      assert.equal(
        (await tasks.get(f.owner, sent.task.id)).status,
        mode === 'unknown' ? 'unknown' : 'succeeded',
      );
      assert.equal(directors, 1);
      assert.equal(npcs, mode === 'selected' ? 1 : 0);
      assert.equal(legacy, 0);
      assert.equal(await run(), false);
      assert.equal(directors, 1);
      assert.equal(
        await store.lookup(f.owner, f.worldId, nativeAgentCommandId(sent.task.id, f.a)),
        null,
      );
      const b = await store.lookup(f.owner, f.worldId, nativeAgentCommandId(sent.task.id, f.b));
      if (mode === 'selected') assert.equal(b!.status, 'committed');
      else assert.equal(b, null);
      const cursor = (
        await admin.query(
          'SELECT observed_through_version,evaluated_through_version FROM parallel_life.director_observed_states WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0];
      assert.ok(
        cursor.evaluated_through_version < cursor.observed_through_version,
        'speaker routing must not consume unrelated global narrative changes',
      );
    });
});
