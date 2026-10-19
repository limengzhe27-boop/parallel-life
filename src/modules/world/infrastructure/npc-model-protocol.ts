import { canHandleExternalResponsibility } from '../domain/capability-responsibility-policy.ts';
import { z } from 'zod';
import {
  npcSourceReferences,
  mapNpcSourceFields,
  npcSourceReferenceSchema,
} from './npc-source-reference.ts';
import { NativePlanIntentsSchema, compileNpcPlanIntents } from './npc-plan-intent.ts';
import { isOwnAgendaReviewInput } from '../domain/own-agenda-review.ts';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { AgentProposalSchema } from './agent-proposal-schema.ts';
import type { ModelOutputOptions } from '../../ai/application/ports.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import {
  interpretCurrentPlayerInput,
  type AgentValidationContext,
} from '../domain/agent-kernel.ts';
import { playerReplyTargets } from '../domain/agent-input-interpretation.ts';
import { NativeExecutionIntentSchema, compileNpcExecutionIntents } from './npc-execution-intent.ts';
import { validPlayerEpisodeManifest } from '../domain/player-episode-manifest.ts';
import { isActorEpisodeConsiderationInput } from '../domain/actor-episode-intent.ts';
import {
  NativeMediaIntentSchema,
  compileNpcMediaIntent,
  NPC_MEDIA_CURRENT_REF,
} from './npc-media-intent.ts';

export const NPC_WIRE_PROTOCOL = 'npc-wire-v14';
const PREVIOUS_NOOP_GOAL_PROTOCOL = 'npc-wire-v13';
const PREVIOUS_CONTINUATION_PROTOCOL = 'npc-wire-v12';
const PREVIOUS_GOAL_SOURCE_PROTOCOL = 'npc-wire-v11';
const PREVIOUS_EXECUTION_PROVENANCE_PROTOCOL = 'npc-wire-v10';
const PREVIOUS_FOCUS_PROTOCOL = 'npc-wire-v9';
const PREVIOUS_SOURCE_PROTOCOL = 'npc-wire-v8';
const PREVIOUS_REVIEW_PROTOCOL = 'npc-wire-v7';
const PREVIOUS_PLAN_PROTOCOL = 'npc-wire-v6';
const PREVIOUS_INTERPRETATION_PROTOCOL = 'npc-wire-v5';
const PREVIOUS_SINGLE_ACTION_PROTOCOL = 'npc-wire-v4';
const PREVIOUS_EXECUTION_PROTOCOL = 'npc-wire-v3';
const PREVIOUS_NATIVE_PROTOCOL = 'npc-wire-v2';
const LEGACY_NPC_WIRE_PROTOCOL = 'npc-wire-v1';
const Id = z.string().min(1).max(240);
const Text = z.string().trim().min(1).max(12000);
const Conditions = z.array(z.unknown()).max(16);
const NextStep = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('action'), actionId: Id }),
  z.strictObject({
    kind: z.literal('reconsider'),
    conditions: Conditions.min(1),
    missing: z.array(Text).max(16),
  }),
  z.strictObject({
    kind: z.literal('wait'),
    conditions: Conditions,
    missing: z.array(Text).min(1).max(16),
  }),
  z.strictObject({ kind: z.literal('blocked'), missing: z.array(Text).min(1).max(16) }),
  z.strictObject({
    kind: z.literal('closed'),
    status: z.enum(['finished', 'withdrawn']),
    reason: Text,
  }),
]);
const Execution = z.strictObject({
  goal: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('existing'), id: Id }),
    z.strictObject({
      kind: z.literal('new'),
      id: Id,
      summary: Text,
      sourceIds: z.array(Id).min(1).max(64),
    }),
  ]),
  plan: z.strictObject({
    id: Id,
    summary: Text,
    sourceIds: z.array(Id).min(1).max(64),
    supersedesPlanId: Id.optional(),
  }),
  action: z.strictObject({
    id: Id,
    capability: Id,
    targetIds: z.array(Id).max(64),
    parameters: z.record(
      z.string(),
      z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(z.string())]),
    ),
    preconditions: Conditions,
    dependsOnActionIds: z.array(Id).max(16),
    handlesResponsibilityIds: z.array(Id).max(32),
    sourceIds: z.array(Id).min(1).max(64),
  }),
});
const MediaDecision = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('not_requested'), execution: z.null() }),
  z.strictObject({ kind: z.literal('decline'), execution: z.null() }),
  z.strictObject({ kind: z.literal('generate_image'), execution: Execution }),
  z.strictObject({ kind: z.literal('generate_video'), execution: Execution }),
  z.strictObject({ kind: z.literal('share_existing'), execution: Execution }),
]);
const Wire = z.strictObject({
  protocol: z.enum([
    LEGACY_NPC_WIRE_PROTOCOL,
    PREVIOUS_NATIVE_PROTOCOL,
    PREVIOUS_EXECUTION_PROTOCOL,
    PREVIOUS_SINGLE_ACTION_PROTOCOL,
    PREVIOUS_INTERPRETATION_PROTOCOL,
    PREVIOUS_PLAN_PROTOCOL,
    PREVIOUS_REVIEW_PROTOCOL,
    PREVIOUS_SOURCE_PROTOCOL,
    PREVIOUS_FOCUS_PROTOCOL,
    PREVIOUS_EXECUTION_PROVENANCE_PROTOCOL,
    PREVIOUS_GOAL_SOURCE_PROTOCOL,
    PREVIOUS_CONTINUATION_PROTOCOL,
    PREVIOUS_NOOP_GOAL_PROTOCOL,
    NPC_WIRE_PROTOCOL,
  ]),
  consideration: z
    .strictObject({
      choice: z.enum(['engage', 'decline', 'defer', 'need_information', 'quiet']),
      reason: Text.max(2000),
      basisSourceIds: z.array(Id).max(63),
      followUp: z
        .strictObject({
          waitingOn: z.enum(['player', 'self', 'world']).nullable(),
          missing: z.array(Text.max(2000)).min(1).max(8),
        })
        .optional(),
    })
    .nullable(),
  /** Absent only when replaying older protected model responses. */
  mediaDecision: MediaDecision.optional(),
  executions: z.array(Execution).max(16).optional(),
  statements: z.array(z.unknown()).max(32),
  goals: z.array(z.unknown()).max(24),
  plans: z
    .array(
      z.strictObject({
        id: Id,
        goalId: Id,
        summary: Text,
        sourceIds: z.array(Id).min(1).max(64),
        nextStep: NextStep,
        supersedesPlanId: Id.optional(),
      }),
    )
    .max(24),
  actions: z.array(z.unknown()).max(16),
  responsibilities: z.array(z.unknown()).max(32),
  decisions: z.array(z.unknown()).max(32),
  focus: z.unknown().optional(),
  replyAssessments: z.unknown().optional(),
  questionWithdrawals: z.unknown().optional(),
  locationReports: z.unknown().optional(),
});

