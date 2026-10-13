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
