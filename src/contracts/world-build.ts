import { AlbumPhotoSchema } from './album.ts';
import { InvitationSchema } from './invitations.ts';
import { z } from 'zod';
import { Id, Timestamp, TaskSchema } from './api.ts';
export const WorldBuildRequestSchema = z.strictObject({ commandId: Id, seedId: Id });
export type WorldBuildRequest = z.infer<typeof WorldBuildRequestSchema>;
export const BuildInputSchema = z.strictObject({
  kind: z.literal('world-build'),
  seedId: Id,
  worldId: Id,
});
/**
 * Model-facing opening shape. Unknown keys are stripped rather than rejected:
 * a stray field such as `notes_placeholder` must not discard an otherwise valid
 * world, while every consumed field keeps its range and count validation.
 */
export const WorldOpeningSchema = z.object({
  identity: z.string().min(1).max(400),
  setting: z.string().min(1).max(500),
  actors: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_]{1,24}$/),
        name: z.string().min(1).max(80),
        relationship: z.string().min(1).max(600),
        persona: z.string().min(1).max(1200),
      }),
    )
    .min(2)
    .max(8),
  /** Directed ties between supporting characters; absence on old openings means unknown. */
  actorTies: z
    .array(
      z.object({
        fromKey: z.string().regex(/^[a-z0-9_]{1,24}$/),
        toKey: z.string().regex(/^[a-z0-9_]{1,24}$/),
        relationship: z.string().min(1).max(200),
        mayShare: z.boolean(),
      }),
    )
    .max(28)
    .optional(),
  messages: z
    .array(z.object({ actorKey: z.string().max(24), text: z.string().min(1).max(160) }))
    .min(1)
    .max(4),
  notes: z
    .array(z.object({ title: z.string().min(1).max(80), text: z.string().min(1).max(1000) }))
    .min(1)
    .max(5),
});
export type WorldOpening = z.infer<typeof WorldOpeningSchema>;
export const WorldBuildSchema = z.strictObject({
  seedId: Id,
  worldId: Id,
  createdAt: Timestamp,
  ready: z.boolean(),
  task: TaskSchema.nullable(),
});
export const WorldBuildListSchema = z.array(WorldBuildSchema).max(100);
export type WorldBuild = z.infer<typeof WorldBuildSchema>;
export const WorldPhoneSchema = z.strictObject({
  photos: z.array(AlbumPhotoSchema).optional(),
  choices: z
    .array(
      z.strictObject({
        id: Id,
        actorId: Id,
        quote: z.string(),
        intent: z.string(),
        at: Timestamp,
        sourceEventId: Id,
        status: z.enum(['pending', 'followed_up', 'superseded']),
        nextStep: z
          .strictObject({
            quote: z.string(),
            at: Timestamp,
            sourceEventId: Id,
            sourceMessageId: Id,
            calendar: z
              .strictObject({
                id: Id,
                title: z.string(),
                at: Timestamp,
                status: z.enum(['proposed', 'confirmed', 'cancelled', 'attended', 'missed']),
              })
              .optional(),
          })
          .optional(),
        result: z
          .strictObject({
            kind: z.enum(['reported_done', 'blocked', 'abandoned']),
            quote: z.string(),
            at: Timestamp,
            sourceEventId: Id,
          })
          .optional(),
        recoveryStep: z
          .strictObject({
            quote: z.string(),
            at: Timestamp,
            sourceEventId: Id,
            sourceMessageId: Id,
          })
          .optional(),
      }),
    )
    .optional(),
  version: z.number().int().nonnegative().optional(),
  invitations: z.array(InvitationSchema).optional(),
  id: Id,
  seedId: Id,
  title: z.string(),
  time: Timestamp,
  identity: z.string(),
  setting: z.string(),
  actors: z.array(
    z.strictObject({
      id: Id,
      name: z.string(),
      relationship: z.string(),
      summary: z.string().optional(),
    }),
  ),
  messages: z.array(
    z.strictObject({
      id: z.string(),
      actorId: Id,
      text: z.string(),
      at: Timestamp,
      role: z.enum(['user', 'assistant']).optional(),
    }),
  ),
  notes: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      text: z.string(),
      version: z.number().int().nonnegative(),
      updatedAt: Timestamp,
    }),
  ),
});
export type WorldPhone = z.infer<typeof WorldPhoneSchema>;
