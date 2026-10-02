import { z } from 'zod';
import { Id, Timestamp, Version } from './api.ts';
import { LifeSettingContentSchema } from './life-settings.ts';

// Private author revisions. No publication/review authority is accepted here.
export const CreateSettingDraftSchema = z.strictObject({
  commandId: Id,
  content: LifeSettingContentSchema,
});
export const SaveSettingDraftSchema = z.strictObject({
  commandId: Id,
  expectedVersion: Version,
  content: LifeSettingContentSchema,
});
export const SettingDraftSchema = z.strictObject({
  id: Id,
  version: Version,
  content: LifeSettingContentSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const SettingDraftSummarySchema = SettingDraftSchema.omit({ content: true }).extend({
  title: z.string(),
  identity: z.string(),
});
export const SettingDraftListSchema = z.array(SettingDraftSummarySchema).max(20);
export type SettingDraft = z.infer<typeof SettingDraftSchema>;
export type CreateSettingDraft = z.infer<typeof CreateSettingDraftSchema>;
export type SaveSettingDraft = z.infer<typeof SaveSettingDraftSchema>;

export const SettingTrialRequestSchema = z.strictObject({
  commandId: Id,
  version: Version.max(99),
});
export type SettingTrialRequest = z.infer<typeof SettingTrialRequestSchema>;
