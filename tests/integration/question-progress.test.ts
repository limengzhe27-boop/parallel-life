import {
  repairQuestionProgressReasonsInTransaction,
  readQuestionProgressReasons,
} from '../../src/modules/world/infrastructure/question-progress-repair.ts';
import { markDirectorEvaluated } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { readAuthoredReconsiderationEvidence } from '../../src/modules/world/infrastructure/authored-reconsideration-evidence.ts';
import { authoredReconsiderationEvidence } from '../../src/modules/world/domain/authored-reconsideration.ts';
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

test('no-responsibility question answer projects one authored reconsideration reason and explicit repair is idempotent', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.QUESTION_PROGRESS_TEST_PORT ?? 55676));
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
  actor.goals = [
    {
      id: 'goal',
      summary: '等待答复安排后续',
      sourceIds: [prior.id],
      status: 'active',
      resultIds: [],
    },
  ];
  actor.plans = [
    {
      id: 'plan',
      goalId: 'goal',
      summary: '等待玩家信息',
      sourceIds: [prior.id],
      status: 'waiting',
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: ['等待答复'],
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
        protocol: 'npc-wire-v16',
        statements: [{ text: '知道了，我自行安排。', dependsOnActionIds: [] }],
        executions: [],
        changes: {
          inputInterpretation: {
            kind: 'related_reply',
            sourceId: 'source:2',
            quote: input.text,
            replies: [{ targetRef: 'reply:1', relation: 'answer', decision: null }],
          },
        },
      });
    },
  };
  const deps = { attempts: store, model, kernel: new PostgresNpcAgentKernel(db, worlds) };
  const out = await runNpcAgent(deps, ownerId, claim, snapshot);
  assert.deepEqual(out.state.decisions, []);
  assert.equal(out.state.questions![0]?.status, 'answered');
  assert.equal(calls, 1);
  const event = await worlds.get({ userId: ownerId }, world.id);
  assert.equal(event.messages.length, 2);
  await db.transaction(ownerId, async (sql) => {
    const proofs = await readQuestionProgressReasons(sql, ownerId, world.id, 1);
    assert.equal(proofs.length, 1);
    assert.equal(proofs[0]!.actorId, actorId);
    const all = await readAuthoredReconsiderationEvidence(sql, ownerId, world.id, 1);
    assert.ok(authoredReconsiderationEvidence([actorId], all, 1).includes(proofs[0]!.id));
    assert.equal(await repairQuestionProgressReasonsInTransaction(sql, ownerId, world.id, 1), 0);
    // Explicitly remove only the disposable fixture projection to emulate a historical missed projection.
    await admin.query('DELETE FROM parallel_life.director_pending_reasons WHERE world_id=$1', [
      world.id,
    ]);
    assert.equal(await repairQuestionProgressReasonsInTransaction(sql, ownerId, world.id, 1), 1);
    assert.equal(await repairQuestionProgressReasonsInTransaction(sql, ownerId, world.id, 1), 0);
  });
  const replay = await runNpcAgent(deps, ownerId, claim, null);
  assert.equal(replay.eventId, out.eventId);
  assert.equal(calls, 1);
  assert.equal((await worlds.get({ userId: ownerId }, world.id)).messages.length, 2);
  await db.transaction(ownerId, async (sql) => {
    await markDirectorEvaluated(sql, ownerId, world.id, {
      expectedObservedThroughVersion: 1,
      throughVersion: 1,
      result: 'quiet',
    });
    await admin.query('DELETE FROM parallel_life.director_pending_reasons WHERE world_id=$1', [
      world.id,
    ]);
    assert.equal(await repairQuestionProgressReasonsInTransaction(sql, ownerId, world.id, 1), 0);
  });
});
