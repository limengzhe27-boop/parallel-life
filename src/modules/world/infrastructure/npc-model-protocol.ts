import { z } from 'zod';
import type { AgentValidationContext } from '../domain/agent-kernel.ts';
import { validPlayerEpisodeManifest } from '../domain/player-episode-manifest.ts';
import { isActorEpisodeConsiderationInput } from '../domain/actor-episode-intent.ts';

export const NPC_WIRE_PROTOCOL = 'npc-wire-v1';
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
const Wire = z.strictObject({
  protocol: z.literal(NPC_WIRE_PROTOCOL),
  consideration: z
    .strictObject({
      choice: z.enum(['engage', 'decline', 'defer', 'need_information', 'quiet']),
      reason: Text.max(2000),
      basisSourceIds: z.array(Id).max(63),
    })
    .nullable(),
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

/** Transport binding only. Every result still passes the original proposal schema and kernel validation. */
export function decodeNpcWire(context: AgentValidationContext, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('protocol' in raw)) return raw; // Persisted canonical completions.
  const wire = Wire.parse(raw);
  const { protocol: _protocol, consideration, plans, ...proposal } = wire;
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
  return {
    ...proposal,
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
