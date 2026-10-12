import {
  sceneStepContext,
  sceneStepRule,
  resolveSceneStepProgress,
} from '../domain/scene-step-progress.ts';
import { trustedOpportunity } from '../domain/matter-progression.ts';
import {
  matterCriterion,
  sceneMatterId,
  isSceneMatterLinked,
} from '../domain/scene-matter-policy.ts';
import { worldDateTimeLabel } from '../domain/display-time.ts';
import { actorContext } from '../application/actor-context.ts';
import { extractJsonObject } from '../../ai/application/model-json.ts';
import { z } from 'zod';
import type { TextModel } from '../../ai/application/ports.ts';
import type {
  ScenePlannerPort,
  ScenePlanningContext,
  SceneProposal,
} from '../application/scene-ports.ts';
import {
  sceneContextEntries,
  scenePresent,
  sceneAttemptBoundary,
  assertsDeferredExecution,
  attributesPlayerStepToActor,
} from '../domain/scene-runtime.ts';
import { DomainError } from '../domain/errors.ts';
export const SCENE_PROMPT_VERSION = 'scene-text-v17-slot-quote-requirements';
const text = z.string().trim().min(1).max(1600);
const reference = z.string().trim().min(1).max(200);
const quote = z.string().trim().min(3).max(500);
const stepProposalSchema = z.strictObject({
  matterId: reference,
  stepId: reference,
  inputQuote: quote,
  observationQuote: quote,
  receiverId: reference.optional(),
});
const npcActionSchema = z.strictObject({
  matterId: reference,
  kind: z.enum(['receive_r17', 'inspect_r17']),
  quote,
});
function stepEvidenceError(
  reason:
    | 'context'
    | 'matter_id'
    | 'matter_index'
    | 'step_id'
    | 'forbidden_npc_step'
    | 'failed_outcome'
    | 'input_quote'
    | 'observation_quote'
    | 'observation_index'
    | 'receiver'
    | 'receiver_index'
    | 'receiver_input_named'
    | 'receiver_observation_named',
): never {
  // Fixed condition codes only. No output text, quotes, names or IDs enter diagnostics.
  const diagnosticMessage = `scene_step_evidence:${reason}`;
  throw Object.assign(new DomainError('INVALID_PROPOSAL', diagnosticMessage), {
    stage: 'proposal',
    diagnosticMessage,
  });
}
function isUnexecutedQuote(quote: string, source: string): boolean {
  const at = source.indexOf(quote);
  if (at < 0) return true;
  const before = source.slice(0, at);
  const prefix = before.split(/[。！？；\n]/u).at(-1) ?? '';
  return /(?:会|将|要|准备|打算|计划|希望|可以|能)[^。！？；\n]{0,20}(?:接过|收下|收到了|接收|检查|核对|复检)|没有|并未|尚未|没(?:有|能)|不(?:会|能|曾|去|收|接|检查|核对)/u.test(
    prefix + quote,
  );
}
const diagnosticFields = new Set([
  'location',
  'narration',
  'presentActorIds',
  'outcome',
  'observation',
  'matterTitle',
  'initialMatters',
  'title',
  'matterUpdates',
  'id',
  'status',
  'dialogues',
  'actorId',
  'text',
  'stepProposals',
  'matterId',
  'matterIndex',
  'stepId',
  'inputQuote',
  'observationQuote',
  'observationIndex',
  'evidenceFormat',
  'receiverId',
  'receiverIndex',
  'npcActions',
  'actions',
  'kind',
  'quote',
  'present',
  'actionFormat',
  'actionIndex',
  'quoteIndex',
]);
const diagnosticCodes = new Set([
  'invalid_type',
  'too_big',
  'too_small',
  'invalid_format',
  'not_multiple_of',
  'unrecognized_keys',
  'invalid_union',
  'invalid_key',
  'invalid_element',
  'invalid_value',
  'custom',
]);
function sceneParseError(error: unknown, actor = false): DomainError {
  const phase = actor ? 'scene_actor_schema' : 'scene_schema';
  const detail =
    error instanceof z.ZodError
      ? error.issues
          .slice(0, 8)
          .map((issue) => {
            const path = issue.path
              .slice(0, 6)
              .map((part) =>
                typeof part === 'number' && Number.isInteger(part) && part >= 0 && part <= 32
                  ? `[${part}]`
                  : typeof part === 'string' && diagnosticFields.has(part)
                    ? part
                    : '*',
              )
              .join('.');
            return `${path || '$'}:${diagnosticCodes.has(issue.code) ? issue.code : 'invalid'}`;
          })
          .join(';')
      : error instanceof Error &&
          ['MODEL_OUTPUT_NOT_JSON', 'MODEL_OUTPUT_WITHOUT_OBJECT'].includes(error.message)
        ? error.message
        : 'invalid';
  const diagnosticMessage = `${phase}:${detail}`.slice(0, 500);
  return Object.assign(
    new DomainError(
      'INVALID_PROPOSAL',
      `${actor ? 'Invalid scene actor reply' : 'Invalid scene proposal'};${diagnosticMessage}`,
    ),
    { stage: 'proposal', diagnosticMessage },
  );
}
const openingNpcReplySchema = z.strictObject({ present: z.boolean(), text: text.nullable() });
const npcReplySchema = z.strictObject({
  text,
  actions: z.array(npcActionSchema).max(4).default([]),
});
type NpcActionSlot = { actionIndex: number; matterId: string; kind: 'receive_r17' | 'inspect_r17' };
const indexedNpcReplySchema = z.strictObject({
  actionFormat: z.literal('indexed-npc-actions-v1'),
  text,
  actions: z.array(z.strictObject({ actionIndex: z.number().int().min(0).max(15), quote })).max(4),
});
// Preserve the new source segments; legacy trim transforms must never repair their execution prefix.
const preservedNpcText = z
  .string()
  .min(1)
  .max(1600)
  .refine((value) => Boolean(value.trim()));
const preservedNpcQuote = z
  .string()
  .min(3)
  .max(500)
  .refine((value) => Boolean(value.trim()));
