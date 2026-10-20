import type { ActorAgendaInitializeGrant } from '../domain/actor-agenda-initialization.ts';
import { collectPendingSceneObservationCandidates } from '../domain/actor-observation-candidate.ts';
import { agentPlanNextStep } from '../domain/agent-plan-next-step.ts';
import { agentConditionsReady } from './agent-condition-checks.ts';
import type { AgentSnapshot } from './agent-runtime-ports.ts';
import type { RegisteredAgentCandidateSource } from './schedule-agents.ts';
import type {
  AgentAction,
  AgentActionResult,
  AgentAttempt,
  AgentBlocker,
  AgentCandidate,
  AgentCondition,
  AgentProposal,
  AgentResponsibility,
  AgentSource,
} from '../domain/agent-runtime.ts';
import type { Appointment } from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';
import { currentPlayerDecision } from '../domain/agent-kernel.ts';
import { evaluateAgentActionEligibility } from '../domain/agent-eligibility.ts';

/** One already authorized, immutable read; these collectors perform no authorization or IO. */
export type SchedulingView = {
  worldId: string;
  engineEpoch: number;
  worldVersion: number;
  storyAt: string;
  actors: readonly {
    snapshot: AgentSnapshot;
    trustedResults: readonly AgentActionResult[];
    appointments: readonly Appointment[];
  }[];
  activeAttempts: readonly Pick<AgentAttempt, 'actorId' | 'status' | 'id'>[];
  /** Only truly committed success/quiet wake receipts, never merely reserved/unknown attempts. */
  consumedCandidateIds: readonly string[];
  /** Server-attested permission, never a model-created agenda. */
  agendaInitializeGrants?: readonly ActorAgendaInitializeGrant[];
};
type ActorRead = SchedulingView['actors'][number];
const empty = (): AgentProposal => ({
  statements: [],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});
