import { z } from 'zod';

/** Public wire contracts. Identity always comes from the server session, never a request body. */
export const Id = z.uuid();
export const Version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Timestamp = z.iso.datetime();
export const ShortText = z.string().trim().min(1).max(500);
export const ErrorCode = z.enum([
  'UNAUTHORIZED',
  'NOT_FOUND',
  'INVALID_INPUT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'BUSY',
  'RATE_LIMITED',
  'FORBIDDEN',
  'CONFLICT',
  'INVALID_STATE',
  'INVALID_COMMAND',
  'UNAVAILABLE',
  'AI_FAILED',
  'AI_TIMEOUT',
  'INVALID_AI_OUTPUT',
  'AI_TRUNCATED',
  'CANCELLED',
  'UNKNOWN',
  'INTERNAL',
]);
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCode,
    message: z.string(),
    retryable: z.boolean(),
    requestId: Id,
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
export const SessionSchema = z.strictObject({
  kind: z.enum(['guest', 'account']),
  csrfToken: z.string().min(32).max(128),
});

export const FactCategory = z.enum([
  'identity',
  'interest',
  'personality',
  'relationship',
  'experience',
  'wish',
]);
export const ProfileFactSchema = z.strictObject({
  id: Id,
  category: FactCategory,
  value: ShortText,
  status: z.enum(['suggested', 'confirmed', 'rejected']),
  sourceMessageIds: z.array(Id).max(20),
  updatedAt: Timestamp,
});
export const LifeDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
  .refine((value) => {
    const full = value.length === 4 ? value + '-01-01' : value.length === 7 ? value + '-01' : value;
    const date = new Date(full + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === full;
  }, '日期无效');
export const LifeEventSchema = z.strictObject({
  id: Id,
  title: z.string().trim().min(1).max(120),
  date: LifeDate.nullable(),
  feeling: z.number().int().min(-5).max(5).nullable(),
  sourceMessageIds: z.array(Id).max(20),
});
export const PersonSchema = z.strictObject({
  id: Id,
  name: z.string().trim().min(1).max(80),
  relationship: z.string().trim().min(1).max(80),
  assetId: Id.nullable(),
});
export type Person = z.infer<typeof PersonSchema>;
export const ProfileSchema = z.strictObject({
  id: Id,
  version: Version,
  facts: z.array(ProfileFactSchema).max(200),
  events: z.array(LifeEventSchema).max(100),
  people: z.array(PersonSchema).max(30).default([]),
  portraitAssetId: Id.nullable(),
  referenceAssetIds: z.array(Id).max(6).default([]),
  updatedAt: Timestamp,
});
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileFact = z.infer<typeof ProfileFactSchema>;
export type LifeEvent = z.infer<typeof LifeEventSchema>;
export const ProfileEditSchema = z.strictObject({
  expectedVersion: Version,
  operation: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('set-fact'),
      id: Id.optional(),
      category: FactCategory,
      value: ShortText,
    }),
    z.strictObject({ kind: z.literal('confirm-fact'), id: Id }),
    z.strictObject({ kind: z.literal('delete-fact'), id: Id }),
    z.strictObject({
      kind: z.literal('set-event'),
      event: LifeEventSchema.omit({ sourceMessageIds: true }),
    }),
    z.strictObject({ kind: z.literal('delete-event'), id: Id }),
    z.strictObject({ kind: z.literal('set-portrait'), assetId: Id.nullable() }),
    z.strictObject({ kind: z.literal('add-reference-photo'), assetId: Id }),
    z.strictObject({ kind: z.literal('delete-reference-photo'), assetId: Id }),
    z.strictObject({ kind: z.literal('set-person'), person: PersonSchema }),
    z.strictObject({ kind: z.literal('delete-person'), id: Id }),
  ]),
});
export type ProfileEdit = z.infer<typeof ProfileEditSchema>;