const ParameterEntries = z
  .array(
    z.strictObject({
      name: Id,
      value: z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(z.string())]),
    }),
  )
  .max(32);
// The model and decoder reuse canonical proposal shapes; only transport references/parameters differ.
const PreviousModelWire = Wire.omit({ mediaDecision: true, actions: true }).extend({
  protocol: z.literal(PREVIOUS_SINGLE_ACTION_PROTOCOL),
  statements: AgentProposalSchema.shape.statements,
  goals: z
    .array(
      AgentProposalSchema.shape.goals.element.omit({ resultIds: true }).extend({
        status: z.enum(['active', 'deferred', 'withdrawn']),
      }),
    )
    .max(24),
  plans: z
    .array(
      Wire.shape.plans.element.extend({
        nextStep: z.union([
          NextStep.options[1].extend({
            conditions: AgentProposalSchema.shape.plans.element.shape.triggers,
          }),
          NextStep.options[2].extend({
            conditions: AgentProposalSchema.shape.plans.element.shape.triggers,
          }),
          NextStep.options[3],
          NextStep.options[4],
        ]),
      }),
    )
    .max(24),
  responsibilities: z
    .array(
      AgentProposalSchema.shape.responsibilities.element.omit({ resolutionResultId: true }).extend({
        status: z.enum(['open', 'waiting', 'deferred', 'withdrawn', 'expired']),
      }),
    )
    .max(32),
  decisions: AgentProposalSchema.shape.decisions,
  focus: AgentProposalSchema.shape.focus,
  replyAssessments: AgentProposalSchema.shape.replyAssessments,
  questionWithdrawals: AgentProposalSchema.shape.questionWithdrawals,
  locationReports: AgentProposalSchema.shape.locationReports,
  executions: z
    .array(
      NativeExecutionIntentSchema.extend({
        // Local transport names are not persisted action IDs or reserved namespaces.
        ref: z.enum([
          'action_1',
          'action_2',
          'action_3',
          'action_4',
          'action_5',
          'action_6',
          'action_7',
          'action_8',
          'action_9',
          'action_10',
          'action_11',
          'action_12',
          'action_13',
          'action_14',
          'action_15',
          'action_16',
        ]),
      }),
    )
    .max(1)
    .optional(),
});
const InputReply = z.strictObject({
  questionId: Id.nullable(),
  questionSourceId: Id.nullable(),
  responsibilityId: Id.nullable(),
  responsibilityRevision: z.number().int().nonnegative().nullable(),
  relation: z.enum(['answer', 'decline_to_answer', 'defer_answer']),
  decision: z.enum(['accepted', 'declined', 'negotiating', 'deferred', 'undecided']).nullable(),
});
const Interpretation = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['new_request', 'topic_change', 'uncertain']),
    sourceId: Id,
    quote: Text.max(1000),
  }),
  z.strictObject({
    kind: z.literal('related_reply'),
    sourceId: Id,
    quote: Text.max(1000),
    replies: z.array(InputReply).min(1).max(16),
  }),
]);
const PreviousInterpretationWire = PreviousModelWire.omit({
  decisions: true,
  replyAssessments: true,
}).extend({
  protocol: z.literal(PREVIOUS_INTERPRETATION_PROTOCOL),
  inputInterpretation: Interpretation.nullable(),
});
const PreviousPlanWire = PreviousInterpretationWire.omit({ plans: true }).extend({
  protocol: z.literal(PREVIOUS_PLAN_PROTOCOL),
  planIntents: NativePlanIntentsSchema,
});
const AgendaReview = z.strictObject({
  decision: z.enum(['quiet', 'update_plan', 'contact']),
  reason: Text.max(2000),
  basisSourceIds: z.array(Id).min(1).max(64),
});
const PreviousReviewWire = PreviousPlanWire.extend({
  protocol: z.literal(PREVIOUS_REVIEW_PROTOCOL),
  agendaReview: AgendaReview.nullable(),
});
const PreviousSourceWire = PreviousReviewWire.extend({
  protocol: z.literal(PREVIOUS_SOURCE_PROTOCOL),
});
const FocusChange = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('keep') }),
  z.strictObject({ kind: z.literal('clear') }),
  z.strictObject({
    kind: z.literal('set'),
    value: AgentProposalSchema.shape.focus.unwrap().unwrap(),
  }),
]);
const PreviousFocusWire = PreviousSourceWire.omit({ focus: true }).extend({
  protocol: z.literal(PREVIOUS_FOCUS_PROTOCOL),
  focusChange: FocusChange,
});
const PreviousExecutionProvenanceWire = PreviousFocusWire.extend({
  protocol: z.literal(PREVIOUS_EXECUTION_PROVENANCE_PROTOCOL),
});
const ModelWire = PreviousExecutionProvenanceWire.extend({
  protocol: z.literal(NPC_WIRE_PROTOCOL),
  continuation: AgentProposalSchema.shape.continuation.unwrap(),
});
const RescheduleParameters = z.strictObject({
  appointmentId: Id,
  at: z.iso.datetime({ offset: true }),
  placeId: Id.nullable(),
  reason: Text.max(2000).nullable(),
});
function visibleAppointmentIds(
  state: Partial<Pick<ActorAgentState, 'responsibilities'>>,
  sources: readonly { id: string }[],
): string[] {
  return [
    ...new Set([
      ...(state.responsibilities ?? [])
        .filter(
          (r) =>
            r.subject.kind === 'appointment' &&
            !['withdrawn', 'expired', 'fulfilled'].includes(r.status),
        )
        .map((r) => r.subject.id),
      ...sources
        .filter((s) => s.id.startsWith('appointment:'))
        .map((s) => s.id.slice('appointment:'.length)),
    ]),
  ]
    .filter(Boolean)
    .sort();
}
/** Strict providers require optional fields to be represented by null, not omitted. */
function strictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictSchema);
  if (!value || typeof value !== 'object') return value;
  const original = value as Record<string, unknown>;
  const out = Object.fromEntries(
    Object.entries(original).map(([key, item]) => [key, strictSchema(item)]),
  );
  if (Array.isArray(out.oneOf)) {
    out.anyOf = out.oneOf;
    delete out.oneOf;
  }
  if (
    typeof original.type === 'string' ||
    Array.isArray(original.anyOf) ||
    Array.isArray(original.oneOf)
  ) {
    // Provider grammar owns shape; the original validator still owns all bounds and ISO semantics.
    for (const key of [
      '$schema',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'format',
      'pattern',
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'multipleOf',
    ])
      delete out[key];
    if ('const' in out) {
      out.enum = [out.const];
      delete out.const;
    }
  }
  if (original.type === 'object') {
    const props = (out.properties ?? {}) as Record<string, unknown>;
    const required = new Set((original.required ?? []) as string[]);
    for (const key of Object.keys(props))
      if (!required.has(key)) props[key] = { anyOf: [props[key], { type: 'null' }] };
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}
export const NPC_RESPONSE_FORMAT: ModelOutputOptions = {
  format: 'json_schema',
  name: 'npc_agent_response',
  strict: true,
  schema: strictSchema(z.toJSONSchema(ModelWire)) as Record<string, unknown>,
};
/** Existing-goal references are actor-visible state, not unconstrained model-created identifiers. */
export function npcResponseFormat(
  state: Pick<AgentValidationContext['state'], 'goals' | 'questions'> &
    Partial<
      Pick<
        AgentValidationContext['state'],
        'actions' | 'plans' | 'responsibilities' | 'focus' | 'worldId' | 'actorId'
      >
    >,
  considerationScope: 'required' | 'optional' | 'forbidden' = 'optional',
  current?: Pick<AgentValidationContext, 'input' | 'channel'> &
    Partial<Pick<AgentValidationContext, 'sources'>>,
): ModelOutputOptions {
  if (NPC_RESPONSE_FORMAT.format !== 'json_schema') throw Error('NPC_RESPONSE_SCHEMA');
  type SchemaNode = {
    properties?: Record<string, SchemaNode>;
    anyOf?: SchemaNode[];
    items?: SchemaNode;
    enum?: unknown[];
    [key: string]: unknown;
  };
  const schema = structuredClone(NPC_RESPONSE_FORMAT.schema) as SchemaNode;
  const properties = schema.properties!;
  if (considerationScope === 'forbidden') properties.consideration = { type: 'null' };
  else if (considerationScope === 'required') {
    const object = properties.consideration!.anyOf!.find((x) => x.type === 'object');
    if (!object) throw Error('NPC_RESPONSE_SCHEMA');
    properties.consideration = object;
  }
  const reviewScope = !!current && isOwnAgendaReviewInput(current.input);
  const review = properties.agendaReview!;
  properties.agendaReview = reviewScope
    ? review.anyOf!.find((node) => node.type === 'object')!
    : { type: 'null' };
  const goalIds = state.goals.filter((goal) => goal.status === 'active').map((g) => g.id);
  const scopeGoal = (execution: SchemaNode, allowedIds = goalIds) => {
    const alternatives = execution.properties?.goal?.anyOf;
    if (!alternatives) throw Error('NPC_RESPONSE_SCHEMA');
    const usable = alternatives.filter((g) => {
      if (g.properties!.kind!.enum?.[0] !== 'existing') return true;
      if (!allowedIds.length) return false;
      g.properties!.id!.enum = allowedIds;
      return true;
    });
    const first = usable[0];
    if (!first) throw Error('NPC_RESPONSE_SCHEMA');
    execution.properties!.goal = usable.length === 1 ? first : { anyOf: usable };
  };
  const editableGoals = state.goals
    .filter((g) => !['fulfilled', 'withdrawn'].includes(g.status))
    .map((g) => g.id);
  if (editableGoals.length) {
    properties.goals!.items!.properties!.id!.enum = editableGoals;
    properties.goals = { anyOf: [properties.goals!, { type: 'null' }] };
  } else properties.goals = { type: 'null' };
  const planVariants = properties.planIntents!.items!.anyOf!;
  const validPlans = (state.plans ?? []).filter(
    (p) =>
      editableGoals.includes(p.goalId) &&
      !['finished', 'withdrawn'].includes(p.status) &&
      p.actionIds.every((id) =>
        state.actions?.some(
          (a) => a.id === id && a.goalId === p.goalId && a.status !== 'executing',
        ),
      ),
  );
  const safeUpdates = validPlans.filter((p) =>
    p.actionIds.every((id) =>
      state.actions?.some(
        (a) => a.id === id && ['succeeded', 'failed', 'withdrawn'].includes(a.status),
      ),
    ),
  );
  const nextStep = planVariants.find((p) => p.properties!.kind!.enum?.[0] === 'create')!.properties!
    .nextStep!;
  for (const choice of nextStep.anyOf ?? []) {
    const kind = choice.properties?.kind?.enum?.[0];
    if ((kind === 'wait' || kind === 'blocked') && choice.properties?.missing)
      choice.properties.missing.minItems = 1;
    if (kind === 'reconsider' && choice.properties?.conditions)
      choice.properties.conditions.minItems = 1;
  }
  schema.$defs = {
    ...((schema.$defs ?? {}) as Record<string, unknown>),
    npc_plan_next_step: nextStep,
  };
  properties.planIntents!.items = {
    anyOf: planVariants.filter((p) => {
      const kind = p.properties!.kind!.enum?.[0];
      if (p.properties!.nextStep) p.properties!.nextStep = { $ref: '#/$defs/npc_plan_next_step' };
      if (kind === 'create') {
        scopeGoal(p, editableGoals);
        return true;
      }
      const ids = (kind === 'replace' ? validPlans : safeUpdates).map((p) => p.id);
      if (!ids.length) return false;
      p.properties!.planId!.enum = ids;
      return true;
    }),
  };
  const executions = properties.executions!;
  const executionItem = (executions.anyOf?.[0] ?? executions).items!;
  scopeGoal(executionItem);
  const replaceablePlanIds = (state.plans ?? [])
    .filter(
      (plan) =>
        goalIds.includes(plan.goalId) &&
        !['finished', 'withdrawn'].includes(plan.status) &&
        !plan.actionIds.some((id) =>
          state.actions?.some((a) => a.id === id && a.status === 'executing'),
        ),
    )
    .map((plan) => plan.id);
  const supersedes = executionItem.properties!.plan!.properties!;
  if (replaceablePlanIds.length)
    supersedes.supersedesPlanId!.anyOf!.find((node) => node.type === 'string')!.enum =
      replaceablePlanIds;
  else supersedes.supersedesPlanId = { type: 'null' };
  if (current) {
    const capabilities = current.channel.allowedCapabilities.filter(
      (cap) => cap !== 'media.share' && cap !== 'plan.record',
    );
    if (capabilities.length) {
      const action = executionItem.properties!.action!;
      const genericCapabilities = capabilities.filter((cap) => cap !== 'appointment.reschedule');
      const handling = genericCapabilities.filter(canHandleExternalResponsibility);
      const nonHandling = genericCapabilities.filter(
        (cap) => !canHandleExternalResponsibility(cap),
      );
      const choices = [handling, nonHandling]
        .filter((caps) => caps.length)
        .map((caps) => {
          const choice = structuredClone(action);
          choice.properties!.capability!.enum = caps;
          // The same capability contract guards actual kernel execution.
          // Proposing an invitation or enqueueing media does not resolve a request.
          if (!canHandleExternalResponsibility(caps[0]!))
            choice.properties!.handlesResponsibilityIds!.maxItems = 0;
          return choice;
        });
      const appointmentIds = visibleAppointmentIds(state, current.sources ?? []);
      if (capabilities.includes('appointment.reschedule') && appointmentIds.length) {
        const choice = structuredClone(action);
        choice.properties!.capability = { type: 'string', enum: ['appointment.reschedule'] };
        choice.properties!.parameters = {
          type: 'object',
          properties: {
            appointmentId: { type: 'string', enum: appointmentIds },
            at: { type: 'string', minLength: 1 },
            placeId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['appointmentId', 'at', 'placeId', 'reason'],
          additionalProperties: false,
        };
        choices.push(choice);
      }
      if (!choices.length) properties.executions = { type: 'null' };
      else
        executionItem.properties!.action = choices.length === 1 ? choices[0]! : { anyOf: choices };
    } else properties.executions = { type: 'null' };
  }
  if (replaceablePlanIds.length && properties.executions?.type !== 'null') {
    // Couple goal and replacement choices in the native grammar. A new goal
    // cannot replace another goal's plan; the kernel remains authoritative.
    const goal = executionItem.properties!.goal!;
    const alternatives = goal.anyOf ?? [goal];
    const fresh = alternatives.find((g) => g.properties!.kind!.enum?.[0] === 'new');
    const existing = alternatives.find((g) => g.properties!.kind!.enum?.[0] === 'existing');
    // Reuse the common action grammar rather than multiplying its conditions
    // for every visible goal. This stays inside the provider's schema budget.
    const definitions = (schema.$defs ?? {}) as Record<string, SchemaNode>;
    definitions.npc_execution_action = executionItem.properties!.action!;
    schema.$defs = definitions;
    executionItem.properties!.action = { $ref: '#/$defs/npc_execution_action' };
    const branches: SchemaNode[] = [];
    for (const goalId of [null, ...goalIds]) {
      const selected = goalId === null ? fresh : existing;
      if (!selected) continue;
      const branch = structuredClone(executionItem);
      branch.properties!.goal = structuredClone(selected);
      if (goalId !== null) branch.properties!.goal.properties!.id!.enum = [goalId];
      const ids =
        goalId === null
          ? []
          : (state.plans ?? [])
              .filter((p) => p.goalId === goalId && replaceablePlanIds.includes(p.id))
              .map((p) => p.id);
      branch.properties!.plan!.properties!.supersedesPlanId = ids.length
        ? { anyOf: [{ type: 'string', enum: ids }, { type: 'null' }] }
        : { type: 'null' };
      branches.push(branch);
    }
    (executions.anyOf?.[0] ?? executions).items = { anyOf: branches };
  }
  if (current) {
    const node = properties.locationReports!;
    const array = node.type === 'array' ? node : node.anyOf?.find((x) => x.type === 'array');
    if (!array?.items?.properties) throw Error('NPC_RESPONSE_SCHEMA');
    if (current.input.origin !== 'player') {
      properties.locationReports = { type: 'null' };
      properties.inputInterpretation = { type: 'null' };
    } else {
      array.items.properties.sourceId!.enum = [current.input.sourceId];
      if (current.input.text.trim().length <= 500)
        array.items.properties.quote!.enum = [current.input.text.trim()];
      properties.locationReports = array;
      const alternatives = (node: SchemaNode): SchemaNode[] =>
        node.properties ? [node] : (node.anyOf ?? []).flatMap(alternatives);
      const interpretation = alternatives(properties.inputInterpretation!);
      const branches: SchemaNode[] = [];
      for (const option of interpretation) {
        option.properties!.sourceId = { type: 'string', enum: [current.input.sourceId] };
        if (current.input.text.trim().length <= 1000)
          option.properties!.quote = { type: 'string', enum: [current.input.text.trim()] };
        if (option.properties!.kind!.enum?.includes('related_reply')) {
          const targets = playerReplyTargets({
            state: {
              ...state,
              responsibilities: state.responsibilities ?? [],
              focus: state.focus ?? null,
            },
            ...current,
          });
          if (!targets.length) continue;
          const item = option.properties!.replies!.items!;
          option.properties!.replies!.items = {
            anyOf: targets.map((target) => {
              const branch = structuredClone(item);
              for (const [key, value] of Object.entries(target))
                branch.properties![key] =
                  value === null
                    ? { type: 'null' }
                    : { type: typeof value === 'number' ? 'integer' : 'string', enum: [value] };
              if (!target.responsibilityId) branch.properties!.decision = { type: 'null' };
              return branch;
            }),
          };
        }
        branches.push(option);
      }
      properties.inputInterpretation = { anyOf: branches };
    }
  }
  if (current) {
    // Source handles come from this authorized snapshot, never guessed aliases.
    // Share the enum once to avoid multiplying the provider schema budget.
    const ids = [...new Set([current.input.sourceId, ...(current.sources ?? []).map((s) => s.id)])];
    const scopeBasis = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(scopeBasis);
        return;
      }
      const node = value as SchemaNode;
      if (node.properties?.sourceIds)
        node.properties.sourceIds = { $ref: '#/$defs/npc_authorized_basis' };
      Object.values(node).forEach(scopeBasis);
    };
    scopeBasis(schema);
    schema.$defs = {
      ...((schema.$defs ?? {}) as Record<string, unknown>),
      npc_authorized_basis: {
        type: 'array',
        minItems: 1,
        maxItems: 64,
        items: { type: 'string', enum: ids },
      },
    };
  }
  return {
    ...NPC_RESPONSE_FORMAT,
    schema: npcSourceReferenceSchema(
      schema as Record<string, unknown>,
      npcSourceReferences(current?.sources ?? []),
    ),
  };
}

