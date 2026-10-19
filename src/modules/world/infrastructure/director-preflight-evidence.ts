import { createHash } from 'node:crypto';

// This exact object is written only by the original runner after its model adapter proves
// no transport request was sent. Model completions are protected strings, never this object.
const PREFLIGHT_RESPONSE_HASH = createHash('sha256')
  .update('{"kind":"model_preflight_rejection","schemaVersion":1}')
  .digest('hex');

type ProtectedDirectorPreflightRow = {
  status: unknown;
  response: unknown;
  response_hash: unknown;
  decision_id: unknown;
};
/**
 * Caller must obtain this row through the owner/world/epoch-scoped original repository.
 * Recognition affects only zero-send successor identity, never mutates the old paid record,
 * reinterprets a model completion, validates a proposal, or authorizes unknown-result retries.
 */
export function isVerifiedDirectorPreflightRejection(row: ProtectedDirectorPreflightRow): boolean {
  if (
    row.status !== 'invalid_output' ||
    row.decision_id !== null ||
    row.response_hash !== PREFLIGHT_RESPONSE_HASH ||
    !row.response ||
    typeof row.response !== 'object' ||
    Array.isArray(row.response)
  )
    return false;
  const response = row.response as Record<string, unknown>;
  const keys = Object.keys(response);
  return (
    keys.length === 2 &&
    keys.includes('kind') &&
    keys.includes('schemaVersion') &&
    response.kind === 'model_preflight_rejection' &&
    response.schemaVersion === 1
  );
}
