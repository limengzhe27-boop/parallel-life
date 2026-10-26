/** Private server evidence, never a model proposal or public error payload. */
export const TRUNCATED_RESPONSE_MAX_BYTES = 512_000;
const CONTENT_LIMIT = 100_000;
type Usage = { [key: string]: number | Usage };
export type TruncatedModelResponse = Readonly<{
  kind: 'model_output_truncated';
  schemaVersion: 1;
  finish_reason: 'length';
  content: string | null;
  contentCharacters: number;
  usage: Usage | null;
}>;
const received = new WeakMap<object, TruncatedModelResponse>();
const trusted = new WeakSet<object>();
function numericUsage(value: unknown, depth = 0): Usage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 1) return null;
  const result: Usage = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    if (!/^[a-z_]{1,64}$/.test(key)) continue;
    if (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0) result[key] = item;
    else {
      const nested = numericUsage(item, depth + 1);
      if (nested) result[key] = nested;
    }
  }
  return Object.freeze(result);
}
/** Called only after the transport received a provider length finish reason. */
export function retainTruncatedModelResponse(error: object, content: unknown, usage: unknown) {
  const bounded = {
    kind: 'model_output_truncated' as const,
    schemaVersion: 1 as const,
    finish_reason: 'length' as const,
    content: typeof content === 'string' ? content.slice(0, CONTENT_LIMIT) : null,
    contentCharacters: typeof content === 'string' ? content.length : 0,
    usage: numericUsage(usage),
  };
  // JSON escaping can make control characters six bytes each. Preserve the original
  // character count, but fit even that response without losing its known outcome.
  while (
    new TextEncoder().encode(JSON.stringify(bounded)).byteLength > TRUNCATED_RESPONSE_MAX_BYTES
  )
    bounded.content = bounded.content!.slice(0, Math.floor(bounded.content!.length / 2));
  const evidence: TruncatedModelResponse = Object.freeze(bounded);
  trusted.add(evidence);
  received.set(error, evidence);
}
/** A JSON lookalike from the model cannot opt into the trusted transport failure path. */
export function modelOutputTruncation(error: unknown): TruncatedModelResponse | null {
  return error && typeof error === 'object' ? (received.get(error) ?? null) : null;
}
export function copyModelOutputTruncation(from: unknown, to: object) {
  const evidence = modelOutputTruncation(from);
  if (evidence) received.set(to, evidence);
}
/** The same in-process evidence is saved atomically as invalid, never parsed as a proposal. */
export function isReceivedModelTruncation(value: unknown): value is TruncatedModelResponse {
  return !!value && typeof value === 'object' && trusted.has(value);
}
