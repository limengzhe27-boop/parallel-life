import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChatTurnError,
  isMeaningfulNpcReplyText,
  summarizeChatTurnSamples,
  type ChatTurnTelemetryRecord,
} from '../src/modules/world/domain/chat-turn-metrics.ts';
import {
  runNpcAgent,
  type AgentRunPhaseTimings,
} from '../src/modules/world/application/run-agent.ts';
import type {
  AgentAttemptStore,
  AgentSnapshot,
} from '../src/modules/world/application/agent-runtime-ports.ts';
import {
  emptyActorAgentState,
  type AgentAttempt,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  WORLD_MESSAGE_PROJECTION_VERSION,
  WorldMessageReceiptSchema,
  worldMessageClientReceipt,
} from '../src/contracts/world-interaction.ts';
import {
  committedLocalSend,
  projectCommittedTurnReceipt,
  unprojectedLocalSends,
} from '../src/features/phone/send-projection.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';

const WORLD_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const RECEIPT_ID = '44444444-4444-4444-8444-444444444444';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';

function createBaseSnapshot(): AgentSnapshot {
  return {
    worldId: WORLD_ID,
    worldTitle: '测试世界',
    worldSetting: '现代都市',
    playerIdentity: '林默',
    worldVersion: 3,
    engineEpoch: 2,
    storyTime: '2026-10-19T12:00:00.000Z',
    actor: {
      id: ACTOR_ID,
      name: '苏晴',
      relationship: '搭档',
      persona: '直接冷静',
    },
    state: emptyActorAgentState(
      { worldId: WORLD_ID, actorId: ACTOR_ID },
      `world:${WORLD_ID}:${ACTOR_ID}`,
      3,
    ),
    sources: [
      {
        id: RECEIPT_ID,
        kind: 'accepted_input',
        recordId: RECEIPT_ID,
        worldVersion: 3,
        at: '2026-10-19T12:00:00.000Z',
      },
    ],
    recentConversation: [],
    input: {
      sourceId: RECEIPT_ID,
      channel: 'private',
      threadId: ACTOR_ID,
      origin: 'player',
      text: '今晚在老地方见面聊一下？',
      at: '2026-10-19T12:00:00.000Z',
    },
    knownAppointmentIds: [],
    knownPlanIds: [],
    allowedSourceIds: [RECEIPT_ID],
  } as unknown as AgentSnapshot;
}

function createBaseAttempt(): AgentAttempt {
  return {
    id: ATTEMPT_ID,
    worldId: WORLD_ID,
    actorId: ACTOR_ID,
    commandId: COMMAND_ID,
    inputReceiptId: RECEIPT_ID,
    inputHash: 'a'.repeat(64),
    engineEpoch: 2,
    status: 'reserved',
    expectedWorldVersion: 3,
    expectedActorRevision: 0,
    token: '77777777-7777-4777-8777-777777777777',
    leaseUntil: '2026-10-19T12:02:00.000Z',
  };
}

function createSampleProposal(): AgentProposal {
  return {
    schemaVersion: 1,
    actorId: ACTOR_ID,
    worldId: WORLD_ID,
    basedOnWorldVersion: 3,
    basedOnActorRevision: 0,
    inputReceiptId: RECEIPT_ID,
    speech: [
      {
        channel: 'private',
        threadId: ACTOR_ID,
        audienceActorIds: [],
        text: '好，我七点半到咖啡馆等你。',
        sourceIds: [RECEIPT_ID],
      },
    ],
    privateThought: {
      summary: '答应今晚见面',
      sourceIds: [RECEIPT_ID],
    },
    questionUpdates: [],
    planUpdates: [],
    relationshipDelta: {
      trustDelta: 0,
      warmthDelta: 0,
      tensionDelta: 0,
      reason: '正常回应',
      sourceIds: [RECEIPT_ID],
    },
    actionRequests: [],
  } as unknown as AgentProposal;
}

