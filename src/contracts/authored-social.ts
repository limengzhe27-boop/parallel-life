import { z } from 'zod';
import { PUBLICATION_LIFE_MODULE_MAX_CHARS } from '../modules/settings/domain/publication-content.ts';
export const AuthoredSocialSchema = z.strictObject({
  profiles: z
    .array(
      z.strictObject({
        actorId: z.string().min(1).max(200),
        momentsVisibility: z.enum(['all', 'three_days']),
      }),
    )
    .max(12)
    .optional(),
  moments: z
    .array(
      z.strictObject({
        key: z.string().max(32),
        actorId: z.string().min(1).max(200),
        name: z.string().min(1).max(80),
        text: z.string().min(1).max(1600),
        at: z.iso.datetime(),
        image: z.string().optional(),
        images: z.array(z.string()).max(9).optional(),
        likes: z
          .array(
            z.strictObject({
              actorId: z.string().min(1).max(200),
              name: z.string().min(1).max(80),
            }),
          )
          .optional(),
        comments: z
          .array(
            z.strictObject({
              id: z.string().max(64),
              actorId: z.string().min(1).max(200),
              name: z.string().min(1).max(80),
              text: z.string().min(1).max(500),
              at: z.iso.datetime(),
            }),
          )
          .optional(),
      }),
    )
    .max(48),
});
export type AuthoredSocial = z.infer<typeof AuthoredSocialSchema>;

/** Server-only input context; the social HTTP route does not include these modules. */
export const AuthoredLifeModulesSchema = z.strictObject({
  lifeContext: z.string().min(1).max(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
  traits: z.string().min(1).max(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
  drives: z.string().min(1).max(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
  behavior: z.string().min(1).max(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
  relationships: z.string().min(1).max(PUBLICATION_LIFE_MODULE_MAX_CHARS).optional(),
});

export const PlayerSocialCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('like_message'),
    commandId: z.uuid(),
    messageId: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal('publish'),
    commandId: z.uuid(),
    text: z.string().trim().min(1).max(1600),
    audienceActorIds: z.array(z.string().min(1).max(200)).max(100).optional(),
  }),
  z.strictObject({
    kind: z.literal('like'),
    commandId: z.uuid(),
    momentKey: z.string().min(1).max(32),
  }),
]);
export const PlayerSocialReceiptSchema = z.strictObject({
  version: z.number().int().nonnegative(),
});
