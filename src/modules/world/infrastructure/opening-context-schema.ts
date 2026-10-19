import { z } from 'zod';
const Key = z.string().min(1).max(240);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const OpeningModule = z.enum([
  'lifeContext',
  'traits',
  'drives',
  'behavior',
  'relationships',
]);
export const OpeningContextReviewSchema = z.strictObject({
  reviewKey: Hash,
  disposition: z.enum(['confirm', 'defer']),
  reason: z.string().trim().min(1).max(1600),
  premises: z
    .array(
      z.strictObject({
        actorId: Key,
        kind: z.literal('opening_information'),
        field: z.enum(['script', 'editorialIntent']),
        quote: z.string().min(6).max(600),
        knowledge: z.strictObject({ module: OpeningModule, quote: z.string().min(6).max(300) }),
      }),
    )
    .max(12),
});
export const OpeningContextAuthoritySchema = z.strictObject({
  policy: z.literal('opening_context_v1'),
  reviewKey: Hash,
  nodeKey: Key,
  nodeHash: Hash,
  sourceHash: Hash,
  initialAt: z.string().datetime(),
  sourceField: z.enum(['script', 'editorialIntent']),
  sourceExcerpt: z.string().max(6000),
  actorKnowledge: z
    .array(
      z.strictObject({
        actorId: Key,
        definitionSourceId: Key,
        modules: z.strictObject({
          lifeContext: z.string().max(900).optional(),
          traits: z.string().max(900).optional(),
          drives: z.string().max(900).optional(),
          behavior: z.string().max(900).optional(),
          relationships: z.string().max(900).optional(),
        }),
      }),
    )
    .max(128),
});
