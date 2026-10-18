import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentValidationContext } from '../domain/agent-kernel.ts';
import type { AgentCondition } from '../domain/agent-runtime.ts';

const Id = z.string().min(1).max(240);
const Summary = z.string().trim().min(1).max(500);
const Description = z.string().trim().min(1).max(6000);
const Basis = z.array(Id).min(1).max(64);

/** A person's explicit media choice, not a phrase-to-action inference or execution receipt. */
export const NativeMediaIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('not_requested') }),
  z.strictObject({ kind: z.literal('decline') }),
  z.strictObject({
    kind: z.literal('generate_image'),
    goalSummary: Summary,
    planSummary: Summary,
    parameters: z.strictObject({
      sceneDescription: Description,
      purpose: z.enum(['portrait', 'scene', 'memorial', 'evidence']),
    }),
    basisSourceIds: Basis,
  }),
  z.strictObject({
    kind: z.literal('generate_video'),
    goalSummary: Summary,
    planSummary: Summary,
    parameters: z.strictObject({
      actionDescription: Description,
      purpose: z.enum(['scene_moment', 'character_action']),
    }),
    basisSourceIds: Basis,
  }),
]);
export type NativeMediaIntent = z.infer<typeof NativeMediaIntentSchema>;
export type NativeMediaKind = 'generate_image' | 'generate_video';
/** Declared wire reference. Root may bind a statement dependency only for an explicit active intent. */
export const NPC_MEDIA_CURRENT_REF = 'media:current';

export type NativeMediaExecution = {
  goal: { kind: 'new'; id: string; summary: string; sourceIds: string[] };
  plan: { id: string; summary: string; sourceIds: string[] };
  action: {
    id: string;
    capability: 'media.generate_image' | 'media.generate_video';
    targetIds: string[];
    parameters: Record<string, string>;
    preconditions: AgentCondition[];
    dependsOnActionIds: string[];
    handlesResponsibilityIds: string[];
    sourceIds: string[];
  };
};

function invalid(code: string): never {
  // Operational code only; source text, model output and private identities never enter the error.
  throw Object.assign(Error(code), { code });
}

/** IDs belong to one actor, one accepted input and one media slot; clock movement cannot rename it. */
export function nativeMediaIntentIds(
  context: Pick<AgentValidationContext, 'state' | 'input'>,
  kind: NativeMediaKind,
) {
  const { worldId, actorId } = context.state;
  if (
    !Id.safeParse(worldId).success ||
    !Id.safeParse(actorId).success ||
    !Id.safeParse(context.input.sourceId).success ||
    !['generate_image', 'generate_video'].includes(kind)
  )
    invalid('NPC_MEDIA_INTENT_IDENTITY');
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        'npc-media-intent-v1',
        worldId,
        actorId,
        context.input.sourceId,
        kind,
        'media-slot:0',
      ]),
    )
    .digest('hex');
  return {
    goalId: `media-goal:${hash}`,
    planId: `media-plan:${hash}`,
    actionId: `media-action:${hash}`,
  };
}

/**
 * Compile an explicit unconditional "do now" intent into the existing nested Execution syntax.
 * No state mutation, factual inference, media dispatch, goal completion or choice is performed.
 * Waiting, personal refusal and unsupported capabilities must not be rewritten as an active intent.
 */
export function compileNpcMediaIntent(
  context: AgentValidationContext,
  raw: unknown,
): NativeMediaExecution | null {
  const parsed = NativeMediaIntentSchema.safeParse(raw);
  if (!parsed.success) invalid('NPC_MEDIA_INTENT_SHAPE');
  const intent = parsed.data;
  if (intent.kind === 'not_requested' || intent.kind === 'decline') return null;
  const capability =
    intent.kind === 'generate_image' ? 'media.generate_image' : 'media.generate_video';
  if (!context.channel.allowedCapabilities.includes(capability))
    invalid('NPC_MEDIA_INTENT_CAPABILITY');
  if (
    !intent.basisSourceIds.includes(context.input.sourceId) ||
    new Set(intent.basisSourceIds).size !== intent.basisSourceIds.length ||
    intent.basisSourceIds.some(
      (id) => context.sources.filter((source) => source.id === id).length !== 1,
    )
  )
    invalid('NPC_MEDIA_INTENT_SOURCE');
  const ids = nativeMediaIntentIds(context, intent.kind);
  const reserved = new Set(Object.values(ids));
  // Consult authoritative state too: hidden/redacted prior entries cannot be overwritten by a new slot.
  for (const state of [context.state, context.viewState].filter((item) => item !== undefined)) {
    if (
      [
        ...state.goals,
        ...state.plans,
        ...state.actions,
        ...state.responsibilities,
        ...state.decisions,
      ].some((item) => reserved.has(item.id))
    )
      invalid('NPC_MEDIA_INTENT_ID_CONFLICT');
  }
  const sourceIds = [...intent.basisSourceIds];
  return {
    goal: { kind: 'new', id: ids.goalId, summary: intent.goalSummary, sourceIds: [...sourceIds] },
    plan: { id: ids.planId, summary: intent.planSummary, sourceIds: [...sourceIds] },
    action: {
      id: ids.actionId,
      capability,
      targetIds: [context.state.actorId],
      parameters: { ...intent.parameters },
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      sourceIds: [...sourceIds],
    },
  };
}