test('isMeaningfulNpcReplyText rejects typing placeholders and generic wait strings', () => {
  assert.equal(isMeaningfulNpcReplyText(''), false);
  assert.equal(isMeaningfulNpcReplyText('   '), false);
  assert.equal(isMeaningfulNpcReplyText('...'), false);
  assert.equal(isMeaningfulNpcReplyText('正在输入…'), false);
  assert.equal(isMeaningfulNpcReplyText('对方正在输入...'), false);
  assert.equal(isMeaningfulNpcReplyText('稍等'), false);
  assert.equal(isMeaningfulNpcReplyText('请稍等。'), false);
  assert.equal(isMeaningfulNpcReplyText('稍等一下，我马上拍一张发你。'), true);
  assert.equal(isMeaningfulNpcReplyText('好，我七点半到咖啡馆等你。'), true);
});

test('summarizeChatTurnSamples guards p95 when sample size < 20 and computes p95 when >= 20', () => {
  const makeRecord = (i: number): ChatTurnTelemetryRecord => ({
    worldId: WORLD_ID,
    actorId: ACTOR_ID,
    commandId: COMMAND_ID,
    eventId: EVENT_ID,
    worldVersionBefore: i,
    worldVersionAfter: i + 1,
    serverReceivedAtEpochMs: 1760000000000 + i * 1000,
    timings: {
      clientSendToServerReceiveMs: 12,
      contextPrepareMs: 20 + i,
      upstreamFirstChunkMs: 1500 + i * 10,
      modelTotalMs: 2500 + i * 20,
      responsePersistMs: 8,
      decodeCompileMs: 4,
      persistAndDecodeWallMs: 9,
      kernelCommitMs: 18,
      postCommitToDisplayMs: 3,
      firstMeaningfulReplyMs: 2550 + i * 20,
      fullTurnMs: 2555 + i * 20,
      toolCompletionMs: 0,
      serverTotalMs: 2540 + i * 20,
    },
    schemaBytes: 4200,
    inputBytes: 18500,
    outputBytes: 620,
    queryCount: 16,
    transactionCount: 5,
    contextQueryCount: 8,
    commitQueryCount: 8,
    modelCallCount: 1,
    cacheHits: i > 0 ? 1 : 0,
    replay: false,
    outcome: 'committed',
    errorCategory: 'none',
  });

  const smallSample = Array.from({ length: 5 }, (_, i) => makeRecord(i));
  const smallSummary = summarizeChatTurnSamples(smallSample);
  assert.equal(smallSummary.sampleCount, 5);
  assert.equal(smallSummary.succeededCount, 5);
  assert.equal(smallSummary.serverTotalMs.p95SufficientSampleSize, false);
  assert.equal(smallSummary.serverTotalMs.p95, null);
  assert.equal(smallSummary.serverTotalMs.min, 2540);
  assert.equal(smallSummary.serverTotalMs.max, 2620);
  assert.equal(smallSummary.serverTotalMs.p50, 2580);

  const fullSample = Array.from({ length: 20 }, (_, i) => makeRecord(i));
  const fullSummary = summarizeChatTurnSamples(fullSample);
  assert.equal(fullSummary.sampleCount, 20);
  assert.equal(fullSummary.serverTotalMs.p95SufficientSampleSize, true);
  assert.equal(typeof fullSummary.serverTotalMs.p95, 'number');
  assert.ok((fullSummary.serverTotalMs.p95 ?? 0) >= 2900);

  assert.equal(classifyChatTurnError({ code: 'VERSION_CONFLICT' }), 'version_conflict');
  assert.equal(classifyChatTurnError({ apiCode: 'BUSY' }), 'busy');
  assert.equal(classifyChatTurnError({ apiCode: 'INVALID_AI_OUTPUT' }, 'decode'), 'decode');
});

