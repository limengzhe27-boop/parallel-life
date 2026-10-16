import type { AgentSnapshot } from './agent-runtime-ports.ts';
import type {
  AgentAction,
  AgentActionResult,
  AgentCondition,
  AgentProposal,
} from '../domain/agent-runtime.ts';
import { evaluateAgentActionEligibility } from '../domain/agent-eligibility.ts';

/** Ephemeral adapter to the original interpreter, never an action to persist or execute. */
export function agentConditionsReady(
  snapshot: AgentSnapshot,
  conditions: readonly AgentCondition[],
  sourceIds: readonly string[],
  results: readonly AgentActionResult[],
  actorPlaceId?: string,
  responsibilityIds: readonly string[] = [],
) {
  if (
    !conditions.length ||
    conditions.some(
      (c) =>
        c.kind === 'at_or_after' &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(c.at) ||
          !Number.isFinite(Date.parse(c.at)) ||
          new Date(c.at.slice(0, 19) + 'Z').toISOString().slice(0, 19) !== c.at.slice(0, 19)),
    )
  )
    return false;
  const ids = new Set(
    [
      ...snapshot.state.goals,
      ...snapshot.state.actions,
      ...snapshot.state.plans,
      ...snapshot.state.responsibilities,
      ...snapshot.state.decisions,
    ]
      .map((x) => x.id)
      .concat(snapshot.redactedStateIds),
  );
  let id = '__schedule_condition_probe__';
  while (ids.has(id)) id += '_';
  const proposal: AgentProposal = {
    statements: [],
    goals: [{ id, summary: '', status: 'active', resultIds: [], sourceIds: [...sourceIds] }],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
  const action: AgentAction = {
    id,
    goalId: id,
    capability: '__condition_probe__',
    targetIds: [],
    parameters: {},
    preconditions: [...conditions],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [...responsibilityIds],
    status: 'ready',
    sourceIds: [...sourceIds],
  };
  return (
    evaluateAgentActionEligibility(snapshot, proposal, action, {
      storyAt: snapshot.storyAt,
      trustedResults: results,
      ...(actorPlaceId ? { actorPlaceId } : {}),
    }).status === 'ready'
  );
}
