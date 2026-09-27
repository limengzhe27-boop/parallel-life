import { z } from 'zod';
import { Id, Version, Timestamp, PersonSchema, LifeDate } from './api.ts';
import { DirectionFields, BasisSchema } from './discovery.ts';
export const SeedRequestSchema = z
  .strictObject({
    commandId: Id,
    discoveryVersion: Version,
    profileVersion: Version,
    directionId: Id,
    factIds: z.array(Id).max(40),
    personIds: z.array(Id).max(30),
    includePortrait: z.boolean(),
  })
  .superRefine((r, c) => {
    if (
      new Set(r.factIds).size !== r.factIds.length ||
      new Set(r.personIds).size !== r.personIds.length
    )
      c.addIssue({ code: 'custom', message: '重复选择' });
  });
export type SeedRequest = z.infer<typeof SeedRequestSchema>;
export const SeedStorySchema = DirectionFields.pick({
  title: true,
  premise: true,
  opening: true,
  tradeoff: true,
});
export const ApprovedSeedSchema = z.strictObject({
  id: Id,
  createdAt: Timestamp,
  profileVersion: Version,
  discoveryVersion: Version,
  directionId: Id,
  story: SeedStorySchema,
  facts: z.array(BasisSchema).max(40),
  events: z
    .array(z.strictObject({ eventId: Id, title: z.string().max(120), date: LifeDate.nullable() }))
    .max(40)
    .optional(),
  draftRef: z.strictObject({ id: Id, version: Version }).optional(),
  people: z.array(PersonSchema).max(30),
  portraitAssetId: Id.nullable(),
  assets: z.array(z.strictObject({ assetId: Id, revision: Version })).max(31),
});
export type ApprovedSeed = z.infer<typeof ApprovedSeedSchema>;
export const SeedListSchema = z.array(ApprovedSeedSchema).max(100);
