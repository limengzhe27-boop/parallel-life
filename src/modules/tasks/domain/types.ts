/** Background work exists before a world: interviews and recommendations need no worldId. */
export type TaskScope =
  | { kind: 'interview'; interviewId: string }
  | { kind: 'profile'; profileId: string }
  | { kind: 'world-build'; proposalId: string }
  | { kind: 'world'; worldId: string }
  | { kind: 'media'; assetRequestId: string };
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'conflict' | 'unknown' | 'cancelled';
/** Contracts only: persistent queue/worker remain unimplemented. */
export type BackgroundTask = {
  id: string; ownerId: string; scope: TaskScope; status: TaskStatus;
  idempotencyKey: string; requestHash: string; createdAt: string; updatedAt: string;
  lease?: { token: string; expiresAt: string };
};
export type InterviewTaskInput = {
  scope: Extract<TaskScope, { kind: 'interview' }>;
  inputMessageId: string;
  expectedInterviewVersion: number;
  expectedProfileVersion: number;
};
