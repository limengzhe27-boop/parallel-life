import { z } from 'zod';
import { Id, Version, TaskSchema, Timestamp } from './api.ts';
import {
  SceneSessionSchema,
  SceneEntrySchema,
  SceneActionSchema,
  CurrentMatterSchema,
  PlayerExperienceSchema,
} from './world-experiences.ts';
const base = { commandId: Id, expectedVersion: Version };
// Appointment IDs may be runtime event-derived IDs. Ownership is checked against storage.
export const SceneEnterSchema = z.strictObject({
  ...base,
  appointmentId: z.string().min(1).max(100),
});
export const SceneInputSchema = z.strictObject({
  ...base,
  text: z
    .string()
    .min(1)
    .max(4000)
    .refine((t) => Boolean(t.trim())),
  relatedMatterIds: z
    .array(Id)
    .max(8)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate matters')
    .default([]),
});
export const SceneViewSchema = z.strictObject({ ...base, view: z.enum(['phone', 'scene']) });
export const SceneLeaveSchema = z.strictObject(base);
export const SceneReceiptSchema = z.strictObject({
  commandId: Id,
  worldId: Id,
  version: Version,
  sceneId: Id,
  task: TaskSchema.nullable(),
});
export const SceneRuntimeSessionSchema = SceneSessionSchema.extend({
  appointmentId: z.string().min(1).max(100).optional(),
  placeId: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/)
    .optional(),
});
const SavedInputText = z
  .string()
  .min(1)
  .max(4000)
  .refine((t) => Boolean(t.trim()));
export const SceneRuntimeActionSchema = SceneActionSchema.safeExtend({ text: SavedInputText });
export const SceneRuntimeEntrySchema = z.discriminatedUnion('kind', [
  SceneEntrySchema.options[0],
  SceneEntrySchema.options[1],
  SceneEntrySchema.options[2].extend({ text: SavedInputText }),
  SceneEntrySchema.options[3],
  SceneEntrySchema.options[4],
  SceneEntrySchema.options[5],
]);
export const SceneReadSchema = z.strictObject({
  worldVersion: Version,
  storyNow: Timestamp,
  paused: z.boolean(),
  experience: PlayerExperienceSchema,
  scene: SceneRuntimeSessionSchema.nullable(),
  entries: z.array(SceneRuntimeEntrySchema),
  actions: z.array(SceneRuntimeActionSchema),
  matters: z.array(CurrentMatterSchema),
  task: TaskSchema.nullable(),
});
export type SceneReceipt = z.infer<typeof SceneReceiptSchema>;
export type SceneRead = z.infer<typeof SceneReadSchema>;

/** Authorized history cards expose recorded scene metadata, never private thoughts or NPC personas. */
export const SceneSummarySchema = z.strictObject({
  id: Id,
  title: z.string().min(1).max(120),
  status: z.enum(['active', 'paused', 'ended']),
  appointmentId: z.string().min(1).max(100).optional(),
  placeId: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/)
    .optional(),
  sourceVersion: Version,
  storyAt: Timestamp.optional(),
  location: z.string().min(1).max(200).optional(),
});
export const SceneHistorySchema = z.strictObject({
  worldId: Id,
  worldVersion: Version,
  storyNow: Timestamp,
  paused: z.boolean(),
  currentScene: SceneSummarySchema.nullable(),
  scenes: z.array(SceneSummarySchema).max(50),
  nextBefore: Version.nullable(),
  appointmentScenes: z.array(SceneSummarySchema),
});
export type SceneSummary = z.infer<typeof SceneSummarySchema>;
export type SceneHistory = z.infer<typeof SceneHistorySchema>;
