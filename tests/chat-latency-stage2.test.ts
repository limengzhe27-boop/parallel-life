import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimsUnboundActionCompletion,
  classifyNpcStreamStatement,
  deterministicStreamEventId,
  deterministicStreamSegmentId,
  deterministicStreamMessageId,
  deterministicStreamUserMessageId,
  toContractStreamSummary,
  type NpcStreamTurnSummary,
} from '../src/modules/world/domain/npc-stream-segment.ts';
import { NpcStreamParser } from '../src/modules/world/infrastructure/npc-stream-parser.ts';
import {
  CommittedStreamSegmentEventSchema,
  WorldMessageReceiptSchema,
  WorldMessageStreamEventSchema,
  type CommittedStreamSegmentEventContract,
} from '../src/contracts/world-interaction.ts';
import {
  applyStreamSegmentToWorld,
  projectCommittedTurnReceipt,
} from '../src/features/phone/send-projection.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';

const WORLD_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';

function createBaseWorld(): WorldPhone {
  return {
    id: WORLD_ID,
    seedId: 'seed-1',
    title: '测试世界',
    setting: '现代',
    time: '2026-10-19T10:00:00.000Z',
    version: 3,
    identity: '林默',
    actors: [
      {
        id: ACTOR_ID,
        name: '苏晴',
        relationship: '搭档',
      },
    ],
    messages: [
      {
        id: 'msg-0',
        actorId: ACTOR_ID,
        role: 'assistant',
        text: '之前的历史消息',
        at: '2026-10-19T09:59:00.000Z',
      },
    ],
    invitations: [],
    notes: [],
  };
}

test('Stage 2 unit: Statement classification & unbound action completion detection', () => {
  // Independent statements: ordinary chatter
  assert.equal(
    claimsUnboundActionCompletion('我刚到家，今天天气真不错。'),
    false,
  );
  assert.equal(
    classifyNpcStreamStatement({
      statement: { text: '我刚到家，今天天气真不错。', dependsOnActionIds: [], segmentIndex: 0 },
      channelKind: 'private',
      inputOrigin: 'player',
      priorDependentSeen: false,
      existingResponsibilityIds: [],
    }).unitKind,
    'independent_statement',
  );

  // Dependent statements: claims unbound media delivery without action execution
  assert.equal(
    claimsUnboundActionCompletion('已经拍好了发给你！', ['media.generate_image']),
    true,
  );
  assert.equal(
    classifyNpcStreamStatement({
      statement: { text: '已经拍好了发给你！', dependsOnActionIds: [], segmentIndex: 0 },
      channelKind: 'private',
      inputOrigin: 'player',
      priorDependentSeen: false,
      existingResponsibilityIds: [],
      executionCapabilities: ['media.generate_image'],
    }).unitKind,
    'dependent_statement',
  );

  // Dependent statements: explicit action dependency
  assert.equal(
    classifyNpcStreamStatement({
      statement: { text: '给你看一下这张图', dependsOnActionIds: ['act_photo_1'], segmentIndex: 0 },
      channelKind: 'private',
      inputOrigin: 'player',
      priorDependentSeen: false,
      existingResponsibilityIds: [],
    }).unitKind,
    'dependent_statement',
  );

  // Unbound physical delivery claim
  assert.equal(
    claimsUnboundActionCompletion('已经把钥匙交给你了。'),
    true,
  );
  assert.equal(
    classifyNpcStreamStatement({
      statement: { text: '已经把钥匙交给你了。', dependsOnActionIds: [], segmentIndex: 0 },
      channelKind: 'private',
      inputOrigin: 'player',
      priorDependentSeen: false,
      existingResponsibilityIds: [],
    }).unitKind,
    'dependent_statement',
  );
});

test('Stage 2 unit: Deterministic IDs meet database constraints and idempotency', () => {
  const evId = deterministicStreamEventId(ATTEMPT_ID);
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evId));
  assert.equal(evId, deterministicStreamEventId(ATTEMPT_ID));
  assert.ok(evId.length <= 64);

  const segId0 = deterministicStreamSegmentId(ATTEMPT_ID, 0);
  assert.equal(segId0, `${ATTEMPT_ID}_seg_0`);
  assert.ok(segId0.length <= 160);

  const msgId0 = deterministicStreamMessageId(evId, 0);
  assert.equal(msgId0, `${evId}_seg_0`);
  assert.ok(msgId0.length <= 160);

  const userMsgId = deterministicStreamUserMessageId(evId);
  assert.equal(userMsgId, `${evId}_user`);
  assert.ok(userMsgId.length <= 160);
});

