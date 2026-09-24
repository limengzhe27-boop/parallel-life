import { z } from 'zod';
import { Id, Timestamp, Version } from './api.ts';

/** Memory provenance crosses legacy worlds and guest accounts, whose IDs are opaque text. */
const MemoryId = z.string().trim().min(1).max(200);
const MemoryOwnerId = z.string().trim().min(1).max(200);

export const MemoryScopeSchema = z.enum(['profile', 'branch', 'character']);
export type MemoryScope = import('../modules/memory/domain/types.ts').MemoryScope;

export const MemoryKindSchema = z.enum([
  'preference',
  'commitment',
  'belief',
  'summary',
  'correction',
  'episode',
]);
export type MemoryKind = import('../modules/memory/domain/types.ts').MemoryKind;

export const MemorySourceTypeSchema = z.enum([
  'user_statement',
  'world_event',
  'agent_inference',
  'user_correction',
  'conversation_summary',
]);
export type MemorySourceType = import('../modules/memory/domain/types.ts').MemorySourceType;

export const MemoryStatusSchema = z.enum(['active', 'superseded', 'forgotten']);
export type MemoryStatus = import('../modules/memory/domain/types.ts').MemoryStatus;

export const MemoryRecordSchema = z.strictObject({
  id: MemoryId,
  ownerId: MemoryOwnerId,
  /** Database column and domain name. A record belongs to exactly one scope. */
  scopeType: MemoryScopeSchema,
  scopeId: MemoryId,
  branchId: MemoryId.optional(),
  characterId: MemoryId.optional(),
  kind: MemoryKindSchema,
  text: z.string().trim().min(1).max(4000),
  key: z.string().trim().min(1).max(128).optional(),
  sourceType: MemorySourceTypeSchema,
  sourceIds: z.array(MemoryId).max(32),
  status: MemoryStatusSchema,
  importance: z.number().int().min(1).max(10),
  createdAt: Timestamp,
});
export type MemoryRecord = import('../modules/memory/domain/types.ts').MemoryRecord;

export const MemorySourceRefTypeSchema = z.enum([
  'interview_message',
  'world_message',
  'world_event',
  'profile_edit',
  'conversation_summary',
]);
export type MemorySourceRefType = import('../modules/memory/domain/types.ts').MemorySourceRefType;

export const MemorySourceRefSchema = z.strictObject({
  memoryId: MemoryId,
  ownerId: MemoryOwnerId,
  sourceType: MemorySourceRefTypeSchema,
  sourceId: MemoryId,
});
export type MemorySourceRef = import('../modules/memory/domain/types.ts').MemorySourceRef;

export const QuestionTargetSchema = z.enum([
  'identity',
  'interest',
  'personality',
  'relationship',
  'experience',
  'wish',
]);
export type QuestionTarget = import('../modules/memory/domain/types.ts').QuestionTarget;

export const QuestionStatusSchema = z.enum(['open', 'answered', 'skipped', 'dismissed']);
export type QuestionStatus = import('../modules/memory/domain/types.ts').QuestionStatus;

/** Commands exposed by the interview UI. Answers are created by sending the next chat message. */
export const InterviewQuestionActionSchema = z.strictObject({
  commandId: Id,
  questionId: Id,
  expectedVersion: Version,
  action: z.enum(['skip', 'dismiss', 'block']),
});
export type InterviewQuestionAction = z.infer<typeof InterviewQuestionActionSchema>;

export const InterviewQuestionSchema = z.strictObject({
  id: Id,
  ownerId: MemoryOwnerId,
  /** Optional for legacy interview rows; new handlers should always provide it. */
  interviewId: Id.optional(),
  text: z.string().trim().min(1).max(2000),
  target: QuestionTargetSchema,
  status: QuestionStatusSchema,
  sourceMessageId: Id,
  answerMessageId: Id.optional(),
  createdAt: Timestamp,
  closedAt: Timestamp.optional(),
  version: Version,
});
export type InterviewQuestion = import('../modules/memory/domain/types.ts').InterviewQuestion;
export const InterviewQuestionListSchema = z.strictObject({
  questions: z.array(InterviewQuestionSchema).max(200),
});
export const InterviewQuestionActionResultSchema = z.strictObject({
  question: InterviewQuestionSchema,
});

export const MemoryCandidateSchema = z.strictObject({
  id: Id,
  ownerId: MemoryOwnerId,
  sourceType: z.enum(['interview', 'branch']),
  sourceScopeId: MemoryId,
  category: z.enum(['identity', 'interest', 'personality', 'relationship', 'experience', 'wish']),
  text: z.string().trim().min(1).max(2000),
  eventDate: z
    .string()
    .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
    .nullable()
    .optional(),
  sourceMessageIds: z.array(MemoryId).min(1).max(8),
  status: z.enum(['suggested', 'confirmed', 'rejected']),
  createdAt: Timestamp,
  confirmedAt: Timestamp.optional(),
});
export type MemoryCandidate = import('../modules/memory/domain/types.ts').MemoryCandidate;

export const MemoryCandidateStatusSchema = z.enum(['suggested', 'confirmed', 'rejected']);
export const MemoryCandidateDecisionSchema = z.strictObject({
  commandId: Id,
  candidateId: Id,
  action: z.enum(['confirm', 'reject']),
});
export type MemoryCandidateDecision = z.infer<typeof MemoryCandidateDecisionSchema>;
/** First confirmation for a branch memory. The literal true prevents accidental writeback. */
export const MemoryCandidateFromBranchSchema = z.strictObject({
  commandId: Id,
  branchMemoryId: MemoryId,
  category: QuestionTargetSchema,
  userConsented: z.literal(true),
});
export type MemoryCandidateFromBranch = z.infer<typeof MemoryCandidateFromBranchSchema>;
export const MemoryCandidateListSchema = z.strictObject({
  candidates: z.array(MemoryCandidateSchema).max(200),
});
export const MemoryCandidateDecisionResultSchema = z.strictObject({
  candidate: MemoryCandidateSchema,
});

const MemoryEditRef = z.string().trim().min(1).max(200);
/** The user's own correction or forgetting of a memory; never inferred by an agent. */
export const MemoryEditRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    commandId: Id,
    action: z.literal('correct'),
    scopeType: MemoryScopeSchema,
    scopeId: MemoryEditRef,
    key: z.string().trim().min(1).max(128),
    newText: z.string().trim().min(1).max(4000),
  }),
  z.strictObject({
    commandId: Id,
    action: z.literal('forget'),
    targetMemoryId: MemoryEditRef,
  }),
]);
export type MemoryEditRequest = z.infer<typeof MemoryEditRequestSchema>;
export const MemoryEditReceiptSchema = z.strictObject({
  status: z.literal('committed'),
  commandId: Id,
  record: z.strictObject({
    id: MemoryEditRef,
    scopeType: MemoryScopeSchema,
    scopeId: MemoryEditRef,
    kind: MemoryKindSchema,
    text: z.string().min(1).max(4000),
    status: MemoryStatusSchema,
  }),
});
export const MemoryListSchema = z.strictObject({
  memories: z.array(
    z.strictObject({
      id: MemoryEditRef,
      scopeType: MemoryScopeSchema,
      scopeId: MemoryEditRef,
      characterId: MemoryEditRef.nullable(),
      kind: MemoryKindSchema,
      text: z.string().min(1).max(4000),
      status: MemoryStatusSchema,
      importance: z.number().int().min(1).max(10),
      createdAt: Timestamp,
    }),
  ),
});
