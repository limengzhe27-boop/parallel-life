import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentValidationContext } from '../domain/agent-kernel.ts';
import { AgentProposalSchema } from './agent-proposal-schema.ts';

const Id = z.string().trim().min(1).max(240);
const Text = z.string().trim().min(1).max(12000);
const Basis = z.array(Id).min(1).max(64);
const Action = AgentProposalSchema.shape.actions.element;

/** Explicit intent only: old transports exclude media; v4 shares one action channel. */
export const NativeExecutionIntentSchema = z.strictObject({
  ref: Id,
  goal: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('existing'), id: Id }),
    z.strictObject({ kind: z.literal('new'), summary: Text, sourceIds: Basis }),
  ]),
  plan: z.strictObject({
    summary: Text,
    sourceIds: Basis,
    supersedesPlanId: Id.optional(),
  }),
  action: z.strictObject({
    capability: Id,
    targetIds: Action.shape.targetIds,
    parameters: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(80),
          value: Action.shape.parameters.valueType,
        }),
      )
      .max(64),
    preconditions: Action.shape.preconditions,
    dependsOnActionIds: Action.shape.dependsOnActionIds,
    handlesResponsibilityIds: Action.shape.handlesResponsibilityIds,
    sourceIds: Basis,
  }),
});
export const NativeExecutionIntentsSchema = z.array(NativeExecutionIntentSchema).max(16);
export type NativeExecutionIntent = z.infer<typeof NativeExecutionIntentSchema>;
export type NativeExecution = {
  goal:
    | { kind: 'existing'; id: string }
    | { kind: 'new'; id: string; summary: string; sourceIds: string[] };
  plan: { id: string; summary: string; sourceIds: string[]; supersedesPlanId?: string };
  action: Omit<NativeExecutionIntent['action'], 'parameters'> & {
    id: string;
    parameters: z.infer<typeof Action.shape.parameters>;
  };
};
function invalid(code: string): never {
  throw Object.assign(Error(code), { code });
}
export function nativeExecutionIntentIds(
  context: Pick<AgentValidationContext, 'state' | 'input'>,
  ref: string,
) {
  if (
    ![context.state.worldId, context.state.actorId, context.input.sourceId, ref].every(
      (v) => Id.safeParse(v).success,
    )
  )
    invalid('NPC_EXECUTION_INTENT_IDENTITY');
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        'npc-execution-intent-v1',
        context.state.worldId,
        context.state.actorId,
        context.input.sourceId,
        ref,
      ]),
    )
    .digest('hex');
  return {
    goalId: `execution-goal:${hash}`,
    planId: `execution-plan:${hash}`,
    actionId: `execution-action:${hash}`,
  };
}
export function compileNpcExecutionIntents(
  context: AgentValidationContext,
  raw: unknown,
  options: { allowMedia?: boolean } = {},
): {
  executions: NativeExecution[];
  actionIdsByRef: Record<string, string>;
} {
  // Native strict providers materialize this optional field as null. Normalize only
  // that transport spelling; never repair other missing or invalid intent fields.
  const transport = Array.isArray(raw)
    ? raw.map((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const value = item as Record<string, unknown>;
        const plan = value.plan;
        if (
          !plan ||
          typeof plan !== 'object' ||
          Array.isArray(plan) ||
          (plan as Record<string, unknown>).supersedesPlanId !== null
        )
          return item;
        const { supersedesPlanId: _optionalNull, ...rest } = plan as Record<string, unknown>;
        return { ...value, plan: rest };
      })
    : raw;
  const parsed = NativeExecutionIntentsSchema.safeParse(transport);
  if (!parsed.success) invalid('NPC_EXECUTION_INTENT_SHAPE');
  const visible = context.viewState;
  const existingActions = new Set(visible?.actions.map((a) => a.id) ?? []);
  const responsibilities = new Set(visible?.responsibilities.map((r) => r.id) ?? []);
  const stateIds = new Set(
    [context.state, visible].flatMap((s) =>
      s
        ? [...s.goals, ...s.plans, ...s.actions, ...s.responsibilities, ...s.decisions].map(
            (i) => i.id,
          )
        : [],
    ),
  );
  const reserved = new Set<string>();
  const refs = new Set<string>();
  const executions: NativeExecution[] = [];
  const actionIdsByRef: Record<string, string> = Object.create(null);
  const legalSource = (id: string) => context.sources.filter((s) => s.id === id).length === 1;
  function basis(ids: string[]) {
    if (
      !ids.includes(context.input.sourceId) ||
      new Set(ids).size !== ids.length ||
      !ids.every(legalSource)
    )
      invalid('NPC_EXECUTION_INTENT_SOURCE');
  }
  for (const intent of parsed.data) {
    if (intent.ref.startsWith('execution:') || intent.ref.startsWith('media:'))
      invalid('NPC_EXECUTION_INTENT_SHAPE');
    if (refs.has(intent.ref)) invalid('NPC_EXECUTION_INTENT_DUPLICATE_REF');
    refs.add(intent.ref);
    if (
      (intent.action.capability.startsWith('media.') &&
        (!options.allowMedia ||
          !['media.generate_image', 'media.generate_video'].includes(intent.action.capability))) ||
      intent.action.capability === 'plan.record' ||
      !context.channel.allowedCapabilities.includes(intent.action.capability)
    )
      invalid('NPC_EXECUTION_INTENT_CAPABILITY');
    basis(intent.plan.sourceIds);
    basis(intent.action.sourceIds);
    if (intent.goal.kind === 'new') basis(intent.goal.sourceIds);
    else {
      const existingGoalId = intent.goal.id;
      if (
        !visible?.goals.some(
          (g) => g.id === existingGoalId && !['fulfilled', 'withdrawn'].includes(g.status),
        )
      )
        invalid('NPC_EXECUTION_INTENT_GOAL');
    }
    const ids = nativeExecutionIntentIds(context, intent.ref);
    for (const id of [
      ids.planId,
      ids.actionId,
      ...(intent.goal.kind === 'new' ? [ids.goalId] : []),
    ]) {
      if (reserved.has(id) || stateIds.has(id)) invalid('NPC_EXECUTION_INTENT_ID_CONFLICT');
      reserved.add(id);
    }
    const goalId = intent.goal.kind === 'existing' ? intent.goal.id : ids.goalId;
    if (
      intent.plan.supersedesPlanId &&
      (!visible?.plans.some((p) => p.id === intent.plan.supersedesPlanId && p.goalId === goalId) ||
        intent.plan.supersedesPlanId === ids.planId)
    )
      invalid('NPC_EXECUTION_INTENT_SUPERSEDES');
    if (intent.action.dependsOnActionIds.some((id) => !existingActions.has(id)))
      invalid('NPC_EXECUTION_INTENT_DEPENDENCY');
    if (intent.action.handlesResponsibilityIds.some((id) => !responsibilities.has(id)))
      invalid('NPC_EXECUTION_INTENT_RESPONSIBILITY');
    for (const condition of intent.action.preconditions) {
      if (
        (condition.kind === 'observation' || condition.kind === 'at_or_after') &&
        !legalSource(condition.sourceId)
      )
        invalid('NPC_EXECUTION_INTENT_SOURCE');
      if (condition.kind === 'result' && !existingActions.has(condition.actionId))
        invalid('NPC_EXECUTION_INTENT_DEPENDENCY');
      if (condition.kind === 'player_decision' && !responsibilities.has(condition.responsibilityId))
        invalid('NPC_EXECUTION_INTENT_RESPONSIBILITY');
    }
    const names = intent.action.parameters.map((p) => p.name);
    if (new Set(names).size !== names.length) invalid('NPC_EXECUTION_INTENT_PARAMETERS');
    executions.push({
      goal: intent.goal.kind === 'new' ? { ...intent.goal, id: ids.goalId } : intent.goal,
      plan: { ...intent.plan, id: ids.planId },
      action: {
        ...intent.action,
        id: ids.actionId,
        parameters: Object.fromEntries(intent.action.parameters.map((p) => [p.name, p.value])),
      },
    });
    actionIdsByRef[intent.ref] = ids.actionId;
  }
  return { executions, actionIdsByRef };
}

