import { z } from 'zod';
import { Id, Timestamp } from './api.ts';
import { PublicationOriginSchema } from './publication-worlds.ts';
const key = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
export const PublicationSeedSchema = z.strictObject({
  id: Id,
  createdAt: Timestamp,
  source: PublicationOriginSchema.extend({ kind: z.enum(['published_work', 'publication_trial']) }),
  identity: z.string().min(1).max(300),
  situation: z.string().min(1).max(1000),
  setting: z.string().min(1).max(1600),
  experienceNote: z.string().min(1).max(300),
});
export const PublicationOpeningSchema = z.strictObject({
  kind: z.literal('publication_opening'),
  schemaVersion: z.literal(1),
  origin: PublicationOriginSchema,
  originKind: z.enum(['published', 'trial']),
  identity: z.string().min(1).max(300),
  situation: z.string().min(1).max(1000),
  setting: z.string().min(1).max(1600),
  experienceNote: z.string().min(1).max(300),
  contacts: z
    .array(
      z.strictObject({
        actorKey: key,
        actorId: Id,
        name: z.string().min(1).max(80),
        relationship: z.string().max(600),
        identity: z.string().max(160).optional(),
        introduction: z.string().max(1600).optional(),
        traits: z.array(z.string().max(60)).max(3),
        appearance: z.string().max(240).optional(),
        initialPlaceId: key.optional(),
      }),
    )
    .min(1)
    .max(12),
  notes: z
    .array(
      z.strictObject({
        key,
        id: Id,
        title: z.string().min(1).max(100),
        text: z.string().min(1).max(1600),
        sourceEventId: z.string().regex(/^publication-genesis:[0-9a-f-]{36}$/),
        factKeys: z.array(key).min(1).max(64),
      }),
    )
    .max(12),
});
export type PublicationOpening = z.infer<typeof PublicationOpeningSchema>;
