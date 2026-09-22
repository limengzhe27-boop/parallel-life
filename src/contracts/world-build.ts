import { z } from 'zod';
import { Id, Timestamp, TaskSchema } from './api.ts';
export const WorldBuildRequestSchema = z.strictObject({ commandId: Id, seedId: Id });
export type WorldBuildRequest = z.infer<typeof WorldBuildRequestSchema>;
export const BuildInputSchema = z.strictObject({
  kind: z.literal('world-build'),
  seedId: Id,
  worldId: Id,
});
export const WorldOpeningSchema = z.strictObject({
  identity: z.string().min(1).max(400),
  setting: z.string().min(1).max(500),
  actors: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[a-z0-9_]{1,24}$/),
        name: z.string().min(1).max(40),
        relationship: z.string().min(1).max(100),
        persona: z.string().min(1).max(600),
      }),
    )
    .min(3)
    .max(5),
  messages: z
    .array(z.strictObject({ actorKey: z.string().max(24), text: z.string().min(1).max(600) }))
    .min(1)
    .max(4),
  notes: z
    .array(z.strictObject({ title: z.string().min(1).max(80), text: z.string().min(1).max(1000) }))
    .min(1)
    .max(3),
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
  id: Id,
  seedId: Id,
  title: z.string(),
  time: Timestamp,
  identity: z.string(),
  setting: z.string(),
  actors: z.array(z.strictObject({ id: Id, name: z.string(), relationship: z.string() })),
  messages: z.array(
    z.strictObject({ id: z.string(), actorId: Id, text: z.string(), at: Timestamp }),
  ),
  notes: z.array(z.strictObject({ title: z.string(), text: z.string() })),
});
export type WorldPhone = z.infer<typeof WorldPhoneSchema>;
