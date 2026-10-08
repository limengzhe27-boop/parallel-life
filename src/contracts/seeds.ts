import { z } from 'zod';
import { Id, Version, Timestamp, PersonSchema, LifeDate } from './api.ts';
import { DirectionFields, BasisSchema } from './discovery.ts';
import { LifeSettingContentSchema } from './life-settings.ts';
export const SeedSetupSchema = z.strictObject({
  identity: z.string().trim().max(80),
  place: z.string().trim().max(120),
  tone: z.string().trim().max(100),
});
export const PersonRolesSchema = z
  .array(z.strictObject({ personId: Id, role: z.string().trim().min(1).max(160) }))
  .max(8)
  .refine((a) => new Set(a.map((p) => p.personId)).size === a.length);
export const SeedRequestSchema = z
  .strictObject({
    commandId: Id,
    discoveryVersion: Version,
    profileVersion: Version,
    directionId: Id,
    factIds: z.array(Id).max(40),
    personIds: z.array(Id).max(30),
    includePortrait: z.boolean(),
    personRoles: PersonRolesSchema.optional(),
  })
  .superRefine((r, c) => {
    if (
      new Set(r.factIds).size !== r.factIds.length ||
      new Set(r.personIds).size !== r.personIds.length
    )
      c.addIssue({ code: 'custom', message: '重复选择' });
    if (r.personIds.length > 8 || r.personRoles?.some((p) => !r.personIds.includes(p.personId)))
      c.addIssue({ code: 'custom', message: '请最多选择8位人物，角色要求只对应已选人物' });
  });
export type SeedRequest = z.infer<typeof SeedRequestSchema>;
export const SeedStorySchema = DirectionFields.pick({
  title: true,
  premise: true,
  opening: true,
  tradeoff: true,
});
const PersonalSeedSchema = z.strictObject({
  id: Id,
  createdAt: Timestamp,
  profileVersion: Version,
  discoveryVersion: Version,
  directionId: Id,
  story: SeedStorySchema,
  setup: SeedSetupSchema.optional(),
  facts: z.array(BasisSchema).max(40),
  events: z
    .array(z.strictObject({ eventId: Id, title: z.string().max(120), date: LifeDate.nullable() }))
    .max(40)
    .optional(),
  draftRef: z.strictObject({ id: Id, version: Version }).optional(),
  people: z.array(PersonSchema).max(30),
  personRoles: PersonRolesSchema.optional(),
  portraitAssetId: Id.nullable(),
  assets: z.array(z.strictObject({ assetId: Id, revision: Version })).max(31),
});
const TrialSeedSchema = PersonalSeedSchema.omit({
  profileVersion: true,
  discoveryVersion: true,
  directionId: true,
  draftRef: true,
  personRoles: true,
})
  .extend({
    source: z.strictObject({ kind: z.literal('setting_draft'), draftId: Id, version: Version }),
    settingContent: LifeSettingContentSchema,
    facts: z.array(BasisSchema).max(0),
    events: z.array(z.never()).max(0),
    people: z.array(PersonSchema).max(0),
    portraitAssetId: z.null(),
    assets: z.array(z.never()).max(0),
  })
  .superRefine((seed, ctx) => {
    if (
      JSON.stringify(seed.story) !== JSON.stringify(seed.settingContent.story) ||
      JSON.stringify(seed.setup) !== JSON.stringify(seed.settingContent.setup)
    )
      ctx.addIssue({ code: 'custom', message: '试演必须使用已选修订的完整起点' });
  });
export const ApprovedSeedSchema = z
  .union([PersonalSeedSchema, TrialSeedSchema])
  .superRefine((seed, ctx) => {
    if (
      'personRoles' in seed &&
      (seed.people.length > 8 ||
        new Set(seed.people.map((p) => p.id)).size !== seed.people.length ||
        seed.personRoles?.some((r) => !seed.people.some((p) => p.id === r.personId)))
    )
      ctx.addIssue({ code: 'custom', message: '新分支人物映射只允许最多8位已选人物' });
  });
export type ApprovedSeed = z.infer<typeof ApprovedSeedSchema>;
export const SeedListSchema = z.array(ApprovedSeedSchema).max(100);
