export type NpcStreamUnitKind = 'independent_statement' | 'dependent_statement';

export type NpcStreamSegmentStatus =
  'persisted' | 'committed' | 'withheld_dependency' | 'superseded_by_interrupt' | 'aborted_error';

export type NpcStreamCompletionStatus =
  'streaming' | 'completed' | 'partial_interrupted' | 'superseded';

export type NpcStreamStatementDraft = Readonly<{
  segmentIndex: number;
  text: string;
  dependsOnActionIds: readonly string[];
  requestsPlayerReply?: boolean;
  questionForResponsibilityId?: string;
}>;

export type NpcStreamSegmentCredential = Readonly<{
  worldId: string;
  attemptId: string;
  commandId: string;
  actorId: string;
  segmentIndex: number;
  segmentId: string;
  messageId: string;
  unitKind: NpcStreamUnitKind;
  text: string;
  dependsOnActionIds: readonly string[];
  requestsPlayerReply: boolean;
  questionForResponsibilityId?: string;
  status: NpcStreamSegmentStatus;
  completionStatus: NpcStreamCompletionStatus;
  sourceEventId?: string;
  sourceVersion?: number;
  userMessageId?: string;
  messageAt: string;
}>;

export type CommittedStreamMessageProjection = Readonly<{
  id: string;
  actorId: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  sourceEventId: string;
  sourceVersion: number;
}>;

export type CommittedStreamSegmentEvent = Readonly<{
  status: 'segment_committed';
  commandId: string;
  worldId: string;
  actorId: string;
  attemptId: string;
  eventId: string;
  version: number;
  segmentIndex: number;
  segmentId: string;
  unitKind: NpcStreamUnitKind;
  message: CommittedStreamMessageProjection & { role: 'assistant' };
  userMessage?: CommittedStreamMessageProjection & { role: 'user' };
}>;

export type NpcStreamTurnSummary = Readonly<{
  attemptId: string;
  commandId: string;
  eventId: string;
  version: number;
  completionStatus: NpcStreamCompletionStatus;
  committedSegmentCount: number;
  withheldSegmentCount: number;
  supersededSegmentCount: number;
  abortedSegmentCount: number;
}>;

export function toContractStreamSummary(summary: NpcStreamTurnSummary): {
  completionStatus: 'streaming' | 'completed' | 'partial_interrupted' | 'superseded';
  committedSegmentCount: number;
  totalSegmentCount: number;
} {
  return {
    completionStatus: summary.completionStatus,
    committedSegmentCount: summary.committedSegmentCount,
    totalSegmentCount:
      summary.committedSegmentCount +
      summary.withheldSegmentCount +
      summary.supersededSegmentCount +
      summary.abortedSegmentCount,
  };
}

function hashHex32(input: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c64e6d,
    h3 = 0x9e3779b9,
    h4 = 0x85ebca6b;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

export function deterministicStreamEventId(attemptId: string): string {
  const hex = hashHex32(`event:${attemptId}`);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    'a' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function deterministicStreamSegmentId(attemptId: string, segmentIndex: number): string {
  return `${attemptId}_seg_${segmentIndex}`;
}

export function deterministicStreamMessageId(eventId: string, segmentIndex: number): string {
  return `${eventId}_seg_${segmentIndex}`;
}

export function deterministicStreamUserMessageId(eventId: string): string {
  return `${eventId}_user`;
}

const UNBOUND_MEDIA_COMPLETION_PATTERNS = [
  /(?:已经|已)(?:拍好|生成好|做好|画好|录好).*(?:发给|发你|送达|传给)/u,
  /(?:照片|图片|自拍|视频|画面)(?:已经|已)(?:发给|发你|发出|传给|送达)/u,
];

const UNBOUND_ACTION_COMPLETION_PATTERNS = [/(?:已经|已)(?:把.*交给你|把.*递给你|完成交付)/u];

export function claimsUnboundActionCompletion(
  text: string,
  executionCapabilities: readonly string[] = [],
): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (UNBOUND_MEDIA_COMPLETION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (UNBOUND_ACTION_COMPLETION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (
    executionCapabilities.some(
      (cap) => cap === 'media.generate_image' || cap === 'media.generate_video',
    ) &&
    /(?:已经拍好|已经发你|已发送照片|已发送图片|已发送视频)/u.test(normalized)
  ) {
    return true;
  }
  return false;
}

export function classifyNpcStreamStatement(input: {
  statement: NpcStreamStatementDraft;
  channelKind: 'private' | 'group' | 'scene';
  inputOrigin: 'player' | 'wake' | 'coordination';
  priorDependentSeen: boolean;
  existingResponsibilityIds: readonly string[];
  executionCapabilities?: readonly string[];
}): {
  unitKind: NpcStreamUnitKind;
  reason?:
    | 'non_private_or_non_player'
    | 'follows_dependent_statement'
    | 'depends_on_action'
    | 'invalid_or_pending_responsibility'
    | 'unbound_completion_claim';
} {
  const {
    statement,
    channelKind,
    inputOrigin,
    priorDependentSeen,
    existingResponsibilityIds,
    executionCapabilities = [],
  } = input;
  if (channelKind !== 'private' || inputOrigin !== 'player') {
    return { unitKind: 'dependent_statement', reason: 'non_private_or_non_player' };
  }
  if (priorDependentSeen) {
    return { unitKind: 'dependent_statement', reason: 'follows_dependent_statement' };
  }
  if (statement.dependsOnActionIds.length > 0) {
    return { unitKind: 'dependent_statement', reason: 'depends_on_action' };
  }
  if (statement.questionForResponsibilityId !== undefined) {
    if (
      statement.requestsPlayerReply !== true ||
      !existingResponsibilityIds.includes(statement.questionForResponsibilityId)
    ) {
      return { unitKind: 'dependent_statement', reason: 'invalid_or_pending_responsibility' };
    }
  }
  if (claimsUnboundActionCompletion(statement.text, executionCapabilities)) {
    return { unitKind: 'dependent_statement', reason: 'unbound_completion_claim' };
  }
  return { unitKind: 'independent_statement' };
}

export type NpcParsedStreamEvent =
  | { kind: 'execution_intents'; protocol: string; executions: unknown[] }
  | {
      kind: 'statement';
      statement: NpcStreamStatementDraft;
      unitKind: NpcStreamUnitKind;
      withheldReason?: string;
    }
  | {
      kind: 'statement_error';
      segmentIndex: number;
      code: string;
    };

/** Stable execution-unit identity; the paid attempt and parent input never change. */
export function streamUnitEventId(attemptId: string, unit: string): string {
  return deterministicStreamEventId(`${attemptId}:unit:${unit}`);
}
export function streamUnitCommandId(attemptId: string, unit: string): string {
  return deterministicStreamEventId(`${attemptId}:command:${unit}`);
}
export type AgentStreamUnit = {
  attemptId: string;
  parentCommandId: string;
  unit: string;
  inputMessageId: string;
  replyMessageId?: string;
};
