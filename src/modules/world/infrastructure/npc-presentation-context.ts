import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { actorInteractionOpportunity } from '../domain/actor-opportunity-context.ts';

type Observation = AgentSnapshot['observations'][number];
type Source = AgentSnapshot['sources'][number];

export type NpcInternalContextRole =
  | 'authored_initial_context'
  | 'director_future_suggestion'
  | 'authored_future_suggestion'
  | 'reported_plan'
  | 'private_historical_recall'
  | 'private_result'
  | 'private_evidence';

/** Decode only the authenticated initial-context envelope for model presentation.
 * Original facts, source hashes and the protected snapshot stay unchanged. */
function initialContextText(text: string): string {
  try {
    const outer = JSON.parse(text);
    const report =
      outer?.method === 'authored_initial_context' && typeof outer.text === 'string'
        ? JSON.parse(outer.text)
        : null;
    return report?.type === 'received_opening_information' &&
      report.assertion === 'report' &&
      report.executionEvidence === false &&
      typeof report.content === 'string' &&
      report.content.trim()
      ? '本人获知的开场报告（不是已投递聊天或执行回执）：' + report.content
      : text;
  } catch {
    return text;
  }
}

/** Normalize the already authenticated task for the model, not its source hash.
 * New Director transports still carry the same v1 interaction task; historical
 * paid snapshots must retain the directive representation they originally saw. */
function futureTaskText(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) return text;
  try {
    const directive = JSON.parse(text.slice(start));
    if (
      directive?.kind !== 'director_future_task' ||
      directive.authority !== 'future_proposal_only' ||
      typeof directive.task !== 'string'
    )
      return text;
    const opportunity = actorInteractionOpportunity(directive.task);
    return opportunity ? text.slice(0, start) + JSON.stringify(opportunity) : text;
  } catch {
    return text;
  }
}

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
    if (
      source?.kind === 'world_event' &&
      source.usage === 'private_strategy' &&
      source.id.startsWith('narrative:') &&
      observation.evidenceKind === 'authored_context'
    )
      role = 'authored_initial_context';
    else if (source?.kind === 'director_intent') role = 'director_future_suggestion';
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
    if (role) {
      const text =
        role === 'authored_initial_context'
          ? initialContextText(observation.text)
          : role === 'director_future_suggestion'
            ? futureTaskText(observation.text)
            : observation.text;
      internalContext.push({
        role,
        observation: text === observation.text ? observation : { ...observation, text },
      });
    } else observations.push(observation);
  }
  return { observations, presentationContext: { internalContext } };
}