const indexedNpcSegmentsReplySchema = z.strictObject({
  actionFormat: z.literal('indexed-npc-actions-v2'),
  text: z.array(preservedNpcText).min(1).max(8),
  actions: z
    .array(
      z.strictObject({
        actionIndex: z.number().int().min(0).max(15),
        quoteIndex: z.number().int().min(0).max(7),
      }),
    )
    .max(4),
});
const preservedNpcCanonicalSchema = npcReplySchema.extend({
  text: preservedNpcText,
  actions: z.array(npcActionSchema.extend({ quote: preservedNpcQuote })).max(4),
});
function npcActionError(reason: 'action_index' | 'duplicate_index' | 'quote_index'): never {
  const diagnosticMessage = `scene_npc_action:${reason}`;
  throw Object.assign(new DomainError('INVALID_PROPOSAL', diagnosticMessage), {
    stage: 'proposal',
    diagnosticMessage,
  });
}
function canonicalNpcReply(raw: unknown, slots: readonly NpcActionSlot[]) {
  if (
    raw &&
    typeof raw === 'object' &&
    'actionFormat' in raw &&
    raw.actionFormat === 'indexed-npc-actions-v2'
  ) {
    const checked = indexedNpcSegmentsReplySchema.safeParse(raw);
    if (!checked.success) {
      if (checked.error.issues.some((issue) => issue.path.includes('quoteIndex')))
        npcActionError('quote_index');
      throw checked.error;
    }
    const parsed = checked.data,
      seen = new Set<number>();
    return preservedNpcCanonicalSchema.parse({
      text: parsed.text.join('\n'),
      actions: parsed.actions.map(({ actionIndex, quoteIndex }) => {
        const slot = slots[actionIndex];
        if (!slot || slot.actionIndex !== actionIndex) npcActionError('action_index');
        if (seen.has(actionIndex)) npcActionError('duplicate_index');
        seen.add(actionIndex);
        const segment = parsed.text[quoteIndex];
        if (segment === undefined) npcActionError('quote_index');
        return { matterId: slot.matterId, kind: slot.kind, quote: segment };
      }),
    });
  }
  if (!raw || typeof raw !== 'object' || !('actionFormat' in raw)) {
    const parsed = npcReplySchema.parse(raw);
    if (
      parsed.actions.some(
        (action) =>
          !slots.some((slot) => slot.matterId === action.matterId && slot.kind === action.kind),
      )
    )
      npcActionError('action_index');
    return parsed;
  }
  // An explicit discriminator commits to the strict new wire, including unknown or mixed formats.
  const parsed = indexedNpcReplySchema.parse(raw);
  const seen = new Set<number>();
  return npcReplySchema.parse({
    text: parsed.text,
    actions: parsed.actions.map(({ actionIndex, quote }) => {
      const slot = slots[actionIndex];
      if (!slot || slot.actionIndex !== actionIndex) npcActionError('action_index');
      if (seen.has(actionIndex)) npcActionError('duplicate_index');
      seen.add(actionIndex);
      return { matterId: slot.matterId, kind: slot.kind, quote };
    }),
  });
}
function requestsOwnInspection(now: string, name: string) {
  // Requests need the actual recipient and bounded object in the same current unquoted clause.
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const directedRequest = new RegExp(
    '(?:请|麻烦)\\s*(?:你)?\\s*' +
      escapedName +
      '\\s*(?:你)?\\s*(?:帮我)?\\s*(?:检查|核对|复检)' +
      '|' +
      escapedName +
      '\\s*[，,:：]?\\s*(?:请|麻烦)?\\s*(?:你)?\\s*(?:帮我)?\\s*(?:检查|核对|复检)',
    'u',
  );
  return now
    .split(/[。！？;；\n]/u)
    .some(
      (clause) =>
        directedRequest.test(clause) &&
        /请|麻烦|帮我/u.test(clause) &&
        /检查|核对|复检/u.test(clause) &&
        /R17|接头/u.test(clause) &&
        !/没有|并未|尚未|不会|别|不(?:用|要|必|请|让)|如果|假如|假设|打算|计划|准备|将会|明天|后天|下周|之后|以后|稍后|昨天|上次|之前|以前|曾经|等.+(?:来|到|后)/u.test(
          clause,
        ) &&
        !/[“「『"].*[”」』"]/u.test(clause) &&
        ![...clause.matchAll(/R\d+/giu)].some((m) => m[0].toUpperCase() !== 'R17'),
    );
}
export const SceneProposalSchema = z.strictObject({
  location: z.string().trim().min(1).max(200),
  narration: text,
  presentActorIds: z.array(z.string()).max(8),
  outcome: z.enum(['succeeded', 'failed', 'partial']).nullable(),
  observation: text.nullable(),
  matterTitle: z.string().trim().min(1).max(200).nullable().default(null),
  initialMatters: z
    .array(z.strictObject({ title: z.string().trim().min(1).max(200) }))
    .max(32)
    .default([]),
  matterUpdates: z
    .array(
      z.strictObject({ id: z.string(), status: z.enum(['in_progress', 'blocked', 'completed']) }),
    )
    .max(8)
    .default([]),
  dialogues: z
    .array(z.strictObject({ actorId: z.string(), text }))
    .max(2)
    .default([]),
  stepProposals: z.array(stepProposalSchema).max(8).default([]),
  // Director cannot propose actions for actors; only the actor adapter binds these.
  npcActions: z.array(z.never()).max(0).default([]),
});
const indexedProposalSchema = SceneProposalSchema.extend({
  evidenceFormat: z.literal('indexed-observations-v1'),
  observation: z.array(text).min(1).max(8).nullable(),
  stepProposals: z
    .array(
      z.strictObject({
        matterId: reference,
        stepId: reference,
        inputQuote: quote,
        observationIndex: z.number().int().min(0).max(7),
        receiverId: reference.optional(),
      }),
    )
    .max(8)
    .default([]),
});
const indexedMatterProposalSchema = indexedProposalSchema.extend({
  evidenceFormat: z.literal('indexed-observations-v2'),
  stepProposals: z
    .array(
      z.strictObject({
        matterIndex: z.number().int().min(0).max(31),
        stepId: reference,
        inputQuote: quote,
        observationIndex: z.number().int().min(0).max(7),
        receiverId: reference.optional(),
      }),
    )
    .max(8)
    .default([]),
});
const indexedReceiverProposalSchema = indexedMatterProposalSchema.extend({
  evidenceFormat: z.literal('indexed-observations-v3'),
  stepProposals: z
    .array(
      z
        .strictObject({
          matterIndex: z.number().int().min(0).max(31),
          stepId: reference,
          inputQuote: quote,
          observationIndex: z.number().int().min(0).max(7),
          receiverIndex: z.number().int().min(0).max(7).optional(),
        })
        .superRefine((step, ctx) => {
          const needsReceiver = ['repair_explained', 'handed_over'].includes(step.stepId);
          if (needsReceiver !== (step.receiverIndex !== undefined))
            ctx.addIssue({
              code: 'custom',
              path: ['receiverIndex'],
              message: 'Receiver index must match the step kind',
            });
        }),
    )
    .max(8)
    .default([]),
});
function canonicalSceneProposal(
  proposal: unknown,
  contexts: readonly {
    matterId: string;
    allowedReceivers: readonly { id: string; name: string }[];
  }[],
) {
  if (
    proposal &&
    typeof proposal === 'object' &&
    'evidenceFormat' in proposal &&
    proposal.evidenceFormat === 'indexed-observations-v3'
  ) {
    const checked = indexedReceiverProposalSchema.safeParse(proposal);
    if (!checked.success) {
      if (checked.error.issues.some((issue) => issue.path.includes('matterIndex')))
        stepEvidenceError('matter_index');
      if (checked.error.issues.some((issue) => issue.path.includes('observationIndex')))
        stepEvidenceError('observation_index');
      if (checked.error.issues.some((issue) => issue.path.includes('receiverIndex')))
        stepEvidenceError('receiver_index');
      throw checked.error;
    }
    const { evidenceFormat: _format, observation, stepProposals, ...rest } = checked.data;
    return SceneProposalSchema.parse({
      ...rest,
      observation: observation?.join('\n') ?? null,
      stepProposals: stepProposals.map(
        ({ matterIndex, observationIndex, receiverIndex, ...step }) => {
          const context = contexts[matterIndex];
          if (!context) stepEvidenceError('matter_index');
          const segment = observation?.[observationIndex];
          if (segment === undefined) stepEvidenceError('observation_index');
          if (receiverIndex === undefined)
            return { ...step, matterId: context.matterId, observationQuote: segment };
          const receiver = context.allowedReceivers[receiverIndex];
          if (!receiver) stepEvidenceError('receiver_index');
          // Select only an explicitly indexed existing receiver; never repair or expand either quote.
          if (!step.inputQuote.includes(receiver.name)) stepEvidenceError('receiver_input_named');
          if (!segment.includes(receiver.name)) stepEvidenceError('receiver_observation_named');
          return {
            ...step,
            matterId: context.matterId,
            observationQuote: segment,
            receiverId: receiver.id,
          };
        },
      ),
    });
  }
  if (
    proposal &&
    typeof proposal === 'object' &&
    'evidenceFormat' in proposal &&
    proposal.evidenceFormat === 'indexed-observations-v2'
  ) {
    const checked = indexedMatterProposalSchema.safeParse(proposal);
    if (!checked.success) {
      if (checked.error.issues.some((issue) => issue.path.includes('matterIndex')))
        stepEvidenceError('matter_index');
      if (checked.error.issues.some((issue) => issue.path.includes('observationIndex')))
        stepEvidenceError('observation_index');
      throw checked.error;
    }
    const { evidenceFormat: _format, observation, stepProposals, ...rest } = checked.data;
    return SceneProposalSchema.parse({
      ...rest,
      observation: observation?.join('\n') ?? null,
      stepProposals: stepProposals.map(({ matterIndex, observationIndex, ...step }) => {
        const context = contexts[matterIndex];
        if (!context) stepEvidenceError('matter_index');
        const segment = observation?.[observationIndex];
        if (segment === undefined) stepEvidenceError('observation_index');
        return { ...step, matterId: context.matterId, observationQuote: segment };
      }),
    });
  }
  if (
    !proposal ||
    typeof proposal !== 'object' ||
    !('evidenceFormat' in proposal) ||
    proposal.evidenceFormat !== 'indexed-observations-v1'
  )
    return SceneProposalSchema.parse(proposal);
  const checked = indexedProposalSchema.safeParse(proposal);
  if (!checked.success) {
    if (checked.error.issues.some((issue) => issue.path.includes('observationIndex')))
      stepEvidenceError('observation_index');
    throw checked.error;
  }
  const { evidenceFormat: _format, observation, stepProposals, ...rest } = checked.data;
  return SceneProposalSchema.parse({
    ...rest,
    observation: observation?.join('\n') ?? null,
    stepProposals: stepProposals.map(({ observationIndex, ...step }) => {
      const segment = observation?.[observationIndex];
      if (segment === undefined) stepEvidenceError('observation_index');
      return { ...step, observationQuote: segment };
    }),
  });
}
export class ScenePlanner implements ScenePlannerPort {
  private model: TextModel;
  constructor(model: TextModel) {
    this.model = model;
  }
  async propose(c: ScenePlanningContext, signal?: AbortSignal): Promise<SceneProposal> {
    const opening = !c.action;
    const boundary = c.action ? sceneAttemptBoundary(c.action.text) : null;
    const scenePlace = c.scene.placeId
      ? c.world.space?.places.find((p) => p.id === c.scene.placeId)
      : undefined;
    if (
      opening &&
      c.scene.placeId &&
      (!scenePlace || c.world.space?.currentPlaceId !== c.scene.placeId)
    )
      throw new DomainError('INVALID_COMMAND', 'Current scene place does not match world location');
    const placeAppointment = c.scene.placeId
      ? c.world.appointments.find(
          (a) =>
            a.status === 'confirmed' &&
            c.world.space?.places
              .find((p) => p.id === c.scene.placeId)
              ?.appointmentIds.includes(a.id) &&
            Date.parse(a.at) <= Date.parse(c.storyAt),
        )
      : undefined;
    const directAppointment = c.world.appointments.find((x) => x.id === c.scene.appointmentId);
    const effectiveDirect =
      directAppointment?.status === 'confirmed' &&
      Date.parse(directAppointment.at) <= Date.parse(c.storyAt) &&
      (!c.scene.placeId || Boolean(scenePlace?.appointmentIds.includes(directAppointment.id)))
        ? directAppointment
        : undefined;
    const activeAppointment = c.scene.appointmentId ? effectiveDirect : placeAppointment;
    const candidates = opening
      ? c.world.actors.filter((a) => activeAppointment?.participantIds.includes(a.id))
      : c.world.actors.filter((a) =>
          scenePresent(c.scene, c.world.version).some(
            (p) => p.kind === 'actor' && p.actorId === a.id,
          ),
        );
    // Director receives public scene information only: no owner facts, interviews or private conversations.
    const currentPlace = c.entries.filter((e) => e.kind === 'time_place').at(-1);
    const stepExecution =
      c.action?.intent === 'attempt'
        ? c.matters
            .filter((m) => c.action!.relatedMatterIds.includes(m.id))
            .flatMap((local) => {
              const m = c.world.matters?.find((m) => sceneMatterId(c.scene.id, m.id) === local.id);
              if (!m || !['not_started', 'in_progress', 'blocked'].includes(m.status)) return [];
              const context = sceneStepContext(c.world, c.scene, m);
              return context ? [context] : [];
            })
        : [];
    const authoredStepDefinition = opening
      ? (c.world.matters ?? []).flatMap((matter) => {
          const rule = sceneStepRule(c.world, matter);
          return rule && isSceneMatterLinked(c.world, c.scene, matter)
            ? [
                {
                  matterId: matter.id,
                  ruleVersion: rule.version,
                  description: matter.description,
                  steps: rule.steps.map(({ id, title, required }) => ({ id, title, required })),
                },
              ]
            : [];
        })
      : [];
    const executionInstructions = stepExecution.length
      ? '\nSTRUCTURED EXECUTION: structuredStepContexts is the ordered list of fixed versioned WORLD rules for this action. Each has a runtime-assigned matterIndex; never use a local scene ID or copy a world ID in a step proposal. Propose stepProposals only for actual player steps performed by this saved currentAction. Use evidenceFormat="indexed-observations-v3". Each proposal is {matterIndex,stepId,inputQuote,observationIndex,receiverIndex?}; matterIndex is an integer from structuredStepContexts, not an ID or a guessed index; inputQuote is an exact self-contained substring of currentAction.text; observation is an array of concrete Chinese segments starting with 你 and observationIndex selects the exact segment that describes the step action/object. Never output observationQuote in this wire. For repair_explained/handed_over inputQuote and the indexed observation segment must explicitly name the allowed present receiver; select its receiverIndex from this matter context.allowedReceivers. receiverIndex is REQUIRED for repair_explained and handed_over, and MUST be omitted for all other player steps. Never output receiverId in this wire or infer a missing index, even when only one receiver is available. Write observation as 1 to 8 concrete array segments each starting with 你. An indexed segment must stand alone, 3 to 500 characters; total joined observation is at most 1600 characters. Do not repeat or reconstruct the segment in a quote field. Do not use promises, requests, prior self-report, imagined outcomes or deferred clauses as player execution evidence. Never propose received/receiver_inspected: only that NPC can act in its independent call. Already saved completedSteps remain done and need not be repeated, no old prose is backfilled. Required steps are only order_reviewed,repair_explained,handed_over,received; connector_checked,record_written,receiver_inspected are OPTIONAL, no new signature/customer-arrival/record/inspection prerequisite. The current player action can succeed even while the overall goal waits for actual receiving. Do not propose matterUpdates.completed for this structured matter: runtime aggregates validated steps and NPC actions, you do not decide whole-goal completion. Other legacy matters keep their existing rules. stepProposals defaults []; npcActions MUST be omitted or [].'
      : '\nNo structured rule applies: stepProposals MUST be [].';
    const payload = {
      executionInstructions,
      structuredStepContexts: stepExecution.map((context, matterIndex) => ({
        ...context,
        matterIndex,
        allowedReceivers: context.allowedReceivers.map((receiver, receiverIndex) => ({
          ...receiver,
          receiverIndex,
        })),
      })),
      authoredStepDefinition,
      currentPlace: currentPlace ?? null,
      worldMatterConditions: c.matters
        .filter((local) => !c.action || c.action.relatedMatterIds.includes(local.id))
        .flatMap((local) => {
          const m = c.world.matters?.find((m) => sceneMatterId(c.scene.id, m.id) === local.id);
          if (!m || m.worldId !== c.world.id || m.visibility !== 'player_visible') return [];
          const rule = m.opportunity
            ? trustedOpportunity(c.world, c.world, m)?.criterion
            : matterCriterion(m);
          return [
            {
              id: local.id,
              title: m.title,
              description: m.description,
              status: m.status,
              stepExecution: stepExecution.find((x) => x.matterId === m.id) ?? null,
              successfulAttemptCanStartAndComplete: Boolean(
                c.action?.intent === 'attempt' &&
                m.status === 'not_started' &&
                m.opportunity &&
                rule,
              ),
              completionAllowed: Boolean(rule),
              condition: rule
                ? {
                    placeId: rule.placeId,
                    requiresWitness: Boolean(rule.requiresWitness),
                    presentInvolvedActorIds: scenePresent(c.scene, c.world.version).flatMap((p) =>
                      p.kind === 'actor' && m.relatedActorIds?.includes(p.actorId)
                        ? [p.actorId]
                        : [],
                    ),
                    actionAll: rule.actionAll.map((r) => r.source),
                    observationAll: rule.observationAll.map((r) => r.source),
                  }
                : null,
            },
          ];
        }),
      authoredPlace: c.scene.placeId
        ? c.world.space?.places.find((p) => p.id === c.scene.placeId) && {
            name: c.world.space.places.find((p) => p.id === c.scene.placeId)!.name,
            description: c.world.space.places.find((p) => p.id === c.scene.placeId)!.description,
          }
        : null,
      player: { label: 'PLAYER (you), distinct from every named actor', lifeTitle: c.world.title },
      storyAt: c.storyAt,
      localStoryTime: {
        zone: 'UTC+08:00',
        label: worldDateTimeLabel(c.storyAt),
        instruction: '以当地故事时间描写光线、活动和环境；不要把UTC小时当作当地小时。',
      },
      appointment: activeAppointment?.title ?? c.appointmentTitle,
      opening,
      actors: candidates.map((a) => ({ id: a.id, name: a.name, relationship: a.relationship })),
      facts: c.world.facts.filter((f) => f.visibility.kind === 'world').slice(-16),
      history: sceneContextEntries(
        c.entries.filter(
          (e) =>
            e.kind !== 'user_action' ||
            (e.actionId !== c.action?.id && e.observableTo.some((p) => p.kind === 'actor')),
        ),
        { kind: 'player' },
      ).map((e) => ({
        kind: e.kind,
        ...(e.kind === 'adjudicated_result' ? { outcome: e.outcome } : {}),
        ...('text' in e ? { text: e.text } : {}),
      })),
      matters: c.matters
        .filter((m) => !c.action || c.action.relatedMatterIds.includes(m.id))
        .map((m) => ({ id: m.id, title: m.title, status: m.status })),
      currentAction: c.action
        ? {
            performedBy: 'PLAYER (you), NOT ' + c.world.actors.map((a) => a.name).join(', '),
            text: boundary!.now,
            deferredUntilAnotherPlayerInput: boundary!.deferred,
            intent: c.action.intent,
            kind: c.action.kind,
            relatedMatterIds: c.action.relatedMatterIds,
          }
        : null,
    };
    while (JSON.stringify(payload).length > 40000 && payload.history.length)
      payload.history.shift();
    while (JSON.stringify(payload).length > 40000 && payload.facts.length) payload.facts.shift();
    const raw = await this.model.complete(
      [
        {
          role: 'system',
          content: `你是幕后现场导演，提出纯文字可观察的环境和行动裁定，不能改时间、身份、替玩家作下一决定。narration只写环境；玩家此刻动作和结果只放observation，不替玩家写准备或心理，不代人物执行动作。日程约定者不等于到场者：开场actors仅是合法当前生效预约候选：你不可强制赴约，presentActorIds只作候选建议并会由各自独立人物调用的当前到场决定替换，允许最终为空；无action时outcome/observation必须null；authoredStepDefinition非空时已有正式父事项及分步定义，initialMatters必须[]、matterTitle=null，不再创建核对/交代/交付等重复独立小事项；没有正式分步定义时可建立与日程相关的具体未开始事项，不设固定任务数量。action存在时presentActorIds必须是当前实际在场者，不增删人物；plan/hypothesis仅记录，outcome/observation=null、matterUpdates=[]，不执行想象。attempt有已保存原文，只裁定这一动作；有条件和协商过程，不因一句“同意/成功”给事业成果、钱、奖励或他人同意；行动只到下一必要选择。dialogues始终[]，对白由独立人物提出。不得发明图片/视频。仅JSON，不写Markdown：${JSON.stringify({ evidenceFormat: 'indexed-observations-v3', location: '实际地点', narration: '可见现象', presentActorIds: ['人物id'], outcome: c.action?.intent === 'attempt' ? 'partial' : null, observation: c.action?.intent === 'attempt' ? ['你本次实际执行动作的可观察结果；此为结构占位，不得照抄或补造成功'] : null, matterTitle: null, initialMatters: [], matterUpdates: [], dialogues: [], stepProposals: [] })}。ID区分：matterUpdates.id必须取worldMatterConditions.id（现场投影ID）；stepProposals.matterIndex必须是structuredStepContexts里给定的数字序号，不是现场或世界事项ID。NPC actions.matterId仍由独立NPC调用取其已授权stepExecution.matterId（世界事项ID）；导演不输出NPC动作。evidenceFormat必须精确为indexed-observations-v3。observation用中文字符串数组，每段以“你”描述玩家本次实际动作；步骤通过observationIndex从0起引用其中一段，不重复抄写观察，不造证据。精确JSON类型：location为非空字符串(最多200字)，narration为非空字符串(最多1600字)，presentActorIds为字符串数组(最多8)，outcome仅succeeded/failed/partial/null，observation为1至8个非空字符串的数组或null，拼接换行后总计最多1600字，供步骤引用的每段3至500字，matterTitle为非空字符串(最多200字)或null；initialMatters是最多32个{title:非空字符串}，matterUpdates是最多8个{id:现有现场事项字符串ID,status:in_progress/blocked/completed}；dialogues必须[]。stepProposals为最多8个{matterIndex:给定规则序号整数,stepId:规则步骤字符串ID,inputQuote:当前玩家原文片段,observationIndex:0至7整数,receiverIndex?:本规则接收人列表整数序号}，inputQuote为3至500字，observationIndex必须指向本次observation数组实际存在的段落；禁止matterId和observationQuote字段；v3必须完全省略receiverId字段；matterIndex必须从当前structuredStepContexts选取，示例0只展示数字类型，未给第0项时不可使用；不得同时输出新旧格式。null观察不得带步骤。repair_explained和handed_over必须显式给receiverIndex整数，选本matterIndex对应allowedReceivers中明确的receiverIndex；其他步骤必须省略receiverIndex，绝不能写null、字符串或undefined字面值。接收者不能从另一事项借来，即使当前只有一个接收者也不能省略索引或默认补人。inputQuote和所选观察段必须原样包含同一接收者name，截取原文时保留向谁说明/交给谁；若原文未点名不得补名字或制造该步骤。stepProposals和npcActions无候选时用[]，不得null；npcActions只能[]或省略，因为导演不能代人物行动。其他未知字段一律不要输出。仅结构示例（占位值不可照抄，未实际执行不得填步骤）：${JSON.stringify({ stepProposals: [{ matterIndex: 0, stepId: 'order_reviewed', inputQuote: '仅截取本次实际核对R17维修单的完整原文', observationIndex: 0 }] })}；交接类示例结构：${JSON.stringify({ matterIndex: 0, stepId: 'handed_over', inputQuote: '本次实际将R17钥匙和维修单交给接收人的原文', observationIndex: 0, receiverIndex: 0 })}。不得照示例创造动作或凑证据，未执行stepProposals=[]。matterTitle只用于开场，更新只能关联action.relatedMatterIds的现有事项；没有关联事项时matters=[]，必须matterUpdates=[]，仍正常裁定行动观察，不自行猜测事项ID；completed仅由succeeded支撑，blocked只由failed支撑，partial仅in_progress或不变。普通事项not_started只能到in_progress；只有worldMatterConditions中successfulAttemptCanStartAndComplete=true的可信已定义机会，在本次完整实际attempt满足全部条件且succeeded时可提completed，运行时会受控开始再完成；in_progress可到blocked/completed；blocked可到in_progress/completed；completed/abandoned不再更新。不要每轮完成事项或制造困难。`,
        },
        {
          role: 'user',
          content:
            JSON.stringify(payload) +
            `\nCURRENT TASK: ${c.action ? (c.action.intent === 'attempt' ? 'Adjudicate the saved currentAction. Non-null outcome and observation REQUIRED. matterTitle=null.' : 'Record the plan/hypothesis only. outcome/observation=null.') : 'Generate the observable opening. No executed outcome.'} Only absent or undefined matterTitle, matterUpdates, dialogues use no-effect defaults null, [], [] respectively. Explicit null arrays and other wrong types are still invalid. Prefer the explicit neutral fields from the JSON template. These defaults never establish dialogue, executed steps, receiving, rewards or whole-goal completion. history is PAST, do not copy its dialogues or output its previous results. The currentAction was attempted by the PLAYER, never by an NPC. Do not change who acted. Narration describes ONLY the physical environment: never invent anyone's thoughts, hopes, anxieties, wishes or emotions, even when the history did. Do not describe NPC actions here; NPC actions and responses come ONLY from separate NPC calls. Observation must address the PLAYER as YOU, never substitute an actor name for the player. No hidden thoughts or feelings. dialogues MUST be [] because NPCs speak separately. ${c.action ? 'presentActorIds MUST equal ' + JSON.stringify(candidates.map((a) => a.id)) : ''} Only explicitly related currentAction.relatedMatterIds may get matterUpdates. A successful action does NOT complete every selected matter. World matter completed requires completionAllowed=true AND every trusted action/observation condition; otherwise propose only in_progress/blocked if justified, or no change. Greeting/arrival/looking/self-report do not complete other goals. Never manufacture completion evidence or rewards. When deferredUntilAnotherPlayerInput is non-null, ONLY adjudicate currentAction.text and stop at the unanswered question. Never execute the deferred clause; outcome is partial or failed. For a not_started matter, normally propose in_progress only after an actual attempt. The sole exception is a trusted opportunity with successfulAttemptCanStartAndComplete=true: when this saved attempt actually fulfils all conditions and succeeds, completed is permitted in this same result. Plans, hypotheses, self-reports, greetings and incomplete attempts never qualify. Partial outcomes must not propose blocked. Conditions describe required real evidence, not instructions to add missing words: never manufacture observations or force success to match a regex. Witness-required goals need an actual presentInvolvedActorId; an invitation or related contact is not a witness. Long pursuits have no one-action completion rule. Preserve concrete checks, explanation, handover and record-writing already established by earlier adjudicated_result history; evaluate what this current saved player attempt actually adds. Do not erase finished steps or demand them again. Use the authored matter description and trusted conditions as the fixed endpoint: do not invent a mandatory absent customer, new appointment, extra third-party inspection or another person's signature if that requirement is not defined. Giving the vehicle/keys/paperwork to an allowed present receiver is not blocked merely because another contact has not arrived. A request for an NPC to inspect or sign is only a request, never proof they did it; distinguish it from the actual player steps. If outcome remains partial/failed, state the specific unsupported or unfinished step and its reason, not merely that the paperwork or whole task is unfinished. Do not call a submitted record unwritten without concrete evidence. If the room has not changed, describe that briefly rather than copying a paragraph with NPC actions or inferred intentions; do not invent environmental changes for variety. When authoredStepDefinition is nonempty, opening initialMatters MUST be [] and matterTitle=null: the authored parent already owns these bounded steps; never create duplicate separate tasks or backfill executed progress from old prose. Otherwise opening initialMatters must be an array of objects with ONLY a title string naming an actual step from this appointment, never copy a fact object, id, text or visibility. It can contain the necessary concrete small steps from this appointment; do not impose a fixed task count. matterTitle is legacy and should be null. On actions, initialMatters=[] and matterTitle=null; do not create new tasks. On opening, actors are ONLY eligible current appointment candidates. Independent actor calls decide actual presence at this moment; the director list is provisional and cannot establish arrival. Prefer presentActorIds=[] rather than presume a candidate arrived. Final IDs come only from each actor own explicit current presence decision. Appointment candidates are not proof of arrival and an empty list is allowed. Narration must agree with that list: if presentActorIds is empty, never say Lao Zhou or any NPC is standing nearby, busy, looking, working or otherwise present; even listed NPC actions are left to their independent calls. Do not fix a contradictory narration by assuming attendance or adding IDs. On opening, location must be a concrete non-empty Chinese place string, never null; derive it from authoredPlace when present, otherwise the appointment. authoredPlace is a trusted public setting, not a performed action. If no appointment or actual present actor exists, actors and presentActorIds must be empty; never bring contacts into this scene. On actions, keep location equal to currentPlace.location until the player explicitly leaves; movement only changes observable position within this scene. All narrative text in Chinese.`,
        },
      ],
      signal,
      4096,
      { format: 'json_object' },
    );
    let p: SceneProposal;
    try {
      const proposal = extractJsonObject(raw) as Record<string, unknown>;
      // Repeated current states are observations, not proposed transitions.
      if (c.action && Array.isArray(proposal.matterUpdates))
        proposal.matterUpdates = proposal.matterUpdates.filter((update) => {
          if (!update || typeof update !== 'object') return true;
          const value = update as Record<string, unknown>;
          return !c.matters.some(
            (matter) =>
              matter.id === value.id &&
              matter.status === value.status &&
              c.action!.relatedMatterIds.includes(matter.id),
          );
        });
      p = canonicalSceneProposal(proposal, stepExecution);
    } catch (error) {
      if (
        error instanceof DomainError &&
        [
          'scene_step_evidence:observation_index',
          'scene_step_evidence:matter_index',
          'scene_step_evidence:receiver_index',
          'scene_step_evidence:receiver_input_named',
          'scene_step_evidence:receiver_observation_named',
        ].includes(error.message)
      )
        throw error;
      throw sceneParseError(error);
    }
    for (const step of p.stepProposals ?? []) {
      if (!stepExecution.length) stepEvidenceError('context');
      const context = stepExecution.find((x) => x.matterId === step.matterId);
      if (!context) stepEvidenceError('matter_id');
      if (!context.steps.some((s) => s.id === step.stepId)) stepEvidenceError('step_id');
      if (['received', 'receiver_inspected'].includes(step.stepId))
        stepEvidenceError('forbidden_npc_step');
      if (p.outcome === 'failed') stepEvidenceError('failed_outcome');
      if (!boundary?.now.includes(step.inputQuote)) stepEvidenceError('input_quote');
      if (!p.observation?.includes(step.observationQuote)) stepEvidenceError('observation_quote');
      if (step.receiverId && !context.allowedReceivers.some((a) => a.id === step.receiverId))
        stepEvidenceError('receiver');
    }
    if ((p.stepProposals?.length ?? 0) && c.action?.intent !== 'attempt')
      throw new DomainError('INVALID_PROPOSAL', 'Only saved attempts can propose executed steps');
    if (!opening && p.matterTitle && c.matters.some((m) => m.title === p.matterTitle))
      p.matterTitle = null;
    if (c.scene.placeId && c.world.space) {
      const canonical = c.world.space.places.find((p) => p.id === c.scene.placeId);
      if (!canonical || c.world.space.currentPlaceId !== canonical.id)
        throw new DomainError('INVALID_COMMAND');
      p.location = canonical.name;
    }
    if (c.action && currentPlace?.kind === 'time_place') p.location = currentPlace.location;
    if (c.action && p.initialMatters?.every((m) => c.matters.some((old) => old.title === m.title)))
      p.initialMatters = [];
    if (/内心|心里|暗自|焦虑|担心|希望(?:能|可以)|想着/u.test(p.narration))
      throw new DomainError('INVALID_PROPOSAL', 'Narration must stay observable');
    const ids = new Set(candidates.map((a) => a.id));
    if (
      new Set(p.presentActorIds).size !== p.presentActorIds.length ||
      p.presentActorIds.some((id) => !ids.has(id)) ||
      p.dialogues.length
    )
      throw new DomainError('INVALID_PROPOSAL', 'Unknown presence or director-authored dialogue');
    if (
      !opening &&
      (p.presentActorIds.length !== ids.size ||
        p.presentActorIds.some((id) => !ids.has(id)) ||
        p.matterTitle ||
        p.initialMatters?.length)
    )
      throw new DomainError('INVALID_PROPOSAL', 'Action cannot invent arrival or a new matter');
    if (
      c.action?.intent === 'attempt'
        ? !p.outcome || !p.observation
        : p.outcome !== null || p.observation !== null || p.matterUpdates.length
    )
      throw new DomainError('INVALID_PROPOSAL', 'Plan/opening cannot become an executed result');
    for (const update of p.matterUpdates) {
      if (
        update.status === 'completed' &&
        stepExecution.some((x) => sceneMatterId(c.scene.id, x.matterId) === update.id)
      )
        throw new DomainError(
          'INVALID_PROPOSAL',
          'Structured matter completion belongs to the runtime',
        );
      if (
        !c.action?.relatedMatterIds.includes(update.id) ||
        !c.matters.some((m) => m.id === update.id)
      )
        throw new DomainError('INVALID_PROPOSAL', 'Unrelated matter');
    }
    if (
      boundary?.deferred &&
      (p.outcome === 'succeeded' ||
        assertsDeferredExecution(
          boundary.deferred,
          (c.entries.some((e) => e.kind === 'narration' && e.text === p.narration)
            ? ''
            : p.narration) +
            ' ' +
            (p.observation ?? ''),
        ))
    )
      throw new DomainError(
        'INVALID_PROPOSAL',
        'Deferred action cannot execute before another player decision',
      );
    if (
      boundary &&
      attributesPlayerStepToActor(
        boundary.now,
        p.narration + ' ' + (p.observation ?? ''),
        c.world.actors.map((a) => a.name),
      )
    )
      throw new DomainError('INVALID_PROPOSAL', 'Player step cannot be attributed to an NPC');
    // At most two relevant NPCs. Each receives its own visible facts/entries, never another private thread.
    let currentHandovers: ReturnType<typeof resolveSceneStepProgress>['matters'] = [];
    if (
      c.action?.intent === 'attempt' &&
      p.outcome !== 'failed' &&
      p.stepProposals?.some((step) => step.stepId === 'handed_over')
    ) {
      const event = { id: 'scene-slot-candidate', version: c.world.version + 1, at: c.storyAt };
      try {
        currentHandovers = resolveSceneStepProgress({
          world: c.world,
          initial: c.world,
          scene: c.scene,
          action: {
            ...c.action,
            status: 'resolved',
            resolution: {
              sourceEventId: event.id,
              sourceVersion: event.version,
              outcome: p.outcome!,
              observation: p.observation!,
            },
          },
          stepProposals: p.stepProposals,
          npcActions: [],
          dialogues: [],
          event,
        }).matters;
      } catch {
        // Invalid player evidence grants no action slot; the original runtime still rejects that delta.
        currentHandovers = [];
      }
    }
    const receiverIds = new Set(
      stepExecution.flatMap((context) =>
        context.allowedReceivers
          .filter(
            (actor) =>
              boundary?.now.includes(actor.name) ||
              (p.stepProposals ?? []).some(
                (step) => step.matterId === context.matterId && step.receiverId === actor.id,
              ),
          )
          .map((actor) => actor.id),
      ),
    );
    const speakers = candidates
      .filter((a) => opening || p.presentActorIds.includes(a.id))
      .sort((a, b) => Number(receiverIds.has(b.id)) - Number(receiverIds.has(a.id)))
      .slice(0, 2);
    if (opening) p.presentActorIds = [];
    for (const actor of speakers) {
      const blockedSources = new Set(c.blockedSourcesByActor?.[actor.id] ?? []);
      const actorVoice = `你正在扮演${actor.name}。以人物本人第一人称“我”直接对玩家“你”说话，说“给我”，不以自己的姓名作第三人称任务播报；旧对白中此类复述不是你本轮的语气模板。只说本人实际知道的内容；身份与动作许可不等于动作已经发生。`;
      const remembered = actorContext(
        c.world,
        actor.id,
        c.action?.text ?? '',
        c.memoriesByActor?.[actor.id] ?? [],
        blockedSources,
      );
      if (opening) {
        const reply = await this.model.complete(
          [
            {
              role: 'system',
              content:
                actorVoice +
                '你是此人物，独立决定这一刻是否实际在这个公开地点出现。这是本次开场的有限虚构行动提案，由运行时同开场事务校验保存，不是从预约或旧对白推定到场。结合自己的立场、已知约定/对话和当前当地故事时间判断，可true也可false；confirmed预约只是合法候选资格，不强制赴约。不得替玩家或其他人物行动、决定别人是否到场、编排未来玩家步骤，也不执行R17接收/检修/交付或产生事项进展。只看提供的本人知识与公开地点；还未正式加入，不知道旧现场历史或他人私聊。不能编迟到理由或瞬移跨地点。仅输出严格JSON {"present":true或false,"text":"当前现场自然的一两句发言"或null}，不含actorId/presentActorIds/actions等其他字段。present=true必须有非空当前现场发言，不能只说以后会到；present=false用null（解释文字也不会保存为现场发言）。身份由本次调用绑定，结果保存后才正式成为在场人。当前对话对象addressee固定为玩家主角，不是客户、车主或其他联系人；visibleFacts中谈及的车主姓名不能当作玩家姓名。仅按已裁剪可见事实中的虚构公开身份理解主角；未给玩家姓名时称“你”，不从actor.persona或他人姓名猜玩家是谁。已知维修价格只代表相应维修记录，不能据此向错误对象索款，不能声称已经收费；未给价格时不编金额，不把未提供的玩家身份或setting共享进来。',
            },
            {
              role: 'user',
              content: JSON.stringify({
                actor: remembered.actor,
                addressee: { kind: 'player', name: null },
                storyAt: c.storyAt,
                localStoryTime: { zone: 'UTC+08:00', label: worldDateTimeLabel(c.storyAt) },
                authoredPlace: payload.authoredPlace,
                sceneLocation: p.location,
                candidateAppointment:
                  remembered.appointments.find((a) => a.id === activeAppointment?.id) ?? null,
                visibleFacts: remembered.facts,
                ownMessages: remembered.messages,
                ownAppointments: remembered.appointments,
                rememberedEpisodes: remembered.retrievedMemories,
                entries: [],
                observedNow: null,
              }),
            },
          ],
          signal,
          1024,
          { format: 'json_object' },
        );
        try {
          const parsed = openingNpcReplySchema.parse(extractJsonObject(reply));
          if (parsed.present) {
            if (!parsed.text)
              throw new DomainError('INVALID_PROPOSAL', 'Present actor requires current speech');
            p.presentActorIds.push(actor.id);
            p.dialogues.push({ actorId: actor.id, text: parsed.text });
          }
        } catch (error) {
          throw sceneParseError(error, true);
        }
        continue;
      }
      const visibleMatters = (remembered.matters ?? []).filter((m) =>
        stepExecution.some((x) => x.matterId === m.id),
      );
      const actorSteps = stepExecution
        .filter(
          (x) =>
            visibleMatters.some((m) => m.id === x.matterId) &&
            x.allowedReceivers.some((a) => a.id === actor.id),
        )
        .map((context) => {
          const completedSteps = context.completedSteps.filter(
            (e) =>
              e.witnessActorIds.includes(actor.id) &&
              !blockedSources.has(e.eventId) &&
              !blockedSources.has(e.inputEventId) &&
              !blockedSources.has(e.actionId),
          );
          const steps = context.steps.map((s) => ({
            ...s,
            done: completedSteps.some((e) => e.stepId === s.id),
          }));
          const savedCompletedSteps = completedSteps.map(
            ({
              stepId,
              performer,
              actorId,
              receiverId,
              eventId,
              eventVersion,
              observationQuote,
            }) => ({
              stepId,
              performer,
              actorId,
              receiverId,
              eventId,
              eventVersion,
              observationQuote,
            }),
          );
          const savedRemainingSteps = steps
            .filter((s) => s.required && !s.done)
            .map(({ id, title }) => ({ id, title }));
          const currentTurnStepCandidates = (p.stepProposals ?? []).filter(
            (s) => s.matterId === context.matterId && (!s.receiverId || s.receiverId === actor.id),
          );
          const { completedSteps: _completed, missingSteps: _missing, ...ruleContext } = context;
          return {
            ...ruleContext,
            description: visibleMatters.find((m) => m.id === context.matterId)!.description,
            steps,
            savedCompletedSteps,
            savedRemainingSteps,
            currentTurnStepCandidates,
          };
        });
      const allowedActions: NpcActionSlot[] = [];
      if (
        c.action?.intent === 'attempt' &&
        p.outcome !== 'failed' &&
        !blockedSources.has(c.action.sourceEventId) &&
        !blockedSources.has(c.action.id)
      ) {
        for (const context of actorSteps) {
          const canonicalSteps = stepExecution.find(
            (x) => x.matterId === context.matterId,
          )!.completedSteps;
          const savedHandover = context.savedCompletedSteps.some(
            (step) =>
              step.stepId === 'handed_over' &&
              step.performer === 'player' &&
              step.receiverId === actor.id,
          );
          const proposedHandover =
            context.currentTurnStepCandidates.some(
              (step) => step.stepId === 'handed_over' && step.receiverId === actor.id,
            ) &&
            !blockedSources.has(c.action.sourceEventId) &&
            !blockedSources.has(c.action.id) &&
            currentHandovers
              .find((m) => m.id === context.matterId)
              ?.stepProgress?.steps.some(
                (step) => step.stepId === 'handed_over' && step.receiverId === actor.id,
              );
          const handover = savedHandover || proposedHandover;
          if (handover && !canonicalSteps.some((step) => step.stepId === 'received'))
            allowedActions.push({
              actionIndex: allowedActions.length,
              matterId: context.matterId,
              kind: 'receive_r17',
            });
          if (
            (handover || requestsOwnInspection(boundary?.now ?? '', actor.name)) &&
            !canonicalSteps.some((step) => step.stepId === 'receiver_inspected')
          )
            allowedActions.push({
              actionIndex: allowedActions.length,
              matterId: context.matterId,
              kind: 'inspect_r17',
            });
        }
      }
      if (allowedActions.length > 16) npcActionError('action_index');
      const npc = {
        currentStep: boundary?.now ?? null,
        deferredUntilPlayerDecision: boundary?.deferred ?? null,
        actor: { name: actor.name, persona: actor.persona, relationship: actor.relationship },
        addressee: { kind: 'player', name: null },
        storyAt: c.storyAt,
        localStoryTime: {
          zone: 'UTC+08:00',
          label: worldDateTimeLabel(c.storyAt),
          instruction: '以当地故事时间描写光线、活动和环境；不要把UTC小时当作当地小时。',
        },
        appointment: c.appointmentTitle,
        visibleFacts: remembered.facts,
        matters: visibleMatters,
        stepExecution: actorSteps,
        allowedActions,
        actionQuoteRequirements: allowedActions.map((slot) => ({
          actionIndex: slot.actionIndex,
          optionalProposal: true,
          completeIndependentSegment: true,
          startsWithPattern:
            slot.kind === 'receive_r17'
              ? '^我(?:现在|已经|当场|刚刚|刚)?(?:接过|收下|收到了|接收)'
              : '^我(?:现在|已经|当场|刚刚|刚)?(?:检查了|检查过|核对了|复检了)',
          requiredObjectAlternatives:
            slot.kind === 'receive_r17'
              ? [['钥匙'], ['维修单', '工单', '单据']]
              : [['R17', '接头']],
        })),
        rememberedEpisodes: remembered.retrievedMemories,
        entries: sceneContextEntries(
          c.entries.filter((e) => !blockedSources.has(e.sourceEventId)),
          { kind: 'actor', actorId: actor.id },
        ).map((e) => ({ kind: e.kind, ...('text' in e ? { text: e.text } : {}) })),
        observedNowSource:
          'Candidate observable adjudication of this saved action, not yet committed; no new pursuit stage or opportunity has been saved yet. Do not claim newly unlocked opportunities or rewards from this candidate.',
        observedNow: {
          outcome: p.outcome,
          location: p.location,
          narration: p.narration,
          observation: p.observation,
        },
      };
      const reply = await this.model.complete(
        [
          {
            role: 'system',
            content:
              actorVoice +
              (actorSteps.length
                ? '本轮有获准stepExecution规则。【两套进度】savedCompletedSteps和savedRemainingSteps仅表示此前已提交且你获准目击的进度；steps.done也只依据这些已存证据。currentTurnStepCandidates和observedNow是本轮可见裁定候选，不是已提交事实。若本轮观察已具体描述玩家核对且有同事项order_reviewed候选，应自然回应核对结果，不再说“单号先核对清楚”或要求重做该步骤。savedRemainingSteps仍列该步骤只是提交前快照，不是本轮新增门槛。可提此前未完成且本轮候选未覆盖的真实下一步；不得提前把候选markdone、宣布整体完成、领奖、新阶段或机会。'
                : '没有获准结构化事项，不得提出动作。') +
              '本次人物回复只用显式完整段索引格式：严格JSON {"actionFormat":"indexed-npc-actions-v2","text":["当前本人直接对玩家的一段自然发言"],"actions":[]}。text为1至8个完整非空中文段，合计含段间换行最多1600字。每个实际动作单独一段，以“我”及本人此刻已执行的动作开头并写全对象；闲聊另成段，不截取或省略主语和物件。allowedActions是你本人本轮有限可选择的槽位，actionIndex整数从0开始；许可不是已经执行、强制合作或整体完成。actionQuoteRequirements按actionIndex列出本动作原有句形和对象要求，属于格式约束而非已发生证据；不必填满所有槽，仅接收时不额外报检查。每个已执行动作必须各自有符合其类型的完整独立段，不能把接收段拿去填检查，不修改原段来凑要求。只在你这次确实执行时用actions:[{actionIndex:实际槽位整数,quoteIndex:text中该完整动作段从0开始的整数序号}]，动作段3至500字，quoteIndex必须实际存在，不重抄quote，不选择半句话或另一段。最多4动作，不猜任何索引，不从别的角色借槽，不输出matterId/kind/actorId/quote字段。allowedActions=[]时actions必须[]，普通核对/说明不是你接收/检修；无动作也使用同一marker和text数组。示例仅展示格式、绝非默认台词或执行证据，不照抄制造动作。' +
              (allowedActions.length
                ? '本轮已提供动作槽位。receive_r17只表示你本人实际接过玩家明确交给你的R17钥匙和维修单；quote必须是同次text里第一人称“我接过/我现在接过/我收下”等实际执行原文并包含钥匙和维修单。inspect_r17只表示你本人实际检查R17/接头，quote必须明确“我检查了/核对了R17或接头”。选择哪一个actionIndex须读allowedActions，不能固定假定某个索引永远表示接收。未来承诺、意向、假设、请求、失败或否定不能列actions。已存动作不再次执行。'
                : '本轮没有可执行动作槽位。不声称已接过、已检查或把玩家说明误记成你自己的动作；可自然回应本轮说明及未完成的一项真实下一步。') +
              '本轮明确说自己实际执行有槽位动作时必须提交对应actions，不能只有完成台词却省略动作；本人获准目击且已保存的同一步可回顾，不再次推进。只有你本人能执行，不替玩家或他人行动。玩家本次partial不禁止你接收实际已交出的对象，但不能补造其他未提供步骤；可选复检和记录不是新门槛。最终由原运行时核对quote、来源和聚合，不由槽位或对白决定整体完成。' +
              '当前对话对象addressee为玩家主角；车主、其他联系人或旧现场对白中的人物名都不能当作玩家姓名，先前错称不构成身份来源。未给玩家姓名时称“你”，只依已裁剪可见虚构事实理解身份，不查私档或全cast。扮演该人物，按你的立场、目标和可知事实回应现场，简短自然的一两句话。只知道提供的可见内容，别读取其他私聊或猜主角内心。不替玩家执行后续行动，不声称重大成果、图片、钱或奖励已经发生。没有受控actions支持时，待检查/待确认不能被你的对白补成已检查、已签收或全部通过，不能用含混的‘我看看，行了’冒充已完成动作。基于当前saved行动与历史可见结果，只提出真实未完成的一项，不重复要求已经完成的核对、交接或记录，也不把允许交给当前接收人的任务改成必须等其他客户到场。人物背景或旧消息里的预约只代表原计划，不等于当前到场或确定马上来；以localStoryTime核对时点，旧约已过而没有到场/新确认来源时，可说原约时间与当前未见，不能编迟到原因或把那个人当在场见证者。只说当前人物获准知道的安排，不引用别人的私聊。只返回上述JSON，不写Markdown。',
          },
          { role: 'user', content: JSON.stringify(npc) },
        ],
        signal,
        1024,
        { format: 'json_object' },
      );
      try {
        const parsed = canonicalNpcReply(extractJsonObject(reply), allowedActions);
        for (const action of parsed.actions) {
          if (
            c.action?.intent !== 'attempt' ||
            p.outcome === 'failed' ||
            !actorSteps.some((m) => m.matterId === action.matterId) ||
            isUnexecutedQuote(action.quote, parsed.text) ||
            /还没|没有|并未|尚未|如果|假如|打算|计划|准备|将会|之后|以后|稍后|等.+(?:来|到|后)/u.test(
              action.quote,
            )
          )
            throw new DomainError('INVALID_PROPOSAL', 'Unsupported actor execution candidate');
        }
        // A claim cannot silently replace an executed action. Only this bounded R17 rule applies.
        for (const rawClause of parsed.text.split(/[。！？;；\n]/u)) {
          const clause = rawClause.trim();
          if (
            isUnexecutedQuote(clause, parsed.text) ||
            /如果|假如|假设|之后|以后|稍后|明天|昨天|上次|之前|以前|曾经|等.+(?:来|到|后)/u.test(
              clause,
            ) ||
            /[“「『"].*[”」』"]/u.test(clause) ||
            [...clause.matchAll(/R\d+/giu)].some((match) => match[0].toUpperCase() !== 'R17')
          )
            continue;
          const received =
            /^我(?:现在|已经|当场|刚刚|刚)?(?:接过|收下|收到了|接收).*钥匙.*(?:维修单|工单|单据)/u.test(
              clause,
            );
          const inspected =
            /^我(?:现在|已经|当场|刚刚|刚)?(?:检查了|检查过|核对了|复检了).*(?:R17|接头)/u.test(
              clause,
            );
          for (const context of actorSteps) {
            for (const [claims, kind, stepId] of [
              [received, 'receive_r17', 'received'],
              [inspected, 'inspect_r17', 'receiver_inspected'],
            ] as const) {
              if (
                claims &&
                !parsed.actions.some(
                  (action) => action.matterId === context.matterId && action.kind === kind,
                ) &&
                !context.savedCompletedSteps.some(
                  (step) =>
                    step.stepId === stepId &&
                    step.performer === 'actor' &&
                    step.actorId === actor.id,
                )
              )
                throw new DomainError(
                  'INVALID_PROPOSAL',
                  'Actor execution claim requires its own saved action evidence',
                );
            }
          }
        }
        if ((p.npcActions?.length ?? 0) + parsed.actions.length > 4)
          throw new DomainError('INVALID_PROPOSAL', 'Unbounded actor execution candidates');
        p.dialogues.push({ actorId: actor.id, text: parsed.text });
        p.npcActions ??= [];
        p.npcActions.push(...parsed.actions.map((action) => ({ ...action, actorId: actor.id })));
      } catch (error) {
        if (
          error instanceof DomainError &&
          [
            'scene_npc_action:action_index',
            'scene_npc_action:duplicate_index',
            'scene_npc_action:quote_index',
          ].includes(error.message)
        )
          throw error;
        throw sceneParseError(error, true);
      }
    }
    if (
      boundary?.deferred &&
      p.dialogues.some((d) => assertsDeferredExecution(boundary.deferred!, d.text))
    )
      throw new DomainError('INVALID_PROPOSAL', 'NPC cannot execute the deferred player action');
    return p;
  }
}
