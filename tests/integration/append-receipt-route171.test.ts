import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { SignedSession } from '../../src/modules/identity/infrastructure/signed-session.ts';
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
import type { WorldMessageReceipt } from '../../src/contracts/world-interaction.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server')
      return {
        url: 'data:text/javascript,export const NextResponse={json:(data,init)=>Response.json(data,init)};export const after=()=>{};',
        shortCircuit: true,
      };
    if (specifier === 'server-only')
      return { url: 'data:text/javascript,export {};', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const START_AT = '2026-10-20T08:00:00.000Z';
const SECRET = 'route171-session-secret-at-least-32-chars';
const ORIGIN = 'http://127.0.0.1:3000';
const { worldMessageRoute } = await import('../../src/server/world-message-http.ts');
const { POST: receiptPost } =
  await import('../../src/app/api/v1/worlds/[id]/messages/receipt/route.ts');

function wireReply(text: string, sourceRef: string, second?: string): string {
  return JSON.stringify({
    protocol: 'npc-wire-v14',
    focusChange: { kind: 'keep' },
    executions: [],
    statements: [
      { text, dependsOnActionIds: [] },
      ...(second ? [{ text: second, dependsOnActionIds: [] }] : []),
    ],
    consideration: null,
    goals: [],
    planIntents: [],
    responsibilities: [],
    agendaReview: null,
    inputInterpretation: { kind: 'new_request', sourceId: sourceRef, quote: text },
    continuation: {
      decision: 'no_current_intent',
      reason: '已回复。',
      sourceIds: [sourceRef],
      planIds: [],
      questionIds: [],
      conditions: [],
    },
  });
}
function wireReply15(text: string, second?: string): string {
  return JSON.stringify({
    protocol: 'npc-wire-v15',
    statements: [
      { text, dependsOnActionIds: [] },
      ...(second ? [{ text: second, dependsOnActionIds: [] }] : []),
    ],
    executions: [],
    changes: null,
  });
}
function extract(messages: unknown[]): { inputSourceRef: string; quote: string } {
  try {
    const payload = JSON.parse(String((messages as any[])[1]?.content));
    return {
      inputSourceRef: payload.wireCatalog?.inputSourceRef ?? 'source:1',
      quote: payload.input?.text ?? '',
    };
  } catch {
    return { inputSourceRef: 'source:1', quote: '' };
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function fixture(modelFactory: () => any) {
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const url = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`;
  process.env.APP_DATABASE_URL = url;
  process.env.SESSION_SECRET = SECRET;
  process.env.APP_ORIGIN = ORIGIN;
  process.env.PRIVATE_ASSET_DIR = '/tmp/append171-assets';
  process.env.YIBU_API_KEY = 'route171-not-called';
  mkdirSync(process.env.PRIVATE_ASSET_DIR, { recursive: true });
  const db = new PostgresDatabase(url);
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
    title: '44-171 route fixture',
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
  const session = new SignedSession(SECRET);
  const token = session.issue(owner).token;
  const csrf = session.csrf(token);
  const api = npcAgentServices(db, modelFactory as any);
  return {
    admin,
    db,
    worlds,
    owner,
    worldId,
    actorA,
    actorB,
    token,
    csrf,
    api,
    close: async () => {
      await db.close();
      await admin.end();
    },
  };
}

async function lookup(
  f: Awaited<ReturnType<typeof fixture>>,
  commandId: string,
  actorId: string,
  text: string,
  expectedVersion = 0,
  projection = '2',
) {
  const response = await receiptPost(
    new Request(`${ORIGIN}/api/v1/worlds/${f.worldId}/messages/receipt`, {
      method: 'POST',
      headers: {
        cookie: `pl_session=${f.token}`,
        origin: ORIGIN,
        'x-csrf-token': f.csrf,
        'content-type': 'application/json',
        'x-message-receipt-projection': projection,
        'x-message-recovery': '1',
      },
      body: JSON.stringify({ commandId, actorId, expectedVersion, text }),
    }),
    { params: Promise.resolve({ id: f.worldId }) },
  );
  return { response, body: await response.json() };
}
async function streamFrame(
  f: Awaited<ReturnType<typeof fixture>>,
  commandId: string,
  actorId: string,
  text: string,
  expectedVersion = 0,
) {
  const response = await worldMessageRoute(
    new Request(`${ORIGIN}/api/v1/worlds/${f.worldId}/messages`, {
      method: 'POST',
      headers: {
        cookie: `pl_session=${f.token}`,
        origin: ORIGIN,
        'x-csrf-token': f.csrf,
        'content-type': 'application/json',
        'x-message-receipt-projection': '2',
        'x-message-stream': '1',
      },
      body: JSON.stringify({ commandId, actorId, expectedVersion, text }),
    }),
    f.worldId,
  );
  assert.equal(response.status, 200);
  const lines = (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { lines, complete: lines.find((line) => line.type === 'complete') };
}

test('44-171 route: completed streamSummary and real message provenance survive lookup and refresh', async (t) => {
  let models = 0;
  const f = await fixture(() => ({
    async complete(messages: unknown[]) {
      models++;
      const { inputSourceRef, quote } = extract(messages);
      return wireReply15('完整回复一。', '完整回复二。');
    },
    async *streamComplete(messages: unknown[]) {
      models++;
      const { inputSourceRef, quote } = extract(messages);
      yield wireReply15('完整回复一。', '完整回复二。');
    },
  }));
  t.after(f.close);
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'route completed',
  };
  const receipt = await f.api.sendMessageIfEnabled(f.owner, command);
  assert.ok(receipt);
  const first = await lookup(f, command.id, command.actorId, command.text);
  assert.equal(first.response.status, 200);
  const body = first.body as WorldMessageReceipt;
  assert.equal(body.status, 'committed');
  assert.equal(body.streamSummary?.completionStatus, 'completed');
  assert.equal(body.messages?.length, 3);
  const messageEvents = new Map(
    (body.messageEvents ?? []).map((event) => [event.eventId, event.version]),
  );
  for (const message of body.messages ?? []) {
    assert.equal(messageEvents.get(message.sourceEventId), message.sourceVersion);
  }
  assert.equal(body.messages?.[0]?.role, 'user');
  assert.equal(body.messages?.[1]?.text, '完整回复一。');
  assert.equal(body.messages?.[1]?.sourceVersion, 1);
  assert.equal(body.messages?.[2]?.text, '完整回复二。');
  assert.equal(body.messages?.[2]?.sourceVersion, 2);
  const countBefore = await f.admin.query(
    'SELECT (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1) events,(SELECT count(*)::int FROM parallel_life.world_messages WHERE world_id=$1) messages',
    [f.worldId],
  );
  const legacy = await lookup(f, command.id, command.actorId, command.text, 0, '1');
  assert.equal((legacy.body as any).status, 'committed');
  assert.equal('messages' in (legacy.body as any), false);
  assert.equal('streamSummary' in (legacy.body as any), false);
  const second = await lookup(f, command.id, command.actorId, command.text);
  assert.deepEqual(second.body, first.body);
  assert.equal(models, 1);
  const countAfter = await f.admin.query(
    'SELECT (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1) events,(SELECT count(*)::int FROM parallel_life.world_messages WHERE world_id=$1) messages',
    [f.worldId],
  );
  assert.deepEqual(countAfter.rows[0], countBefore.rows[0]);
});

test('44-171 route: partial_interrupted and superseded are distinct, preserve only saved units, and do not call a model on lookup', async (t) => {
  let models = 0;
  const f = await fixture(() => ({
    async complete(messages: unknown[]) {
      models++;
      const { inputSourceRef } = extract(messages);
      return wireReply('不应调用。', inputSourceRef);
    },
    async *streamComplete(messages: unknown[]) {
      models++;
      const { inputSourceRef } = extract(messages);
      yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
      yield '{"text":"已保存的第一段。","dependsOnActionIds":[]}';
      throw Error('ROUTE_SUFFIX_FAILURE');
    },
  }));
  t.after(f.close);
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'route partial',
  };
  const receipt = await f.api.sendMessageIfEnabled(f.owner, command);
  assert.ok(receipt);
  const partial = await lookup(f, command.id, command.actorId, command.text);
  const body = partial.body as WorldMessageReceipt;
  assert.equal(body.status, 'committed');
  assert.equal(body.streamSummary?.completionStatus, 'partial_interrupted');
  assert.equal(body.streamSummary?.committedSegmentCount, 1);
  assert.equal(
    body.messages?.some((m) => m.role === 'assistant' && m.text.includes('已保存的第一段')),
    true,
  );
  assert.equal(
    body.messages?.some((m) => m.role === 'assistant' && m.text.includes('第二段')),
    false,
  );
  assert.equal(models, 1);
  const stream = await streamFrame(f, command.id, command.actorId, command.text);
  assert.equal(stream.complete.receipt.streamSummary?.completionStatus, 'partial_interrupted');
  assert.equal(stream.complete.receipt.streamSummary?.committedSegmentCount, 1);
  assert.equal(
    stream.complete.receipt.messages?.some((m: any) => m.text.includes('已保存的第一段')),
    true,
  );
});

test('44-171 route: A appends its second unit after B and reports completed with real provenance', async (t) => {
  const f = await fixture(() => ({
    async complete(messages: unknown[]) {
      const { inputSourceRef } = extract(messages);
      return wireReply('B 的独立回复。', inputSourceRef);
    },
    async *streamComplete(messages: unknown[]) {
      const { inputSourceRef, quote } = extract(messages);
      if (!quote.startsWith('route superseded')) {
        yield wireReply('B 的独立回复。', inputSourceRef);
        return;
      }
      yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
      yield '{"text":"superseded 已保存首段。","dependsOnActionIds":[]}';
      await gate.promise;
      yield ',{"text":"superseded 不应保存的后缀。","dependsOnActionIds":[]}';
      yield '],"consideration":null,"goals":[],"planIntents":[],"responsibilities":[],"agendaReview":null,"inputInterpretation":{"kind":"new_request","sourceId":"' +
        inputSourceRef +
        '","quote":' +
        JSON.stringify(quote) +
        '},"continuation":{"decision":"no_current_intent","reason":"已回复。","sourceIds":["' +
        inputSourceRef +
        '"],"planIds":[],"questionIds":[],"conditions":[]}}';
    },
  }));
  t.after(f.close);
  const first = deferred();
  const gate = deferred();
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'route superseded',
  };
  const aPromise = f.api.sendMessageIfEnabled(f.owner, command, {
    onSegment: () => {
      first.resolve();
    },
  });
  await first.promise;
  await f.api.sendMessageIfEnabled(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorB,
    expectedVersion: 1,
    text: 'B 在 route superseded 中插入。',
  });
  gate.resolve();
  const aResult = await aPromise;
  assert.ok(aResult);
  const result = await lookup(f, command.id, command.actorId, command.text);
  const body = result.body as WorldMessageReceipt;
  assert.equal(body.streamSummary?.completionStatus, 'completed');
  assert.equal(body.streamSummary?.committedSegmentCount, 2);
  assert.equal(
    body.messages?.some((m) => m.text.includes('superseded 已保存首段')),
    true,
  );
  assert.equal(
    body.messages?.some((m) => m.text.includes('superseded 不应保存的后缀')),
    true,
  );
  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(
    world.messages.some((m) => m.text.includes('B 的独立回复')),
    true,
  );
  const sourceFor = new Map((body.messageEvents ?? []).map((e) => [e.eventId, e.version]));
  for (const m of body.messages ?? [])
    assert.equal(sourceFor.get(m.sourceEventId), m.sourceVersion);
});

test('44-171 route: user interruption seals the old prefix as superseded, not completed', async (t) => {
  const gate = deferred();
  const f = await fixture(() => ({
    async complete(messages: unknown[]) {
      const { inputSourceRef } = extract(messages);
      return wireReply('新决定回复。', inputSourceRef);
    },
    async *streamComplete(messages: unknown[]) {
      const { inputSourceRef, quote } = extract(messages);
      if (quote.startsWith('old superseded')) {
        yield '{"protocol":"npc-wire-v14","focusChange":{"kind":"keep"},"executions":[],"statements":[';
        yield '{"text":"旧回合已保存段。","dependsOnActionIds":[]}';
        await gate.promise;
        yield ',{"text":"旧回合不应保存段。","dependsOnActionIds":[]}';
        yield '],"consideration":null,"goals":[],"planIntents":[],"responsibilities":[],"agendaReview":null,"inputInterpretation":{"kind":"new_request","sourceId":"' +
          inputSourceRef +
          '","quote":' +
          JSON.stringify(quote) +
          '},"continuation":{"decision":"no_current_intent","reason":"旧回合。","sourceIds":["' +
          inputSourceRef +
          '"],"planIds":[],"questionIds":[],"conditions":[]}}';
        return;
      }
      yield wireReply15('新决定回复。');
    },
  }));
  t.after(f.close);
  const first = deferred();
  const oldCommand = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'old superseded turn',
  };
  const oldPromise = f.api.sendMessageIfEnabled(f.owner, oldCommand, {
    onSegment: () => first.resolve(),
  });
  await first.promise;
  const newReceipt = await f.api.sendMessageIfEnabled(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 1,
    text: 'new decision turn',
  });
  assert.ok(newReceipt);
  gate.resolve();
  assert.ok(await oldPromise);
  const result = await lookup(f, oldCommand.id, oldCommand.actorId, oldCommand.text);
  const body = result.body as WorldMessageReceipt;
  assert.equal(body.streamSummary?.completionStatus, 'superseded');
  assert.equal(body.streamSummary?.committedSegmentCount, 1);
  assert.equal(
    body.messages?.some((m) => m.text.includes('旧回合已保存段')),
    true,
  );
  assert.equal(
    body.messages?.some((m) => m.text.includes('旧回合不应保存段')),
    false,
  );
  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(
    world.messages.some((m) => m.text.includes('新决定回复')),
    true,
  );
});

test('44-171 route: unknown remains execution-unknown, not a stream completion status', async (t) => {
  const f = await fixture(() => ({
    async complete(messages: unknown[]) {
      const { inputSourceRef } = extract(messages);
      return wireReply('不应调用。', inputSourceRef);
    },
  }));
  t.after(f.close);
  const store = new (
    await import('../../src/modules/world/infrastructure/agent-runtime-repository.ts')
  ).PostgresAgentRuntimeRepository(f.db);
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'route unknown',
  };
  const receipt = await store.accept(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    commandId: command.id,
    inputHash: createHash('sha256')
      .update(JSON.stringify([f.worldId, 0, f.actorA, command.text, 'private', 'player']))
      .digest('hex'),
    channel: 'private',
    threadId: f.actorA,
    recipientActorId: f.actorA,
    expectedWorldVersion: 0,
    origin: 'player',
    text: command.text,
    receivedAt: START_AT,
    storyAt: START_AT,
  });
  const actor = await store.read(f.owner, { worldId: f.worldId, actorId: f.actorA });
  assert.ok(actor);
  const attempt = (
    await store.claim(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.actorA,
      commandId: command.id,
      inputReceiptId: receipt.receipt.id,
      inputHash: receipt.receipt.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    })
  ).attempt;
  await store.mark(f.owner, attempt, 'request_sent');
  await store.mark(f.owner, attempt, 'unknown_after_send');
  const lookupResponse = await lookup(f, command.id, command.actorId, command.text);
  const body = lookupResponse.body as any;
  assert.equal(body.status, 'unconfirmed');
  assert.equal(body.recovery, 'unknown');
  assert.equal('streamSummary' in body, false);
  assert.equal(
    (
      await f.admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1',
        [f.worldId],
      )
    ).rows[0].n,
    0,
  );
});

test('44-171 route: media prefix and final receipt stay linked to the original request after B insertion', async (t) => {
  let models = 0;
  const f = await fixture(() => ({
    async complete(messages: unknown[]) {
      models++;
      const { inputSourceRef } = extract(messages);
      return wireReply15('B 的媒体期间回复。');
    },
    async *streamComplete(messages: unknown[]) {
      models++;
      const { inputSourceRef, quote } = extract(messages);
      if (!quote.startsWith('A media final')) {
        yield wireReply15('B 的媒体期间回复。');
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
      await mediaGate.promise;
      yield ',"changes":null}';
    },
  }));
  t.after(f.close);
  const first = deferred();
  const media = deferred();
  const mediaGate = deferred();
  let mediaEventId = '';
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'A media final original request',
  };
  const aPromise = f.api.sendMessageIfEnabled(f.owner, command, {
    onSegment: () => first.resolve(),
    onMediaCommitted: (eventId) => {
      mediaEventId = eventId;
      media.resolve();
    },
  });
  await Promise.all([first.promise, media.promise]);
  const current = await f.worlds.get({ userId: f.owner }, f.worldId);
  const bReceipt = await f.api.sendMessageIfEnabled(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorB,
    expectedVersion: current.version,
    text: 'B media insertion',
  });
  assert.ok(bReceipt);
  mediaGate.resolve();
  assert.ok(await aPromise);
  assert.ok(mediaEventId);
  const receipt = await lookup(f, command.id, command.actorId, command.text);
  const body = receipt.body as WorldMessageReceipt;
  assert.equal(body.streamSummary?.completionStatus, 'completed');
  assert.equal(
    body.messages?.some((m) => m.text.includes('A 先说明拍照')),
    true,
  );
  assert.equal(
    body.messages?.some((m) => m.text.includes('B 的媒体期间回复')),
    false,
  );
  const mediaRows = await f.admin.query(
    "SELECT id,document FROM parallel_life.world_media_requests WHERE world_id=$1 AND document->>'sourceEventId'=$2",
    [f.worldId, mediaEventId],
  );
  assert.equal(mediaRows.rows.length, 1);
  assert.equal(
    (
      await f.admin.query(
        'SELECT id FROM parallel_life.outbox_jobs WHERE world_id=$1 AND event_id=$2',
        [f.worldId, mediaEventId],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await f.admin.query(
        'SELECT id FROM parallel_life.agent_action_results WHERE world_id=$1 AND source_event_id=$2',
        [f.worldId, mediaEventId],
      )
    ).rows.length,
    1,
  );
  const world = await f.worlds.get({ userId: f.owner }, f.worldId);
  assert.equal(
    world.messages.some((m) => m.text.includes('B 的媒体期间回复')),
    true,
  );
  const beforeEvents = await f.admin.query(
    'SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1',
    [f.worldId],
  );
  const refresh = await lookup(f, command.id, command.actorId, command.text);
  assert.deepEqual(refresh.body, receipt.body);
  const afterEvents = await f.admin.query(
    'SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1',
    [f.worldId],
  );
  assert.deepEqual(afterEvents.rows[0], beforeEvents.rows[0]);
  assert.equal(models, 2);
});

test('44-171 route: concurrent receipt and stream refreshes are read-only and do not duplicate work', async (t) => {
  let models = 0;
  const f = await fixture(() => ({
    async complete(messages: unknown[]) {
      models++;
      const { inputSourceRef } = extract(messages);
      return wireReply15('并发刷新一。', '并发刷新二。');
    },
    async *streamComplete(messages: unknown[]) {
      models++;
      const { inputSourceRef } = extract(messages);
      yield wireReply15('并发刷新一。', '并发刷新二。');
    },
  }));
  t.after(f.close);
  const command = {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: f.actorA,
    expectedVersion: 0,
    text: 'route concurrent refresh',
  };
  const receipt = await f.api.sendMessageIfEnabled(f.owner, command);
  assert.ok(receipt);
  const before = await f.admin.query(
    'SELECT (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1) events,(SELECT count(*)::int FROM parallel_life.world_messages WHERE world_id=$1) messages,(SELECT count(*)::int FROM parallel_life.world_media_requests WHERE world_id=$1) media',
    [f.worldId],
  );
  const results = await Promise.all([
    ...Array.from({ length: 4 }, () => lookup(f, command.id, command.actorId, command.text)),
    streamFrame(f, command.id, command.actorId, command.text),
  ]);
  assert.equal(models, 1);
  const receipts = results.slice(0, 4) as Awaited<ReturnType<typeof lookup>>[];
  for (const result of receipts) {
    const body = result.body as WorldMessageReceipt;
    assert.equal(body.status, 'committed');
    assert.equal(body.streamSummary?.completionStatus, 'completed');
  }
  const stream = results[4] as Awaited<ReturnType<typeof streamFrame>>;
  assert.equal(stream.complete.receipt.streamSummary?.completionStatus, 'completed');
  assert.equal(
    (
      await f.admin.query(
        'SELECT (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1) events,(SELECT count(*)::int FROM parallel_life.world_messages WHERE world_id=$1) messages,(SELECT count(*)::int FROM parallel_life.world_media_requests WHERE world_id=$1) media',
        [f.worldId],
      )
    ).rows[0].events,
    before.rows[0].events,
  );
  assert.equal(
    (
      await f.admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_messages WHERE world_id=$1',
        [f.worldId],
      )
    ).rows[0].n,
    before.rows[0].messages,
  );
  assert.equal(
    (
      await f.admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_media_requests WHERE world_id=$1',
        [f.worldId],
      )
    ).rows[0].n,
    before.rows[0].media,
  );
});
