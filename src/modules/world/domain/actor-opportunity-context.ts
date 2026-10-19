/** Versioned future opportunity, not a world fact or another actor's private material. */
export function actorOpportunityContext(originResponse: unknown, task: string) {
  if (typeof originResponse !== 'string') return null;
  try {
    const origin = JSON.parse(originResponse);
    if (origin?.protocol !== 'director-wire-v9') return null;
    const value = JSON.parse(task);
    const keys = ['protocol', 'topic', 'personalObjective', 'proposedInteraction'];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      !keys.every((k) => Object.hasOwn(value, k)) ||
      value.protocol !== 'actor-interaction-opportunity-v1' ||
      !keys
        .slice(1)
        .every((k) => typeof value[k] === 'string' && value[k].trim() && value[k].length <= 140)
    )
      return null;
    return {
      kind: 'actor_interaction_opportunity' as const,
      authority: 'future_proposal_only' as const,
      opportunity: {
        topic: value.topic as string,
        personalObjective: value.personalObjective as string,
        proposedInteraction: value.proposedInteraction as string,
      },
      interpretation:
        'A concrete interaction you may propose now from your own stance. It does not establish events, player consent, others knowledge or a deadline. Existing conditions still apply.',
    };
  } catch {
    return null;
  }
}
