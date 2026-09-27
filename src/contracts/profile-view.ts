import { z } from 'zod';
import { Id, Version } from './api.ts';
import { BASIC_FIELDS } from '../modules/profile/domain/profile-view.ts';

export const ProfileViewItemSchema = z.strictObject({
  ref: z
    .strictObject({
      kind: z.enum(['fact', 'event', 'person']),
      id: Id,
      basicField: z.enum(BASIC_FIELDS).optional(),
    })
    .refine((ref) => !ref.basicField || ref.kind === 'fact', '基础字段必须引用原事实'),
  text: z.string(),
  category: z.string(),
  storedStatus: z.enum(['suggested', 'confirmed', 'unspecified']),
  sourceMessageIds: z.array(Id),
  evidence: z.enum(['source_refs_only', 'unspecified']),
  time: z
    .strictObject({
      value: z.string().nullable(),
      precision: z.enum(['year', 'month', 'day', 'unknown']),
    })
    .optional(),
});
export const ProfileViewSchema = z.strictObject({
  profileId: Id,
  profileVersion: Version,
  current: z.array(ProfileViewItemSchema),
  interestsAndWishes: z.array(ProfileViewItemSchema),
  experiences: z.array(ProfileViewItemSchema),
  people: z.array(ProfileViewItemSchema),
  unresolved: z.array(ProfileViewItemSchema),
});
export type ProfileView = z.infer<typeof ProfileViewSchema>;
export type ProfileViewItem = z.infer<typeof ProfileViewItemSchema>;
