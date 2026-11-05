/**
 * Player-facing copy is second person. Authored publication and world data
 * occasionally still says "主角" (third person); the API boundary normalizes
 * it so every client surface reads "你" without rewriting immutable history.
 */
const AUTHORIAL_PROTAGONIST = /(?<![男女])主角/g;

export function playerFacingText(text: string): string {
  return text.replace(AUTHORIAL_PROTAGONIST, '你');
}

/** Deep projection for JSON payloads; leaves keys and non-strings untouched. */
export function playerFacingProjection<T>(value: T): T {
  if (typeof value === 'string') return playerFacingText(value) as T;
  if (Array.isArray(value)) return value.map((item) => playerFacingProjection(item)) as T;
  if (value && typeof value === 'object') {
    const projected: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      projected[key] = playerFacingProjection(item);
    }
    return projected as T;
  }
  return value;
}