const optionalNullKeys = new Set([
  'followUp',
  'executions',
  'supersedesPlanId',
  'endReason',
  'resolutionResultId',
  'resultId',
  'deadline',
  'requestsPlayerReply',
  'questionForResponsibilityId',
  'replyAssessments',
  'questionWithdrawals',
  'locationReports',
]);
function parameterObject(value: unknown) {
  if (!Array.isArray(value)) return value;
  const entries = ParameterEntries.parse(value);
  if (
    new Set(entries.map((e) => e.name)).size !== entries.length ||
    entries.some((e) => ['__proto__', 'prototype', 'constructor'].includes(e.name))
  )
    throw Error('NPC_PARAMETER_KEYS');
  return Object.fromEntries(entries.map((e) => [e.name, e.value]));
}
/** Null optional metadata and named parameter entries are transport details, never semantic repairs. */
function transport(value: unknown, convertParameters = true): unknown {
  if (Array.isArray(value)) return value.map((entry) => transport(entry, convertParameters));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k, v]) => !(v === null && optionalNullKeys.has(k)))
      .map(([k, v]) => [
        k,
        k === 'parameters' && convertParameters
          ? parameterObject(v)
          : transport(v, convertParameters),
      ]),
  );
}

/** Transport binding only. Every result still passes the original proposal schema and kernel validation. */
export function decodeNpcWire(context: AgentValidationContext, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  if ('protocol' in raw && raw.protocol === NPC_WIRE_PROTOCOL) {
    const transformed = structuredClone(raw) as Record<string, unknown>;
    const mapped = mapNpcSourceFields(
      raw,
      npcSourceReferences(context.sources),
      'decode',
    ) as Record<string, unknown>;
    const intents = NativePlanIntentsSchema.parse(transport(mapped.planIntents ?? [], false));
    const touched = new Set(
      intents.flatMap((intent) => ('planId' in intent ? [intent.planId] : [])),
    );
    const available = visibleAppointmentIds(context.viewState ?? context.state, context.sources);
    if (Array.isArray(transformed.executions))
      for (const item of transformed.executions) {
        if (!item || typeof item !== 'object') continue;
        const execution = item as {
          plan?: { supersedesPlanId?: unknown };
          action?: { capability?: unknown; parameters?: unknown };
        };
        const supersedes = execution.plan?.supersedesPlanId;
        if (typeof supersedes === 'string' && touched.has(supersedes))
          throw Error('NPC_V14_DUPLICATE_PLAN_REPLACEMENT');
        if (execution.action?.capability === 'appointment.reschedule') {
          const parameters = RescheduleParameters.parse(execution.action.parameters);
          if (!available.includes(parameters.appointmentId))
            throw Error('NPC_V14_APPOINTMENT_SCOPE');
          execution.action.parameters = Object.entries(parameters).flatMap(([name, value]) =>
            value === null ? [] : [{ name, value }],
          );
        }
      }
    return decodeNpcWire(context, { ...transformed, protocol: PREVIOUS_NOOP_GOAL_PROTOCOL });
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_NOOP_GOAL_PROTOCOL) {
    const catalog = npcSourceReferences(context.sources);
    const mapped = mapNpcSourceFields(raw, catalog, 'decode') as Record<string, unknown>;
    const goals = PreviousModelWire.shape.goals.parse(transport(mapped.goals ?? [], false));
    const current = context.sources.filter((source) => source.id === context.input.sourceId);
    if (current.length !== 1 || current[0]!.kind !== 'accepted_input')
      throw Error('NPC_V13_INPUT_SOURCE');
    if (new Set(goals.map((goal) => goal.id)).size !== goals.length)
      throw Error('NPC_V13_GOAL_UPDATE_DUPLICATE');
    const visible =
      context.viewState?.goals.filter(
        (goal) => !['fulfilled', 'withdrawn'].includes(goal.status),
      ) ?? [];
    const changed = goals.filter((goal) => {
      const previous = visible.find((existing) => existing.id === goal.id);
      if (!previous) throw Error('NPC_V13_GOAL_UPDATE_SCOPE');
      if (
        new Set(goal.sourceIds).size !== goal.sourceIds.length ||
        goal.sourceIds.some(
          (id) => context.sources.filter((source) => source.id === id).length !== 1,
        )
      )
        throw Error('NPC_V13_DECLARED_SOURCE');
      // Exact no-op echoes do not create a goal update or receive artificial provenance.
      // Real source additions/removals and semantic changes still use all prior checks.
      const sameSources =
        goal.sourceIds.length === previous.sourceIds.length &&
        goal.sourceIds.every((id) => previous.sourceIds.includes(id));
      const sameSemantics =
        goal.summary === previous.summary &&
        goal.status === previous.status &&
        goal.endReason === previous.endReason &&
        previous.resultIds.length === 0;
      return !(sameSources && sameSemantics);
    });
    return decodeNpcWire(context, {
      ...(mapNpcSourceFields({ ...mapped, goals: changed }, catalog, 'encode') as object),
      protocol: PREVIOUS_CONTINUATION_PROTOCOL,
    });
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_CONTINUATION_PROTOCOL) {
    const catalog = npcSourceReferences(context.sources);
    const mapped = mapNpcSourceFields(raw, catalog, 'decode') as Record<string, unknown>;
    const continuation = AgentProposalSchema.shape.continuation.unwrap().parse(mapped.continuation);
    const { continuation: ignored, ...previous } = raw as Record<string, unknown>;
    void ignored;
    const decoded = decodeNpcWire(context, {
      ...previous,
      protocol: PREVIOUS_GOAL_SOURCE_PROTOCOL,
    });
    return { ...(decoded as object), continuation };
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_GOAL_SOURCE_PROTOCOL) {
    const catalog = npcSourceReferences(context.sources);
    const mapped = mapNpcSourceFields(raw, catalog, 'decode') as Record<string, unknown>;
    const currentSource = context.sources.filter((source) => source.id === context.input.sourceId);
    if (currentSource.length !== 1 || currentSource[0]!.kind !== 'accepted_input')
      throw Error('NPC_V11_INPUT_SOURCE');
    const goals = PreviousModelWire.shape.goals.parse(transport(mapped.goals ?? [], false));
    const visibleGoals =
      context.viewState?.goals.filter(
        (goal) => !['fulfilled', 'withdrawn'].includes(goal.status),
      ) ?? [];
    if (new Set(goals.map((goal) => goal.id)).size !== goals.length)
      throw Error('NPC_V11_GOAL_UPDATE_DUPLICATE');
    const bound = goals.map((goal) => {
      // Only a proposed update to an exact visible, nonterminal existing goal.
      // This cannot create, reveal, resurrect, complete or retarget a goal.
      if (!visibleGoals.some((existing) => existing.id === goal.id))
        throw Error('NPC_V11_GOAL_UPDATE_SCOPE');
      if (
        new Set(goal.sourceIds).size !== goal.sourceIds.length ||
        goal.sourceIds.some(
          (id) => context.sources.filter((source) => source.id === id).length !== 1,
        )
      )
        throw Error('NPC_V11_DECLARED_SOURCE');
      return {
        ...goal,
        sourceIds: goal.sourceIds.includes(context.input.sourceId)
          ? [...goal.sourceIds]
          : [...goal.sourceIds, context.input.sourceId],
      };
    });
    return decodeNpcWire(context, {
      ...(mapNpcSourceFields({ ...mapped, goals: bound }, catalog, 'encode') as object),
      protocol: PREVIOUS_EXECUTION_PROVENANCE_PROTOCOL,
    });
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_EXECUTION_PROVENANCE_PROTOCOL) {
    // v10 adds accepted-input provenance, never a guessed semantic basis. Decode
    // every declared source first so unknown or corrupt references still reject.
    const catalog = npcSourceReferences(context.sources);
    const mapped = mapNpcSourceFields(raw, catalog, 'decode') as Record<string, unknown>;
    const currentSource = context.sources.filter((source) => source.id === context.input.sourceId);
    if (currentSource.length !== 1 || currentSource[0]!.kind !== 'accepted_input')
      throw Error('NPC_V10_INPUT_SOURCE');
    const bindBasis = (ids: string[]) => {
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => context.sources.filter((source) => source.id === id).length !== 1)
      )
        throw Error('NPC_V10_DECLARED_SOURCE');
      return ids.includes(context.input.sourceId) ? [...ids] : [...ids, context.input.sourceId];
    };
    const intents = z
      .array(NativeExecutionIntentSchema)
      .max(1)
      .parse(transport(mapped.executions ?? [], false));
    const executions = intents.map((intent) => ({
      ...intent,
      goal:
        intent.goal.kind === 'new'
          ? { ...intent.goal, sourceIds: bindBasis(intent.goal.sourceIds) }
          : intent.goal,
      plan: { ...intent.plan, sourceIds: bindBasis(intent.plan.sourceIds) },
      action: { ...intent.action, sourceIds: bindBasis(intent.action.sourceIds) },
    }));
    // Round-trip only authenticated structural references into the fixed v9
    // decoder; all capability, dependency and kernel checks stay authoritative.
    return decodeNpcWire(context, {
      ...(mapNpcSourceFields({ ...mapped, executions }, catalog, 'encode') as object),
      protocol: PREVIOUS_FOCUS_PROTOCOL,
    });
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_FOCUS_PROTOCOL) {
    if ('focus' in raw) throw Error('NPC_V9_FOCUS_CHANGE_ONLY');
    const { focusChange, ...rest } = raw as Record<string, unknown>;
    const choice = FocusChange.parse(focusChange);
    return decodeNpcWire(context, {
      ...rest,
      protocol: PREVIOUS_SOURCE_PROTOCOL,
      ...(choice.kind === 'clear'
        ? { focus: null }
        : choice.kind === 'set'
          ? { focus: choice.value }
          : {}),
    });
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_SOURCE_PROTOCOL) {
    const mapped = mapNpcSourceFields(
      raw,
      npcSourceReferences(context.sources),
      'decode',
    ) as Record<string, unknown>;
    return decodeNpcWire(context, {
      ...mapped,
      ...(mapped.goals === null ? { goals: [] } : {}),
      protocol: PREVIOUS_REVIEW_PROTOCOL,
    });
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_REVIEW_PROTOCOL) {
    const value = transport(raw, false) as Record<string, unknown>;
    const visibleGoals =
      context.viewState?.goals.filter((g) => !['fulfilled', 'withdrawn'].includes(g.status)) ?? [];
    if (value.goals === null && !visibleGoals.length) value.goals = [];
    const { agendaReview, ...native } = PreviousReviewWire.parse(value);
    const currentSource = context.sources.filter((s) => s.id === context.input.sourceId);
    if (currentSource.length !== 1) throw Error('NPC_V7_INPUT_SOURCE');
    const bindBasis = (ids: string[]) => {
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => context.sources.filter((s) => s.id === id).length !== 1)
      )
        throw Error('NPC_V7_DECLARED_SOURCE');
      return ids.includes(context.input.sourceId) ? [...ids] : [...ids, context.input.sourceId];
    };
    const intents = native.planIntents.map((intent) => ({
      ...intent,
      sourceIds: bindBasis(intent.sourceIds),
      ...(intent.kind === 'create' && intent.goal.kind === 'new'
        ? { goal: { ...intent.goal, sourceIds: bindBasis(intent.goal.sourceIds) } }
        : {}),
    }));
    const reviewScope = isOwnAgendaReviewInput(context.input);
    if (reviewScope !== (agendaReview !== null)) throw Error('NPC_AGENDA_REVIEW_SCOPE');
    if (agendaReview) bindBasis(agendaReview.basisSourceIds);
    const proposal = AgentProposalSchema.parse(
      decodeNpcWire(context, { ...native, protocol: PREVIOUS_PLAN_PROTOCOL, planIntents: intents }),
    );
    if (agendaReview) {
      const semantic = (value: unknown, ignoreProvenance = false) => {
        if (!value || typeof value !== 'object') return value;
        const { revision: _serverRevision, ...body } = value as Record<string, unknown>;
        if (ignoreProvenance) delete body.sourceIds;
        return body;
      };
      const stateChanged = <T extends { id: string }>(
        proposed: T[],
        previous: T[],
        ignoreProvenance = false,
      ) =>
        proposed.some(
          (p) =>
            !isDeepStrictEqual(
              semantic(p, ignoreProvenance),
              semantic(
                previous.find((old) => old.id === p.id),
                ignoreProvenance,
              ),
            ),
        );
      const agendaChanged =
        stateChanged(proposal.goals, context.state.goals) ||
        stateChanged(proposal.plans, context.state.plans) ||
        stateChanged(proposal.responsibilities, context.state.responsibilities);
      const otherChanged =
        stateChanged(proposal.actions, context.state.actions) ||
        stateChanged(proposal.decisions, context.state.decisions) ||
        !!proposal.questionWithdrawals?.length ||
        (proposal.focus !== undefined && !isDeepStrictEqual(proposal.focus, context.state.focus));
      if (agendaReview.decision !== 'contact' && proposal.statements.length)
        throw Error('NPC_AGENDA_REVIEW_PRIVATE_REPORT');
      if (agendaReview.decision === 'contact' && !proposal.statements.length)
        throw Error('NPC_AGENDA_REVIEW_CONTACT_EMPTY');
      if (agendaReview.decision === 'quiet' && (agendaChanged || otherChanged))
        throw Error('NPC_AGENDA_REVIEW_QUIET_CHANGED');
      const substantiveAgendaChanged =
        stateChanged(proposal.goals, context.state.goals, true) ||
        stateChanged(proposal.plans, context.state.plans, true) ||
        stateChanged(proposal.responsibilities, context.state.responsibilities, true);
      if (agendaReview.decision === 'update_plan' && !substantiveAgendaChanged)
        throw Error('NPC_AGENDA_REVIEW_NO_AGENDA_CHANGE');
    }
    return proposal;
  }
  if ('protocol' in raw && raw.protocol === PREVIOUS_PLAN_PROTOCOL) {
    const value = transport(raw, false) as Record<string, unknown>;
    const visibleGoals =
      context.viewState?.goals.filter((g) => !['fulfilled', 'withdrawn'].includes(g.status)) ?? [];
    if (value.goals === null && visibleGoals.length === 0) value.goals = [];
    const { planIntents, ...native } = PreviousPlanWire.parse(value);
    const planChanges = compileNpcPlanIntents(context, planIntents);
    if (new Set(native.goals.map((g) => g.id)).size !== native.goals.length)
      throw Error('NPC_PLAN_GOAL_UPDATE_DUPLICATE');
    for (const goal of native.goals)
      if (
        !visibleGoals.some((g) => g.id === goal.id) ||
        !goal.sourceIds.includes(context.input.sourceId) ||
        new Set(goal.sourceIds).size !== goal.sourceIds.length ||
        goal.sourceIds.some((id) => context.sources.filter((s) => s.id === id).length !== 1)
      )
        throw Error('NPC_PLAN_GOAL_UPDATE_FORBIDDEN');
    const base = AgentProposalSchema.parse(
      decodeNpcWire(context, {
        ...native,
        protocol: PREVIOUS_INTERPRETATION_PROTOCOL,
        plans: [],
      }),
    );
    const executionGoalIds = new Set(base.plans.map((p) => p.goalId));
    const executionPlanIds = new Set(base.plans.map((p) => p.id));
    const replacements = new Set(
      base.plans.flatMap((p) => (p.supersedesPlanId ? [p.supersedesPlanId] : [])),
    );
    const generatedIds = new Set([...base.goals, ...base.plans, ...base.actions].map((p) => p.id));
    for (const plan of planChanges.plans) {
      if (
        executionGoalIds.has(plan.goalId) ||
        executionPlanIds.has(plan.id) ||
        replacements.has(plan.id) ||
        (plan.supersedesPlanId &&
          (replacements.has(plan.supersedesPlanId) || executionPlanIds.has(plan.supersedesPlanId)))
      )
        throw Error('NPC_PLAN_EXECUTION_CONFLICT');
      const goalUpdate = base.goals.find((g) => g.id === plan.goalId);
      if (
        goalUpdate &&
        ((goalUpdate.status === 'withdrawn' && !['finished', 'withdrawn'].includes(plan.status)) ||
          (goalUpdate.status !== 'active' && plan.status === 'active'))
      )
        throw Error('NPC_PLAN_GOAL_STATUS_CONFLICT');
    }
    if ([...planChanges.goals, ...planChanges.plans].some((p) => generatedIds.has(p.id)))
      throw Error('NPC_PLAN_OBJECT_CONFLICT');
    return AgentProposalSchema.parse({
      ...base,
      goals: [...base.goals, ...planChanges.goals],
      plans: [...base.plans, ...planChanges.plans],
    });
  }
  if (
    'protocol' in raw &&
    (raw.protocol === PREVIOUS_INTERPRETATION_PROTOCOL ||
      raw.protocol === PREVIOUS_SINGLE_ACTION_PROTOCOL)
  ) {
    // Native v4 has one action channel. No disposition flag competes with an
    // execution, and models cannot author completion receipts or terminal success.
    const nativeTransport = transport(raw, false) as Record<string, unknown>;
    // The scoped native grammar offers null when no player-decision items are
    // authorized. This is an empty transport collection, not a guessed decision.
    if (nativeTransport.decisions === null) nativeTransport.decisions = [];
    const current = raw.protocol === PREVIOUS_INTERPRETATION_PROTOCOL;
    const parsed = current
      ? PreviousInterpretationWire.parse(nativeTransport)
      : PreviousModelWire.parse(nativeTransport);
    let native: z.infer<typeof PreviousModelWire>;
    if (current) {
      const { inputInterpretation, ...body } = parsed as z.infer<typeof PreviousInterpretationWire>;
      const replies = interpretCurrentPlayerInput(context, inputInterpretation);
      native = {
        ...body,
        protocol: PREVIOUS_SINGLE_ACTION_PROTOCOL,
        decisions: replies
          .filter((r) => r.decision !== null)
          .map((r) => ({
            id: `decision:${createHash('sha256')
              .update(
                JSON.stringify([
                  'npc-player-decision-v1',
                  context.state.worldId,
                  context.state.actorId,
                  context.input.sourceId,
                  r.responsibilityId,
                  r.responsibilityRevision,
                ]),
              )
              .digest('hex')}`,
            responsibilityId: r.responsibilityId!,
            kind: r.decision!,
            sourceId: context.input.sourceId,
            quote: inputInterpretation!.quote,
          })),
        replyAssessments: replies
          .filter((r) => r.questionId !== null)
          .map((r) => ({
            questionId: r.questionId!,
            sourceId: context.input.sourceId,
            quote: inputInterpretation!.quote,
            relation: r.relation,
          })),
      };
    } else native = parsed as z.infer<typeof PreviousModelWire>;
    const compiled = compileNpcExecutionIntents(context, native.executions ?? [], {
      allowMedia: true,
    });
    const { protocol: _protocol, goals, statements, ...rest } = native;
    return decodeNpcWire(context, {
      ...rest,
      protocol: LEGACY_NPC_WIRE_PROTOCOL,
      executions: compiled.executions,
      actions: [],
      goals: goals.map((goal) => ({
        ...goal,
        resultIds: [
          ...((context.viewState ?? context.state).goals.find((old) => old.id === goal.id)
            ?.resultIds ?? []),
        ],
      })),
      statements: statements.map((statement) => ({
        ...statement,
        dependsOnActionIds: statement.dependsOnActionIds.map((id) => {
          const direct = compiled.actionIdsByRef[id];
          if (direct) {
            if (context.state.actions.some((action) => action.id === id))
              throw Error('NPC_EXECUTION_DEPENDENCY_AMBIGUOUS');
            return direct;
          }
          if (!id.startsWith('execution:')) return id;
          const bound = compiled.actionIdsByRef[id.slice('execution:'.length)];
          if (!bound) throw Error('NPC_EXECUTION_DEPENDENCY_WITHOUT_INTENT');
          return bound;
        }),
      })),
    });
  }
  // nextStep/executions are exclusive wire syntax, not canonical state fields.
  // Missing transport metadata never means a missing NPC choice is manufactured.
  const wirePlans =
    'plans' in raw &&
    Array.isArray(raw.plans) &&
    raw.plans.some((p) => p && typeof p === 'object' && 'nextStep' in p);
  if (
    !('protocol' in raw) &&
    !('consideration' in raw) &&
    !('mediaDecision' in raw) &&
    !('executions' in raw) &&
    !wirePlans
  )
    return raw;
  let normalized: unknown = raw;
  if (
    'protocol' in raw &&
    (raw.protocol === PREVIOUS_EXECUTION_PROTOCOL || raw.protocol === PREVIOUS_NATIVE_PROTOCOL)
  ) {
    const compact =
      raw.protocol === PREVIOUS_EXECUTION_PROTOCOL
        ? compileNpcExecutionIntents(context, 'executions' in raw ? (raw.executions ?? []) : [])
        : null;
    if (
      raw.protocol === PREVIOUS_EXECUTION_PROTOCOL &&
      'actions' in raw &&
      Array.isArray(raw.actions)
    ) {
      const mutable = new Set(
        (context.viewState?.actions ?? [])
          .filter((action) => !['succeeded', 'failed', 'withdrawn'].includes(action.status))
          .map((action) => action.id),
      );
      if (
        raw.actions.some(
          (action) =>
            !action ||
            typeof action !== 'object' ||
            !('id' in action) ||
            !mutable.has(String(action.id)) ||
            !('status' in action) ||
            !['waiting', 'blocked', 'withdrawn'].includes(String(action.status)),
        )
      )
        throw Error('NPC_EXECUTION_EDIT_SCOPE');
    }
    const intent = NativeMediaIntentSchema.parse('mediaDecision' in raw ? raw.mediaDecision : null);
    const execution = compileNpcMediaIntent(context, intent);
    const statements = 'statements' in raw ? raw.statements : null;
    if (!Array.isArray(statements)) throw Error('NPC_MEDIA_STATEMENTS');
    normalized = {
      ...raw,
      ...(compact ? { executions: compact.executions } : {}),
      mediaDecision: { kind: intent.kind, execution },
      statements: statements.map((statement) => {
        if (
          !statement ||
          typeof statement !== 'object' ||
          !Array.isArray(statement.dependsOnActionIds)
        )
          return statement;
        return {
          ...statement,
          dependsOnActionIds: statement.dependsOnActionIds.map((id: unknown) => {
            if (compact && typeof id === 'string' && id.startsWith('execution:')) {
              const actionId = compact.actionIdsByRef[id.slice('execution:'.length)];
              if (!actionId) throw Error('NPC_EXECUTION_DEPENDENCY_WITHOUT_INTENT');
              return actionId;
            }
            if (id !== NPC_MEDIA_CURRENT_REF) return id;
            if (!execution) throw Error('NPC_MEDIA_DEPENDENCY_WITHOUT_INTENT');
            return execution.action.id;
          }),
        };
      }),
    };
    // Strict providers do not support enum values that are themselves arrays.
    // Native null means the grammar offered no judgment items, not a missing
    // semantic choice to infer or repair. Historical v1 responses are untouched.
    for (const name of ['replyAssessments', 'decisions', 'locationReports', 'actions']) {
      if ((normalized as Record<string, unknown>)[name] === null)
        (normalized as Record<string, unknown>)[name] = [];
    }
  }
  const wire = Wire.parse(
    transport({
      protocol: LEGACY_NPC_WIRE_PROTOCOL,
      consideration: null,
      ...(normalized as object),
    }),
  );
  const {
    protocol: _protocol,
    consideration,
    mediaDecision,
    plans,
    executions: suppliedExecutions = [],
    ...proposal
  } = wire;
  const mediaCapabilities = new Set([
    'media.generate_image',
    'media.generate_video',
    'media.share',
  ]);
  const mediaCapability = {
    generate_image: 'media.generate_image',
    generate_video: 'media.generate_video',
    share_existing: 'media.share',
  } as const;
  const executions = [...suppliedExecutions];
  if (mediaDecision) {
    if (suppliedExecutions.some((entry) => mediaCapabilities.has(entry.action.capability)))
      throw Error('NPC_MEDIA_DECISION_CONFLICT');
    if (mediaDecision.execution) {
      if (mediaDecision.execution.action.capability !== mediaCapability[mediaDecision.kind])
        throw Error('NPC_MEDIA_DECISION_CAPABILITY');
      executions.push(mediaDecision.execution);
    }
  }
  // A typed intent is mapped to the original proposal, never executed here or inferred from speech.
  const seenExecutions = new Map<string, (typeof executions)[number]>();
  for (const execution of executions) {
    const key = JSON.stringify([execution.goal.id, execution.plan.id, execution.action.id]);
    const previous = seenExecutions.get(key);
    if (previous) {
      if (!isDeepStrictEqual(previous, execution)) throw Error('NPC_EXECUTION_CONFLICT');
      continue;
    }
    seenExecutions.set(key, execution);
    const { goal, plan, action } = execution;
    if (goal.kind === 'new')
      proposal.goals.push({
        id: goal.id,
        summary: goal.summary,
        status: 'active',
        sourceIds: goal.sourceIds,
        resultIds: [],
      });
    proposal.actions.push({ ...action, goalId: goal.id, status: 'proposed' });
    plans.push({ ...plan, goalId: goal.id, nextStep: { kind: 'action', actionId: action.id } });
  }
  let requestId: string | undefined;
  if (isActorEpisodeConsiderationInput(context.input)) {
    const request = JSON.parse(context.input.text);
    if (
      request.revision !== 0 ||
      typeof request.requestId !== 'string' ||
      context.channel.kind !== 'private'
    )
      throw Error('NPC_WIRE_CONSIDERATION_SCOPE');
    requestId = request.requestId;
    if (!consideration) throw Error('NPC_WIRE_CONSIDERATION_REQUIRED');
  } else if (
    context.input.origin === 'player' &&
    validPlayerEpisodeManifest(context.episodeManifest)
  ) {
    requestId = context.episodeManifest.requestId;
  }
  if (consideration && !requestId) throw Error('NPC_WIRE_CONSIDERATION_SCOPE');
  if (
    consideration &&
    ['need_information', 'defer'].includes(consideration.choice) &&
    !consideration.followUp
  )
    throw Error('NPC_WIRE_FOLLOW_UP_REQUIRED');
  // Only the person's explicit wait is bound; no invented deadline, wake or public statement.
  const followUpSources = consideration
    ? [
        ...new Set([
          context.input.sourceId,
          ...(context.input.origin === 'player' && context.episodeManifest
            ? [context.episodeManifest.sourceId]
            : []),
          ...consideration.basisSourceIds,
        ]),
      ]
    : [];
  const responsibility =
    consideration?.followUp && requestId
      ? {
          id: requestId + ':followup',
          subject: { kind: 'request', id: requestId },
          summary: consideration.followUp.missing.join('；'),
          status: 'waiting',
          waitingOn: consideration.followUp.waitingOn,
          sourceIds: [
            ...new Set([
              ...(context.state.responsibilities.find((r) => r.id === requestId + ':followup')
                ?.sourceIds ?? []),
              ...followUpSources,
            ]),
          ],
          nextCheck: [],
        }
      : null;
  if (
    responsibility &&
    proposal.responsibilities.some(
      (r) => r && typeof r === 'object' && 'id' in r && r.id === responsibility.id,
    )
  )
    throw Error('NPC_WIRE_FOLLOW_UP_DUPLICATE');
  return {
    ...proposal,
    responsibilities: responsibility
      ? [...proposal.responsibilities, responsibility]
      : proposal.responsibilities,
    plans: plans.map(({ nextStep, ...plan }) => ({
      ...plan,
      status:
        nextStep.kind === 'closed'
          ? nextStep.status
          : nextStep.kind === 'blocked'
            ? 'blocked'
            : nextStep.kind === 'wait'
              ? 'waiting'
              : 'active',
      actionIds: nextStep.kind === 'action' ? [nextStep.actionId] : [],
      nextActionId: nextStep.kind === 'action' ? nextStep.actionId : null,
      triggers:
        nextStep.kind === 'wait' || nextStep.kind === 'reconsider' ? nextStep.conditions : [],
      missingConditions:
        nextStep.kind === 'blocked' || nextStep.kind === 'wait' || nextStep.kind === 'reconsider'
          ? nextStep.missing
          : nextStep.kind === 'closed'
            ? [nextStep.reason]
            : [],
    })),
    ...(consideration
      ? {
          episodeDecision: {
            requestId,
            choice: consideration.choice,
            reason: consideration.reason,
            sourceIds: [
              ...new Set([
                context.input.sourceId,
                ...(context.input.origin === 'player' && context.episodeManifest
                  ? [context.episodeManifest.sourceId]
                  : []),
                ...consideration.basisSourceIds,
              ]),
            ],
          },
        }
      : {}),
  };
}
