/** This selector only sees observations already authenticated by the Director
 * snapshot reader. It does not promote a statement, plan or report into a fact. */
export type DirectorContextEvidence = {
  sourceId: string;
  kind: string;
  text: string;
};
const executionReceipts = new Set([
  'travel.completed',
  'agent.arrival_committed',
  'scene.entered',
  'scene.action_resolved',
  'invitation.responded',
]);
export function isRequiredDirectorEvidence(observation: DirectorContextEvidence): boolean {
  // Supplied speech is the selected original conversation evidence, not all
  // chat history. Keep its role/type intact; an NPC claim is still only speech.
  if (observation.kind === 'speech' || observation.kind === 'result') return true;
  if (
    observation.sourceId.startsWith('position-knowledge:') &&
    (observation.kind === 'fact' || observation.kind === 'belief')
  )
    return true;
  if (observation.kind === 'plan' && observation.sourceId.startsWith('appointment:')) return true;
  if (observation.kind !== 'fact') return false;
  if (
    ['actual-position:', 'calendar-response:', 'decision:', 'player-decision:', 'genesis:'].some(
      (prefix) => observation.sourceId.startsWith(prefix),
    )
  )
    return true;
  let record: unknown;
  try {
    record = JSON.parse(observation.text);
  } catch {
    return false;
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const value = record as Record<string, unknown>;
  if (
    value.type === 'received_opening_information' &&
    value.assertion === 'report' &&
    value.executionEvidence === false
  )
    return true;
  if (value.kind === 'explicit_calendar_button') return true;
  return (
    value.kind === 'committed_event_receipt' &&
    typeof value.type === 'string' &&
    executionReceipts.has(value.type)
  );
}

/** Preserve essential source evidence plus the optional tail, in original order.
 * No copying, rewriting, hashing or inferred absence: every returned object is
 * one of the original records. Earlier duplicates retain their original record.
 */
export function retainDirectorEvidence<T extends DirectorContextEvidence>(
  observations: readonly T[],
  keepTail: number,
): T[] {
  if (!Number.isSafeInteger(keepTail) || keepTail < 0)
    throw Error('INVALID_DIRECTOR_EVIDENCE_TAIL');
  const retained = new Set(observations.filter(isRequiredDirectorEvidence).map((o) => o.sourceId));
  for (const observation of observations.slice(Math.max(0, observations.length - keepTail)))
    retained.add(observation.sourceId);
  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (!retained.has(observation.sourceId) || seen.has(observation.sourceId)) return false;
    seen.add(observation.sourceId);
    return true;
  });
}
