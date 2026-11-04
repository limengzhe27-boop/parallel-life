import type { SqlClient } from '../../src/modules/storage/infrastructure/postgres.ts';
import { readConsumedSceneObservationSourcesInTransaction } from '../../src/modules/world/infrastructure/actor-observation-consumption-repository.ts';
import { readActorStrategyBasis } from '../../src/modules/world/infrastructure/agent-source-resolver.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import {
  readActorSceneRecall,
  validateActorSceneRecall,
} from '../../src/modules/world/infrastructure/actor-observation-inbox.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import { readNativeAgentSnapshot } from '../../src/modules/world/infrastructure/agent-channel-snapshot.ts';
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
  SceneRepository,
  commitSceneProposal,
  loadScene,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import {
  acceptAgentInputInTransaction,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { projectCommittedWorldAwareness } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { nativeNpcTaskHandler } from '../../src/server/npc-agent-channel-services.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('scene-private delivery44 uses one actor turn and preserves input privacy (real PG)', async (t) => {
  const config = await localConfig();
  const port = Number(process.env.ACTOR_SCENE_OBSERVATION_TEST_PORT ?? 55565);
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
  assert.equal(
    config.port,
    port,
    'dedicated local database configuration must match the assigned port',
  );
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const scenes = new SceneRepository(db);
  const generated: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    try {
      for (const f of generated)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.worldId, f.owner],
        );
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  type Fixture = { owner: string; worldId: string; a: string; b: string; sceneId: string };
  const proposal = (actorIds: string[], narration = '窗边放着一把椅子。') => ({
    location: 'Room',
    narration,
    presentActorIds: actorIds,
    outcome: null,
    observation: null,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [],
    npcActions: [],
  });
  async function fixture(): Promise<Fixture> {
    const owner = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    generated.push({ owner, worldId });
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic historical scene observation fixture',
      time: new Date().toISOString(),
      actors: [
        { id: a, name: '甲', persona: '只知道实际获准观察的事情。' },
        { id: b, name: '乙', persona: '有自己的生活。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'room',
        positionSource: source,
        places: [
          {
            id: 'room',
            name: 'Room',
            description: 'Explicit synthetic fixture place',
            source,
            contactActorIds: [a, b],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, world);
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 0,
      placeId: 'room',
    });
    const lease = await queue.claimForOwner(entered.task!.id, owner, ['world']);
    assert.ok(lease);
    // Actual old writer produces explicit historical presence. This is not a new-engine NPC action.
    const version = await db.transaction(owner, (sql) =>
      commitSceneProposal(
        sql,
        owner,
        worldId,
        lease.input as Parameters<typeof commitSceneProposal>[3],
        proposal([a]),
        randomUUID(),
      ),
    );
    await queue.finish(lease, { status: 'succeeded', resultVersion: version });
    return { owner, worldId, a, b, sceneId: entered.sceneId };
  }
  async function input(f: Fixture, text: string) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return scenes.input(f.owner, f.worldId, f.sceneId, {
      commandId: randomUUID(),
      expectedVersion: world.version,
      text,
      relatedMatterIds: [],
    });
  }
  const f = await fixture();
  let world = await worlds.get({ userId: f.owner }, f.worldId);
  await db.transaction(f.owner, async (sql) => {
    for (const actorId of [f.a, f.b])
      await initializeActorAgentStateInTransaction(
        sql,
        f.owner,
        emptyActorAgentState(
          { worldId: f.worldId, actorId },
          agentDefinitionRef(world, actorId),
          world.version,
        ),
      );
    await switchAgentEngineEpochInTransaction(sql, f.owner, {
      worldId: f.worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: world.version,
    });
    const event = (
      await sql.query(
        'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version=$2',
        [f.worldId, world.version],
      )
    ).rows[0].payload;
    await projectCommittedWorldAwareness(sql, f.owner, event);
  });
  let calls = 0;
  const api = npcAgentServices(db, () => ({
    async complete(messages) {
      calls++;
      const p = JSON.parse(messages[1]!.content);
      assert.equal(p.sceneReplyContext.sceneId, f.sceneId);
      return JSON.stringify({
        protocol: 'npc-wire-v20',
        replyChannel: 'scene',
        statements: [
          {
            text: '我就在你面前呢。',
            kind: 'speech',
            dependsOnActionIds: [],
            requestsPlayerReply: false,
            questionForResponsibilityId: null,
            stickerId: null,
          },
          {
            text: '甲抬头看向你。',
            kind: 'narration',
            dependsOnActionIds: [],
            requestsPlayerReply: false,
            questionForResponsibilityId: null,
            stickerId: null,
          },
        ],
        executions: [],
        changes: null,
      });
    },
  }));
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.a,
    expectedVersion: world.version,
    text: '微信私密测试：你在忙什么？',
  };
  const delayedCommand = { ...command, id: randomUUID(), text: '这条已接收的微信还没有调用模型' };
  const delayedReceipt = {
    id: randomUUID(),
    worldId: f.worldId,
    commandId: delayedCommand.id,
    channel: 'private' as const,
    threadId: f.a,
    recipientActorId: f.a,
    expectedWorldVersion: world.version,
    origin: 'player' as const,
    text: delayedCommand.text,
    receivedAt: new Date().toISOString(),
    storyAt: world.time,
    inputHash: createHash('sha256')
      .update(
        JSON.stringify([f.worldId, world.version, f.a, delayedCommand.text, 'private', 'player']),
      )
      .digest('hex'),
  };
  await db.transaction(f.owner, (sql) =>
    acceptAgentInputInTransaction(sql, f.owner, delayedReceipt),
  );
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.agent_attempts WHERE world_id=$1 AND command_id=$2',
        [f.worldId, delayedCommand.id],
      )
    ).rows[0].n,
    0,
  );
  const result = await api.sendMessageIfEnabled(f.owner, command);
  assert.equal(result?.status, 'committed');
  const after = await worlds.get({ userId: f.owner }, f.worldId);
  assert.ok(after.messages.some((m) => m.role === 'user' && m.text === command.text));
  assert.ok(!after.messages.some((m) => m.role === 'assistant' && m.text === '我就在你面前呢。'));
  const entries = await db.transaction(f.owner, (sql) => loadScene(sql, f.worldId, f.sceneId));
  assert.ok(entries.entries.some((e) => 'text' in e && e.text === '我就在你面前呢。'));
  assert.ok(entries.entries.some((e) => e.kind === 'narration' && e.text === '甲抬头看向你。'));
  assert.ok(!entries.entries.some((e) => 'text' in e && e.text === command.text));
  await api.sendMessageIfEnabled(f.owner, command);
  assert.equal(calls, 1);
  const reread = await db.transaction(f.owner, (sql) => loadScene(sql, f.worldId, f.sceneId));
  assert.equal(reread.entries.length, entries.entries.length);
  const recallFrame = {
    state: { worldId: f.worldId, actorId: f.a },
    worldVersion: after.version,
    storyAt: after.time,
  } as AgentSnapshot;
  const recall = await db.transaction(f.owner, (sql) =>
    readActorSceneRecall(sql, f.owner, recallFrame),
  );
  assert.ok(recall.observations.some((o) => o.text === '我就在你面前呢。'));
  assert.ok(recall.observations.some((o) => o.text === '甲抬头看向你。'));
  assert.ok(!recall.observations.some((o) => o.text === command.text));
  await db.transaction(f.owner, (sql) =>
    validateActorSceneRecall(sql, f.owner, { ...recallFrame, ...recall }),
  );
  const absent = await db.transaction(f.owner, (sql) =>
    readActorSceneRecall(sql, f.owner, {
      ...recallFrame,
      state: { ...recallFrame.state, actorId: f.b },
    }),
  );
  assert.equal(absent.observations.length, 0);
  const speechEntry = entries.entries.find(
    (e) => e.kind === 'dialogue' && e.text === '我就在你面前呢。',
  )!;
  const actor = (
    await admin.query(
      'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [f.worldId, f.a],
    )
  ).rows[0].document;
  const basis = await db.transaction(f.owner, (sql) =>
    readActorStrategyBasis(sql, f.owner, actor, after.version, after.time, {
      referencedSourceIds: ['scene:' + speechEntry.id],
    }),
  );
  assert.ok(
    basis.some((s) => s.id === 'scene:' + speechEntry.id),
    'own private-to-scene speech remains a usable strategy source',
  );
  const beforeDelayed = await worlds.get({ userId: f.owner }, f.worldId);
  assert.ok(beforeDelayed.version > delayedReceipt.expectedWorldVersion);
  assert.equal((await api.sendMessageIfEnabled(f.owner, delayedCommand))?.status, 'committed');
  const delayedAttempt = (
    await admin.query(
      'SELECT expected_world_version,response FROM parallel_life.agent_attempts WHERE world_id=$1 AND command_id=$2',
      [f.worldId, delayedCommand.id],
    )
  ).rows[0];
  assert.equal(delayedAttempt.expected_world_version, beforeDelayed.version);
  assert.equal(delayedAttempt.response.snapshot.worldVersion, beforeDelayed.version);
  const savedReceipt = (
    await admin.query('SELECT document FROM parallel_life.agent_input_receipts WHERE id=$1', [
      delayedReceipt.id,
    ])
  ).rows[0].document;
  assert.equal(savedReceipt.expectedWorldVersion, delayedReceipt.expectedWorldVersion);
  assert.equal(savedReceipt.text, delayedCommand.text);
  const callsAfterDelayed = calls;
  await api.sendMessageIfEnabled(f.owner, delayedCommand);
  assert.equal(calls, callsAfterDelayed, 'accepted-only recovery purchases exactly once');
  // First completion consumed the opening; later completions contain historical recall.
  // Reading the following snapshot must not reinterpret that recall as a fresh ACK.
  for (let turn = 0; turn < 2; turn++) {
    const current = await worlds.get({ userId: f.owner }, f.worldId);
    const next = await api.sendMessageIfEnabled(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.a,
      expectedVersion: current.version,
      text: '继续当面聊第' + turn + '轮',
    });
    assert.equal(next?.status, 'committed');
  }
  assert.equal(calls, 4);
  const currentAfterRecall = await worlds.get({ userId: f.owner }, f.worldId);
  const consumptionFrame = {
    worldId: f.worldId,
    actorId: f.a,
    engineEpoch: 2,
    worldVersion: currentAfterRecall.version,
  };
  const consumed = await db.transaction(f.owner, (sql) =>
    readConsumedSceneObservationSourcesInTransaction(sql, f.owner, consumptionFrame),
  );
  assert.equal(
    new Set(consumed.map((x) => x.sourceId + ':' + x.contentHash)).size,
    consumed.length,
  );
  const completed = (
    await admin.query(
      "SELECT id,response FROM parallel_life.agent_attempts WHERE world_id=$1 AND actor_id=$2 AND status='committed' ORDER BY expected_world_version DESC",
      [f.worldId, f.a],
    )
  ).rows;
  const historical = completed.find((row) =>
    row.response.snapshot.sources.some(
      (source: any) =>
        source.kind === 'scene_entry' &&
        source.usage === 'private_strategy' &&
        !row.response.snapshot.actorObservationInbox?.sourceIds.includes(source.id),
    ),
  );
  assert.ok(historical, 'completion must actually retain historical recall in its snapshot');
  const saved = historical.response;
  const recallSources = saved.snapshot.sources.filter(
    (source: any) =>
      source.kind === 'scene_entry' &&
      source.usage === 'private_strategy' &&
      !saved.snapshot.actorObservationInbox?.sourceIds.includes(source.id),
  );
  assert.ok(
    recallSources.every(
      (source: any) =>
        !saved.suppliedContext.observations.some((ref: any) => ref.sourceId === source.id),
    ),
    'new completions exclude historical recall from notification ACK',
  );
  // Simulate a previously persisted completion using genuine source evidence, without editing it.
  const onlyRecall = structuredClone(saved);
  onlyRecall.suppliedContext.observations = recallSources.map((source: any) => ({
    sourceId: source.id,
    contentHash: source.contentHash,
  }));
  delete onlyRecall.snapshot.actorObservationInbox;
  const readWithSupplied = (response: typeof saved) =>
    db.transaction(f.owner, (sql) =>
      readConsumedSceneObservationSourcesInTransaction(
        {
          query: (async (text: string, values?: unknown[]) => {
            const result = await sql.query(text, values);
            if (text.includes('SELECT a.*,e.version AS committed_version'))
              return {
                ...result,
                rows: result.rows.map((row) =>
                  row.id === historical.id ? { ...row, response } : row,
                ),
              };
            return result;
          }) as SqlClient['query'],
        } as SqlClient,
        f.owner,
        consumptionFrame,
      ),
    );
  await readWithSupplied(onlyRecall);
  const sourceId = onlyRecall.suppliedContext.observations[0].sourceId;
  onlyRecall.snapshot.observations.find((o: any) => o.sourceId === sourceId).text =
    '伪造的历史现场文字';
  await assert.rejects(readWithSupplied(onlyRecall), {
    code: 'SCENE_OBSERVATION_CONSUMPTION_PROOF_INVALID',
  });
  const accepted = await input(f, '@甲 现在当面说吧。');
  let nativeCalls = 0;
  const handler = nativeNpcTaskHandler(db, () => ({
    async complete(messages) {
      nativeCalls++;
      const receipt = (
        await admin.query(
          "SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND document->>'threadId'=$2 ORDER BY created_at DESC LIMIT 1",
          [f.worldId, f.sceneId],
        )
      ).rows[0].document;
      const currentActor = (
        await admin.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
          [f.worldId, f.a],
        )
      ).rows[0].document;
      const snapshot = await readNativeAgentSnapshot(
        db,
        f.owner,
        await worlds.get({ userId: f.owner }, f.worldId),
        f.a,
        receipt,
        receipt.storyAt,
        currentActor,
      );
      const privateRecall = snapshot.observations.find((o) => o.text === command.text);
      assert.ok(privateRecall, 'scene actor remembers own actual private input');
      assert.equal(
        snapshot.sources.find((s) => s.id === privateRecall.sourceId)?.usage,
        'private_strategy',
      );
      assert.ok(
        !snapshot.sources.some(
          (s) => s.id === privateRecall.sourceId && s.usage === 'channel_context',
        ),
      );
      return JSON.stringify({
        statements: [
          { text: '今晚一起吃饭吗？', dependsOnActionIds: [], requestsPlayerReply: true },
        ],
        goals: [],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
      });
    },
  }));
  await runOne(
    {
      claim: (kinds) => queue.claimForOwner(accepted.task!.id, f.owner, kinds),
      renew: (lease) => queue.renew(lease),
      finish: (lease, outcome) => queue.finish(lease, outcome),
    },
    {
      world: async (lease, signal) => {
        assert.equal(await handler(lease, signal), true);
      },
    },
  );
  assert.equal(nativeCalls, 1);
  const questionState = (
    await admin.query(
      'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [f.worldId, f.a],
    )
  ).rows[0].document;
  const sceneQuestion = questionState.questions.find(
    (q: any) => q.status === 'open' && q.channel === 'scene',
  );
  assert.ok(sceneQuestion, 'native turn creates a scene question');
  const replyApi = npcAgentServices(db, () => ({
    async complete(messages) {
      const payload = JSON.parse(messages[1]!.content);
      const target = Object.entries(payload.playerReplyTargets).find(
        ([, value]) => (value as { questionId?: string }).questionId === sceneQuestion.id,
      );
      assert.ok(target, 'private input in same scene receives authorized scene question target');
      return JSON.stringify({
        protocol: 'npc-wire-v20',
        replyChannel: 'scene',
        statements: [
          {
            text: '好，听到了。',
            kind: 'speech',
            dependsOnActionIds: [],
            requestsPlayerReply: false,
            questionForResponsibilityId: null,
            stickerId: null,
          },
        ],
        executions: [],
        changes: {
          inputInterpretation: {
            kind: 'related_reply',
            sourceId: payload.wireCatalog.inputSourceRef,
            quote: '好呀',
            replies: [{ targetRef: target[0], relation: 'answer', decision: null }],
          },
        },
      });
    },
  }));
  const beforeAnswer = await worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(
    (
      await replyApi.sendMessageIfEnabled(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        actorId: f.a,
        expectedVersion: beforeAnswer.version,
        text: '好呀',
      })
    )?.status,
    'committed',
  );
  const answered = (
    await admin.query(
      'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [f.worldId, f.a],
    )
  ).rows[0].document;
  assert.equal(answered.questions.find((q: any) => q.id === sceneQuestion.id).status, 'answered');

  const preLeave = await worlds.get({ userId: f.owner }, f.worldId);
  const priorScene = await db.transaction(f.owner, (sql) => loadScene(sql, f.worldId, f.sceneId));
  const lateApi = npcAgentServices(db, () => ({
    async complete() {
      const live = await worlds.get({ userId: f.owner }, f.worldId);
      await scenes.navigate(
        f.owner,
        f.worldId,
        f.sceneId,
        { commandId: randomUUID(), expectedVersion: live.version },
        true,
      );
      return JSON.stringify({
        protocol: 'npc-wire-v20',
        replyChannel: 'scene',
        statements: [
          {
            text: '这条迟到现场回复不能保存。',
            kind: 'speech',
            dependsOnActionIds: [],
            requestsPlayerReply: false,
            questionForResponsibilityId: null,
            stickerId: null,
          },
        ],
        executions: [],
        changes: null,
      });
    },
  }));
  await assert.rejects(
    lateApi.sendMessageIfEnabled(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.a,
      expectedVersion: preLeave.version,
      text: '离开前发给你的微信',
    }),
  );
  const left = await db.transaction(f.owner, (sql) => loadScene(sql, f.worldId, f.sceneId));
  assert.ok(!left.entries.some((e) => 'text' in e && e.text === '这条迟到现场回复不能保存。'));
  assert.equal(left.entries.length, priorScene.entries.length);

  const absentApi = npcAgentServices(db, () => ({
    async complete(messages) {
      assert.equal(JSON.parse(messages[1]!.content).sceneReplyContext, undefined);
      return JSON.stringify({
        protocol: 'npc-wire-v20',
        replyChannel: 'scene',
        statements: [
          {
            text: '缺席人物不能现场说话。',
            kind: 'speech',
            dependsOnActionIds: [],
            requestsPlayerReply: false,
            questionForResponsibilityId: null,
            stickerId: null,
          },
        ],
        executions: [],
        changes: null,
      });
    },
  }));
  const finalWorld = await worlds.get({ userId: f.owner }, f.worldId);
  await assert.rejects(
    absentApi.sendMessageIfEnabled(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.b,
      expectedVersion: finalWorld.version,
      text: '你在哪？',
    }),
  );
  assert.ok(
    !(await db.transaction(f.owner, (sql) => loadScene(sql, f.worldId, f.sceneId))).entries.some(
      (e) => 'text' in e && e.text === '缺席人物不能现场说话。',
    ),
  );
});
