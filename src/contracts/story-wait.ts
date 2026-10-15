import { z } from 'zod';
import { Id, Timestamp, Version } from './api.ts';
export const StoryWaitRequestSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  clientId: Id,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  target: z.enum(['next_appointment', 'morning', 'short']),
});
export type StoryWaitRequest = z.infer<typeof StoryWaitRequestSchema>;
export const StoryWaitReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  worldId: Id,
  version: Version,
  sourceEventId: Id,
  fromStoryAt: Timestamp,
  storyNow: Timestamp,
  targetAt: Timestamp,
  stoppedBy: z.strictObject({
    reason: z.enum(['target', 'appointment', 'story_boundary', 'opening', 'message']),
    label: z.string().max(200).optional(),
  }),
});
export type StoryWaitReceipt = z.infer<typeof StoryWaitReceiptSchema>;
