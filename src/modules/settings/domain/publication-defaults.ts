/** Complete only absent technical scaffolding. Never infer characters, personality,
 * history, visibility, dates, locations or routes. Invalid authored values must reach
 * validation unchanged; this function is neither a migration nor a repair operation.
 */
export function ensurePublishableDefaults(
  raw: Record<string, unknown>,
  _fallbackTitle?: string,
): Record<string, unknown> {
  const content = structuredClone(raw);
  const missing = (object: Record<string, unknown>, key: string, value: unknown) => {
    if (!Object.hasOwn(object, key)) object[key] = value;
  };
  missing(content, 'schemaVersion', 1);
  for (const key of [
    'relationships',
    'routes',
    'history',
    'initialKnowledge',
    'media',
    'candidates',
    'extensions',
  ])
    missing(content, key, []);
  if (record(content.work)) {
    // The workbench initializes this hidden, neutral metadata to an empty string.
    // Treat that empty sentinel like absence; never replace nonempty authored prose.
    const note = content.work.experienceNote;
    if (
      !Object.hasOwn(content.work, 'experienceNote') ||
      (typeof note === 'string' && !note.trim())
    )
      content.work.experienceNote = '沉浸式平行人生体验';
  }
  if (record(content.protagonist)) missing(content.protagonist, 'knownFactKeys', []);
  missing(content, 'phone', {});
  if (record(content.phone))
    for (const key of ['messages', 'notes', 'invitations', 'album'])
      missing(content.phone, key, []);
  if (Array.isArray(content.actors))
    for (const actor of content.actors)
      if (record(actor) && record(actor.publicCard)) missing(actor.publicCard, 'traits', []);
  if (Array.isArray(content.places))
    for (const place of content.places) if (record(place)) missing(place, 'description', '');
  return content;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
