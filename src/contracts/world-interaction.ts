import { z } from 'zod';
import { Id, Timestamp } from './api.ts';

export const TurnModeSchema = z.enum(['chat', 'image', 'world']);
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

export const WorldMessageReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  actorId: Id,
  version: z.number().int().nonnegative(),
  eventId: Id,
});
export type WorldMessageReceipt = z.infer<typeof WorldMessageReceiptSchema>;

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
