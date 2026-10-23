import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentValidationContext } from '../domain/agent-kernel.ts';
import type { AgentGoal, AgentPlan } from '../domain/agent-runtime.ts';
import { AgentProposalSchema } from './agent-proposal-schema.ts';

const Id = z.string().trim().min(1).max(240);
const Text = z.string().trim().min(1).max(12000);
const Basis = z.array(Id).min(1).max(64);
const NextStep = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reconsider'),
    conditions: AgentProposalSchema.shape.plans.unwrap().element.shape.triggers.unwrap().min(1),
    missing: z.array(Text).max(16),
  }),
  z.strictObject({
    kind: z.literal('wait'),
    conditions: AgentProposalSchema.shape.plans.unwrap().element.shape.triggers.unwrap(),
    missing: z.array(Text).min(1).max(16),
  }),
  z.strictObject({ kind: z.literal('blocked'), missing: z.array(Text).min(1).max(16) }),
]);
const Goal = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('existing'), id: Id }),
  z.strictObject({ kind: z.literal('new'), summary: Text, sourceIds: Basis }),
]);
const Body = { summary: Text, sourceIds: Basis, nextStep: NextStep.optional() };
const planIntentSchema = (goalRequired: boolean) =>
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('create'),
      ref: Id,
      goal: goalRequired ? Goal : Goal.optional(),
      ...Body,
    }),
    z.strictObject({ kind: z.literal('replace'), ref: Id, planId: Id, ...Body }),
    z.strictObject({ kind: z.literal('update'), planId: Id, ...Body }),
    z.strictObject({
      kind: z.literal('close'),
      planId: Id,
      status: z.enum(['finished', 'withdrawn']),
      reason: Text,
      sourceIds: Basis,
    }),
  ]);
