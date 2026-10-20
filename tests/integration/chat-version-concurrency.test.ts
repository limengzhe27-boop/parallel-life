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
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const START_AT = '2026-10-20T08:00:00.000Z';

function extractInputInfo(messages: unknown[]): { inputSourceRef: string; quote: string } {
  try {
    const raw = (messages as any[])?.[1]?.content;
    if (typeof raw === 'string') {
      const payload = JSON.parse(raw);
      return {
        inputSourceRef: payload.wireCatalog?.inputSourceRef ?? 'source:1',
        quote: payload.input?.text ?? '',
      };
    }
  } catch {}
  return { inputSourceRef: 'source:1', quote: '' };
}
function buildWireV14(
  statements: { text: string; dependsOnActionIds?: string[] }[],
  options?: { inputSourceRef?: string; quote?: string },
): string {
  const inputSourceRef = options?.inputSourceRef ?? 'source:1';
  const quote = options?.quote || (statements[0]?.text ?? '你好');
  return JSON.stringify({
    protocol: 'npc-wire-v14',
    focusChange: { kind: 'keep' },
    executions: [],
    statements: statements.map((s) => ({
      text: s.text,
      dependsOnActionIds: s.dependsOnActionIds ?? [],
    })),
    consideration: null,
    goals: [],
    planIntents: [],
    responsibilities: [],
    agendaReview: null,
    inputInterpretation: { kind: 'new_request', sourceId: inputSourceRef, quote },
    continuation: {
      decision: 'no_current_intent',
      reason: '已回复。',
      sourceIds: [inputSourceRef],
      planIds: [],
      questionIds: [],
      conditions: [],
    },
  });
}
function buildWireV14Tail(options?: { inputSourceRef?: string; quote?: string }): string {
  const inputSourceRef = options?.inputSourceRef ?? 'source:1';
  const quote = options?.quote ?? '你好';
  return `],"consideration":null,"goals":[],"planIntents":[],"responsibilities":[],"agendaReview":null,"inputInterpretation":{"kind":"new_request","sourceId":"${inputSourceRef}","quote":${JSON.stringify(quote)}},"continuation":{"decision":"no_current_intent","reason":"已回复。","sourceIds":["${inputSourceRef}"],"planIds":[],"questionIds":[],"conditions":[]}}`;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function fixture() {
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clocks = new PostgresClockStore(db);
  const owner = randomUUID();
  const worldId = randomUUID();
  const actorA = randomUUID();
  const actorB = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: '44-170 version concurrency fixture',
    time: START_AT,
    actors: [
      { id: actorA, name: '甲', persona: '有自己的安排。' },
      { id: actorB, name: '乙', persona: '独立生活。' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  await worlds.initialize({ userId: owner }, world);
  await db.transaction(owner, async (sql) => {
    for (const actorId of [actorA, actorB])
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(world, actorId), 0),
      );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
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
  return {
    admin,
    db,
    worlds,
    owner,
    worldId,
    actorA,
    actorB,
    close: async () => {
      await db.close();
      await admin.end();
    },
  };
}

test('44-170 current: unrelated B commit preserves B and A first prefix is not overwritten', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const pause = deferred();
  const firstSegment = deferred();
  let streamCalls = 0;
  const model = {
    async complete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      return buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
    },
    async *streamComplete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      streamCalls += 1;
      if (!quote.includes('A 第一条')) {
        yield buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
        return;
      }
      yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
      yield '{"text":"A 第一段先显示。","dependsOnActionIds":[]}';
      await pause.promise;
      yield ',{"text":"A 第二段稍后显示。","dependsOnActionIds":[]}';
      yield buildWireV14Tail({ inputSourceRef, quote });
    },
  };
  const api = npcAgentServices(f.db, () => model);
  const aCommand = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'A 第一条：先听我说。',
  };
  const aPromise = api.sendMessageIfEnabled(f.owner, aCommand, {
    onSegment() {
      firstSegment.resolve();
    },
  });
  await firstSegment.promise;
  const prefixBefore = (
    await f.admin.query(
      'SELECT id,version,payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
      [f.worldId, f.owner, aCommand.id],
    )
  ).rows[0];
  assert.ok(prefixBefore);
  assert.equal(Number(prefixBefore.version), 1);
  const bReceipt = await api.sendMessageIfEnabled(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorB,
    expectedVersion: 1,
    text: 'B 的独立消息。',
  });
  assert.equal(bReceipt?.version, 2);
  pause.resolve();
  const aResult = await aPromise;
  assert.ok(aResult);
  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.ok(world.messages.some((message) => message.text.includes('B 的独立回复')));
  assert.equal(
    world.messages.filter((message) => message.text.includes('A 第一段先显示')).length,
    1,
  );
  assert.equal(
    world.messages.some((message) => message.text.includes('A 第二段稍后显示')),
    false,
  );
  assert.ok(world.messages.some((message) => message.text.includes('B 的独立消息')));
  const prefixAfter = (
    await f.admin.query(
      'SELECT id,version,payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
      [f.worldId, f.owner, aCommand.id],
    )
  ).rows[0];
  assert.deepEqual(prefixAfter, prefixBefore);
  const stream = await api.readStreamSegments(f.owner, f.worldId, aCommand.id);
  assert.ok(['partial_interrupted', 'superseded'].includes(stream.summary?.completionStatus ?? ''));
  assert.equal(stream.summary?.committedSegmentCount, 1);
  assert.equal(world.messages.filter((m) => m.text === aCommand.text).length, 1);
  t.diagnostic(
    JSON.stringify({
      streamCalls,
      aResult,
      messages: world.messages.map((m) => ({ text: m.text, version: m.sourceVersion })),
    }),
  );
});

