import { isStandaloneMediaAction } from './agent-runtime.ts';
import { currentPlayerDecision, type AgentValidationContext } from './agent-kernel.ts';
import type {
  ActorAgentState,
  AgentAction,
  AgentActionResult,
  AgentCondition,
  AgentProposal,
} from './agent-runtime.ts';

/** Structural domain view; application snapshots satisfy this without a reverse dependency. */
export type AgentEligibilitySnapshot = AgentValidationContext & {
  viewState: ActorAgentState;
  redactedStateIds: readonly string[];
  observations: readonly { sourceId: string }[];
};
export type AgentEligibilityContext = {
  storyAt: string;
  /** Trusted spatial projection, never extracted from speech. Missing means unknown. */
  actorPlaceId?: string;
  /** Trusted persisted or same-transaction kernel receipts, including failed outcomes. */
  trustedResults?: readonly AgentActionResult[];
};
export type AgentEligibilityMissing = {
  code:
    | 'invalid_snapshot'
    | 'hidden_state'
    | 'unavailable_source'
    | 'terminal_action'
    | 'action_in_progress'
    | 'inactive_goal'
    | 'inactive_plan'
    | 'plan_next_action'
    | 'inactive_responsibility'
    | 'dependency_result'
    | 'dependency_failed'
    | 'condition';
  subjectId?: string;
  condition?: AgentCondition;
};
export type AgentActionEligibility = {
  status: 'ready' | 'waiting' | 'blocked';
  missing: AgentEligibilityMissing[];
};

