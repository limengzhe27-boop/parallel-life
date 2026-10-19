import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';

type Observation = AgentSnapshot['observations'][number];
type Source = AgentSnapshot['sources'][number];

export type NpcInternalContextRole =
  | 'director_future_suggestion'
  | 'authored_future_suggestion'
  | 'reported_plan'
  | 'private_historical_recall'
  | 'private_result'
  | 'private_evidence';

/** Presentation only: no new knowledge, speaker attribution, or permission. */
export function npcPresentationContext<T extends Observation>(input: {
  observations: readonly T[];
  sources: readonly Source[];
  channelKind: AgentSnapshot['channel']['kind'];
  recalledSourceIds?: readonly string[];
}): {
  observations: T[];
  presentationContext: {
    internalContext: { role: NpcInternalContextRole; observation: T }[];
  };
} {
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  const recalled = new Set(input.recalledSourceIds);
  const observations: T[] = [];
  const internalContext: { role: NpcInternalContextRole; observation: T }[] = [];
  for (const observation of input.observations) {
    const source = sources.get(observation.sourceId);
    let role: NpcInternalContextRole | undefined;
    if (source?.kind === 'director_intent') role = 'director_future_suggestion';
    else if (observation.kind === 'plan')
      role = source?.kind === 'authored' ? 'authored_future_suggestion' : 'reported_plan';
    else if (
      source?.usage === 'private_strategy' ||
      (input.channelKind === 'private' &&
        recalled.has(observation.sourceId) &&
        (source?.kind === 'group_message' || source?.kind === 'scene_entry'))
    ) {
      role =
        observation.kind === 'result'
          ? 'private_result'
          : observation.kind === 'speech'
            ? 'private_historical_recall'
            : 'private_evidence';
    }
    if (role) internalContext.push({ role, observation });
    else observations.push(observation);
  }
  return { observations, presentationContext: { internalContext } };
}
