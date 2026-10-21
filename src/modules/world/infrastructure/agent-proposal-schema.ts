import { z } from 'zod';

const Id = z.string().min(1).max(240);
const Text = z.string().trim().min(1).max(12000);
const Basis = { sourceIds: z.array(Id).min(1).max(64) };
const DecisionKind = z.enum(['accepted', 'declined', 'negotiating', 'deferred', 'undecided']);
const Condition = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('at_or_after'),
    at: z.iso.datetime({ offset: true }),
    sourceId: Id,
  }),
  z.strictObject({
    kind: z.literal('result'),
    actionId: Id,
    outcome: z.enum(['succeeded', 'failed']),
  }),
  z.strictObject({
    kind: z.literal('player_decision'),
    responsibilityId: Id,
    decision: DecisionKind,
  }),
  z.strictObject({ kind: z.literal('at_place'), placeId: Id }),
  z.strictObject({ kind: z.literal('observation'), sourceId: Id }),
]);
export const ActorContinuationSchema = z.strictObject({
  decision: z.enum(['act', 'await_response', 'await_condition', 'no_current_intent']),
  reason: Text.max(2000),
  sourceIds: z.array(Id).min(1).max(64),
  planIds: z.array(Id).max(16),
  questionIds: z.array(Id).max(16),
  conditions: z.array(Condition).max(16),
});
export const AgentProposalSchema = z.strictObject({
  continuation: ActorContinuationSchema.optional(),
  episodeDecision: z
    .strictObject({
      requestId: Id,
      choice: z.enum(['engage', 'decline', 'defer', 'need_information', 'quiet']),
      reason: z.string().trim().min(1).max(2000),
      ...Basis,
    })
    .optional(),
  replyAssessments: z
    .array(
      z.strictObject({
        questionId: Id,
        sourceId: Id,
        quote: Text,
        relation: z.enum(['answer', 'decline_to_answer', 'defer_answer', 'unrelated', 'uncertain']),
      }),
    )
    .max(32)
    .optional(),
  questionWithdrawals: z
    .array(
      z.strictObject({
        questionId: Id,
        ...Basis,
        reason: Text,
      }),
    )
    .max(32)
    .optional(),
  locationReports: z
    .array(
      z.strictObject({
        subject: z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('player') }),
          z.strictObject({ kind: z.literal('actor'), actorId: Id }),
        ]),
        placeId: Id.nullable(),
        sourceId: Id,
        quote: z.string().trim().min(1).max(500),
        assertion: z.enum(['reported', 'hypothetical', 'uncertain']),
      }),
    )
    .max(8)
    .optional(),
  statements: z
    .array(
      z.strictObject({
        text: Text,
        dependsOnActionIds: z.array(Id).max(16),
        requestsPlayerReply: z.boolean().optional(),
        questionForResponsibilityId: Id.optional(),
      }),
    )
    .max(8)
    .default([]),
  goals: z
    .array(
      z.strictObject({
        ...Basis,
        id: Id,
        summary: Text,
        status: z.enum(['active', 'deferred', 'fulfilled', 'withdrawn']),
        resultIds: z.array(Id).max(32),
        endReason: Text.optional(),
      }),
    )
    .max(24)
    .default([]),
  plans: z
    .array(
      z.strictObject({
        ...Basis,
        id: Id,
        goalId: Id,
        summary: Text,
        status: z.enum(['active', 'waiting', 'blocked', 'finished', 'withdrawn']),
        actionIds: z.array(Id).max(32),
        nextActionId: Id.nullable(),
        triggers: z.array(Condition).max(16),
        missingConditions: z.array(Text).max(16),
        supersedesPlanId: Id.optional(),
      }),
    )
    .max(24)
    .default([]),
  actions: z
    .array(
      z.strictObject({
        ...Basis,
        id: Id,
        goalId: Id.nullable(),
        capability: Id,
        targetIds: z.array(Id).max(32).default([]),
        parameters: z.record(
          z.string().max(80),
          z.union([
            z.string().max(12000),
            z.number().finite(),
            z.boolean(),
            z.null(),
            z.array(Id).max(32),
          ]),
        ),
        preconditions: z.array(Condition).max(16).default([]),
        dependsOnActionIds: z.array(Id).max(16).default([]),
        handlesResponsibilityIds: z.array(Id).max(32).default([]),
        status: z
          .enum([
            'proposed',
            'ready',
            'waiting',
            'blocked',
            'executing',
            'succeeded',
            'failed',
            'withdrawn',
          ])
          .default('proposed'),
        resultId: Id.optional(),
      }),
    )
    .max(16)
    .default([]),
  responsibilities: z
    .array(
      z.strictObject({
        ...Basis,
        id: Id,
        subject: z.strictObject({
          kind: z.enum(['appointment', 'matter', 'episode', 'request']),
          id: Id,
        }),
        summary: Text,
        status: z.enum(['open', 'waiting', 'deferred', 'fulfilled', 'withdrawn', 'expired']),
        waitingOn: z.enum(['player', 'self', 'world']).nullable(),
        deadline: z.strictObject({ at: z.iso.datetime({ offset: true }), sourceId: Id }).optional(),
        nextCheck: z.array(Condition).max(16),
        resolutionResultId: Id.optional(),
        endReason: Text.optional(),
      }),
    )
    .max(32)
    .default([]),
  decisions: z
    .array(
      z.strictObject({
        id: Id,
        responsibilityId: Id,
        kind: DecisionKind,
        sourceId: Id,
        quote: Text,
      }),
    )
    .max(16)
    .default([]),
  focus: z
    .strictObject({
      channel: z.enum(['private', 'group', 'scene']),
      threadId: Id,
      subjectId: Id.nullable(),
      questionSourceId: Id.nullable(),
      replyToActorId: Id.nullable(),
    })
    .nullable()
    .optional(),
});
