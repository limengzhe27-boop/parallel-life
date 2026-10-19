import type { ActorAgentState, AgentCondition, AgentProposal } from './agent-runtime.ts';
import type { AgentValidationContext } from './agent-kernel.ts';

/** A personal decision about what comes next, not a player obligation or execution result. */
export type ActorContinuationProposal = {
  decision: 'act' | 'await_response' | 'await_condition' | 'no_current_intent';
  reason: string;
  sourceIds: string[];
  planIds: string[];
  questionIds: string[];
  conditions: AgentCondition[];
};
export type ActorContinuation = ActorContinuationProposal & {
  version: 1;
  decidedAt: string;
  sourceInputId: string;
  /** Server-bound semantic state digest; ordinary commits and clock ticks are excluded. */
  basisHash: string;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export function actorContinuationBasis(state: ActorAgentState): string {
  const sorted = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(
    stable({
      definitionRef: state.definitionRef,
      knowledgeSourceIds: [...state.knowledgeSourceIds].sort(),
      goals: sorted(state.goals),
      plans: sorted(state.plans),
      actions: sorted(state.actions),
      responsibilities: sorted(state.responsibilities),
      decisions: sorted(state.decisions),
      questions: sorted(state.questions ?? []),
      episodeParticipations: state.episodeParticipations ?? [],
    }),
  );
}
export function validateActorContinuation(
  context: AgentValidationContext,
  proposal: AgentProposal,
): void {
  const c = proposal.continuation;
  if (!c) return;
  const fail = () => {
    throw Error('INVALID_ACTOR_CONTINUATION');
  };
  const state = context.viewState ?? context.state;
  const sources = new Map(context.sources.map((s) => [s.id, s]));
  if (!c.sourceIds.length || c.sourceIds.some((id) => !sources.has(id))) fail();
  const plans = [...state.plans, ...proposal.plans];
  if (
    c.planIds.some(
      (id) => !plans.some((p) => p.id === id && !['finished', 'withdrawn'].includes(p.status)),
    )
  )
    fail();
  if (c.questionIds.some((id) => !state.questions?.some((q) => q.id === id && q.status === 'open')))
    fail();
  // A continuation can reuse an already authorized condition, never invent a timer/place.
  const conditions = [
    ...plans.flatMap((p) => p.triggers),
    ...state.responsibilities.flatMap((r) => r.nextCheck),
    ...proposal.responsibilities.flatMap((r) => r.nextCheck),
  ];
  for (const condition of c.conditions) {
    const known = conditions.some(
      (existing) => JSON.stringify(stable(existing)) === JSON.stringify(stable(condition)),
    );
    const observation = condition.kind === 'observation' && sources.has(condition.sourceId);
    const deadline =
      condition.kind === 'at_or_after' &&
      sources.get(condition.sourceId)?.deadlineAt === condition.at;
    if (!known && !observation && !deadline) fail();
  }
  if (c.decision === 'act' && !c.planIds.length && !proposal.actions.length) fail();
  if (c.decision === 'await_condition' && !c.conditions.length) fail();
  if (
    c.decision === 'await_response' &&
    !c.questionIds.length &&
    !c.planIds.length &&
    !proposal.statements.some((s) => s.requestsPlayerReply)
  )
    fail();
}
