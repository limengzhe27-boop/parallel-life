import type { AuthoredAgentMaterial } from './authored-agent-material.ts';
/** An explicitly bound author cast is narrower than the world's supported cast.
 * Truly unconfigured legacy nodes retain world-wide consideration; unresolved
 * explicit references never silently turn into that legacy default.
 */
export function authoredOpportunityActorIds(
  material: Pick<AuthoredAgentMaterial, 'node' | 'participantRefs'>,
  worldActorIds: readonly string[],
): string[] {
  const intent = material.node.intent;
  const explicit =
    material.node.actorKeys.length > 0 ||
    material.participantRefs.length > 0 ||
    ('actorKey' in intent && Boolean(intent.actorKey)) ||
    ('actorKeys' in intent && intent.actorKeys.length > 0);
  return [
    ...new Set(
      explicit
        ? material.participantRefs.flatMap((r) =>
            r.status === 'resolved' && r.actorId && worldActorIds.includes(r.actorId)
              ? [r.actorId]
              : [],
          )
        : worldActorIds,
    ),
  ];
}
/** No semantic role inference from names, persona keywords or array order. */
export function validAuthoredOpportunityCast(
  materials: readonly Pick<AuthoredAgentMaterial, 'ref' | 'node' | 'participantRefs'>[],
  worldActorIds: readonly string[],
  opportunity: { authoredEventKey?: string; participantActorIds: readonly string[] },
): boolean {
  if (opportunity.authoredEventKey === undefined) return true;
  const matches = materials.filter((m) => m.ref.nodeKey === opportunity.authoredEventKey);
  if (matches.length !== 1) return false;
  const allowed = new Set(authoredOpportunityActorIds(matches[0]!, worldActorIds));
  return (
    opportunity.participantActorIds.length > 0 &&
    opportunity.participantActorIds.every((id) => allowed.has(id))
  );
}