test('Stage 2 unit: NpcStreamParser incremental chunk parsing and error containment', () => {
  const parserOpts = {
    channelKind: 'private' as const,
    inputOrigin: 'player' as const,
    existingResponsibilityIds: [] as string[],
  };

  // Boundary #1: zero chunks
  const p1 = new NpcStreamParser(parserOpts);
  assert.deepEqual(p1.pushChunk(''), []);
  assert.equal(p1.rawText, '');

  // Boundary #2: unclosed JSON prefix followed by stream abort -> 0 events
  const p2 = new NpcStreamParser(parserOpts);
  const events2 = p2.pushChunk('{"statements":[{"text":"未闭合前缀');
  assert.deepEqual(events2, []);
  assert.equal(p2.rawText, '{"statements":[{"text":"未闭合前缀');

  // Complete statement emits event immediately when closed
  const p3 = new NpcStreamParser(parserOpts);
  const c1 = p3.pushChunk('{"statements":[{"text":"第一句台词","dependsOnActionIds":[]}');
  assert.equal(c1.length, 1); // Emitted as soon as statement object closes!
  const itemC1 = c1[0]!;
  assert.equal(itemC1.kind, 'statement');
  if (itemC1.kind === 'statement') {
    assert.equal(itemC1.statement.segmentIndex, 0);
    assert.equal(itemC1.statement.text, '第一句台词');
  }
  const c2 = p3.pushChunk(']}'); // Object and array closed!
  assert.equal(c2.length, 0);

  // Boundary #4: Second segment with malformed content after first segment
  const p4 = new NpcStreamParser(parserOpts);
  const ev1 = p4.pushChunk(
    '{"statements":[{"text":"第一句有效语句","dependsOnActionIds":[]},{"bad_prop":true',
  );
  assert.equal(ev1.length, 1);
  const itemEv1 = ev1[0]!;
  assert.equal(itemEv1.kind, 'statement');
  if (itemEv1.kind === 'statement') {
    assert.equal(itemEv1.statement.text, '第一句有效语句');
  }
  const ev2 = p4.pushChunk('}]}');
  // Malformed element emits a statement_error event without crashing parser
  assert.equal(ev2.length, 1);
  const itemEv2 = ev2[0]!;
  assert.equal(itemEv2.kind, 'statement_error');
  if (itemEv2.kind === 'statement_error') {
    assert.equal(itemEv2.segmentIndex, 1);
  }
});

