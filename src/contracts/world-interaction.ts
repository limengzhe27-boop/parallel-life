import { z } from 'zod';
import { Id, Timestamp } from './api.ts';

export const TurnModeSchema = z.enum(['chat', 'image', 'video', 'world']);
export type TurnMode = z.infer<typeof TurnModeSchema>;

export const ReplyStatusSchema = z.enum(['ready', 'failed', 'not_requested']);
export type ReplyStatus = z.infer<typeof ReplyStatusSchema>;

export const InteractRequestSchema = z.strictObject({
  requestId: Id,
  characterId: Id,
  text: z.string().min(1).max(4000),
  worldVersion: z.number().int().nonnegative(),
  conversationVersion: z.number().int().nonnegative().default(0),
  imageRequest: z.string().max(1500).optional(),
  videoRequest: z.string().max(1500).optional(),
  userAction: z.record(z.string(), z.unknown()).optional(),
});
export type InteractRequest = z.infer<typeof InteractRequestSchema>;

/** Persisted phone message command. The server supplies the world owner and version. */
export const WorldMessageRequestSchema = z.strictObject({
  commandId: Id,
  actorId: Id,
  expectedVersion: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(4000),
});
export type WorldMessageRequest = z.infer<typeof WorldMessageRequestSchema>;

export const WORLD_MESSAGE_PROJECTION_HEADER = 'x-message-receipt-projection';
export const WORLD_MESSAGE_PROJECTION_VERSION = '1';
export const WORLD_MESSAGE_STREAM_HEADER = 'x-message-stream';
export const WORLD_MESSAGE_STREAM_VERSION = '1';

export const CommittedTurnMessageSchema = z.strictObject({
  id: z.string().min(1).max(160),
  actorId: Id,
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(4000),
  at: Timestamp,
  sourceEventId: Id,
  sourceVersion: z.number().int().nonnegative(),
});
export type CommittedTurnMessage = z.infer<typeof CommittedTurnMessageSchema>;

export const NpcStreamTurnSummarySchema = z.strictObject({
  completionStatus: z.enum(['streaming', 'completed', 'partial_interrupted', 'superseded']),
  committedSegmentCount: z.number().int().nonnegative(),
  totalSegmentCount: z.number().int().nonnegative(),
});
export type NpcStreamTurnSummaryContract = z.infer<typeof NpcStreamTurnSummarySchema>;

export const CommittedStreamSegmentEventSchema = z.strictObject({
  attemptId: Id,
  commandId: Id,
  worldId: Id,
  actorId: Id,
  eventId: Id,
  version: z.number().int().nonnegative(),
  segmentIndex: z.number().int().nonnegative(),
  segmentId: z.string().min(1).max(160),
  unitKind: z.enum(['independent_statement', 'dependent_statement']),
  status: z.literal('committed'),
  completionStatus: z.enum(['streaming', 'completed', 'partial_interrupted', 'superseded']),
  message: CommittedTurnMessageSchema,
  userMessage: CommittedTurnMessageSchema.optional(),
});
export type CommittedStreamSegmentEventContract = z.infer<typeof CommittedStreamSegmentEventSchema>;

export const ChatTurnServerMetricsSchema = z.strictObject({
  serverReceivedAtEpochMs: z.number().int().nonnegative(),
  contextPrepareMs: z.number().nonnegative(),
  upstreamFirstChunkMs: z.number().nonnegative(),
  modelTotalMs: z.number().nonnegative(),
  responsePersistMs: z.number().nonnegative(),
  decodeCompileMs: z.number().nonnegative(),
  persistAndDecodeWallMs: z.number().nonnegative(),
  kernelCommitMs: z.number().nonnegative(),
  serverTotalMs: z.number().nonnegative(),
  toolCompletionMs: z.number().nonnegative().optional(),
  schemaBytes: z.number().int().nonnegative(),
  inputBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  queryCount: z.number().int().nonnegative(),
  transactionCount: z.number().int().nonnegative(),
  contextQueryCount: z.number().int().nonnegative(),
  commitQueryCount: z.number().int().nonnegative(),
  modelCallCount: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
});
export type ChatTurnServerMetrics = z.infer<typeof ChatTurnServerMetricsSchema>;

export const WorldMessageReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  actorId: Id,
  version: z.number().int().nonnegative(),
  eventId: Id,
  messages: z.array(CommittedTurnMessageSchema).max(16).optional(),
  metrics: ChatTurnServerMetricsSchema.optional(),
  streamSummary: NpcStreamTurnSummarySchema.optional(),
});
export type WorldMessageReceipt = z.infer<typeof WorldMessageReceiptSchema>;

export const WorldMessageStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('segment'),
    segment: CommittedStreamSegmentEventSchema,
  }),
  z.strictObject({
    type: z.literal('complete'),
    receipt: WorldMessageReceiptSchema,
  }),
  z.strictObject({
    type: z.literal('error'),
    error: z.strictObject({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      requestId: z.string(),
    }),
  }),
]);
export type WorldMessageStreamEvent = z.infer<typeof WorldMessageStreamEventSchema>;

/** Cached clients keep their original strict 6-field envelope unless projection header is negotiated. */
export function worldMessageClientReceipt(
  receipt: WorldMessageReceipt,
  projectionVersion: string | null,
): WorldMessageReceipt {
  if (projectionVersion === WORLD_MESSAGE_PROJECTION_VERSION) return receipt;
  const { messages: _messages, metrics: _metrics, streamSummary: _streamSummary, ...legacy } = receipt;
  return legacy;
}

export const InteractEventSchema = z.strictObject({
  id: Id,
  kind: z.enum(['message', 'proposal', 'fact', 'action']),
  description: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  at: Timestamp,
});
export type InteractEvent = z.infer<typeof InteractEventSchema>;

export const InteractResponseSchema = z.strictObject({
  turnMode: TurnModeSchema,
  replyStatus: ReplyStatusSchema,
  replyText: z.string().optional(),
  characterId: Id,
  worldVersion: z.number().int().nonnegative(),
  conversationVersion: z.number().int().nonnegative(),
  events: z.array(InteractEventSchema).default([]),
  errors: z.array(z.string()).default([]),
  media: z
    .strictObject({
      status: z.enum(['none', 'queued', 'pending', 'done', 'failed', 'limited']),
      subject: z.string().optional(),
      jobId: z.string().optional(),
    })
    .optional(),
});
export type InteractResponse = z.infer<typeof InteractResponseSchema>;
