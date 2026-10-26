import type { AuthoritativePosition } from './world-awareness.ts';

export const INITIAL_POSITION_POLICY = 'fictional-unset-state-v1' as const;
export function initialPositionPolicySourceId(worldId: string, actorId: string) {
  return `initial-position-policy:${worldId}:${actorId}`;
}
/** Unknown genesis is an unset fictional state, not a player's location report. */
export function canEstablishInitialPosition(input: {
  worldId: string;
  actorId: string;
  ownPosition?: AuthoritativePosition | null;
  hasJourney: boolean;
  placeIds: readonly string[];
}): boolean {
  const p = input.ownPosition;
  return (
    !!p &&
    p.worldId === input.worldId &&
    p.subject.kind === 'actor' &&
    p.subject.actorId === input.actorId &&
    p.status === 'unknown' &&
    p.placeId === null &&
    p.worldVersion === 0 &&
    p.sourceEventId === null &&
    !input.hasJourney &&
    input.placeIds.length > 0
  );
}
export type InitialPositionCommit = {
  actorId: string;
  placeId: string;
  actionId: string;
  resultId: string;
  policy: typeof INITIAL_POSITION_POLICY;
  sourceId: string;
};
export function planInitialPosition(
  input: Parameters<typeof canEstablishInitialPosition>[0] & {
    placeId: string;
    sourceIds: readonly string[];
    allowedSourceIds: readonly string[];
  },
):
  | { status: 'ready'; policy: typeof INITIAL_POSITION_POLICY; sourceId: string }
  | { status: 'blocked'; reason: string } {
  if (!canEstablishInitialPosition(input))
    return { status: 'blocked', reason: 'INITIAL_POSITION_ALREADY_FIXED' };
  if (!input.placeIds.includes(input.placeId))
    return { status: 'blocked', reason: 'INITIAL_POSITION_OUTSIDE_BOUNDARY' };
  const sourceId = initialPositionPolicySourceId(input.worldId, input.actorId);
  if (!input.sourceIds.includes(sourceId) || !input.allowedSourceIds.includes(sourceId))
    return { status: 'blocked', reason: 'INITIAL_POSITION_POLICY_NOT_AUTHORIZED' };
  return { status: 'ready', policy: INITIAL_POSITION_POLICY, sourceId };
}
