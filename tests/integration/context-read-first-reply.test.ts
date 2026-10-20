import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
  type AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  clearSnapshotImmutableCaches,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { deriveAndStoreMemories } from '../../src/modules/memory/infrastructure/memory-store.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const START_AT = '2026-10-20T08:00:00.000Z';

function textReply(text: string): AgentProposal {
  return {
    statements: [{ text, dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
}

function imageWire(messages: unknown[], actorId: string) {
  const payload = JSON.parse(String((messages as { content: string }[])[1]!.content));
  const ref = payload.wireCatalog.inputSourceRef;
  const quote = String(payload.input.text).slice(0, 12);
  return JSON.stringify({
    protocol: 'npc-wire-v14',
    focusChange: { kind: 'keep' },
    executions: [
      {
        ref: 'action_1',
        goal: { kind: 'new', summary: '发一张自拍', sourceIds: [ref] },
        plan: { summary: '准备自拍并发送', sourceIds: [ref], supersedesPlanId: null },
        action: {
          capability: 'media.generate_image',
          targetIds: [actorId],
          parameters: { sceneDescription: '手持手机前置相机的日常自拍', purpose: 'portrait' },
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          sourceIds: [ref],
        },
      },
    ],
    statements: [{ text: '我找个光线好的地方拍一下。', dependsOnActionIds: [] }],
    consideration: null,
    goals: [],
    planIntents: [],
    responsibilities: [],
    agendaReview: null,
    inputInterpretation: { kind: 'new_request', sourceId: ref, quote },
    continuation: {
      decision: 'no_current_intent',
      reason: '已回复。',
      sourceIds: [ref],
      planIds: [],
      questionIds: [],
      conditions: [],
    },
  });
}

test('44-168 context read: one narrative read, sparse optional reads, and preserved input/plan/memory/media authority', async (t) => {
  clearSnapshotImmutableCaches();
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clocks = new PostgresClockStore(db);
  const store = new PostgresAgentRuntimeRepository(db);
  const owner = randomUUID();
  const worldId = randomUUID();
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const created: string[] = [];
  t.after(async () => {
    try {
      await admin.query(
        'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
        [worldId, owner],
      );
    } finally {
      await db.close();
      await admin.end();
    }
  });

  await new IdentityRepository(db).ensureGuest(owner);
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: '44-168 context read fixture',
    time: START_AT,
    actors: [
      { id: actorId, name: '林岸', persona: '说话简短，有自己的工作安排。' },
      { id: otherActorId, name: '周遥', persona: '独立生活，不替别人做决定。' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  await worlds.initialize({ userId: owner }, world);
  await db.transaction(owner, async (sql) => {
    for (const id of [actorId, otherActorId])
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId: id }, agentDefinitionRef(world, id), 0),
      );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId,
      expectedWorldVersion: 0,
      expectedEpoch: 1,
      nextEpoch: 2,
    });
  });
  await clocks.write(owner, worldId, {
    storyNow: START_AT,
    speed: 0,
    paused: false,
    lastTickAt: new Date().toISOString(),
    missedBeats: 0,
    summary: null,
  });

  let calls = 0;
  let imageMode = false;
  const api = npcAgentServices(db, () => ({
    async complete(messages: unknown[]) {
      calls += 1;
      return imageMode
        ? imageWire(messages, actorId)
        : JSON.stringify(textReply(`第${calls}次回复：我看到了。`));
    },
  }));

  async function turn(text: string) {
    const current = await worlds.get({ userId: owner }, worldId);
    const command = { id: randomUUID(), worldId, actorId, expectedVersion: current.version, text };
    const receipt = await api.sendMessageIfEnabled(owner, command);
    assert.ok(receipt);
    assert.equal(receipt.status, 'committed');
    const metrics = api.readTurnMetrics(command.id);
    assert.ok(metrics);
    created.push(command.id);
    return { command, receipt, metrics };
  }

  const first = await turn('第一轮：今天还在忙吗？');
  assert.ok(
    first.metrics.contextQueryCount <= 34,
    `ordinary warm turn reads <= 34 context queries, got ${first.metrics.contextQueryCount}`,
  );
  const second = await turn('第二轮：周末有什么打算？');
  assert.ok(
    second.metrics.contextQueryCount <= 34,
    `second warm turn reads <= 34 context queries, got ${second.metrics.contextQueryCount}`,
  );

  // Real accepted input receipt and assistant source for the next assertions.
  const receiptRow = (
    await admin.query(
      'SELECT id,document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
      [worldId, second.command.id],
    )
  ).rows[0];
  assert.ok(receiptRow);
  const input = receiptRow.document as AgentInputReceipt;
  const assistantRow = (
    await admin.query(
      "SELECT id FROM parallel_life.world_messages WHERE world_id=$1 AND actor_id=$2 AND document->>'role'='assistant' ORDER BY ordinal DESC LIMIT 1",
      [worldId, actorId],
    )
  ).rows[0];
  assert.ok(assistantRow);

  // A durable plan, a key memory, and a player decision all cite real accepted sources.
  const state = await store.read(owner, { worldId, actorId });
  assert.ok(state);
  const goal = {
    id: 'g_ctx168',
    summary: '保留周末拍照安排',
    sourceIds: [input.id],
    status: 'active',
    resultIds: [],
  };
  const plan = {
    id: 'p_ctx168',
    goalId: goal.id,
    summary: '周末带旧相机去河边拍照',
    sourceIds: [input.id],
    status: 'active',
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: [],
  };
  await admin.query(
    `UPDATE parallel_life.actor_agent_states
     SET document=jsonb_set(jsonb_set(document,'{goals}',$3::jsonb),'{plans}',$4::jsonb)
     WHERE world_id=$1 AND owner_id=$2 AND actor_id=$5`,
    [worldId, owner, JSON.stringify([goal]), JSON.stringify([plan]), actorId],
  );
  await db.transaction(owner, async (sql) => {
    await deriveAndStoreMemories(sql, [
      {
        ownerId: owner,
        scopeType: 'character',
        scopeId: actorId,
        branchId: worldId,
        characterId: actorId,
        text: '周末打算带旧相机去河边拍照。',
        kind: 'belief',
        sourceType: 'agent_inference',
        sourceIds: [String(assistantRow.id)],
        importance: 9,
        evidence: {
          [String(assistantRow.id)]: {
            id: String(assistantRow.id),
            role: 'assistant',
            text: '第2次回复：我看到了。',
          },
        },
      },
    ]);
  });

  // Direct snapshot read: the latest input, plan and memory still survive authorization.
  const worldNow = await worlds.get({ userId: owner }, worldId);
  const stateNow = await store.read(owner, { worldId, actorId });
  assert.ok(stateNow);
  const snapshot = (
    await readPrivateAgentSnapshot(db, owner, worldNow, actorId, input, input.storyAt, stateNow)
  ).snapshot;
  assert.equal(snapshot.input.text, second.command.text);
  assert.ok(snapshot.sources.some((source) => source.id === input.id));
  assert.equal(snapshot.state.goals.find((item) => item.id === goal.id)?.summary, goal.summary);
  assert.equal(snapshot.state.plans.find((item) => item.id === plan.id)?.summary, plan.summary);
  assert.ok(
    snapshot.observations.some((observation) => observation.text.includes('周末打算带旧相机')),
    'key memory remains in the authorized observations',
  );
  assert.ok(
    snapshot.observations.some((observation) => observation.text.includes(second.command.text)),
    'latest player message remains in the authorized observations',
  );

  // A turn with plan/memory handles still stays below the old 45-query shape.
  const third = await turn('第三轮：那周末几点出发？');
  assert.ok(
    third.metrics.contextQueryCount <= 40,
    `stateful turn reads <= 40 context queries, got ${third.metrics.contextQueryCount}`,
  );

  // Image request uses the same context reader; media is enqueued by the committed turn.
  imageMode = true;
  const imageTurn = await turn('能给我发张照片吗？');
  assert.ok(
    imageTurn.metrics.contextQueryCount <= 40,
    `image request reads <= 40 context queries, got ${imageTurn.metrics.contextQueryCount}`,
  );
  const mediaRows = (
    await admin.query('SELECT id FROM parallel_life.world_media_requests WHERE world_id=$1', [
      worldId,
    ])
  ).rows;
  assert.ok(mediaRows.length >= 1, 'image execution created a durable media request');
  const mediaMessage = (
    await admin.query(
      "SELECT 1 FROM parallel_life.world_messages WHERE world_id=$1 AND actor_id=$2 AND document->>'role'='assistant' AND document->>'text' LIKE '%光线好%'",
      [worldId, actorId],
    )
  ).rowCount;
  assert.equal(mediaMessage, 1, 'natural text was committed alongside the image intent');
  t.diagnostic(
    `44-168 metrics: ordinary=${JSON.stringify(first.metrics)} stateful=${JSON.stringify(third.metrics)} image=${JSON.stringify(imageTurn.metrics)}`,
  );
});
