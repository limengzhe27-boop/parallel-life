/** Reuse the existing wire directory for presentation only. The saved snapshot,
 * decoder and execution authority keep their original identifiers. */
export function compactDirectorContextReferences(payload: Record<string, unknown>) {
  const catalog = payload.wireCatalog as Record<string, Array<Record<string, unknown>>> | undefined;
  if (!catalog) return payload;
  const aliases = new Map<string, string>();
  for (const [collection, identity] of [
    ['actors', 'actorId'],
    ['places', 'placeId'],
    ['sources', 'sourceId'],
    ['candidates', 'candidateId'],
  ])
    for (const entry of catalog[collection!] ?? [])
      if (typeof entry[identity!] === 'string' && typeof entry.ref === 'string')
        aliases.set(entry[identity!] as string, entry.ref);
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return aliases.get(value) ?? value;
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, visit(v)]));
    return value;
  };
  const result = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      key === 'wireCatalog' ? value : visit(value),
    ]),
  );
  // Structured receipts are serialized JSON in observations. Substitute exact
  // identifier values only; never search/replace identifiers inside free speech.
  if (Array.isArray(result.observations))
    result.observations = result.observations.map((o) => {
      if (!o || typeof o !== 'object' || typeof o.text !== 'string' || o.kind === 'speech')
        return o;
      try {
        const record = JSON.parse(o.text);
        if (!record || typeof record !== 'object') return o;
        return { ...o, text: JSON.stringify(visit(record)) };
      } catch {
        return o;
      }
    });
  // Source authority is resolved from the saved catalog, not model-echoed IDs.
  // Observations and origin fields above already carry these exact scoped refs.
  result.wireCatalog = {
    ...catalog,
    sources: (catalog.sources ?? []).map(({ sourceId: _boundSource, ...entry }) => entry),
  };
  return result;
}
