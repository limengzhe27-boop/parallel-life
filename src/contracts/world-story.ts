import { z } from 'zod';
import { Id } from './api.ts';

/** Public progress contains only references to already presented events, never future scripts. */
export const PublicWorldStorySchema = z.strictObject({
  runtime: z.literal('agents').optional(),
  currentStageKeys: z.array(z.string()).max(128),
  totalNodes: z.number().int().nonnegative().max(256),
  presented: z
    .array(
      z.strictObject({
        nodeKey: z.string(),
        status: z.enum([
          'claimed',
          'unknown',
          'presented',
          'offered',
          'committed',
          'declined',
          'skipped',
          'expired',
          'failed',
        ]),
        outcome: z.enum(['committed', 'declined', 'skipped', 'expired']).nullable(),
        sourceEventId: z.string(),
        sourceMessageId: z.string().nullable(),
        invitationId: z.string().nullable(),
        playerCompleted: z.literal(false),
      }),
    )
    .max(256),
  pending: z
    .strictObject({
      claimId: Id,
      commandId: Id,
      status: z.enum(['claimed', 'unknown']),
    })
    .nullable(),
});
export type PublicWorldStory = z.infer<typeof PublicWorldStorySchema>;