export const TaskScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('interview'), interviewId: Id }),
  z.strictObject({ kind: z.literal('profile'), profileId: Id }),
  z.strictObject({ kind: z.literal('world-build'), proposalId: Id }),
  z.strictObject({ kind: z.literal('world'), worldId: Id }),
  /* Media requests are effect-scoped text ids (`<eventId>_effect_<n>`), not uuids. */
  z.strictObject({ kind: z.literal('media'), assetRequestId: z.string().trim().min(1).max(200) }),
]);
export const TaskStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'conflict',
  'unknown',
  'cancelled',
]);
export const TaskSchema = z.strictObject({
  id: Id,
  scope: TaskScopeSchema,
  status: TaskStatus,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  errorCode: ErrorCode.nullable(),
  resultVersion: Version.nullable(),
});
export type Task = z.infer<typeof TaskSchema>;
export const InterviewMessageSchema = z.strictObject({
  id: Id,
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(8000),
  createdAt: Timestamp,
  taskId: Id.nullable(),
});
export type InterviewMessage = z.infer<typeof InterviewMessageSchema>;
export const InterviewQuestionTargetSchema = z.enum([
  'identity',
  'interest',
  'personality',
  'relationship',
  'experience',
  'wish',
]);
export const InterviewSchema = z.strictObject({
  id: Id,
  version: Version,
  messages: z.array(InterviewMessageSchema).max(200),
  activeTask: TaskSchema.nullable(),
  openQuestion: z.strictObject({ id: Id, version: Version }).nullable(),
  blockedTargets: z.array(InterviewQuestionTargetSchema).max(6),
});
export type Interview = z.infer<typeof InterviewSchema>;
export const InterviewSendSchema = z
  .strictObject({
    commandId: Id,
    expectedVersion: Version,
    text: z.string().trim().min(1).max(4000),
    questionId: Id.optional(),
    questionVersion: Version.optional(),
  })
  .superRefine((input, ctx) => {
    if ((input.questionId === undefined) !== (input.questionVersion === undefined))
      ctx.addIssue({
        code: 'custom',
        message: 'questionId and questionVersion must be provided together',
      });
  });
export type InterviewSend = z.infer<typeof InterviewSendSchema>;
export const InterviewSendResultSchema = z.strictObject({
  task: TaskSchema,
  interview: InterviewSchema,
});
export const InterviewWorkspaceSchema = z.strictObject({
  interview: InterviewSchema,
  profile: ProfileSchema,
});
export type InterviewWorkspace = z.infer<typeof InterviewWorkspaceSchema>;
export const RetryTaskSchema = z.strictObject({ commandId: Id });

/** World projections are read-only display contracts; write commands live with each feature route. */
const Visibility = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owner') }),
  z.strictObject({ kind: z.literal('world') }),
  z.strictObject({ kind: z.literal('actors'), actorIds: z.array(Id).min(1).max(20) }),
]);
export const WorldFactSchema = z
  .strictObject({
    id: Id,
    kind: z.enum(['canonical', 'belief']),
    text: ShortText,
    believedByActorId: Id.nullable(),
    sourceEventId: Id,
    validFrom: Timestamp,
    validUntil: Timestamp.nullable(),
    visibility: Visibility,
  })
  .superRefine((fact, ctx) => {
    if ((fact.kind === 'belief') !== (fact.believedByActorId !== null))
      ctx.addIssue({ code: 'custom', message: 'Only a belief requires an actor.' });
    if (fact.validUntil && fact.validUntil < fact.validFrom)
      ctx.addIssue({ code: 'custom', message: 'Invalid validity period.' });
  });
export const InvitationSchema = z.strictObject({
  id: Id,
  title: ShortText,
  at: Timestamp,
  status: z.enum(['proposed', 'confirmed', 'cancelled']),
  actorIds: z.array(Id).min(1).max(20),
  sourceEventId: Id,
});
export const WorldRevisionSchema = z.strictObject({
  id: Id,
  version: Version,
  assetRevision: Version,
});
export const AssetSchema = z.strictObject({
  id: Id,
  revision: Version,
  kind: z.enum(['upload', 'generated']),
  status: z.enum(['processing', 'ready', 'failed', 'deleted']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: Timestamp,
});
export type Asset = z.infer<typeof AssetSchema>;