test('runNpcAgent overlaps saveResponse with pure kernel.parse and records monotonic timings', async () => {
  const snapshot = createBaseSnapshot();
  const attempt = createBaseAttempt();
  const proposal = createSampleProposal();
  const response = {
    rawText: JSON.stringify(proposal),
    proposal,
  };
  const savedPayloads: {
    snapshot?: AgentSnapshot;
    response?: { rawText: string; proposal: AgentProposal };
  }[] = [];
  let capturedTimings: AgentRunPhaseTimings | null = null;
  let parseCalls = 0;

  const store: AgentAttemptStore = {
    lookup: async () => attempt,
    claim: async () => ({ attempt, replay: false }),
    readResponse: async () => ({ found: false, response: null }),
    saveResponse: async (_ownerId, a, payload) => {
      await new Promise((r) => setTimeout(r, 35));
      savedPayloads.push(
        payload as {
          snapshot?: AgentSnapshot;
          response?: { rawText: string; proposal: AgentProposal };
        },
      );
      return { ...a, status: 'response_received' };
    },
    mark: async (_ownerId, a, status) => ({ ...a, status }),
  };

  const result = await runNpcAgent(
    {
      attempts: store,
      model: {
        decide: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return response;
        },
      },
      kernel: {
        parse: (snap, resp) => {
          parseCalls += 1;
          // Attempt to mutate clone to verify original snapshot/response stay untouched
          (snap.actor as { name: string }).name = 'MUTATED_BY_PARSE';
          (resp as Record<string, unknown>).rawText = 'MUTATED_RAW_TEXT';
          return proposal;
        },
        commit: async (_ownerId, input) => {
          assert.equal(input.snapshot.actor.name, '苏晴');
          assert.equal(input.proposal, proposal);
          return {
            state: input.snapshot.state,
            eventId: EVENT_ID,
            results: [],
          };
        },
      },
      onPhaseTiming: (timings) => {
        capturedTimings = timings;
      },
    },
    'owner-1',
    attempt,
    snapshot,
  );

  assert.equal(result.eventId, EVENT_ID);
  assert.equal(parseCalls, 1);
  assert.equal(savedPayloads[0]?.snapshot?.actor.name, '苏晴');
  assert.equal(savedPayloads[0]?.response?.rawText, response.rawText);
  assert.ok(capturedTimings);
  assert.ok((capturedTimings as AgentRunPhaseTimings).modelTotalMs >= 10);
  assert.ok((capturedTimings as AgentRunPhaseTimings).responsePersistMs >= 25);
});

test('runNpcAgent fault injection: saveResponse failure prevents commit and marks unknown_after_send', async () => {
  const snapshot = createBaseSnapshot();
  const attempt = createBaseAttempt();
  const proposal = createSampleProposal();
  let commitCalled = false;
  let failedStatus: string | null = null;

  const store: AgentAttemptStore = {
    lookup: async () => attempt,
    claim: async () => ({ attempt, replay: false }),
    readResponse: async () => ({ found: false, response: null }),
    saveResponse: async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('DB_WRITE_FAILED_DURING_SAVE_RESPONSE');
    },
    mark: async (_ownerId, a, status) => {
      if (status !== 'request_sent') failedStatus = status;
      return { ...a, status };
    },
  };

  await assert.rejects(
    () =>
      runNpcAgent(
        {
          attempts: store,
          model: {
            decide: async () => ({ rawText: '{}', proposal }),
          },
          kernel: {
            parse: () => proposal,
            commit: async () => {
              commitCalled = true;
              throw new Error('COMMIT_MUST_NOT_RUN');
            },
          },
        },
        'owner-1',
        attempt,
        snapshot,
      ),
    /DB_WRITE_FAILED_DURING_SAVE_RESPONSE/,
  );

  assert.equal(commitCalled, false);
  assert.equal(failedStatus, 'unknown_after_send');
});

