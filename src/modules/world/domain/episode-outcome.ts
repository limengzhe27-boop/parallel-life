import type { AuthoredMaterialNode } from './authored-agent-material.ts';
import type { EpisodeEvidenceRecord } from './episode-evidence.ts';

/** Only an explicit author contract can define this as the whole event's objective. */
export function invitationOutcomeEvidence(
  node: AuthoredMaterialNode,
  records: readonly EpisodeEvidenceRecord[],
): EpisodeEvidenceRecord[] | null {
  const policy = node.direction?.progress?.completion;
  if (
    !policy ||
    policy.scope !== 'invitation_response' ||
    !policy.criteria.length ||
    policy.criteria.some((c) => c.kind !== 'invitation_response')
  )
    return null;
  const matches = policy.criteria.map((c) =>
    records.find(
      (r) =>
        c.kind === 'invitation_response' &&
        r.subject.kind === 'appointment' &&
        r.kind === (c.response === 'accepted' ? 'invitation_accepted' : 'invitation_declined'),
    ),
  );
  if (policy.mode === 'all' ? matches.some((r) => !r) : matches.every((r) => !r)) return null;
  return [
    ...new Map(
      matches
        .filter((r): r is EpisodeEvidenceRecord => !!r)
        .map((r) => [r.eventId + ':' + r.subject.id, r]),
    ).values(),
  ];
}