test(
  '44-170 target pending: A continuation should append after unrelated B commit',
  { todo: 'requires actual-version append event; current prefix commit is V+1 only' },
  async (t) => {
    const f = await fixture();
    t.after(f.close);
    const pause = deferred();
    const firstSegment = deferred();
    const model = {
      async complete(messages: unknown[]) {
        const { inputSourceRef, quote } = extractInputInfo(messages);
        return buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
      },
      async *streamComplete(messages: unknown[]) {
        const { inputSourceRef, quote } = extractInputInfo(messages);
        if (!quote.includes('A 第一条')) {
          yield buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
          return;
        }
        yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
        yield '{"text":"A 第一段先显示。","dependsOnActionIds":[]}';
        await pause.promise;
        yield ',{"text":"A 第二段稍后显示。","dependsOnActionIds":[]}';
        yield ',{"text":"A 第三段稍后显示。","dependsOnActionIds":[]}';
        yield buildWireV14Tail({ inputSourceRef, quote });
      },
    };
    const api = npcAgentServices(f.db, () => model);
    const aPromise = api.sendMessageIfEnabled(
      f.owner,
      {
        id: randomUUID(),
        worldId: f.worldId,
        actorId: f.actorA,
        expectedVersion: 0,
        text: 'A 第一条：先听我说。',
      },
      { onSegment: () => firstSegment.resolve() },
    );
    await firstSegment.promise;
    await api.sendMessageIfEnabled(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.actorB,
      expectedVersion: 1,
      text: 'B 的独立消息。',
    });
    pause.resolve();
    await aPromise;
    const world = await f.worlds.get({ userId: f.owner }, f.worldId);
    assert.ok(world.messages.some((message) => message.text.includes('A 第二段稍后显示')));
    assert.ok(world.messages.some((message) => message.text.includes('A 第三段稍后显示')));
    assert.ok(world.messages.some((message) => message.text.includes('B 的独立回复')));
    assert.equal(
      world.messages.filter((message) => message.text.includes('A 第二段稍后显示')).length,
      1,
    );
    assert.equal(
      world.messages.filter((message) => message.text.includes('A 第三段稍后显示')).length,
      1,
    );
  },
);

