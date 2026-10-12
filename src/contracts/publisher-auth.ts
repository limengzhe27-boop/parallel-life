import { z } from 'zod';
import { Id } from './api.ts';

/** Employee credentials are checked server-side; a player cannot submit privileges. */
export const PublisherLoginSchema = z.strictObject({
  username: z.string().regex(/^[a-z][a-z0-9_-]{2,31}$/),
  password: z.string().min(1).max(160),
});

export const PublisherPublicIdentitySchema = z.strictObject({
  id: Id,
  username: z.string().regex(/^[a-z][a-z0-9_-]{2,31}$/),
  displayName: z
    .string()
    .min(1)
    .max(80)
    .refine((value) => value.trim().length > 0),
  permissions: z
    .array(z.enum(['edit', 'publish']))
    .max(2)
    .refine((values) => new Set(values).size === values.length),
});

/** The cookie token, credentials and complete employee configuration never enter this DTO. */
export const PublisherSessionStateSchema = z
  .strictObject({
    publisher: PublisherPublicIdentitySchema.nullable(),
    csrfToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable(),
  })
  .refine((state) => (state.publisher === null) === (state.csrfToken === null));

export type PublisherLogin = z.infer<typeof PublisherLoginSchema>;
export type PublisherSessionState = z.infer<typeof PublisherSessionStateSchema>;
