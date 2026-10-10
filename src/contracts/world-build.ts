import { GenesisSourceSchema } from './world-records.ts';
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
/** Runtime-only, bound to the actor ID created in the genesis transaction. Never model authority. */
export const PlayerOpeningActorSchema = z.strictObject({
  actorId: Id,
  source: z.strictObject({ kind: z.literal('selected_person'), personId: Id }),
  relationship: z.string().max(160),
});
export const HistoryConnectionSchema = z.strictObject({
  quote: z.string().trim().min(1).max(80),
  calendar: z.strictObject({ minutesAfterStart: z.number().int().min(30).max(10080) }).optional(),
});
export const MessageHistorySchema = z.strictObject({
  version: z.literal(1),
  messages: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-z0-9_]{1,32}$/),
        actorKey: z.string().regex(/^[a-z0-9_]{1,24}$/),
        text: z.string().trim().min(1).max(160),
        minutesBeforeStart: z.number().int().min(60).max(43200),
        connection: HistoryConnectionSchema.optional(),
        replyToKey: z
          .string()
          .regex(/^[a-z0-9_]{1,32}$/)
          .optional(),
      }),
    )
    .min(2)
    .max(48),
});
export const SpaceOpeningPlaceDraftSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9_]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  actorKeys: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)),
  invitationKeys: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)),
});
export const SpaceOpeningRouteDraftSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9_]{1,64}$/),
  from: z.string().regex(/^[a-z0-9_]{1,64}$/),
  to: z.string().regex(/^[a-z0-9_]{1,64}$/),
  minutes: z.number().int().min(1).max(120),
  modeLabel: z.string().trim().min(1).max(80),
});
export const SpaceOpeningDraftSchema = z.strictObject({
  initialPlaceId: z.string().regex(/^[a-z0-9_]{1,64}$/),
  places: z.array(SpaceOpeningPlaceDraftSchema).min(1).max(16),
  routes: z.array(SpaceOpeningRouteDraftSchema).max(64),
});
export const WorldOpeningSchema = z.object({
  // Optional only for reading already persisted legacy openings; new writes require it.
  messageHistory: MessageHistorySchema.optional(),
  space: SpaceOpeningDraftSchema.optional(),
  playerActors: z.array(PlayerOpeningActorSchema).max(8).optional(),
  identity: z.string().min(1).max(400),
  setting: z.string().min(1).max(500),
  actors: z
    .array(
      z.object({
        sourcePersonId: Id.optional(),
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
/** Runtime effects are stable event-derived IDs; old UUID item IDs remain readable. */
const WorldItemId = z.union([
  Id,
  z
    .string()
    .max(80)
    .refine((value) => {
      const match = /^(.{36})_effect_(?:0|[1-9]\d{0,2})$/.exec(value);
      return Boolean(match && Id.safeParse(match[1]).success);
    }, 'Invalid world item ID'),
]);
export const WorldPhoneSchema = z.strictObject({
  photos: z.array(AlbumPhotoSchema).optional(),
  historyLinks: z
    .array(
      z.strictObject({
        recordId: z.string().startsWith('sys/history/'),
        actorId: Id,
        messageId: Id,
        invitationId: Id.optional(),
        photoIds: z.array(Id).max(2),
        source: GenesisSourceSchema,
      }),
    )
    .max(2)
    .optional(),
  choices: z
    .array(
      z.strictObject({
        id: WorldItemId,
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
            sourceMessageId: WorldItemId,
            calendar: z
              .strictObject({
                id: WorldItemId,
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
            sourceMessageId: WorldItemId,
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
      sourcePersonId: Id.optional(),
      photo: z.strictObject({ assetId: Id, revision: z.number().int().positive() }).optional(),
    }),
  ),
  messages: z.array(
    z.strictObject({
      id: z.string(),
      actorId: Id,
      text: z.string(),
      at: Timestamp,
      role: z.enum(['user', 'assistant']).optional(),
      initialRead: z.boolean().optional(),
      origin: z.literal('fictional_history').optional(),
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
