import { z } from 'zod';
import { Id, Version } from './api.ts';
export const PublisherStageImageInputSchema = z.strictObject({
  commandId: Id,
  expectedDraftVersion: Version,
  actorKey: z.string().regex(/^[a-z0-9_]{1,64}$/),
  sourceAssetId: Id,
});
export const PublisherStageImageRecordSchema = z.strictObject({
  commandId: Id,
  workId: Id,
  actorKey: z.string(),
  status: z.enum(['running', 'succeeded', 'failed', 'unknown']),
  image: z
    .strictObject({
      assetId: Id,
      kind: z.literal('image'),
      mimeType: z.literal('image/png'),
      byteLength: z.number().int().positive(),
    })
    .nullable(),
  errorCode: z.string().nullable(),
});
export type PublisherStageImageInput = z.infer<typeof PublisherStageImageInputSchema>;
export type PublisherStageImageRecord = z.infer<typeof PublisherStageImageRecordSchema>;
