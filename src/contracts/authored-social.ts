import { z } from 'zod';
export const AuthoredSocialSchema = z.strictObject({
  moments: z
    .array(
      z.strictObject({
        key: z.string().max(32),
        actorId: z.string().min(1).max(200),
        name: z.string().min(1).max(80),
        text: z.string().min(1).max(1600),
        at: z.iso.datetime(),
      }),
    )
    .max(48),
});
export type AuthoredSocial = z.infer<typeof AuthoredSocialSchema>;

/** Server-only input context; the social HTTP route does not include these modules. */
export const AuthoredLifeModulesSchema = z.strictObject({
  lifeContext: z.string().min(1).max(4000).optional(),
  traits: z.string().min(1).max(4000).optional(),
  drives: z.string().min(1).max(4000).optional(),
  behavior: z.string().min(1).max(4000).optional(),
  relationships: z.string().min(1).max(4000).optional(),
});
