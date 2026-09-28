import { z } from 'zod';
import { Id, Version, Timestamp } from './api.ts';
import { SeedStorySchema, SeedSetupSchema } from './seeds.ts';
const ids = (max: number) =>
  z
    .array(Id)
    .max(max)
    .refine((a) => new Set(a).size === a.length);
const emptySetup = () => ({ identity: '', place: '', tone: '' });
// A draft saved before this field existed stays readable and editable.
export const CompatibleLifeSetupSchema = SeedSetupSchema.default(emptySetup);
export const DraftSelectionSchema = z
  .strictObject({
    factIds: ids(40),
    eventIds: ids(40),
    personIds: ids(30),
    assetIds: ids(31),
    portraitAssetId: Id.nullable(),
  })
  .refine((s) => !s.portraitAssetId || s.assetIds.includes(s.portraitAssetId));
export const LifeDraftSchema = z.strictObject({
  id: Id,
  version: Version,
  profileVersion: Version,
  discoveryVersion: Version,
  directionId: Id,
  status: z.enum(['draft', 'confirmed']),
  story: SeedStorySchema,
  setup: CompatibleLifeSetupSchema,
  selection: DraftSelectionSchema,
  assets: z.array(z.strictObject({ assetId: Id, revision: Version })).max(31),
  seedId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type LifeDraft = z.infer<typeof LifeDraftSchema>;
export const DraftListSchema = z.array(LifeDraftSchema).max(100);
export const PrepareDraftSchema = z.strictObject({
  commandId: Id,
  directionId: Id,
  discoveryVersion: Version,
});
export const SaveDraftSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  expectedProfileVersion: Version,
  story: SeedStorySchema,
  setup: CompatibleLifeSetupSchema,
  selection: DraftSelectionSchema,
});
export const ConfirmDraftSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  expectedProfileVersion: Version,
});
export type PrepareDraft = z.infer<typeof PrepareDraftSchema>;
export type SaveDraft = z.infer<typeof SaveDraftSchema>;
export type SaveDraftInput = z.input<typeof SaveDraftSchema>;
export type ConfirmDraft = z.infer<typeof ConfirmDraftSchema>;
