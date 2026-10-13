import { z } from 'zod';
import { Id, Timestamp, Version } from './api.ts';
import { PublicationAssetUrlSchema } from './publication-assets.ts';
import { publicationStorageIssues } from '../modules/settings/domain/publication-content.ts';

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length > 0);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Incomplete, unknown and future-schema documents are private drafts, not executable content. */
export const PublisherDraftContentSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    for (const e of publicationStorageIssues(value))
      ctx.addIssue({ code: 'custom', path: e.path, message: e.code });
  })
  .pipe(z.record(z.string(), z.unknown()));
export const PublisherPrincipalSchema = z.strictObject({
  id: Id,
  displayName: text(80),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
  active: z.boolean(),
});
export const PublisherCreateWorkSchema = z.strictObject({
  commandId: Id,
  title: text(80),
  content: PublisherDraftContentSchema,
});
export const PublisherSaveDraftSchema = z.strictObject({
  commandId: Id,
  expectedDraftVersion: Version,
  title: text(80).optional(),
  content: PublisherDraftContentSchema,
});
export const PublisherRenameWorkSchema = z.strictObject({
  commandId: Id.optional(),
  title: text(80),
  expectedDraftVersion: Version.optional(),
});
export type PublisherRenameWork = z.infer<typeof PublisherRenameWorkSchema>;
export const PublisherDeleteWorkResultSchema = z.strictObject({
  acknowledged: z.boolean(),
  id: Id,
});
export type PublisherDeleteWorkResult = z.infer<typeof PublisherDeleteWorkResultSchema>;
export const PublisherCheckDraftSchema = z.strictObject({
  commandId: Id,
  expectedDraftVersion: Version,
});
export const PublisherPublishSchema = z.strictObject({
  commandId: Id,
  expectedDraftVersion: Version,
  expectedMetadataVersion: Version,
  checkId: Id,
});
export const PublisherUnpublishSchema = z.strictObject({
  commandId: Id,
  expectedMetadataVersion: Version,
});
export const PublisherRestoreSchema = z.strictObject({
  commandId: Id,
  expectedMetadataVersion: Version,
  publicationVersion: Version.min(1),
});
export const PublisherWorkSummarySchema = z.strictObject({
  id: Id,
  title: text(80),
  draftVersion: Version,
  metadataVersion: Version,
  status: z.enum(['draft', 'published', 'unpublished']),
  publicationVersion: Version.min(1).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const PublisherWorkSchema = PublisherWorkSummarySchema.extend({
  draft: z.strictObject({
    version: Version,
    contentHash: hash,
    content: PublisherDraftContentSchema,
    createdAt: Timestamp,
    createdBy: Id,
  }),
});
export const PublisherWorkListSchema = z.strictObject({
  works: z.array(PublisherWorkSummarySchema).max(100),
  nextCursor: Id.nullable(),
});
export const PublisherCheckResultSchema = z.strictObject({
  id: Id,
  workId: Id,
  draftVersion: Version,
  contentHash: hash,
  status: z.enum(['invalid', 'blocked', 'ready']),
  issues: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string().max(80), z.number().int().nonnegative()])).max(16),
        code: z.string().regex(/^[a-zA-Z0-9_]{1,80}$/),
      }),
    )
    .max(100),
  issuesTruncated: z.boolean(),
  missingCapabilities: z.array(z.string().max(100)).max(32),
  mediaVerified: z.boolean(),
  trialVerified: z.boolean(),
  checkedAt: Timestamp,
});
export const PublisherPublicationResultSchema = z.strictObject({
  workId: Id,
  publicationVersion: Version.min(1),
  metadataVersion: Version,
  status: z.enum(['published', 'unpublished']),
});
export const PublishedWorkCardSchema = z.strictObject({
  id: Id,
  version: Version.min(1),
  title: text(80),
  hook: text(180),
  identityLabel: text(300),
  experienceNote: text(300),
  description: text(1600),
  coverUrl: PublicationAssetUrlSchema.optional(),
});
export const PublishedWorkCatalogSchema = z.strictObject({
  works: z.array(PublishedWorkCardSchema).max(100),
  nextCursor: Id.nullable(),
});
export type PublisherCreateWork = z.infer<typeof PublisherCreateWorkSchema>;
export type PublisherSaveDraft = z.infer<typeof PublisherSaveDraftSchema>;
export type PublisherCheckDraft = z.infer<typeof PublisherCheckDraftSchema>;
export type PublisherPublish = z.infer<typeof PublisherPublishSchema>;
export type PublisherUnpublish = z.infer<typeof PublisherUnpublishSchema>;
export type PublisherRestore = z.infer<typeof PublisherRestoreSchema>;
export type PublisherWork = z.infer<typeof PublisherWorkSchema>;
export type PublisherCheckResult = z.infer<typeof PublisherCheckResultSchema>;
export type PublishedWorkCard = z.infer<typeof PublishedWorkCardSchema>;

export type PublisherWorkList = z.infer<typeof PublisherWorkListSchema>;
export type PublisherPublicationResult = z.infer<typeof PublisherPublicationResultSchema>;
export type PublishedWorkCatalog = z.infer<typeof PublishedWorkCatalogSchema>;
