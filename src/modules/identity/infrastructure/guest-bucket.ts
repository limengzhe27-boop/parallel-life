import { createHash } from 'node:crypto';

/**
 * Guest creation limits.
 *
 * The quota is per caller (hashed address) so one caller cannot exhaust it for
 * everyone, plus a much wider global ceiling as a backstop. Callers are stored
 * as a salted hash: the limit only needs to tell callers apart, so there is no
 * reason to keep raw addresses.
 */
export const GUEST_LIMIT_PER_CALLER = 30;
export const GUEST_LIMIT_GLOBAL_CEILING = 600;
export const GUEST_LIMIT_WINDOW_SECONDS = 3600;

/** First hop of `x-forwarded-for`, falling back to `x-real-ip`. */
export function callerAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = headers.get('x-real-ip')?.trim();
  return forwarded || real || '';
}

/** Stable bucket for one caller. Unknown addresses share a bucket on purpose. */
export function callerBucket(headers: Headers, salt: string): string {
  return createHash('sha256')
    .update(`${salt}|${callerAddress(headers) || 'unknown'}`)
    .digest('hex')
    .slice(0, 32);
}