test('44-170 current: A first prefix commits after unrelated B pre-prefix commit with immutable model basis', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const gate = deferred();
  const started = deferred();
  let aCalls = 0;
  let bCalls = 0;
  const model = {
    async complete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      return buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
    },
    async *streamComplete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      if (!quote.includes('A 第一条')) {
        bCalls += 1;
        yield buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
        return;
      }
      aCalls += 1;
      started.resolve();
      await gate.promise;
      yield buildWireV14([{ text: 'A 的第一段。' }], { inputSourceRef, quote });
    },
  };
  const api = npcAgentServices(f.db, () => model);
  const aCommand = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'A 第一条：先听我说。',
  };
  const aPromise = api.sendMessageIfEnabled(f.owner, aCommand);
  await started.promise;
  const bReceipt = await api.sendMessageIfEnabled(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorB,
    expectedVersion: 0,
    text: 'B 的独立消息。',
  });
  assert.equal(bReceipt?.version, 1);
  gate.resolve();
  const aResult = await aPromise;
  assert.ok(aResult);
  assert.equal(aResult.version, 2);

  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  const aInput = world.messages.find((message) => message.text === aCommand.text);
  const aReply = world.messages.find((message) => message.text.includes('A 的第一段。'));
  const bInput = world.messages.find((message) => message.text === 'B 的独立消息。');
  const bReply = world.messages.find((message) => message.text.includes('B 的独立回复。'));
  for (const message of [aInput, aReply]) {
    assert.ok(message);
    assert.equal(message.sourceVersion, 2);
  }
  for (const message of [bInput, bReply]) {
    assert.ok(message);
    assert.equal(message.sourceVersion, 1);
  }
  assert.equal(world.messages.filter((message) => message.text === aCommand.text).length, 1);
  assert.equal(world.messages.filter((message) => message.text === 'B 的独立消息。').length, 1);

  const attempt = (
    await f.admin.query(
      'SELECT expected_world_version,expected_actor_revision,status,response FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
      [f.worldId, f.owner, aCommand.id],
    )
  ).rows[0];
  assert.ok(attempt);
  assert.equal(Number(attempt.expected_world_version), 0);
  assert.equal(Number(attempt.expected_actor_revision), 0);
  assert.equal(attempt.status, 'committed');
  assert.equal(Number(attempt.response.snapshot.worldVersion), 0);
  assert.equal(attempt.response.snapshot.input.text, aCommand.text);
  const receipt = (
    await f.admin.query(
      "SELECT document->>'expectedWorldVersion' AS expected FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3",
      [f.worldId, f.owner, aCommand.id],
    )
  ).rows[0];
  assert.equal(Number(receipt.expected), 0);
  const events = (
    await f.admin.query(
      'SELECT id,version FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
      [f.worldId, f.owner, aCommand.id],
    )
  ).rows;
  assert.equal(events.length, 1);
  assert.equal(Number(events[0].version), 2);
  assert.equal(events[0].id, aResult.eventId);

  const replay = await api.sendMessageIfEnabled(f.owner, aCommand);
  assert.deepEqual(replay, aResult);
  assert.equal(aCalls, 1);
  assert.equal(bCalls, 1);
  t.diagnostic(
    JSON.stringify({
      aResult,
      attemptExpected: Number(attempt.expected_world_version),
      snapshotVersion: Number(attempt.response.snapshot.worldVersion),
      aEventVersion: Number(events[0].version),
      aCalls,
      bCalls,
    }),
  );
});

test('44-170 current: same-actor new input seals old prefix and does not overwrite the new decision', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const pause = deferred();
  const firstSegment = deferred();
  let aOneCalls = 0;
  let aTwoCalls = 0;
  const model = {
    async complete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      return buildWireV14([{ text: '旁路回复。' }], { inputSourceRef, quote });
    },
    async *streamComplete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      if (quote.includes('A 第一条')) {
        aOneCalls += 1;
        yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
        yield '{"text":"旧回合第一段。","dependsOnActionIds":[]}';
        await pause.promise;
        yield ',{"text":"旧回合不应保存的第二段。","dependsOnActionIds":[]}';
        yield buildWireV14Tail({ inputSourceRef, quote });
        return;
      }
      aTwoCalls += 1;
      yield buildWireV14([{ text: '新回合回复。' }], { inputSourceRef, quote });
    },
  };
  const api = npcAgentServices(f.db, () => model);
  const oldCommand = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'A 第一条：先听我说。',
  };
  const oldPromise = api.sendMessageIfEnabled(f.owner, oldCommand, {
    onSegment: () => firstSegment.resolve(),
  });
  await firstSegment.promise;
  const newCommand = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 1,
    text: 'A 第二条：我改变主意了。',
  };
  const newReceipt = await api.sendMessageIfEnabled(f.owner, newCommand);
  assert.ok(newReceipt);
  pause.resolve();
  const oldResult = await oldPromise;
  assert.ok(oldResult);
  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(world.messages.filter((m) => m.text.includes('旧回合第一段')).length, 1);
  assert.equal(
    world.messages.some((m) => m.text.includes('旧回合不应保存的第二段')),
    false,
  );
  assert.ok(world.messages.some((m) => m.text.includes('A 第二条：我改变主意了')));
  assert.ok(world.messages.some((m) => m.text.includes('新回合回复')));
  const history = await api.readCommittedTurnMessages(f.owner, newReceipt);
  const projected = world.messages
    .filter((m) => m.sourceEventId === newReceipt.eventId)
    .map((m) => ({
      id: m.id,
      actorId: m.actorId,
      role: m.role,
      text: m.text,
      sourceVersion: m.sourceVersion,
    }));
  assert.deepEqual(
    history.map((m) => ({
      id: m.id,
      actorId: m.actorId,
      role: m.role,
      text: m.text,
      sourceVersion: m.sourceVersion,
    })),
    projected,
  );
  const replay = await api.sendMessageIfEnabled(f.owner, newCommand);
  assert.deepEqual(replay, newReceipt);
  assert.equal(aTwoCalls, 1);
  assert.equal(aOneCalls, 1);
});

