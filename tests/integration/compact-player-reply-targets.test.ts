import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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
import {
  emptyActorAgentState,
  type AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('compact reply commits exact player decision once; stored response replays without model', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.COMPACT_REPLY_TEST_PORT ?? 55675));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    store = new PostgresAgentRuntimeRepository(db);
  const ownerId = randomUUID(),
    actorId = randomUUID(),
    at = '2026-10-27T08:00:00.000Z';
  await new IdentityRepository(db).ensureGuest(ownerId);
  const world: WorldState = {
    schemaVersion: 1,
    id: randomUUID(),
    ownerId,
    title: 'Synthetic compact reply',
    version: 0,
    time: at,
    actors: [{ id: actorId, name: '甲', persona: '有自己的安排' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  await worlds.initialize({ userId: ownerId }, world);
  const receipt = (text: string): AgentInputReceipt => ({
    id: randomUUID(),
    worldId: world.id,
    commandId: randomUUID(),
    inputHash: createHash('sha256').update(text).digest('hex'),
    channel: 'private',
    threadId: actorId,
    recipientActorId: actorId,
    expectedWorldVersion: 0,
    origin: 'player',
    text,
    receivedAt: new Date().toISOString(),
    storyAt: at,
  });
  const prior = receipt('请问我是否参与'),
    input = receipt('我不参与，你自行安排');
  await store.accept(ownerId, prior);
  await store.accept(ownerId, input);
  const actor = emptyActorAgentState(
    { worldId: world.id, actorId },
    agentDefinitionRef(world, actorId),
    0,
  );
  actor.responsibilities = [
    {
      id: 'participation',
      subject: { kind: 'request', id: 'participation' },
      summary: '等待玩家决定',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: [prior.id],
      nextCheck: [],
      revision: 3,
    },
  ];
  actor.questions = [
    {
      id: 'participation-question',
      channel: 'private',
      threadId: actorId,
      sourceId: prior.id,
      text: '是否参与？',
      askedAt: at,
      status: 'open',
      responsibilityId: 'participation',
    },
  ];
  await db.transaction(ownerId, async (sql) => {
    await initializeActorAgentStateInTransaction(sql, ownerId, actor);
    await switchAgentEngineEpochInTransaction(sql, ownerId, {
      worldId: world.id,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
  });
  const snapshot: AgentSnapshot = {
    state: actor,
    viewState: structuredClone(actor),
    redactedStateIds: [],
    worldVersion: 0,
    storyAt: at,
    sources: [prior, input].map((r) => ({
      id: r.id,
      kind: 'accepted_input',
      recordId: r.id,
      worldVersion: 0,
      at,
    })),
    observations: [],
    actor: {
      name: '甲',
      persona: '有自己的安排',
      boundaries: '不替玩家决定',
      definitionRef: actor.definitionRef,
    },
    input: { sourceId: input.id, text: input.text, origin: 'player' },
    channel: {
      kind: 'private',
      threadId: actorId,
      audienceActorIds: [actorId],
      allowedCapabilities: [],
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
  let calls = 0;
  const model = {
    async decide() {
      calls++;
      return JSON.stringify({
        protocol: 'npc-wire-v15',
        statements: [{ text: '知道了，我自行安排。', dependsOnActionIds: [] }],
        executions: [],
        changes: {
          inputInterpretation: {
            kind: 'related_reply',
            sourceId: 'source:2',
            quote: input.text,
            replies: [{ targetRef: 'reply:1', relation: 'answer', decision: 'declined' }],
          },
        },
      });
    },
  };
  const deps = { attempts: store, model, kernel: new PostgresNpcAgentKernel(db, worlds) };
  const out = await runNpcAgent(deps, ownerId, claim, snapshot);
  assert.equal(out.state.decisions[0]?.kind, 'declined');
  assert.equal(out.state.decisions[0]?.responsibilityId, 'participation');
  assert.equal(out.state.questions![0]?.status, 'answered');
  assert.equal(calls, 1);
  const event = await worlds.get({ userId: ownerId }, world.id);
  assert.equal(event.messages.length, 2);
  const replay = await runNpcAgent(deps, ownerId, claim, null);
  assert.equal(replay.eventId, out.eventId);
  assert.equal(calls, 1);
  assert.equal((await worlds.get({ userId: ownerId }, world.id)).messages.length, 2);
});
