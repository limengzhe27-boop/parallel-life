import type { AgentSource } from '../domain/agent-runtime.ts';

export type NpcSourceReference = { ref: string; sourceId: string };
const scalarFields = new Set(['sourceId', 'questionSourceId', 'definitionSourceId']);
const arrayFields = new Set([
  'sourceIds',
  'basisSourceIds',
  'knowledgeSourceIds',
  'requestedSourceIds',
  'selectedSourceIds',
  'omittedSourceIds',
  'omittedObservationSourceIds',
]);
function invalid(): never {
  throw Error('NPC_SOURCE_REFERENCE_INVALID');
}
/** This mapping stays server-side and is scoped to the original immutable snapshot. */
export function npcSourceReferences(
  sources: readonly Pick<AgentSource, 'id'>[],
): NpcSourceReference[] {
  if (
    sources.some((s) => typeof s.id !== 'string' || !s.id || s.id.trim() !== s.id) ||
    new Set(sources.map((s) => s.id)).size !== sources.length
  )
    invalid();
  return sources.map((s, i) => ({ ref: `source:${i + 1}`, sourceId: s.id }));
}
export function npcSourceRef(
  catalog: readonly NpcSourceReference[],
  sourceId: string,
): string | null {
  return catalog.find((item) => item.sourceId === sourceId)?.ref ?? null;
}
/** Only named structural source fields are transformed; prose, quotes and generic parameter values are untouched. */
export function mapNpcSourceFields(
  value: unknown,
  catalog: readonly NpcSourceReference[],
  direction: 'encode' | 'decode',
): unknown {
  const one = (v: unknown): string | null => {
    if (typeof v !== 'string') {
      if (direction === 'encode') return null;
      invalid();
    }
    if (direction === 'encode') return npcSourceRef(catalog, v);
    const found = catalog.find((item) => item.ref === v);
    if (!found) invalid();
    return found.sourceId;
  };
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(v)) {
      if (scalarFields.has(key)) {
        out[key] = child === null ? null : one(child);
        if (direction === 'encode' && child !== null && out[key] === null)
          out[`${key}Unavailable`] = true;
      } else if (arrayFields.has(key)) {
        if (child === null) {
          out[key] = null;
          continue;
        }
        if (!Array.isArray(child)) {
          if (direction === 'encode') {
            out[key] = null;
            out[`${key}Unavailable`] = true;
            continue;
          }
          invalid();
        }
        const mapped = child.map(one);
        out[key] = direction === 'encode' ? mapped.filter((id) => id !== null) : mapped;
        if (direction === 'encode' && mapped.some((id) => id === null))
          out[`${key}UnavailableCount`] = mapped.filter((id) => id === null).length;
      } else out[key] = visit(child);
    }
    return out;
  };
  return visit(value);
}
/** Actor persona is authored JSON sometimes. Decode only that structured envelope, never arbitrary user quotes. */
export function npcPersonaSourceReferences(
  persona: string,
  catalog: readonly NpcSourceReference[],
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(persona);
  } catch {
    return persona;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return persona;
  const mapped = mapNpcSourceFields(parsed, catalog, 'encode') as Record<string, unknown>;
  if (typeof mapped.persona === 'string')
    mapped.persona = npcPersonaSourceReferences(mapped.persona, catalog);
  return JSON.stringify(mapped);
}
/** Source enum constraints are mechanical transport projection, not a new authorization path. */
export function npcSourceReferenceSchema(
  schema: Record<string, unknown>,
  catalog: readonly NpcSourceReference[],
): Record<string, unknown> {
  type Node = Record<string, any>;
  const scalar = (node: Node): Node => {
    if (node.type === 'null') return node;
    if (node.anyOf) return { ...node, anyOf: node.anyOf.map(scalar) };
    if (node.type === 'string') {
      if (Array.isArray(node.enum)) {
        const refs = node.enum
          .map((id: string) => npcSourceRef(catalog, id))
          .filter((id: string | null) => id !== null);
        return refs.length ? { type: 'string', enum: refs } : { type: 'null' };
      }
      return { $ref: '#/$defs/npc_source_ref' };
    }
    return node;
  };
  const array = (node: Node): Node =>
    node.anyOf
      ? { ...node, anyOf: node.anyOf.map(array) }
      : node.items
        ? { ...node, items: scalar(node.items) }
        : node;
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (!v || typeof v !== 'object') return v;
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)])) as Node;
    if (out.properties)
      for (const key of Object.keys(out.properties)) {
        if (scalarFields.has(key)) out.properties[key] = scalar(out.properties[key]);
        else if (arrayFields.has(key)) out.properties[key] = array(out.properties[key]);
      }
    return out;
  };
  const out = visit(schema) as Node;
  if (out.$defs?.npc_authorized_basis)
    out.$defs.npc_authorized_basis = array(out.$defs.npc_authorized_basis);
  out.$defs = {
    ...(out.$defs ?? {}),
    npc_source_ref: catalog.length
      ? { type: 'string', enum: catalog.map((s) => s.ref) }
      : { type: 'string', pattern: '^source:[1-9][0-9]*$' },
  };
  return out;
}
