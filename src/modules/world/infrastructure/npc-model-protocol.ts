import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { AgentProposalSchema } from './agent-proposal-schema.ts';
import type { ModelOutputOptions } from '../../ai/application/ports.ts';
import type { AgentValidationContext } from '../domain/agent-kernel.ts';
import { NativeExecutionIntentSchema, compileNpcExecutionIntents } from './npc-execution-intent.ts';
import { validPlayerEpisodeManifest } from '../domain/player-episode-manifest.ts';
import { isActorEpisodeConsiderationInput } from '../domain/actor-episode-intent.ts';
import {
  NativeMediaIntentSchema,
  compileNpcMediaIntent,
  NPC_MEDIA_CURRENT_REF,
} from './npc-media-intent.ts';

export const NPC_WIRE_PROTOCOL = 'npc-wire-v4';
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
const ModelWire = Wire.omit({ mediaDecision: true, actions: true }).extend({
  protocol: z.literal(NPC_WIRE_PROTOCOL),
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
  executions: z.array(NativeExecutionIntentSchema).max(16).optional(),
});
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
        'actions' | 'plans' | 'responsibilities' | 'worldId' | 'actorId'
      >
    >,
  considerationScope: 'required' | 'optional' | 'forbidden' = 'optional',
  current?: Pick<AgentValidationContext, 'input' | 'channel'>,
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
  const goalIds = state.goals.filter((goal) => goal.status === 'active').map((g) => g.id);
  const scopeGoal = (execution: SchemaNode) => {
    const alternatives = execution.properties?.goal?.anyOf;
    if (!alternatives) throw Error('NPC_RESPONSE_SCHEMA');
    const usable = alternatives.filter((g) => {
      if (g.properties!.kind!.enum?.[0] !== 'existing') return true;
      if (!goalIds.length) return false;
      g.properties!.id!.enum = goalIds;
      return true;
    });
    const first = usable[0];
    if (!first) throw Error('NPC_RESPONSE_SCHEMA');
    execution.properties!.goal = usable.length === 1 ? first : { anyOf: usable };
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
    if (capabilities.length)
      executionItem.properties!.action!.properties!.capability!.enum = capabilities;
    else properties.executions = { type: 'null' };
  }
  if (replaceablePlanIds.length && properties.executions?.type !== 'null') {
    // Couple goal and replacement choices in the native grammar. A new goal
    // cannot replace another goal's plan; the kernel remains authoritative.
    const goal = executionItem.properties!.goal!;
    const alternatives = goal.anyOf ?? [goal];
    const fresh = alternatives.find((g) => g.properties!.kind!.enum?.[0] === 'new');
    const existing = alternatives.find((g) => g.properties!.kind!.enum?.[0] === 'existing');
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
  // A reply assessment is about this player's current words, not an old NPC question.
  // Narrow the native grammar before the call; the kernel still validates exact source,
  // verbatim quote and thread authorization after the response is durably saved.
  if (current) {
    // The kernel applies the same current-input rule to decisions and location
    // reports. Bind all three judgments consistently before asking the model.
    for (const [name, quoteLimit] of [
      ['decisions', 1000],
      ['locationReports', 500],
    ] as const) {
      const node = properties[name]!;
      const array = node.type === 'array' ? node : node.anyOf?.find((x) => x.type === 'array');
      if (!array?.items?.properties) throw Error('NPC_RESPONSE_SCHEMA');
      if (current.input.origin !== 'player') {
        properties[name] = { type: 'null' };
        continue;
      } else {
        array.items.properties.sourceId!.enum = [current.input.sourceId];
        if (current.input.text.trim().length <= quoteLimit)
          array.items.properties.quote!.enum = [current.input.text.trim()];
      }
      properties[name] = array;
    }
    if (current.input.origin === 'player' && properties.decisions?.type !== 'null') {
      const responsibilities = (state.responsibilities ?? []).filter((r) =>
        ['open', 'waiting', 'deferred'].includes(r.status),
      );
      const array = properties.decisions!;
      const item = array.items!;
      if (!responsibilities.length) properties.decisions = { type: 'null' };
      else
        array.items = {
          anyOf: responsibilities.map((responsibility) => {
            const branch = structuredClone(item);
            const id = `decision:${createHash('sha256')
              .update(
                JSON.stringify([
                  'npc-player-decision-v1',
                  state.worldId,
                  state.actorId,
                  current.input.sourceId,
                  responsibility.id,
                  responsibility.revision ?? 0,
                ]),
              )
              .digest('hex')}`;
            branch.properties!.id!.enum = [id];
            branch.properties!.responsibilityId!.enum = [responsibility.id];
            return branch;
          }),
        };
    }
    const choices = (state.questions ?? [])
      .filter(
        (question) =>
          question.status === 'open' &&
          question.channel === current.channel.kind &&
          question.threadId === current.channel.threadId,
      )
      .slice(-16)
      .map((question) => question.id);
    const array = properties.replyAssessments?.anyOf?.find((option) => option.type === 'array');
    const item = array?.items;
    if (!array || !item?.properties) throw Error('NPC_RESPONSE_SCHEMA');
    if (
      current.input.origin !== 'player' ||
      !current.input.sourceId.trim() ||
      !current.input.text.trim() ||
      !choices.length
    ) {
      properties.replyAssessments = { type: 'null' };
    } else {
      item.properties.questionId!.enum = choices;
      item.properties.sourceId!.enum = [current.input.sourceId];
      // A short complete input is itself a valid verbatim quote. For long messages,
      // avoid a large schema/output while retaining the kernel's substring check.
      if (current.input.text.trim().length <= 1000)
        item.properties.quote!.enum = [current.input.text.trim()];
    }
    if (properties.replyAssessments?.type !== 'null') properties.replyAssessments = array;
  }
  return { ...NPC_RESPONSE_FORMAT, schema };
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
    // Native v4 has one action channel. No disposition flag competes with an
    // execution, and models cannot author completion receipts or terminal success.
    const native = ModelWire.parse(transport(raw, false));
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