/** Explicit non-executing choices only; never inferred from a dangling goalId. */
export const NativePlanIntentSchema = planIntentSchema(false);
export const NativePlanIntentsSchema = z.array(NativePlanIntentSchema).max(24);
/** Historical v7 grammar keeps the required goal envelope for replay compatibility. */
export const LegacyNativePlanIntentsSchema = z.array(planIntentSchema(true)).max(24);
export type NativePlanIntent = z.infer<typeof NativePlanIntentSchema>;
function invalid(code: string): never {
  throw Object.assign(Error(code), { code: 'INVALID_PROPOSAL', reason: code });
}
/** Distinct from execution IDs: input receipt identity makes paid replay deterministic. */
export function nativePlanIntentIds(
  context: Pick<AgentValidationContext, 'state' | 'input'>,
  ref: string,
) {
  if (
    ![context.state.worldId, context.state.actorId, context.input.sourceId, ref].every(
      (v) => Id.safeParse(v).success,
    )
  )
    invalid('NPC_PLAN_INTENT_IDENTITY');
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        'npc-plan-intent-v1',
        context.state.worldId,
        context.state.actorId,
        context.input.sourceId,
        ref,
      ]),
    )
    .digest('hex');
  return { goalId: `plan-intent-goal:${hash}`, planId: `plan-intent-plan:${hash}` };
}
export function compileNpcPlanIntents(
  context: AgentValidationContext,
  raw: unknown,
): { goals: AgentGoal[]; plans: AgentPlan[] } {
  // No null/default semantics here: v6 owns whether an absent optional array is [].
  const parsed = NativePlanIntentsSchema.safeParse(raw);
  if (!parsed.success) invalid('NPC_PLAN_INTENT_SHAPE');
  const visible = context.viewState;
  if (
    visible &&
    (visible.worldId !== context.state.worldId || visible.actorId !== context.state.actorId)
  )
    invalid('NPC_PLAN_INTENT_SCOPE');
  const goals: AgentGoal[] = [],
    plans: AgentPlan[] = [];
  const refs = new Set<string>(),
    targets = new Set<string>();
  const occupied = new Set(
    [context.state, visible].flatMap((s) =>
      s
        ? [...s.goals, ...s.plans, ...s.actions, ...s.responsibilities, ...s.decisions].map(
            (x) => x.id,
          )
        : [],
    ),
  );
  const reserve = (id: string) => {
    if (occupied.has(id)) invalid('NPC_PLAN_INTENT_ID_CONFLICT');
    occupied.add(id);
  };
  const basis = (ids: string[]) => {
    if (
      ids.length < 1 ||
      ids.length > 64 ||
      !ids.includes(context.input.sourceId) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => context.sources.filter((s) => s.id === id).length !== 1)
    )
      invalid('NPC_PLAN_INTENT_SOURCE');
  };
  const knownGoal = (id: string) => {
    const matches = visible?.goals.filter((g) => g.id === id) ?? [];
    const goal = matches[0];
    if (matches.length !== 1 || !goal || ['fulfilled', 'withdrawn'].includes(goal.status))
      invalid('NPC_PLAN_INTENT_GOAL');
    return goal;
  };
  const knownPlan = (id: string, replacing: boolean) => {
    const matches = visible?.plans.filter((p) => p.id === id) ?? [];
    const plan = matches[0];
    if (matches.length !== 1 || !plan || ['finished', 'withdrawn'].includes(plan.status))
      invalid('NPC_PLAN_INTENT_PLAN');
    knownGoal(plan.goalId);
    if (targets.has(id)) invalid('NPC_PLAN_INTENT_DUPLICATE_TARGET');
    targets.add(id);
    for (const actionId of plan.actionIds) {
      const action = visible?.actions.find((a) => a.id === actionId);
      if (!action || action.goalId !== plan.goalId || action.status === 'executing')
        invalid('NPC_PLAN_INTENT_CHILD_ACTION');
      // Only explicit replacement can retire unexecuted actions through the original kernel.
      if (!replacing && !['succeeded', 'failed', 'withdrawn'].includes(action.status))
        invalid('NPC_PLAN_INTENT_UNFINISHED_ACTION');
    }
    return plan;
  };
  // A server-origin plan review already supplies the target. An omitted goal
  // means continue that plan; a genuinely new intention must name its new goal.
  let reviewedPlanId: string | undefined;
  if (context.input.origin === 'wake') {
    try {
      const wake = JSON.parse(context.input.text);
      if (wake.type === 'npc_own_condition_ready' && wake.source === 'actor_plan') {
        const review = wake.planReview;
        const matches =
          visible?.plans.filter((p) => p.id === review?.planId && p.goalId === review?.goalId) ??
          [];
        if (matches.length === 1) reviewedPlanId = matches[0]!.id;
      }
    } catch {
      // Other wake inputs do not carry a plan-review target.
    }
  }
  for (const original of parsed.data) {
    const intent: NativePlanIntent =
      original.kind === 'create' && !original.goal && reviewedPlanId
        ? {
            kind: 'update',
            planId: reviewedPlanId,
            summary: original.summary,
            sourceIds: original.sourceIds,
            ...(original.nextStep ? { nextStep: original.nextStep } : {}),
          }
        : original;
    basis(intent.sourceIds);
    let previous: AgentPlan | undefined;
    if (intent.kind !== 'create') previous = knownPlan(intent.planId, intent.kind === 'replace');
    const goalId =
      intent.kind === 'create'
        ? intent.goal?.kind === 'existing'
          ? knownGoal(intent.goal.id).id
          : undefined
        : previous!.goalId;
    let id: string,
      resolvedGoalId = goalId;
    if (intent.kind === 'create' || intent.kind === 'replace') {
      if (refs.has(intent.ref)) invalid('NPC_PLAN_INTENT_DUPLICATE_REF');
      refs.add(intent.ref);
      const ids = nativePlanIntentIds(context, intent.ref);
      reserve(ids.planId);
      id = ids.planId;
      if (intent.kind === 'create' && (!intent.goal || intent.goal.kind === 'new')) {
        const goal = intent.goal;
        const goalSources = goal?.kind === 'new' ? goal.sourceIds : intent.sourceIds;
        basis(goalSources);
        reserve(ids.goalId);
        resolvedGoalId = ids.goalId;
        goals.push({
          id: ids.goalId,
          summary: goal?.kind === 'new' ? goal.summary : intent.summary,
          status: 'active',
          sourceIds: [...goalSources],
          resultIds: [],
        });
      }
    } else id = previous!.id;
    const sourceIds = previous
      ? [...new Set([...previous.sourceIds, ...intent.sourceIds])]
      : [...intent.sourceIds];
    basis(sourceIds);
    if (intent.kind === 'close') {
      plans.push({
        ...structuredClone(previous!),
        sourceIds,
        status: intent.status,
        nextActionId: null,
        triggers: [],
        missingConditions: [intent.reason],
      });
      continue;
    }
    const next = intent.nextStep;
    if (next && next.kind !== 'blocked')
      for (const condition of next.conditions) {
        if (
          (condition.kind === 'observation' || condition.kind === 'at_or_after') &&
          context.sources.filter((s) => s.id === condition.sourceId).length !== 1
        )
          invalid('NPC_PLAN_INTENT_CONDITION_SOURCE');
        if (
          condition.kind === 'result' &&
          !visible?.actions.some((a) => a.id === condition.actionId)
        )
          invalid('NPC_PLAN_INTENT_CONDITION_ACTION');
        if (
          condition.kind === 'player_decision' &&
          !visible?.responsibilities.some((r) => r.id === condition.responsibilityId)
        )
          invalid('NPC_PLAN_INTENT_CONDITION_RESPONSIBILITY');
      }
    plans.push({
      id,
      goalId: resolvedGoalId!,
      summary: intent.summary,
      sourceIds,
      status:
        !next || next.kind === 'reconsider'
          ? 'active'
          : next.kind === 'wait'
            ? 'waiting'
            : 'blocked',
      actionIds: intent.kind === 'update' ? [...previous!.actionIds] : [],
      nextActionId: null,
      triggers: !next || next.kind === 'blocked' ? [] : structuredClone(next.conditions),
      missingConditions: next ? [...next.missing] : [],
      ...(intent.kind === 'replace'
        ? { supersedesPlanId: previous!.id }
        : previous?.supersedesPlanId
          ? { supersedesPlanId: previous.supersedesPlanId }
          : {}),
    });
  }
  return { goals, plans };
}
