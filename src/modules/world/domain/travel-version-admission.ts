/** A narrow event proof for a route intent, not permission to execute against an old world. */
export type TravelVersionEvent = { version: number; payload: unknown };
const record = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
const empty = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.length === 0);
function harmlessEvent(worldId: string, version: number, payload: unknown) {
  const e = record(payload),
    d = record(e?.data);
  if (!e || e.worldId !== worldId || e.version !== version || !d) return false;
  if (e.type === 'scene.view_changed')
    return (
      typeof d.sceneId === 'string' &&
      ['phone', 'scene'].includes(d.view) &&
      Object.keys(d).every((k) => ['sceneId', 'view'].includes(k))
    );
  if (
    !['agent.state_committed', 'turn.resolved'].includes(e.type) ||
    typeof d.actorId !== 'string' ||
    !Object.keys(d).every((k) =>
      ['actorId', 'userText', 'userAt', 'effects', 'agentRuntime', 'stream'].includes(k),
    )
  )
    return false;
  const rt = record(d.agentRuntime),
    p = record(rt?.proposal),
    state = record(rt?.stateAfter);
  if (
    !rt ||
    !p ||
    !state ||
    state.worldId !== worldId ||
    state.actorId !== d.actorId ||
    state.projectedWorldVersion !== version ||
    rt.schemaVersion !== 1 ||
    !Number.isInteger(rt.engineEpoch) ||
    rt.engineEpoch < 2
  )
    return false;
  if (
    !Object.keys(rt).every((k) =>
      [
        'schemaVersion',
        'engineEpoch',
        'inputReceiptId',
        'inputStoryAt',
        'inputWorldVersion',
        'actorRevisionBefore',
        'actorRevisionAfter',
        'proposal',
        'results',
        'questionChanges',
        'stateAfter',
        'initialPositions',
        'departures',
        'sceneDepartures',
        'positionKnowledge',
        'episodeDecision',
      ].includes(k),
    )
  )
    return false;
  if (!Array.isArray(rt.results) || rt.results.length || rt.episodeDecision || p.episodeDecision)
    return false;
  for (const key of [
    'initialPositions',
    'departures',
    'sceneDepartures',
    'positionKnowledge',
    'questionChanges',
  ])
    if (!empty(rt[key])) return false;
  if (!Array.isArray(p.actions) || p.actions.length) return false;
  for (const key of ['locationReports', 'replyAssessments', 'questionWithdrawals'])
    if (!empty(p[key])) return false;
  if (!Array.isArray(d.effects)) return false;
  if (e.type === 'agent.state_committed')
    return d.effects.length === 0 && Array.isArray(p.statements) && p.statements.length === 0;
  return (
    d.effects.length > 0 &&
    d.effects.every((effect: unknown) => {
      const x = record(effect);
      return x?.type === 'message.received' && x.actorId === d.actorId;
    })
  );
}
/** All intervening versions must be represented by authenticated committed events, in order. */
export function canAppendTravelAfter(input: {
  worldId: string;
  expectedVersion: number;
  actualVersion: number;
  events: readonly TravelVersionEvent[];
}): boolean {
  const { worldId, expectedVersion, actualVersion, events } = input;
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0 ||
    !Number.isSafeInteger(actualVersion) ||
    actualVersion < expectedVersion ||
    actualVersion - expectedVersion > 256 ||
    events.length !== actualVersion - expectedVersion
  )
    return false;
  return events.every(
    (entry, index) =>
      entry.version === expectedVersion + index + 1 &&
      harmlessEvent(worldId, entry.version, entry.payload),
  );
}
