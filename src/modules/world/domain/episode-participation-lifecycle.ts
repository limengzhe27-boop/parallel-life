import type { AgentEpisodeRequest, EpisodeParticipationDecision } from './agent-narrative.ts';
import type {
  ActorAgentState,
  AgentActionResult,
  AgentCondition,
  AgentGoal,
  AgentPlan,
  AgentResponsibility,
} from './agent-runtime.ts';
import { ACTOR_EPISODE_INTENT_PREFIX } from './actor-episode-intent.ts';

export type EpisodeParticipationLifecycleInput = {
  request: AgentEpisodeRequest;
  decision: EpisodeParticipationDecision;
  /** Already authorized and merged by the original kernel; never a model's unchecked state. */
  state: ActorAgentState;
  /** Already authenticated committed results, or results of this kernel transaction. */
  results: readonly AgentActionResult[];
  /** Original eligibility evaluator's verified conditions, not a model's assertion. */
  satisfiedConditions?: readonly AgentCondition[];
};
export type EpisodeReassessmentBasis = {
  kind: 'plan' | 'responsibility';
  id: string;
  conditions: AgentCondition[];
};
export type EpisodeParticipationLifecycle = {
  worldId: string;
  actorId: string;
  requestId: string;
  episodeId: string;
  stance: EpisodeParticipationDecision;
  /** Only these existing items' lifecycle; never the shared episode's status. */
  followUp: 'none' | 'open' | 'terminal';
  goals: AgentGoal[];
  plans: AgentPlan[];
  responsibilities: AgentResponsibility[];
  /** Eligibility to reconsider, not permission to execute, buy another call or consume a request. */
  reassessment: { eligible: boolean; basis: EpisodeReassessmentBasis[] };
};

export class EpisodeParticipationLifecycleError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = 'EpisodeParticipationLifecycleError';
    this.code = code;
  }
}
const fail = (code: string): never => {
  throw new EpisodeParticipationLifecycleError(code);
};
const unique = (items: readonly { id: string }[]) =>
  items.every((item) => item.id.trim().length > 0) &&
  new Set(items.map((item) => item.id)).size === items.length;

function conditionKey(condition: AgentCondition): string {
  switch (condition.kind) {
    case 'at_or_after':
      return JSON.stringify([condition.kind, condition.sourceId, condition.at]);
    case 'result':
      return JSON.stringify([condition.kind, condition.actionId, condition.outcome]);
    case 'player_decision':
      return JSON.stringify([condition.kind, condition.responsibilityId, condition.decision]);
    case 'at_place':
      return JSON.stringify([condition.kind, condition.placeId]);
    case 'observation':
      return JSON.stringify([condition.kind, condition.sourceId]);
    default:
      return fail('EPISODE_LIFECYCLE_INVALID_CONDITION');
  }
}

/**
 * Pure projection of one person's existing follow-up. The caller authenticates request/decision,
 * source visibility and conditions through the original snapshot/kernel. This is neither a new
 * repository nor a scheduler, and creates no goals, deadlines, consent or shared episode results.
 */
