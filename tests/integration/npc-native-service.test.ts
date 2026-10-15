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
          return JSON.stringify(
            reply(
              nativeCalls === 1 ? '我有自己的安排。要改天再聊吗？' : '好，那就先随意聊聊。',
              nativeCalls === 1,
            ),
          );
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

  await t.test(
    'an ambiguous group never silently picks the first NPC or invokes the legacy runner',
    async () => {
      const f = await fixture();
      let calls = 0,
        legacyCalls = 0,
        failureMessage = '';
      const current = await worlds.get({ userId: f.owner }, f.worldId);
      const accepted = await groups.send(f.owner, {
        worldId: f.worldId,
        groupId: f.groupId,
        commandId: randomUUID(),
        expectedVersion: current.version,
        text: '大家聊聊吧',
      });
      const handler = nativeNpcTaskHandler(db, () => ({
        async complete() {
          calls++;
          return JSON.stringify(reply('不应随意指定第一位人物'));
        },
      }));
      const dispatcher = worldTaskDispatcher({
        agent: handler,
        group: async () => {
          legacyCalls++;
        },
        scene: async () => {
          legacyCalls++;
        },
      });
      await runOne(
        {
          claim: (kinds) => queue.claimForOwner(accepted.task.id, f.owner, kinds),
          renew: (lease) => queue.renew(lease),
          finish: (lease, outcome) => queue.finish(lease, outcome),
        },
        {
          world: async (lease, signal) => {
            try {
              await dispatcher(lease, signal);
            } catch (error) {
              failureMessage = error instanceof Error ? error.message : '';
              throw error;
            }
          },
        },
      );
      assert.equal((await tasks.get(f.owner, accepted.task.id)).status, 'failed');
      assert.equal((await tasks.get(f.owner, accepted.task.id)).errorCode, 'INVALID_COMMAND');
      assert.equal(failureMessage, 'DIRECTOR_COORDINATION_REQUIRED');
      assert.equal(calls, 0);
      assert.equal(legacyCalls, 0);
      assert.equal(
        await store.lookup(f.owner, f.worldId, nativeAgentCommandId(accepted.task.id, f.a)),
        null,
      );
      assert.equal(
        await store.lookup(f.owner, f.worldId, nativeAgentCommandId(accepted.task.id, f.b)),
        null,
      );
    },
  );
});
