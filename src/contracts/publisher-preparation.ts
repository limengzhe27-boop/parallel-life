import { z } from 'zod';
import { Id, Version, Timestamp } from './api.ts';
import { PublisherDraftContentSchema } from './world-publisher.ts';

export const PublisherPreparationMaterialSchema = z.strictObject({
  currentContent: PublisherDraftContentSchema,
  sources: z.array(z.strictObject({
    filename: z.string().trim().min(1).max(500),
    content: z.string().min(1).max(131072),
  })).min(1).max(32),
}).superRefine((value, ctx) => {
  if (value.sources.reduce((n, s) => n + new TextEncoder().encode(s.content).length, 0) > 131072 ||
      JSON.stringify(value).length > 48000)
    ctx.addIssue({ code: 'custom', message: 'MANUSCRIPT_TOO_LARGE' });
});
export const PublisherPreparationInputSchema = z.strictObject({
  commandId: Id,
  expectedDraftVersion: Version,
  currentContent: PublisherDraftContentSchema,
  sources: PublisherPreparationMaterialSchema.shape.sources,
}).superRefine((value, ctx) => {
  if (!PublisherPreparationMaterialSchema.safeParse({currentContent:value.currentContent,sources:value.sources}).success)
    ctx.addIssue({code:'custom',message:'MANUSCRIPT_TOO_LARGE'});
});
export const PublisherPreparationOutputSchema = z.strictObject({
  updatedContent: PublisherDraftContentSchema,
  summary: z.string().trim().min(1).max(1000),
  notes: z.array(z.strictObject({
    kind: z.enum(['extracted', 'supplemented', 'review']),
    text: z.string().trim().min(1).max(1000),
  })).max(100),
  issues: z.array(z.strictObject({
    path: z.array(z.union([z.string().max(100), z.number().int().nonnegative()])).max(16),
    code: z.string().regex(/^[a-zA-Z0-9_]{1,100}$/),
  })).max(100),
});
export const PublisherPreparationRecordSchema = z.strictObject({
  commandId: Id,
  workId: Id,
  draftVersion: Version,
  status: z.enum(['running','succeeded','failed','unknown']),
  material: PublisherPreparationMaterialSchema,
  result: PublisherPreparationOutputSchema.nullable(),
  errorCode: z.enum(['INVALID_RESPONSE','UPSTREAM_FAILED','TIMEOUT','UNAVAILABLE']).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const PublisherPreparationLatestSchema = z.strictObject({preparation:PublisherPreparationRecordSchema.nullable()});
export type PublisherPreparationMaterial = z.infer<typeof PublisherPreparationMaterialSchema>;
export type PublisherPreparationInput = z.infer<typeof PublisherPreparationInputSchema>;
export type PublisherPreparationOutput = z.infer<typeof PublisherPreparationOutputSchema>;
export type PublisherPreparationRecord = z.infer<typeof PublisherPreparationRecordSchema>;