/** Current immediate tools bind mechanical identity/provenance once, without a fake life plan. */
export function compileNpcExecutionProposal(context: AgentValidationContext, raw: unknown) {
  if (!Array.isArray(raw) || raw.length > 1) invalid('NPC_EXECUTION_INTENT_SHAPE');
  const proposal: z.infer<typeof AgentProposalSchema> = {
    statements: [],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
  const actionIdsByRef: Record<string, string> = Object.create(null);
  for (const item of raw) {
    if (item && typeof item === 'object' && !('goal' in item) && !('plan' in item)) {
      const immediate = z
        .strictObject({
          ref: Id,
          action: z.strictObject({
            capability: z.literal('media.generate_image'),
            parameters: z.strictObject({
              sceneDescription: Text,
              purpose: z.enum(['portrait', 'scene', 'memorial', 'evidence']),
            }),
          }),
        })
        .parse(item);
      if (!context.channel.allowedCapabilities.includes(immediate.action.capability))
        invalid('NPC_EXECUTION_INTENT_CAPABILITY');
      const id = nativeExecutionIntentIds(context, immediate.ref).actionId;
      if (context.state.actions.some((a) => a.id === id))
        invalid('NPC_EXECUTION_INTENT_ID_CONFLICT');
      proposal.actions.push({
        id,
        goalId: null,
        ...immediate.action,
        targetIds: [],
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        sourceIds: [context.input.sourceId],
        status: 'proposed',
      });
      actionIdsByRef[immediate.ref] = id;
    } else {
      const compiled = compileNpcExecutionIntents(context, [item], { allowMedia: true });
      Object.assign(actionIdsByRef, compiled.actionIdsByRef);
      for (const { goal, plan, action } of compiled.executions) {
        if (goal.kind === 'new')
          proposal.goals.push({
            id: goal.id,
            summary: goal.summary,
            sourceIds: goal.sourceIds,
            status: 'active',
            resultIds: [],
          });
        proposal.actions.push({ ...action, goalId: goal.id, status: 'proposed' });
        proposal.plans.push({
          ...plan,
          goalId: goal.id,
          status: 'active',
          actionIds: [action.id],
          nextActionId: action.id,
          triggers: [],
          missingConditions: [],
        });
      }
    }
  }
  return { proposal, actionIdsByRef };
}