const integer = (v: number) => Number.isSafeInteger(v) && v >= 0;
const id = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 160 && v.trim() === v;
function instant(v: string) {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    return false;
  const wall = new Date(v.slice(0, 19) + 'Z');
  return Number.isFinite(wall.getTime()) && wall.toISOString().slice(0, 19) === v.slice(0, 19);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => JSON.stringify(key) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const ordered = <T>(values: readonly T[]) =>
  [...values].sort((a, b) =>
    canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
  );
async function fingerprint(value: unknown) {
  // Standard local WebCrypto keeps this application module independent of Node/infra imports.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
}

function authorizedActor(view: SchedulingView, actor: ActorRead) {
  const original = actor.snapshot,
    state = original.state,
    visible = original.viewState;
  if (
    state.worldId !== view.worldId ||
    visible.worldId !== state.worldId ||
    visible.actorId !== state.actorId ||
    visible.revision !== state.revision ||
    visible.definitionRef !== state.definitionRef ||
    !integer(state.revision) ||
    !integer(state.projectedWorldVersion) ||
    state.projectedWorldVersion > view.worldVersion ||
    !integer(visible.projectedWorldVersion) ||
    visible.projectedWorldVersion !== state.projectedWorldVersion ||
    visible.projectedWorldVersion > view.worldVersion ||
    original.worldVersion !== view.worldVersion ||
    !instant(original.storyAt) ||
    Date.parse(original.storyAt) !== Date.parse(view.storyAt)
  )
    throw new DomainError('INVALID_COMMAND');
  for (const key of ['goals', 'plans', 'actions', 'responsibilities', 'decisions'] as const) {
    const all = new Map(state[key].map((item) => [item.id, item]));
    if (
      all.size !== state[key].length ||
      new Set(visible[key].map((item) => item.id)).size !== visible[key].length ||
      visible[key].some((item) => canonical(item) !== canonical(all.get(item.id)))
    )
      throw new DomainError('INVALID_COMMAND');
  }
  if (new Set(original.sources.map((s) => s.id)).size !== original.sources.length)
    throw new DomainError('INVALID_COMMAND');
  const snapshot: AgentSnapshot = {
    ...original,
    sources: original.sources.filter(
      (s) =>
        id(s.id) &&
        integer(s.worldVersion) &&
        s.worldVersion <= view.worldVersion &&
        instant(s.at) &&
        Date.parse(s.at) <= Date.parse(view.storyAt),
    ),
  };
  const sources = new Map(snapshot.sources.map((s) => [s.id, s]));
  const hidden = new Set(snapshot.redactedStateIds);
  const basis = (item: { id: string; sourceIds: string[] }) =>
    !hidden.has(item.id) &&
    item.sourceIds.length > 0 &&
    item.sourceIds.every((sourceId) => sources.has(sourceId));
  const results = actor.trustedResults.filter(
    (result) =>
      result.worldId === view.worldId &&
      result.actorId === state.actorId &&
      id(result.id) &&
      id(result.eventId) &&
      integer(result.worldVersion) &&
      result.worldVersion <= view.worldVersion &&
      instant(result.at) &&
      Date.parse(result.at) <= Date.parse(view.storyAt) &&
      result.evidenceSourceIds.length > 0 &&
      result.evidenceSourceIds.every((sourceId) => sources.has(sourceId)) &&
      !hidden.has(result.actionId) &&
      visible.actions.some((a) => a.id === result.actionId),
  );
  const context = snapshot.worldContext;
  if (
    context &&
    (!instant(context.time.storyAt) ||
      Date.parse(context.time.storyAt) !== Date.parse(view.storyAt) ||
      !context.boundary.actorIds.includes(state.actorId))
  )
    throw new DomainError('INVALID_COMMAND');
  const own = context?.selfPosition;
  const position =
    own?.status === 'at' &&
    own.placeId &&
    own.sourceId &&
    own.occurredAt &&
    instant(own.occurredAt) &&
    Date.parse(own.occurredAt) <= Date.parse(view.storyAt) &&
    sources.get(own.sourceId)?.kind === 'world_event' &&
    Date.parse(sources.get(own.sourceId)!.at) === Date.parse(own.occurredAt) &&
    context!.boundary.actorIds.includes(state.actorId) &&
    context!.boundary.placeIds.includes(own.placeId)
      ? { placeId: own.placeId, sourceId: own.sourceId }
      : undefined;
  return { snapshot, sources, basis, results, position };
}
type ActorContext = ReturnType<typeof authorizedActor>;
const conditionTimesValid = (conditions: readonly AgentCondition[]) =>
  conditions.every((c) => c.kind !== 'at_or_after' || instant(c.at));
function eligibility(context: ActorContext, action: AgentAction, proposal = empty()) {
  return (
    evaluateAgentActionEligibility(context.snapshot, proposal, action, {
      storyAt: context.snapshot.storyAt,
      trustedResults: context.results,
      ...(context.position ? { actorPlaceId: context.position.placeId } : {}),
    }).status === 'ready'
  );
}
/** Internal adapter to the ONE shared condition interpreter; never emitted or persisted as a goal/action. */
function checksReady(context: ActorContext, responsibility: AgentResponsibility) {
  if (!responsibility.nextCheck.length || !conditionTimesValid(responsibility.nextCheck))
    return false;
  return agentConditionsReady(
    context.snapshot,
    responsibility.nextCheck,
    responsibility.sourceIds,
    context.results,
    context.position?.placeId,
    [responsibility.id],
  );
}
function evidence(
  context: ActorContext,
  conditions: readonly AgentCondition[],
  dependencyIds: readonly string[] = [],
) {
  const sourceIds: string[] = [];
  const values: unknown[] = [];
  for (const condition of conditions) {
    if (condition.kind === 'player_decision') {
      const decision = currentPlayerDecision(context.snapshot, empty(), condition.responsibilityId);
      if (decision) {
        sourceIds.push(decision.sourceId);
        values.push({ decision });
      }
    } else if (condition.kind === 'at_place') {
      if (context.position) {
        sourceIds.push(context.position.sourceId);
        values.push({ position: context.position });
      }
    } else if (condition.kind !== 'result') sourceIds.push(condition.sourceId);
  }
  const actions = new Set([
    ...dependencyIds,
    ...conditions.flatMap((c) => (c.kind === 'result' ? [c.actionId] : [])),
  ]);
  const receipts = context.results.filter((r) => actions.has(r.actionId));
  for (const receipt of receipts) sourceIds.push(...receipt.evidenceSourceIds);
  values.push(...receipts.map((result) => ({ result })));
  return { sourceIds: sorted(sourceIds), values: ordered(values) };
}
function sourceProofs(context: ActorContext, sourceIds: readonly string[]) {
  return sorted(sourceIds).map((id) => {
    const source = context.sources.get(id)!;
    // Availability is version/time checked above. Ambient projection at/version
    // must not turn unrelated world chatter into a new semantic candidate.
    return {
      id,
      kind: source.kind,
      recordId: source.recordId,
      ...(source.contentHash ? { contentHash: source.contentHash } : {}),
    };
  });
}
const responsibilitySemantic = (r: AgentResponsibility) => ({
  ...r,
  sourceIds: sorted(r.sourceIds),
  nextCheck: ordered(r.nextCheck),
});
async function candidate(
  view: SchedulingView,
  context: ActorContext,
  input: {
    source: 'actor_plan' | 'responsibility' | 'observation';
    actionId: string | null;
    sourceIds: string[];
    responsibilities: readonly AgentResponsibility[];
    episodeIds?: string[];
    semantic: unknown;
    reason: string;
  },
): Promise<AgentCandidate> {
  const snapshot = context.snapshot;
  const episodes = sorted([
    ...input.responsibilities.filter((r) => r.subject.kind === 'episode').map((r) => r.subject.id),
    ...(input.episodeIds ?? []),
  ]);
  const resourceIds = sorted(
    input.responsibilities
      .filter((r) => r.subject.kind === 'appointment' || r.subject.kind === 'matter')
      .map((r) => `${r.subject.kind}:${r.subject.id}`),
  );
  return {
    id: `${input.source}:${await fingerprint({
      worldId: view.worldId,
      actorId: snapshot.state.actorId,
      channel: snapshot.channel.kind,
      threadId: snapshot.channel.threadId,
      source: input.source,
      semantic: input.semantic,
      sources: sourceProofs(context, input.sourceIds),
    })}`,
    worldId: view.worldId,
    actorId: snapshot.state.actorId,
    source: input.source,
    episodeId: episodes.length === 1 ? episodes[0]! : null,
    actionId: input.actionId,
    resourceIds,
    channel: snapshot.channel.kind,
    threadId: snapshot.channel.threadId,
    sourceIds: sorted(input.sourceIds),
    expectedWorldVersion: view.worldVersion,
    expectedActorRevision: snapshot.state.revision,
    priority: input.source === 'actor_plan' ? 60 : input.source === 'responsibility' ? 50 : 40,
    reason: input.reason,
    requiresCoordination: episodes.length > 1,
  };
}
async function plans(view: SchedulingView, context: ActorContext) {
  const state = context.snapshot.viewState,
    out: AgentCandidate[] = [],
    seen = new Set<string>();
  for (const plan of state.plans) {
    if (
      !['active', 'waiting'].includes(plan.status) ||
      !plan.nextActionId ||
      !context.basis(plan) ||
      !conditionTimesValid(plan.triggers)
    )
      continue;
    if (seen.has(plan.nextActionId)) continue;
    seen.add(plan.nextActionId);
    const action = state.actions.find((a) => a.id === plan.nextActionId);
    const goal = state.goals.find((g) => g.id === plan.goalId);
    if (
      !action ||
      !goal ||
      !context.basis(action) ||
      !context.basis(goal) ||
      !conditionTimesValid(action.preconditions) ||
      !context.snapshot.channel.allowedCapabilities.includes(action.capability) ||
      (context.snapshot.worldContext &&
        !context.snapshot.worldContext.boundary.capabilityIds.includes(action.capability))
    )
      continue;
    const related = state.plans.filter(
      (p) => p.actionIds.includes(action.id) || p.nextActionId === action.id,
    );
    if (related.some((p) => !context.basis(p) || !conditionTimesValid(p.triggers))) continue;
    const conditions = [...related.flatMap((p) => p.triggers), ...action.preconditions];
    if (
      action.status !== 'ready' &&
      !(action.status === 'waiting' && (conditions.length || action.dependsOnActionIds.length))
    )
      continue;
    if (context.results.some((r) => r.actionId === action.id) || !eligibility(context, action))
      continue;
    const responsibilities = state.responsibilities.filter((r) =>
      action.handlesResponsibilityIds.includes(r.id),
    );
    if (
      responsibilities.length !== new Set(action.handlesResponsibilityIds).size ||
      responsibilities.some((r) => !context.basis(r))
    )
      continue;
    const proof = evidence(context, conditions, action.dependsOnActionIds);
    const sourceIds = sorted([
      ...related.flatMap((p) => p.sourceIds),
      ...goal.sourceIds,
      ...action.sourceIds,
      ...responsibilities.flatMap((r) => r.sourceIds),
      ...proof.sourceIds,
    ]);
    if (sourceIds.some((id) => !context.sources.has(id))) continue;
    out.push(
      await candidate(view, context, {
        source: 'actor_plan',
        actionId: action.id,
        sourceIds,
        responsibilities,
        semantic: {
          plans: ordered(
            related.map((p) => ({
              ...p,
              sourceIds: sorted(p.sourceIds),
              triggers: ordered(p.triggers),
            })),
          ),
          action: {
            ...action,
            sourceIds: sorted(action.sourceIds),
            preconditions: ordered(action.preconditions),
            dependsOnActionIds: sorted(action.dependsOnActionIds),
            handlesResponsibilityIds: sorted(action.handlesResponsibilityIds),
          },
          goal: {
            id: goal.id,
            summary: goal.summary,
            status: goal.status,
            sourceIds: sorted(goal.sourceIds),
          },
          responsibilities: ordered(responsibilities.map(responsibilitySemantic)),
          evidence: proof.values,
        },
        reason: '已记录计划的下一行动条件满足，评估执行。',
      }),
    );
  }
  return out;
}
async function planReconsiderations(
  view: SchedulingView,
  context: ActorContext,
  existing: AgentCandidate[],
) {
  const out: AgentCandidate[] = [];
  const state = context.snapshot.viewState;
  for (const plan of state.plans) {
    const goal = state.goals.find((g) => g.id === plan.goalId);
    const nextAction = state.actions.find((a) => a.id === plan.nextActionId);
    const completedStep =
      nextAction && plan.actionIds.includes(nextAction.id)
        ? context.results.find(
            (r) =>
              r.actionId === nextAction.id &&
              r.id === nextAction.resultId &&
              r.outcome === nextAction.status &&
              ['succeeded', 'failed'].includes(r.outcome),
          )
        : undefined;
    const reviewConditions: AgentCondition[] = completedStep
      ? [{ kind: 'result', actionId: completedStep.actionId, outcome: completedStep.outcome }]
      : plan.triggers;
    // Execution may already have established the next step: waiting for the
    // player on the exact object it created. Its responsibility owns that wait;
    // buying another result review now merely asks for the same answer again.
    const resultAlreadyWaiting =
      completedStep?.outcome === 'succeeded' &&
      state.responsibilities.some(
        (r) =>
          r.status === 'waiting' &&
          r.waitingOn === 'player' &&
          context.basis(r) &&
          completedStep.outputRefs?.some(
            (ref) => ref.kind === r.subject.kind && ref.id === r.subject.id,
          ) &&
          !currentPlayerDecision(context.snapshot, empty(), r.id),
      );
    const refs = (context.snapshot.episodeFollowUps ?? []).filter((f) =>
      f.planIds.includes(plan.id),
    );
    if (
      // A successful generation action only enqueues media. The existing media
      // completion observer owns its next wake; a second plan review here can
      // recreate the same request before or after delivery.
      (completedStep?.outcome === 'succeeded' &&
        ['media.generate_image', 'media.generate_video'].includes(nextAction!.capability) &&
        completedStep.outputRefs?.some((ref) => ref.kind === 'media')) ||
      resultAlreadyWaiting ||
      (!refs.length &&
        !completedStep &&
        ((nextAction && ['succeeded', 'failed'].includes(nextAction.status)) ||
          agentPlanNextStep(plan, state.actions, context.snapshot.channel.allowedCapabilities) !==
            'reconsider')) ||
      !['active', 'waiting', 'blocked'].includes(plan.status) ||
      !context.basis(plan) ||
      !conditionTimesValid(plan.triggers) ||
      !goal ||
      !['active', 'deferred'].includes(goal.status) ||
      !context.basis(goal) ||
      (plan.nextActionId && existing.some((c) => c.actionId === plan.nextActionId)) ||
      !agentConditionsReady(
        context.snapshot,
        reviewConditions,
        plan.sourceIds,
        context.results,
        context.position?.placeId,
      )
    )
      continue;
    const proof = evidence(context, reviewConditions);
    const sourceIds = sorted([
      ...plan.sourceIds,
      ...(refs.length ? [] : goal.sourceIds),
      ...proof.sourceIds,
    ]);
    if (sourceIds.some((id) => !context.sources.has(id))) continue;
    out.push(
      await candidate(view, context, {
        source: 'actor_plan',
        actionId: null,
        episodeIds: refs.map((f) => f.episodeId),
        sourceIds,
        responsibilities: [],
        semantic: {
          reconsiderPlan: refs.length
            ? plan
            : { id: plan.id, goalId: plan.goalId, triggers: ordered(plan.triggers) },
          episodeRefs: refs.map((f) => ({
            requestId: f.requestId,
            episodeId: f.episodeId,
            choice: f.choice,
          })),
          evidence: proof.values,
        },
        reason: refs.length
          ? '本人已考虑事件的既有计划出现明确复查依据；只重新考虑安排，不推定执行、同意或事件完成。'
          : '本人既有计划出现明确复查依据；只重新考虑下一步或明确等待，不推定执行、同意或事件完成。',
      }),
    );
  }
  return out;
}

/** A persisted personal waiting decision can mature without any actor-state mutation. */
async function continuationConditions(view: SchedulingView, context: ActorContext) {
  const state = context.snapshot.viewState;
  const continuation = state.continuation;
  if (
    !continuation ||
    continuation.version !== 1 ||
    continuation.decision !== 'await_condition' ||
    context.snapshot.channel.kind !== 'private' ||
    canonical(continuation) !== canonical(context.snapshot.state.continuation) ||
    !continuation.conditions.length ||
    !conditionTimesValid(continuation.conditions) ||
    continuation.planIds.some(
      (id) =>
        !state.plans.some(
          (p) => p.id === id && context.basis(p) && !['finished', 'withdrawn'].includes(p.status),
        ),
    ) ||
    continuation.questionIds.some(
      (id) => !state.questions?.some((q) => q.id === id && q.status === 'open'),
    )
  )
    return [];
  const conditions = continuation.conditions;
  const proof = evidence(context, conditions);
  // Authenticate the actual matured condition, not a fresh quiet input's receipt.
  // Prior decision inputs need not remain in a bounded snapshot forever.
  if (
    !proof.sourceIds.length ||
    proof.sourceIds.some(
      (id) =>
        !context.sources.has(id) ||
        (context.sources.get(id)!.kind === 'accepted_input' &&
          !conditions.some(
            (c) =>
              c.kind === 'player_decision' &&
              currentPlayerDecision(context.snapshot, empty(), c.responsibilityId)?.sourceId === id,
          )),
    ) ||
    conditions.some(
      (c) => c.kind === 'at_or_after' && context.sources.get(c.sourceId)?.deadlineAt !== c.at,
    ) ||
    !agentConditionsReady(
      context.snapshot,
      conditions,
      proof.sourceIds,
      context.results,
      context.position?.placeId,
    )
  )
    return [];
  const same = (other: readonly AgentCondition[]) =>
    canonical(ordered(other)) === canonical(ordered(conditions));
  if (
    state.plans.some(
      (p) =>
        ['active', 'waiting', 'blocked'].includes(p.status) && context.basis(p) && same(p.triggers),
    ) ||
    state.responsibilities.some(
      (r) =>
        !['fulfilled', 'withdrawn', 'expired'].includes(r.status) &&
        context.basis(r) &&
        same(r.nextCheck),
    )
  )
    return [];
  return [
    await candidate(view, context, {
      source: 'actor_plan',
      actionId: null,
      sourceIds: proof.sourceIds,
      responsibilities: [],
      semantic: { continuationConditions: ordered(conditions), evidence: proof.values },
      reason: '本人已保存的等待条件出现实际依据，重新考虑下一步；不推定玩家同意或行动完成。',
    }),
  ];
}

async function responsibilities(view: SchedulingView, actor: ActorRead, context: ActorContext) {
  const out: AgentCandidate[] = [];
  for (const responsibility of context.snapshot.viewState.responsibilities) {
    if (
      ['fulfilled', 'withdrawn', 'expired'].includes(responsibility.status) ||
      !context.basis(responsibility) ||
      !integer(responsibility.revision ?? 0)
    )
      continue;
    if (
      responsibility.deadline &&
      (!instant(responsibility.deadline.at) ||
        context.sources.get(responsibility.deadline.sourceId)?.deadlineAt !==
          responsibility.deadline.at)
    )
      continue;
    const triggers: unknown[] = [],
      sourceIds = [
        ...responsibility.sourceIds,
        ...(responsibility.deadline ? [responsibility.deadline.sourceId] : []),
      ];
    if (checksReady(context, responsibility)) {
      const proof = evidence(context, responsibility.nextCheck);
      sourceIds.push(...proof.sourceIds);
      triggers.push({ nextCheck: ordered(responsibility.nextCheck), evidence: proof.values });
    }
    const decision = currentPlayerDecision(context.snapshot, empty(), responsibility.id);
    if (
      decision &&
      context.sources.get(decision.sourceId)?.kind === 'accepted_input' &&
      !context.snapshot.redactedStateIds.includes(decision.id)
    ) {
      sourceIds.push(decision.sourceId);
      triggers.push({ decision });
    }
    if (responsibility.subject.kind === 'appointment') {
      const appointment = actor.appointments.find((a) => a.id === responsibility.subject.id);
      const source = appointment && context.sources.get(`appointment:${appointment.id}`);
      if (
        appointment &&
        ['proposed', 'confirmed'].includes(appointment.status ?? '') &&
        appointment.participantIds.includes(context.snapshot.state.actorId) &&
        instant(appointment.at) &&
        Date.parse(appointment.at) <= Date.parse(view.storyAt) &&
        source?.recordId === appointment.sourceEventId &&
        (source.kind === 'world_event' || source.kind === 'authored') &&
        (appointment.responseAt === undefined ||
          (instant(appointment.responseAt) &&
            Date.parse(appointment.responseAt) <= Date.parse(view.storyAt))) &&
        (appointment.responseVersion === undefined ||
          (integer(appointment.responseVersion) &&
            appointment.responseVersion <= view.worldVersion))
      ) {
        sourceIds.push(source.id);
        triggers.push({ appointment });
      }
    }
    if (!triggers.length) continue;
    const refs = (context.snapshot.episodeFollowUps ?? []).filter((f) =>
      f.responsibilityIds.includes(responsibility.id),
    );
    out.push(
      await candidate(view, context, {
        source: 'responsibility',
        actionId: null,
        sourceIds,
        responsibilities: [responsibility],
        episodeIds: refs.map((f) => f.episodeId),
        semantic: {
          responsibility: responsibilitySemantic(responsibility),
          triggers: ordered(triggers),
          ...(refs.length
            ? {
                episodeRefs: refs.map((f) => ({
                  requestId: f.requestId,
                  episodeId: f.episodeId,
                  choice: f.choice,
                })),
              }
            : {}),
        },
        reason: '当前责任有实际复查依据，重新评估本人的安排；不推定到场、同意或失约。',
      }),
    );
  }
  return out;
}

/** Two pure sources per actor, all from the same detached view; no legacy-agenda fallback. */
/** Newly observable information is a reason to think, never a compulsory message or deduction. */
async function observations(view: SchedulingView, context: ActorContext) {
  const snapshot = context.snapshot,
    out: AgentCandidate[] = [];
  if (snapshot.channel.kind === 'private')
    out.push(
      ...(await collectActorMediaResultCandidates({
        worldId: view.worldId,
        actorId: snapshot.state.actorId,
        engineEpoch: view.engineEpoch,
        worldVersion: view.worldVersion,
        actorRevision: snapshot.state.revision,
        storyAt: view.storyAt,
        sources: snapshot.sources,
        observations: snapshot.observations,
      })),
    );
  for (const knowledge of snapshot.worldContext?.knowledge ?? []) {
    const source = context.sources.get(knowledge.sourceId);
    // projectedWorldVersion is the actor's last actual evaluated/committed view,
    // not a message count. A report handled in that turn is not a new idle wake.
    if (
      !source ||
      source.kind !== 'world_event' ||
      source.usage === 'private_strategy' ||
      source.worldVersion <= snapshot.state.projectedWorldVersion ||
      !instant(knowledge.learnedAt) ||
      Date.parse(knowledge.learnedAt) > Date.parse(view.storyAt)
    )
      continue;
    if (
      !['at', 'left', 'absent', 'report'].includes(knowledge.kind) ||
      !['direct', 'player_report', 'relayed', 'inference'].includes(knowledge.sourceKind) ||
      (knowledge.placeId !== null &&
        !snapshot.worldContext!.boundary.placeIds.includes(knowledge.placeId)) ||
      (knowledge.subject.kind === 'actor' &&
        !snapshot.worldContext!.boundary.actorIds.includes(knowledge.subject.actorId))
    )
      continue;
    if (!snapshot.observations.some((o) => o.sourceId === knowledge.sourceId)) continue;
    out.push(
      await candidate(view, context, {
        source: 'observation',
        actionId: null,
        sourceIds: [knowledge.sourceId],
        responsibilities: [],
        semantic: {
          kind: knowledge.kind,
          subject: knowledge.subject,
          placeId: knowledge.placeId,
          sourceKind: knowledge.sourceKind,
          occurredAt: knowledge.occurredAt,
          learnedAt: knowledge.learnedAt,
        },
        reason:
          '本人获得了新的有来源观察；评估是否调整安排或联系。允许保持安静，不推定玩家去向、失约或关系变化。',
      }),
    );
  }
  // A real answer to this actor's invitation is new causal information even before its meeting time.
  // Identity is tied to the immutable evidence, not to current clock/actor/message counters.
  if (snapshot.channel.kind === 'private')
    for (const result of snapshot.episodeResults ?? []) {
      const source = context.sources.get(`appointment:${result.subject.id}`);
      if (
        result.actorId !== snapshot.state.actorId ||
        result.subject.kind !== 'appointment' ||
        !['invitation_accepted', 'invitation_declined'].includes(result.kind) ||
        !integer(result.worldVersion) ||
        result.worldVersion > view.worldVersion ||
        !instant(result.occurredAt) ||
        Date.parse(result.occurredAt) > Date.parse(view.storyAt) ||
        !source ||
        !['world_event', 'authored'].includes(source.kind)
      )
        continue;
      out.push({
        id:
          'episode-answer:' +
          (await fingerprint({
            worldId: view.worldId,
            actorId: result.actorId,
            engineEpoch: view.engineEpoch,
            result,
          })),
        worldId: view.worldId,
        actorId: result.actorId,
        source: 'observation',
        episodeId: result.episodeId,
        actionId: null,
        resourceIds: [`appointment:${result.subject.id}`],
        channel: 'private',
        threadId: result.actorId,
        sourceIds: [source.id],
        expectedWorldVersion: view.worldVersion,
        expectedActorRevision: snapshot.state.revision,
        priority: 45,
        requiresCoordination: false,
        reason:
          '本人邀请已有真实答复；依据episodeResults调整自己的安排或保持安静，不重新询问同一答复，不推定赴约或整段事件完成。',
      });
    }
  if (snapshot.actorObservationInbox?.sourceIds.length && snapshot.channel.kind === 'private') {
    out.push(
      ...(await collectPendingSceneObservationCandidates({
        worldId: view.worldId,
        actorId: snapshot.state.actorId,
        engineEpoch: view.engineEpoch,
        worldVersion: view.worldVersion,
        actorRevision: snapshot.state.revision,
        storyAt: view.storyAt,
        sources: snapshot.sources.filter((s) =>
          snapshot.actorObservationInbox!.sourceIds.includes(s.id),
        ),
        observations: snapshot.observations,
        consumed: [],
      })),
    );
  }
  return out;
}

export function createAgentScheduleSources(
  input: SchedulingView,
): readonly RegisteredAgentCandidateSource[] {
  if (
    !input ||
    !id(input.worldId) ||
    !integer(input.engineEpoch) ||
    input.engineEpoch < 2 ||
    !integer(input.worldVersion) ||
    !instant(input.storyAt) ||
    !Array.isArray(input.actors) ||
    !Array.isArray(input.activeAttempts) ||
    !Array.isArray(input.consumedCandidateIds) ||
    !input.consumedCandidateIds.every((v) => typeof v === 'string')
  )
    throw new DomainError('INVALID_COMMAND');
  const view = freeze(structuredClone(input));
  const ids = view.actors.map((a) => a.snapshot.state.actorId);
  if (
    !ids.every(id) ||
    new Set(ids).size !== ids.length ||
    view.activeAttempts.some(
      (a) =>
        !id(a.id) ||
        !id(a.actorId) ||
        ![
          'reserved',
          'request_sent',
          'response_received',
          'unknown_after_send',
          'committed',
          'invalid_output',
          'stale_discarded',
          'cancelled_before_send',
        ].includes(a.status),
    )
  )
    throw new DomainError('INVALID_COMMAND');
  const consumed = new Set(view.consumedCandidateIds);
  return freeze(
    view.actors.flatMap((actor) =>
      (
        [
          'actor_plan',
          'responsibility',
          ...(view.agendaInitializeGrants?.some((g) => g.actorId === actor.snapshot.state.actorId)
            ? ['agenda_initialize' as const]
            : []),
          ...(actor.snapshot.worldContext?.knowledge.length ||
          actor.snapshot.actorObservationInbox?.sourceIds.length ||
          actor.snapshot.episodeResults?.length ||
          actor.snapshot.sources.some((source) => source.id.startsWith('media-result:'))
            ? ['observation' as const]
            : []),
        ] as const
      ).map((source) => ({
        id: `${source}:${actor.snapshot.state.actorId}`,
        failureScope: { kind: 'actor' as const, actorId: actor.snapshot.state.actorId },
        source: {
          async collect(_ownerId: string, worldId: string) {
            if (worldId !== view.worldId) throw new DomainError('INVALID_COMMAND');
            const context = authorizedActor(view, actor);
            const blockers: AgentBlocker[] =
              source === 'actor_plan' || source === 'agenda_initialize'
                ? view.activeAttempts
                    .filter(
                      (a) =>
                        a.actorId === actor.snapshot.state.actorId &&
                        [
                          'reserved',
                          'request_sent',
                          'response_received',
                          'unknown_after_send',
                        ].includes(a.status),
                    )
                    .map((a) => ({
                      scope: { kind: 'actor' as const, actorId: a.actorId },
                      sourceId: a.id,
                      reason:
                        a.status === 'unknown_after_send'
                          ? ('unknown_attempt' as const)
                          : ('waiting_condition' as const),
                      reconsiderOn: [],
                    }))
                : [];
            const candidates = (
              await (source === 'agenda_initialize'
                ? Promise.resolve(
                    (view.agendaInitializeGrants ?? [])
                      .filter(
                        (g) =>
                          g.actorId === context.snapshot.state.actorId &&
                          g.worldId === view.worldId &&
                          g.engineEpoch === view.engineEpoch &&
                          g.policy === 'npc_agenda_initialize_v1' &&
                          g.definitionRef === context.snapshot.state.definitionRef &&
                          g.sourceIds.length > 0 &&
                          g.sourceIds.every((id) =>
                            context.snapshot.sources.some(
                              (s) =>
                                s.id === id &&
                                s.kind === 'authored' &&
                                s.recordId === g.definitionRef,
                            ),
                          ),
                      )
                      .map((g) => ({
                        id: g.candidateId,
                        worldId: view.worldId,
                        actorId: g.actorId,
                        source: 'agenda_initialize' as const,
                        episodeId: null,
                        actionId: null,
                        resourceIds: [],
                        channel: 'private' as const,
                        threadId: g.actorId,
                        sourceIds: [...g.sourceIds],
                        expectedWorldVersion: view.worldVersion,
                        expectedActorRevision: context.snapshot.state.revision,
                        priority: 10,
                        reason: '本人尚无议程，获得一次有界自主规划机会；不要求联系玩家。',
                        requiresCoordination: false,
                      })),
                  )
                : source === 'actor_plan'
                  ? plans(view, context).then(async (ready) => [
                      ...ready,
                      ...(await planReconsiderations(view, context, ready)),
                      ...(await continuationConditions(view, context)),
                    ])
                  : source === 'responsibility'
                    ? responsibilities(view, actor, context)
                    : observations(view, context))
            ).filter((c) => !consumed.has(c.id));
            return { candidates, blockers };
          },
        },
      })),
    ),
  );
}

/**
 * The caller supplies G/J-authenticated own completion packets, never a ready request flag.
 * External work may complete without advancing worldVersion; identity follows the actual
 * completion/source hash, not the read time, model revision, message count, or clock tick.
 */
export async function collectActorMediaResultCandidates(input: {
  worldId: string;
  actorId: string;
  engineEpoch: number;
  worldVersion: number;
  actorRevision: number;
  storyAt: string;
  sources: readonly AgentSource[];
  observations: AgentSnapshot['observations'];
}): Promise<AgentCandidate[]> {
  if (
    !id(input.worldId) ||
    !id(input.actorId) ||
    !integer(input.engineEpoch) ||
    input.engineEpoch < 2 ||
    !integer(input.worldVersion) ||
    !integer(input.actorRevision) ||
    !instant(input.storyAt)
  )
    throw new DomainError('INVALID_COMMAND');
  const candidates: AgentCandidate[] = [];
  for (const source of input.sources) {
    if (
      !/^media-result:[a-f0-9]{64}$/.test(source.id) ||
      source.kind !== 'action_result' ||
      source.usage !== 'private_strategy' ||
      !/^[a-f0-9]{64}$/.test(source.contentHash ?? '') ||
      !id(source.recordId) ||
      !integer(source.worldVersion) ||
      source.worldVersion > input.worldVersion ||
      !instant(source.at) ||
      Date.parse(source.at) > Date.parse(input.storyAt)
    )
      continue;
    const observation = input.observations.find(
      (item) => item.sourceId === source.id && item.kind === 'result',
    );
    let result: Record<string, any>;
    try {
      result = JSON.parse(observation?.text ?? 'null');
    } catch {
      continue;
    }
    if (
      !result ||
      result.kind !== 'own_media_completion' ||
      result.phase !== 'completed' ||
      result.requestId !== source.recordId ||
      !['image', 'video'].includes(result.mediaType) ||
      result.sourceStoryAt !== source.at ||
      result.observedAtStory !== input.storyAt ||
      !instant(result.completedAtReal) ||
      !id(result.asset?.id) ||
      !integer(result.asset?.revision) ||
      result.asset.revision < 1 ||
      !['image/png', 'image/jpeg', 'image/webp', 'video/mp4'].includes(result.asset.mimeType) ||
      !['eligible', 'suppressed', 'no_message'].includes(result.chatProjection)
    )
      continue;
    candidates.push({
      id:
        'observation:' +
        (await fingerprint({
          kind: 'own_media_completion_v1',
          worldId: input.worldId,
          actorId: input.actorId,
          engineEpoch: input.engineEpoch,
          sourceId: source.id,
          contentHash: source.contentHash,
        })),
      worldId: input.worldId,
      actorId: input.actorId,
      source: 'observation',
      episodeId: null,
      actionId: null,
      resourceIds: [`media:${source.recordId}`],
      channel: 'private',
      threadId: input.actorId,
      sourceIds: [source.id],
      expectedWorldVersion: input.worldVersion,
      expectedActorRevision: input.actorRevision,
      priority: 40,
      requiresCoordination: false,
      reason:
        '本人请求的媒体已有真实生成结果；据此考虑自己的后续计划或保持安静，不再次购买同一生成，不推定玩家已读或整个目标完成。',
    });
  }
  return candidates;
}