test('runNpcAgent fault injection: parse failure still awaits in-flight saveResponse and preserves raw response', async () => {
  const snapshot = createBaseSnapshot();
  const attempt = createBaseAttempt();
  const proposal = createSampleProposal();
  let saveCompleted = false;
  let commitCalled = false;
  let failedStatus: string | null = null;

  const store: AgentAttemptStore = {
    lookup: async () => attempt,
    claim: async () => ({ attempt, replay: false }),
    readResponse: async () => ({ found: false, response: null }),
    saveResponse: async (_ownerId, a) => {
      await new Promise((r) => setTimeout(r, 35));
      saveCompleted = true;
      return { ...a, status: 'response_received' };
    },
    mark: async (_ownerId, a, status) => {
      if (status !== 'request_sent') {
        assert.equal(
          saveCompleted,
          true,
          'saveResponse must finish before mark(invalid_output) runs',
        );
        failedStatus = status;
      }
      return { ...a, status };
    },
  };

  await assert.rejects(
    () =>
      runNpcAgent(
        {
          attempts: store,
          model: {
            decide: async () => ({ rawText: '{"bad":true}', proposal }),
          },
          kernel: {
            parse: () => {
              throw new Error('SCHEMA_DECODE_FAILURE');
            },
            commit: async () => {
              commitCalled = true;
              throw new Error('COMMIT_MUST_NOT_RUN');
            },
          },
        },
        'owner-1',
        attempt,
        snapshot,
      ),
    /SCHEMA_DECODE_FAILURE/,
  );

  assert.equal(saveCompleted, true);
  assert.equal(commitCalled, false);
  assert.equal(failedStatus, 'invalid_output');
});

test('worldMessageClientReceipt preserves strict 6-field compatibility for legacy clients and projections for v1 clients', () => {
  const fullReceipt = WorldMessageReceiptSchema.parse({
    status: 'committed',
    commandId: COMMAND_ID,
    worldId: WORLD_ID,
    actorId: ACTOR_ID,
    version: 4,
    eventId: EVENT_ID,
    messages: [
      {
        id: `${EVENT_ID}_user`,
        actorId: ACTOR_ID,
        role: 'user',
        text: '今晚见？',
        at: '2026-10-19T12:00:00.000Z',
        sourceEventId: EVENT_ID,
        sourceVersion: 4,
      },
      {
        id: `${EVENT_ID}_effect_0`,
        actorId: ACTOR_ID,
        role: 'assistant',
        text: '好，老地方见。',
        at: '2026-10-19T12:00:01.000Z',
        sourceEventId: EVENT_ID,
        sourceVersion: 4,
      },
    ],
    metrics: {
      serverReceivedAtEpochMs: 1760000000000,
      contextPrepareMs: 25,
      upstreamFirstChunkMs: 1800,
      modelTotalMs: 2900,
      responsePersistMs: 9,
      decodeCompileMs: 3,
      persistAndDecodeWallMs: 10,
      kernelCommitMs: 21,
      serverTotalMs: 2960,
      schemaBytes: 4200,
      inputBytes: 19200,
      outputBytes: 640,
      queryCount: 16,
      transactionCount: 5,
      contextQueryCount: 8,
      commitQueryCount: 8,
      modelCallCount: 1,
      cacheHits: 1,
    },
  });

  const legacy = worldMessageClientReceipt(fullReceipt, null);
  assert.deepEqual(Object.keys(legacy).sort(), [
    'actorId',
    'commandId',
    'eventId',
    'status',
    'version',
    'worldId',
  ]);

  const negotiated = worldMessageClientReceipt(fullReceipt, WORLD_MESSAGE_PROJECTION_VERSION);
  assert.equal(negotiated.messages?.length, 2);
  assert.equal(negotiated.metrics?.queryCount, 16);
});

