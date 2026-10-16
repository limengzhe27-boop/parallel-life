import { z } from 'zod';
import { Id, Version, Timestamp } from './api.ts';
import { PublishedWorkCardSchema } from './world-publisher.ts';

export const PublicationOriginSchema = z.strictObject({
  workId: Id,
  publicationVersion: Version,
  draftVersion: Version,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PublicationOrigin = z.infer<typeof PublicationOriginSchema>;
export const PublishedWorldStartRequestSchema = z.strictObject({
  commandId: Id,
  publicationVersion: Version.min(1),
});
export const PublicationTrialStartRequestSchema = z.strictObject({
  commandId: Id,
  draftVersion: Version,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const PublicationWorldResultSchema = z.strictObject({
  worldId: Id,
  seedId: Id,
  origin: PublicationOriginSchema,
  originKind: z.enum(['published_work', 'trial']),
  trialId: Id.nullable(),
  resumed: z.boolean(),
  replayed: z.boolean(),
});
export const PublicationTrialSchema = z.strictObject({
  trialId: Id,
  worldId: Id,
  seedId: Id,
  origin: PublicationOriginSchema,
  createdAt: Timestamp,
});
export const PublicationTrialEvidenceSchema = z.strictObject({
  verified: z.boolean(),
  receiptId: Id.nullable(),
});
export const PublicationPlayerCatalogSchema = z.strictObject({
  works: z
    .array(
      PublishedWorkCardSchema.extend({
        worldId: Id.nullable(),
      }),
    )
    .max(100),
  nextCursor: Id.nullable(),
});
export type PublishedWorldStartRequest = z.infer<typeof PublishedWorldStartRequestSchema>;
export type PublicationTrialStartRequest = z.infer<typeof PublicationTrialStartRequestSchema>;
export type PublicationWorldResult = z.infer<typeof PublicationWorldResultSchema>;
export type PublicationTrial = z.infer<typeof PublicationTrialSchema>;
export type PublicationTrialEvidence = z.infer<typeof PublicationTrialEvidenceSchema>;
export type PublicationPlayerCatalog = z.infer<typeof PublicationPlayerCatalogSchema>;

/** Staff-private status only; no raw director reasoning or future event content. */
export const TrialDirectorStatusSchema = z.strictObject({
  status: z.enum(['legacy', 'ready', 'failed', 'pending', 'unknown', 'blocked']),
  attemptId: Id.nullable(),
});
export type TrialDirectorStatus = z.infer<typeof TrialDirectorStatusSchema>;