export function projectEpisodeParticipationLifecycle(
  input: EpisodeParticipationLifecycleInput,
): EpisodeParticipationLifecycle {
  const { request, decision, state } = input;
  if (
    request.schemaVersion !== 1 ||
    request.worldId !== state.worldId ||
    request.actorId !== state.actorId ||
    request.id !== decision.requestId ||
    request.engineEpoch < 2 ||
    !Number.isSafeInteger(request.engineEpoch) ||
    !Number.isSafeInteger(request.createdAtVersion) ||
    request.createdAtVersion < 0 ||
    !Number.isSafeInteger(state.projectedWorldVersion) ||
    request.createdAtVersion > state.projectedWorldVersion ||
    ![request.id, request.episodeId, request.worldId, request.actorId].every((s) => s.trim()) ||
    !['engage', 'decline', 'defer', 'need_information', 'quiet'].includes(decision.choice) ||
    !decision.reason.trim() ||
    !decision.sourceIds.length ||
    new Set(decision.sourceIds).size !== decision.sourceIds.length
  )
    fail('EPISODE_LIFECYCLE_IDENTITY');
  if (
    ![state.goals, state.plans, state.responsibilities, state.actions].every(unique) ||
    !unique(input.results)
  )
    fail('EPISODE_LIFECYCLE_DUPLICATE_ID');

  const intentSource = ACTOR_EPISODE_INTENT_PREFIX + request.id;
  const based = (item: { sourceIds: string[] }) => item.sourceIds.includes(intentSource);
  const directGoalIds = new Set(state.goals.filter(based).map((g) => g.id));
  const plans = state.plans.filter((p) => based(p) || directGoalIds.has(p.goalId));
  const planGoalIds = new Set(plans.map((p) => p.goalId));
  const goals = state.goals.filter((g) => directGoalIds.has(g.id) || planGoalIds.has(g.id));
  const responsibilities = state.responsibilities.filter(
    (r) =>
      based(r) ||
      (r.subject.kind === 'episode' && r.subject.id === request.episodeId) ||
      (r.subject.kind === 'request' && r.subject.id === request.id),
  );
  const results = input.results.filter(
    (r) =>
      r.worldId === state.worldId &&
      r.actorId === state.actorId &&
      Number.isSafeInteger(r.worldVersion) &&
      r.worldVersion > 0 &&
      r.worldVersion <= state.projectedWorldVersion &&
      !!r.eventId.trim() &&
      Number.isFinite(Date.parse(r.at)) &&
      state.actions.some((a) => a.id === r.actionId && a.resultId === r.id),
  );
  for (const goal of goals)
    if (
      goal.status === 'fulfilled' &&
      (!goal.resultIds.length ||
        !goal.resultIds.every((id) =>
          results.some(
            (r) =>
              r.id === id && r.outcome === 'succeeded' && r.completedGoalIds?.includes(goal.id),
          ),
        ))
    )
      fail('EPISODE_LIFECYCLE_UNCONFIRMED_GOAL');
  for (const responsibility of responsibilities)
    if (
      responsibility.status === 'fulfilled' &&
      !results.some(
        (r) =>
          r.id === responsibility.resolutionResultId &&
          r.outcome === 'succeeded' &&
          r.handledResponsibilityIds.includes(responsibility.id),
      )
    )
      fail('EPISODE_LIFECYCLE_UNCONFIRMED_RESPONSIBILITY');

  const satisfied = new Set((input.satisfiedConditions ?? []).map(conditionKey));
  const holds = (condition: AgentCondition) =>
    condition.kind === 'result'
      ? results.some((r) => r.actionId === condition.actionId && r.outcome === condition.outcome)
      : satisfied.has(conditionKey(condition));
  const basis: EpisodeReassessmentBasis[] = [];
  for (const plan of plans)
    if (
      ['active', 'waiting', 'blocked'].includes(plan.status) &&
      plan.triggers.length > 0 &&
      plan.triggers.every(holds) &&
      state.goals.some((g) => g.id === plan.goalId && ['active', 'deferred'].includes(g.status))
    )
      basis.push({ kind: 'plan', id: plan.id, conditions: plan.triggers });
  for (const responsibility of responsibilities)
    if (
      ['open', 'waiting', 'deferred'].includes(responsibility.status) &&
      responsibility.nextCheck.length > 0 &&
      responsibility.nextCheck.every(holds)
    )
      basis.push({
        kind: 'responsibility',
        id: responsibility.id,
        conditions: responsibility.nextCheck,
      });
  const open =
    goals.some((g) => ['active', 'deferred'].includes(g.status)) ||
    plans.some((p) => ['active', 'waiting', 'blocked'].includes(p.status)) ||
    responsibilities.some((r) => ['open', 'waiting', 'deferred'].includes(r.status));
  return structuredClone({
    worldId: state.worldId,
    actorId: state.actorId,
    requestId: request.id,
    episodeId: request.episodeId,
    stance: decision,
    followUp: open
      ? 'open'
      : goals.length + plans.length + responsibilities.length > 0
        ? 'terminal'
        : 'none',
    goals,
    plans,
    responsibilities,
    reassessment: { eligible: basis.length > 0, basis },
  });
}

/** Same checks as projection; never partially mutates the caller's state on rejection. */
export function validateEpisodeParticipationLifecycle(
  input: EpisodeParticipationLifecycleInput,
): void {
  projectEpisodeParticipationLifecycle(input);
}

/** All authenticated first considerations declined: no participant accepted this proposal.
 * Receipts are authenticated by the original committing repository. Silence, missing receipts
 * and later withdrawal of an active plan are not interchangeable with an initial decline.
 */
export function shouldWithdrawDeclinedEpisode(
  episode: import('./director-runtime.ts').SharedEpisode,
  considerations: readonly { actorId: string; choice: string }[],
): boolean {
  if (episode.status !== 'proposed' || !episode.participantActorIds.length) return false;
  const participants = new Set(episode.participantActorIds);
  if (
    participants.size !== episode.participantActorIds.length ||
    considerations.length !== participants.size ||
    new Set(considerations.map((c) => c.actorId)).size !== considerations.length
  )
    return false;
  return considerations.every((c) => participants.has(c.actorId) && c.choice === 'decline');
}