test('projectCommittedTurnReceipt authenticates event/version/actor, deduplicates by ID, and guards against late receipts', () => {
  const initialPhone: WorldPhone = {
    id: WORLD_ID,
    seedId: '88888888-8888-4888-8888-888888888888',
    title: '测试世界',
    version: 3,
    time: '2026-10-19T11:59:00.000Z',
    identity: '林默',
    setting: '现代都市',
    actors: [{ id: ACTOR_ID, name: '苏晴', relationship: '搭档' }],
    messages: [
      {
        id: 'opening_0',
        actorId: ACTOR_ID,
        role: 'assistant',
        text: '早安。',
        at: '2026-10-19T09:00:00.000Z',
      },
    ],
    notes: [],
  };

  const receipt = WorldMessageReceiptSchema.parse({
    status: 'committed',
    commandId: COMMAND_ID,
    worldId: WORLD_ID,
    actorId: ACTOR_ID,
    version: 4,
    eventId: EVENT_ID,
    messages: [
      {
        id: `${EVENT_ID}_user`,
        actorId: ACTOR_ID,
        role: 'user',
        text: '今晚见？',
        at: '2026-10-19T12:00:00.000Z',
        sourceEventId: EVENT_ID,
        sourceVersion: 4,
      },
      {
        id: `${EVENT_ID}_effect_0`,
        actorId: ACTOR_ID,
        role: 'assistant',
        text: '好，老地方见。',
        at: '2026-10-19T12:00:01.000Z',
        sourceEventId: EVENT_ID,
        sourceVersion: 4,
      },
    ],
  });

  const localPending = {
    id: COMMAND_ID,
    actorId: ACTOR_ID,
    role: 'user' as const,
    text: '今晚见？',
    at: '2026-10-19T12:00:00.000Z',
    status: 'pending' as const,
  };
  const confirmedLocal = committedLocalSend(WORLD_ID, localPending, receipt);
  const projectedPhone = projectCommittedTurnReceipt(initialPhone, receipt);

  assert.equal(projectedPhone.version, 4);
  assert.equal(projectedPhone.time, '2026-10-19T12:00:01.000Z');
  assert.equal(projectedPhone.messages.length, 3);
  assert.equal(projectedPhone.messages[2]?.text, '好，老地方见。');

  // Local sent bubble is immediately deduplicated once receipt.messages projects `${eventId}_user`
  const remainingLocal = unprojectedLocalSends([confirmedLocal], projectedPhone.messages, {
    [COMMAND_ID]: receipt,
  });
  assert.equal(remainingLocal.length, 0);

  // Applying the same receipt a second time is a no-op (strict ID deduplication)
  const projectedTwice = projectCommittedTurnReceipt(projectedPhone, receipt);
  assert.equal(projectedTwice.messages.length, 3);

  // Late receipt from an older version (e.g. version 3 when phone is already at version 5)
  // never downgrades version or time
  const newerPhone: WorldPhone = {
    ...projectedPhone,
    version: 5,
    time: '2026-10-19T12:05:00.000Z',
  };
  const afterLate = projectCommittedTurnReceipt(newerPhone, receipt);
  assert.equal(afterLate.version, 5);
  assert.equal(afterLate.time, '2026-10-19T12:05:00.000Z');

  // Forged user message ID or mismatched assistant sourceEventId/sourceVersion must be rejected
  assert.throws(
    () =>
      projectCommittedTurnReceipt(initialPhone, {
        ...receipt,
        messages: [
          {
            id: 'forged_user_message_id',
            actorId: ACTOR_ID,
            role: 'user',
            text: '伪造用户消息ID',
            at: '2026-10-19T12:00:01.000Z',
            sourceEventId: EVENT_ID,
            sourceVersion: 4,
          },
        ],
      }),
    /MESSAGE_RECEIPT_IDENTITY_MISMATCH/,
  );
  assert.throws(
    () =>
      projectCommittedTurnReceipt(initialPhone, {
        ...receipt,
        messages: [
          {
            id: 'msg_assistant_1',
            actorId: ACTOR_ID,
            role: 'assistant',
            text: '伪造事件归属',
            at: '2026-10-19T12:00:01.000Z',
            sourceEventId: 'other_event_id',
            sourceVersion: 4,
          },
        ],
      }),
    /MESSAGE_RECEIPT_IDENTITY_MISMATCH/,
  );
});