/** Eligibility is not execution, consent inference, or a replacement for proposal validation. */
export function evaluateAgentActionEligibility(
  snapshot: AgentEligibilitySnapshot,
  proposal: AgentProposal,
  action: AgentAction,
  context: AgentEligibilityContext,
): AgentActionEligibility {
  const missing: AgentEligibilityMissing[] = [];
  let blocked = false;
  const add = (item: AgentEligibilityMissing, hard = false) => {
    missing.push(item);
    blocked ||= hard;
  };
  const view = snapshot.viewState;
  const now = Date.parse(context.storyAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(Date.parse(snapshot.storyAt)) ||
    now < Date.parse(snapshot.storyAt) ||
    view.worldId !== snapshot.state.worldId ||
    view.actorId !== snapshot.state.actorId ||
    view.revision !== snapshot.state.revision ||
    view.definitionRef !== snapshot.state.definitionRef ||
    view.projectedWorldVersion > snapshot.worldVersion
  )
    return { status: 'blocked', missing: [{ code: 'invalid_snapshot' }] };

  const hidden = new Set(snapshot.redactedStateIds);
  for (const key of ['goals', 'plans', 'actions', 'responsibilities', 'decisions'] as const) {
    const visible = new Set(view[key].map((item) => item.id));
    for (const item of snapshot.state[key]) if (!visible.has(item.id)) hidden.add(item.id);
  }
  const merged = <T extends { id: string }>(old: readonly T[], next: readonly T[]) =>
    new Map([...old, ...next].map((item) => [item.id, item]));
  const goals = merged(view.goals, proposal.goals);
  const plans = merged(view.plans, proposal.plans);
  const actions = merged(view.actions, proposal.actions);
  const responsibilities = merged(view.responsibilities, proposal.responsibilities);
  const sourceAvailable = (id: string) =>
    snapshot.sources.some(
      (source) =>
        source.id === id &&
        source.worldVersion <= snapshot.worldVersion &&
        Number.isFinite(Date.parse(source.at)) &&
        Date.parse(source.at) <= now,
    );
  const checkBasis = (item: { id: string; sourceIds: string[] }) => {
    if (hidden.has(item.id)) {
      add({ code: 'hidden_state' }, true);
      return;
    }
    for (const id of item.sourceIds)
      if (!sourceAvailable(id)) add({ code: 'unavailable_source', subjectId: id }, true);
  };
  checkBasis(action);
  if (action.goalId !== null) {
    if (hidden.has(action.goalId)) add({ code: 'hidden_state' }, true);
    const goal = goals.get(action.goalId);
    if (
      !goal ||
      goal.status !== 'active' ||
      snapshot.state.goals.some(
        (g) => g.id === action.goalId && (g.status === 'fulfilled' || g.status === 'withdrawn'),
      )
    )
      add({ code: 'inactive_goal', subjectId: action.goalId }, true);
    if (goal) checkBasis(goal);
  } else if (
    !isStandaloneMediaAction(action) ||
    snapshot.state.actions.some((old) => old.id === action.id && old.goalId !== null)
  ) {
    add({ code: 'inactive_goal' }, true);
  }
  const terminal = (status: AgentAction['status']) =>
    status === 'succeeded' || status === 'failed' || status === 'withdrawn';
  if (
    terminal(action.status) ||
    snapshot.state.actions.some((a) => a.id === action.id && terminal(a.status))
  )
    add({ code: 'terminal_action', subjectId: action.id }, true);
  if (
    action.status === 'executing' ||
    snapshot.state.actions.some((a) => a.id === action.id && a.status === 'executing')
  )
    add({ code: 'action_in_progress', subjectId: action.id }, true);

  // A model cannot unlink an old plan to evade its trigger or conceal it in the view.
  const relatedPlanIds = new Set(
    [...snapshot.state.plans, ...view.plans, ...proposal.plans]
      .filter((plan) => plan.actionIds.includes(action.id) || plan.nextActionId === action.id)
      .map((p) => p.id),
  );
  const conditions: AgentCondition[] = [...action.preconditions];
  for (const id of relatedPlanIds) {
    if (hidden.has(id)) {
      add({ code: 'hidden_state' }, true);
      continue;
    }
    const plan = plans.get(id);
    if (
      !plan ||
      !plan.actionIds.includes(action.id) ||
      plan.goalId !== action.goalId ||
      !['active', 'waiting'].includes(plan.status) ||
      snapshot.state.plans.some((p) => p.id === id && ['finished', 'withdrawn'].includes(p.status))
    ) {
      add({ code: 'inactive_plan', subjectId: id }, true);
      continue;
    }
    checkBasis(plan);
    if (plan.nextActionId !== action.id) add({ code: 'plan_next_action', subjectId: id });
    conditions.push(...plan.triggers);
  }
  for (const id of action.handlesResponsibilityIds) {
    if (hidden.has(id)) {
      add({ code: 'hidden_state' }, true);
      continue;
    }
    const responsibility = responsibilities.get(id);
    if (
      !responsibility ||
      ['fulfilled', 'withdrawn', 'expired'].includes(responsibility.status) ||
      snapshot.state.responsibilities.some(
        (r) => r.id === id && ['fulfilled', 'withdrawn', 'expired'].includes(r.status),
      )
    )
      add({ code: 'inactive_responsibility', subjectId: id }, true);
    if (responsibility) checkBasis(responsibility);
  }
  const receipts = (context.trustedResults ?? []).filter(
    (result) =>
      result.worldId === view.worldId &&
      result.actorId === view.actorId &&
      !!result.id &&
      !!result.eventId &&
      result.worldVersion <= snapshot.worldVersion + 1 &&
      Number.isSafeInteger(result.worldVersion) &&
      result.worldVersion >= 0 &&
      result.evidenceSourceIds.every(sourceAvailable) &&
      Number.isFinite(Date.parse(result.at)) &&
      Date.parse(result.at) <= now &&
      !hidden.has(result.actionId) &&
      actions.has(result.actionId),
  );
  for (const id of action.dependsOnActionIds) {
    if (hidden.has(id)) {
      add({ code: 'hidden_state' }, true);
      continue;
    }
    if (!receipts.some((r) => r.actionId === id && r.outcome === 'succeeded'))
      add(
        {
          code: receipts.some((r) => r.actionId === id && r.outcome === 'failed')
            ? 'dependency_failed'
            : 'dependency_result',
          subjectId: id,
        },
        receipts.some((r) => r.actionId === id && r.outcome === 'failed'),
      );
  }
  for (const condition of conditions) {
    let ready = false;
    switch (condition.kind) {
      case 'at_or_after':
        ready =
          sourceAvailable(condition.sourceId) &&
          Number.isFinite(Date.parse(condition.at)) &&
          now >= Date.parse(condition.at);
        break;
      case 'observation':
        ready =
          sourceAvailable(condition.sourceId) &&
          snapshot.observations.some((o) => o.sourceId === condition.sourceId);
        break;
      case 'at_place':
        ready = context.actorPlaceId !== undefined && context.actorPlaceId === condition.placeId;
        break;
      case 'result':
        ready = receipts.some(
          (r) => r.actionId === condition.actionId && r.outcome === condition.outcome,
        );
        break;
      case 'player_decision': {
        if (hidden.has(condition.responsibilityId)) {
          add({ code: 'hidden_state' }, true);
          continue;
        }
        const responsibility = responsibilities.get(condition.responsibilityId);
        const decision = currentPlayerDecision(snapshot, proposal, condition.responsibilityId);
        ready =
          !!responsibility &&
          !['fulfilled', 'withdrawn', 'expired'].includes(responsibility.status) &&
          !snapshot.state.responsibilities.some(
            (r) =>
              r.id === condition.responsibilityId &&
              ['fulfilled', 'withdrawn', 'expired'].includes(r.status),
          ) &&
          !!decision &&
          sourceAvailable(decision.sourceId) &&
          decision.kind === condition.decision;
        break;
      }
    }
    if (!ready) add({ code: 'condition', condition: structuredClone(condition) });
  }
  return { status: blocked ? 'blocked' : missing.length ? 'waiting' : 'ready', missing };
}
