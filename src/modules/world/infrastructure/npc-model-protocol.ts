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
  plan: z.strictObject({ id: Id, summary: Text, sourceIds: z.array(Id).min(1).max(64) }),
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
const Wire = z.strictObject({
  protocol: z.literal(NPC_WIRE_PROTOCOL),
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

/** Transport binding only. Every result still passes the original proposal schema and kernel validation. */
export function decodeNpcWire(context: AgentValidationContext, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  // consideration is exclusive to this wire format. Recognize an omitted transport tag only;
  // the entire strict wire schema and original semantic/authority checks still apply.
  if (!('protocol' in raw) && !('consideration' in raw)) return raw; // Persisted canonical completions.
  const wire = Wire.parse('protocol' in raw ? raw : { ...raw, protocol: NPC_WIRE_PROTOCOL });
  const { protocol: _protocol, consideration, plans, executions = [], ...proposal } = wire;
  // A typed intent is mapped to the original proposal, never executed here or inferred from speech.
  for (const execution of executions) {
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