test('44-170 current: duplicate HTTP command returns the same receipt without another model call', async (t) => {
  const f = await fixture();
  t.after(f.close);
  let calls = 0;
  const model = {
    async complete(messages: unknown[]) {
      calls += 1;
      const { inputSourceRef, quote } = extractInputInfo(messages);
      return buildWireV14([{ text: '唯一回复。' }], { inputSourceRef, quote });
    },
    async *streamComplete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      yield buildWireV14([{ text: '唯一流式回复。' }], { inputSourceRef, quote });
    },
  };
  const api = npcAgentServices(f.db, () => model);
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: '重复 HTTP 的身份。',
  };
  const first = await api.sendMessageIfEnabled(f.owner, command);
  assert.ok(first);
  const second = await api.sendMessageIfEnabled(f.owner, command);
  assert.deepEqual(second, first);
  assert.equal(calls, 0, 'streamed text does not use complete()');
  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(world.messages.filter((message) => message.text === '唯一流式回复。').length, 1);
});

test('44-170 current: media prefix survives B insertion and is not queued twice', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const mediaPause = deferred();
  const firstSegment = deferred();
  const mediaCommitted = deferred();
  let mediaEventId = '';
  const model = {
    async complete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      return buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
    },
    async *streamComplete(messages: unknown[]) {
      const { inputSourceRef, quote } = extractInputInfo(messages);
      if (!quote.includes('A 媒体第一条')) {
        yield buildWireV14([{ text: 'B 的独立回复。' }], { inputSourceRef, quote });
        return;
      }
      const execution = {
        ref: 'action_1',
        action: {
          capability: 'media.generate_image',
          parameters: { sceneDescription: 'A natural front camera selfie', purpose: 'portrait' },
        },
      };
      yield '{"protocol":"npc-wire-v15","statements":[{"text":"A 先说明拍照。","dependsOnActionIds":[]}],"executions":[' +
        JSON.stringify(execution) +
        ']';
      await mediaPause.promise;
      yield ',"changes":null}';
    },
  };
  const api = npcAgentServices(f.db, () => model);
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'A 媒体第一条：拍一张。',
  };
  const aPromise = api.sendMessageIfEnabled(f.owner, command, {
    onSegment: () => firstSegment.resolve(),
    onMediaCommitted: (eventId) => {
      mediaEventId = eventId;
      mediaCommitted.resolve();
    },
  });
  await Promise.all([firstSegment.promise, mediaCommitted.promise]);
  const bReceipt = await api.sendMessageIfEnabled(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorB,
    expectedVersion: 1,
    text: 'B 在拍照期间独立说话。',
  });
  assert.equal(bReceipt?.version, 2);
  mediaPause.resolve();
  const aResult = await aPromise;
  assert.ok(aResult);
  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(world.messages.filter((m) => m.text === 'A 先说明拍照。').length, 1);
  assert.ok(world.messages.some((m) => m.text.includes('B 的独立回复')));
  assert.equal(
    (
      await f.admin.query(
        "SELECT id FROM parallel_life.world_media_requests WHERE world_id=$1 AND document->>'sourceEventId'=$2",
        [f.worldId, mediaEventId],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await f.admin.query(
        'SELECT id FROM parallel_life.outbox_jobs WHERE world_id=$1 AND event_id=$2',
        [f.worldId, mediaEventId],
      )
    ).rows.length,
    1,
  );
  const before = (
    await f.admin.query(
      "SELECT id FROM parallel_life.world_media_requests WHERE world_id=$1 AND document->>'sourceEventId'=$2",
      [f.worldId, mediaEventId],
    )
  ).rows[0].id;
  const replay = await api.sendMessageIfEnabled(f.owner, command);
  assert.deepEqual(replay, aResult);
  assert.equal(
    (
      await f.admin.query(
        "SELECT id FROM parallel_life.world_media_requests WHERE world_id=$1 AND document->>'sourceEventId'=$2",
        [f.worldId, mediaEventId],
      )
    ).rows[0].id,
    before,
  );
});
