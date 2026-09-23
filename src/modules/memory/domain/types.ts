/** Pure domain types. Protocol validation belongs to src/contracts/memory.ts. */
export type MemoryScope = 'profile' | 'branch' | 'character';
export type MemoryKind =
  'preference' | 'commitment' | 'belief' | 'summary' | 'correction' | 'episode';
export type MemorySourceType =
  'user_statement' | 'world_event' | 'agent_inference' | 'user_correction' | 'conversation_summary';
export type MemoryStatus = 'active' | 'superseded' | 'forgotten';

export interface MemoryRecord {
  id: string;
  ownerId: string;
  scopeType: MemoryScope;
  scopeId: string;
  branchId?: string;
  characterId?: string;
  kind: MemoryKind;
  text: string;
  key?: string;
  sourceType: MemorySourceType;
  sourceIds: string[];
  status: MemoryStatus;
  importance: number;
  createdAt: string;
}

export type MemorySourceRefType =
  'interview_message' | 'world_message' | 'world_event' | 'profile_edit' | 'conversation_summary';
export interface MemorySourceRef {
  memoryId: string;
  ownerId: string;
  sourceType: MemorySourceRefType;
  sourceId: string;
}

export type QuestionTarget =
  'identity' | 'interest' | 'personality' | 'relationship' | 'experience' | 'wish';
export type QuestionStatus = 'open' | 'answered' | 'skipped' | 'dismissed';
export interface InterviewQuestion {
  id: string;
  ownerId: string;
  interviewId?: string;
  text: string;
  target: QuestionTarget;
  status: QuestionStatus;
  sourceMessageId: string;
  answerMessageId?: string;
  createdAt: string;
  closedAt?: string;
  version: number;
}

export type CandidateCategory = QuestionTarget;
export type CandidateStatus = 'suggested' | 'confirmed' | 'rejected';
export interface MemoryCandidate {
  id: string;
  ownerId: string;
  sourceType: 'interview' | 'branch';
  sourceScopeId: string;
  category: CandidateCategory;
  text: string;
  eventDate?: string | null;
  sourceMessageIds: string[];
  status: CandidateStatus;
  createdAt: string;
  confirmedAt?: string;
}