test('Stage 2 unit: applyStreamSegmentToWorld pure projection semantics', () => {
  const world = createBaseWorld();
  const segment0: CommittedStreamSegmentEventContract = {
    attemptId: ATTEMPT_ID,
    commandId: COMMAND_ID,
    worldId: WORLD_ID,
    actorId: ACTOR_ID,
    eventId: EVENT_ID,
    version: 4,
    segmentIndex: 0,
    segmentId: `${ATTEMPT_ID}_seg_0`,
    unitKind: 'independent_statement',
    status: 'committed',
    completionStatus: 'streaming',
    message: {
      id: `${EVENT_ID}_seg_0`,
      actorId: ACTOR_ID,
      role: 'assistant',
      text: '你好！第一段流式回复已提交。',
      at: '2026-10-19T10:01:00.000Z',
      sourceEventId: EVENT_ID,
      sourceVersion: 4,
    },
    userMessage: {
      id: `${EVENT_ID}_user`,
      actorId: ACTOR_ID,
      role: 'user',
      text: '你在家吗？',
      at: '2026-10-19T10:00:30.000Z',
      sourceEventId: EVENT_ID,
      sourceVersion: 4,
    },
  };

  const nextWorld1 = applyStreamSegmentToWorld(world, segment0);
  assert.equal(nextWorld1.version, 4);
  assert.equal(nextWorld1.messages.length, 3); // 1 old + 1 user + 1 assistant
  assert.equal(nextWorld1.messages[1]!.id, `${EVENT_ID}_user`);
  assert.equal(nextWorld1.messages[2]!.id, `${EVENT_ID}_seg_0`);

  // Idempotency: applying segment 0 again leaves state identical
  const nextWorld1Dup = applyStreamSegmentToWorld(nextWorld1, segment0);
  assert.equal(nextWorld1Dup.messages.length, 3);

  // Segment 1 arrived (no userMessage)
  const segment1: CommittedStreamSegmentEventContract = {
    attemptId: ATTEMPT_ID,
    commandId: COMMAND_ID,
    worldId: WORLD_ID,
    actorId: ACTOR_ID,
    eventId: EVENT_ID,
    version: 4,
    segmentIndex: 1,
    segmentId: `${ATTEMPT_ID}_seg_1`,
    unitKind: 'independent_statement',
    status: 'committed',
    completionStatus: 'streaming',
    message: {
      id: `${EVENT_ID}_seg_1`,
      actorId: ACTOR_ID,
      role: 'assistant',
      text: '我刚回来，正在煮咖啡。',
      at: '2026-10-19T10:01:02.000Z',
      sourceEventId: EVENT_ID,
      sourceVersion: 4,
    },
  };

  const nextWorld2 = applyStreamSegmentToWorld(nextWorld1, segment1);
  assert.equal(nextWorld2.version, 4);
  assert.equal(nextWorld2.messages.length, 4);
  assert.equal(nextWorld2.messages[3]!.text, '我刚回来，正在煮咖啡。');

  // Final receipt projectCommittedTurnReceipt deduplicates already-projected messages
  const receipt = WorldMessageReceiptSchema.parse({
    status: 'committed',
    commandId: COMMAND_ID,
    worldId: WORLD_ID,
    actorId: ACTOR_ID,
    version: 4,
    eventId: EVENT_ID,
    messages: [
      segment0.userMessage!,
      segment0.message,
      segment1.message,
    ],
  });
  const finalWorld = projectCommittedTurnReceipt(nextWorld2, receipt);
  assert.equal(finalWorld.messages.length, 4); // No duplicates!
});

test('Stage 2 unit: WorldMessageStreamEventSchema validation & toContractStreamSummary', () => {
  const segmentEvent = WorldMessageStreamEventSchema.parse({
    type: 'segment',
    segment: {
      attemptId: ATTEMPT_ID,
      commandId: COMMAND_ID,
      worldId: WORLD_ID,
      actorId: ACTOR_ID,
      eventId: EVENT_ID,
      version: 4,
      segmentIndex: 0,
      segmentId: `${ATTEMPT_ID}_seg_0`,
      unitKind: 'independent_statement',
      status: 'committed',
      completionStatus: 'streaming',
      message: {
        id: `${EVENT_ID}_seg_0`,
        actorId: ACTOR_ID,
        role: 'assistant',
        text: '气泡',
        at: '2026-10-19T10:01:00.000Z',
        sourceEventId: EVENT_ID,
        sourceVersion: 4,
      },
    },
  });
  assert.equal(segmentEvent.type, 'segment');

  const completeEvent = WorldMessageStreamEventSchema.parse({
    type: 'complete',
    receipt: {
      status: 'committed',
      commandId: COMMAND_ID,
      worldId: WORLD_ID,
      actorId: ACTOR_ID,
      version: 4,
      eventId: EVENT_ID,
    },
  });
  assert.equal(completeEvent.type, 'complete');

  const errorEvent = WorldMessageStreamEventSchema.parse({
    type: 'error',
    error: {
      code: 'BUSY',
      message: '正在处理中',
      retryable: true,
      requestId: 'req-1',
    },
  });
  assert.equal(errorEvent.type, 'error');

  const domainSummary: NpcStreamTurnSummary = {
    attemptId: ATTEMPT_ID,
    commandId: COMMAND_ID,
    eventId: EVENT_ID,
    version: 4,
    completionStatus: 'partial_interrupted',
    committedSegmentCount: 2,
    withheldSegmentCount: 1,
    supersededSegmentCount: 1,
    abortedSegmentCount: 0,
  };
  const contractSummary = toContractStreamSummary(domainSummary);
  assert.equal(contractSummary.completionStatus, 'partial_interrupted');
  assert.equal(contractSummary.committedSegmentCount, 2);
  assert.equal(contractSummary.totalSegmentCount, 4); // 2 + 1 + 1 + 0
});
