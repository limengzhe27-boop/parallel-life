import { isoInstant } from './validation.ts';

export type QuestionChannel = 'private' | 'group' | 'scene';
export type AgentQuestion = {
  id: string;
  channel: QuestionChannel;
  threadId: string;
  sourceId: string;
  text: string;
  askedAt: string;
  status: 'open' | 'answered' | 'withdrawn';
  responsibilityId?: string;
  resolution?: {
    sourceId: string;
    quote?: string;
    at: string;
    kind: 'answer' | 'decline_to_answer' | 'withdrawal';
    reason?: string;
  };
};
export type QuestionReplyAssessment = {
  questionId: string;
  sourceId: string;
  quote: string;
  relation: 'answer' | 'decline_to_answer' | 'defer_answer' | 'unrelated' | 'uncertain';
};
export type QuestionWithdrawal = { questionId: string; sourceIds: string[]; reason: string };
export type QuestionState = { worldId: string; actorId: string; questions: AgentQuestion[] };
type Thread = { channel: QuestionChannel; threadId: string };
/** Authorization evidence is supplied by the kernel, never accepted directly from model output. */
export type QuestionContext = {
  worldId: string;
  actorId: string;
  storyAt: string;
  input?: Thread & { origin: 'player'; sourceId: string; text: string };
  questionSources: readonly (Thread & { questionId: string; sourceId: string })[];
  withdrawalSourceIds: readonly string[];
  crossChannelGrants?: readonly {
    questionId: string;
    questionSourceId: string;
    inputSourceId: string;
    from: Thread;
    to: Thread;
  }[];
};
export type QuestionApplicationReceipt = {
  questionId: string;
  questionSourceId: string;
  sourceIds: string[];
  at: string;
  relation: QuestionReplyAssessment['relation'] | 'withdrawal';
  statusBefore: AgentQuestion['status'];
  statusAfter: AgentQuestion['status'];
  replayed: boolean;
  quote?: string;
  reason?: string;
};
export class AgentQuestionError extends Error {
  readonly code = 'INVALID_QUESTION_CHANGE';
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = 'AgentQuestionError';
  }
}
function requireQuestion(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new AgentQuestionError(reason);
}
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
function instant(value: string): number {
  try {
    isoInstant(value);
  } catch {
    throw new AgentQuestionError('INVALID_TIME');
  }
  return Date.parse(value);
}
function validThread(value: Thread) {
  requireQuestion(['private', 'group', 'scene'].includes(value.channel), 'INVALID_CHANNEL');
  requireQuestion(nonempty(value.threadId), 'INVALID_THREAD');
}
function sameThread(a: Thread, b: Thread) {
  return a.channel === b.channel && a.threadId === b.threadId;
}
function validQuestion(question: AgentQuestion) {
  validThread(question);
  for (const value of [question.id, question.sourceId, question.text])
    requireQuestion(nonempty(value), 'INVALID_QUESTION');
  requireQuestion(
    question.responsibilityId === undefined || nonempty(question.responsibilityId),
    'INVALID_RESPONSIBILITY_LINK',
  );
  const askedAt = instant(question.askedAt);
  if (question.status === 'open') {
    requireQuestion(question.resolution === undefined, 'OPEN_QUESTION_HAS_RESOLUTION');
    return;
  }
  requireQuestion(['answered', 'withdrawn'].includes(question.status), 'INVALID_STATUS');
  const resolution = question.resolution;
  requireQuestion(resolution && nonempty(resolution.sourceId), 'MISSING_RESOLUTION');
  requireQuestion(instant(resolution.at) >= askedAt, 'RESOLUTION_BEFORE_QUESTION');
  if (question.status === 'withdrawn')
    requireQuestion(
      resolution.kind === 'withdrawal' && nonempty(resolution.reason),
      'INVALID_WITHDRAWAL_RESOLUTION',
    );
  else
    requireQuestion(
      ['answer', 'decline_to_answer'].includes(resolution.kind) && nonempty(resolution.quote),
      'INVALID_ANSWER_RESOLUTION',
    );
}

/** Pure state change only: caller certifies identity, visibility and source provenance first.
 * An answered question never produces a player commitment, action result or fulfilled responsibility.
 * Only the same source and same result may replay; terminal questions reject other edits.
 */
export function applyQuestionChanges(
  state: QuestionState,
  context: QuestionContext,
  changes: {
    replyAssessments?: readonly QuestionReplyAssessment[];
    withdrawals?: readonly QuestionWithdrawal[];
  },
): { state: QuestionState; applied: QuestionApplicationReceipt[] } {
  requireQuestion(
    nonempty(state.worldId) &&
      nonempty(state.actorId) &&
      state.worldId === context.worldId &&
      state.actorId === context.actorId,
    'QUESTION_IDENTITY',
  );
  const now = instant(context.storyAt);
  const next = structuredClone(state);
  const questions = new Map<string, AgentQuestion>();
  for (const question of next.questions) {
    validQuestion(question);
    requireQuestion(!questions.has(question.id), 'DUPLICATE_QUESTION');
    requireQuestion(instant(question.askedAt) <= now, 'FUTURE_QUESTION');
    if (question.resolution)
      requireQuestion(instant(question.resolution.at) <= now, 'FUTURE_RESOLUTION');
    questions.set(question.id, question);
  }
  const changed = new Set<string>();
  const applied: QuestionApplicationReceipt[] = [];
  const target = (id: string) => {
    requireQuestion(!changed.has(id), 'DUPLICATE_QUESTION_CHANGE');
    const question = questions.get(id);
    requireQuestion(question, 'UNKNOWN_QUESTION');
    requireQuestion(
      context.questionSources.some(
        (source) =>
          source.questionId === question.id &&
          source.sourceId === question.sourceId &&
          sameThread(source, question),
      ),
      'QUESTION_SOURCE_NOT_AUTHORIZED',
    );
    changed.add(id);
    return question;
  };
  for (const assessment of changes.replyAssessments ?? []) {
    const question = target(assessment.questionId);
    const input = context.input;
    requireQuestion(input?.origin === 'player', 'NOT_CURRENT_PLAYER_INPUT');
    validThread(input);
    requireQuestion(
      nonempty(input.sourceId) && assessment.sourceId === input.sourceId,
      'NOT_CURRENT_INPUT_SOURCE',
    );
    requireQuestion(input.sourceId !== question.sourceId, 'QUESTION_CANNOT_ANSWER_ITSELF');
    requireQuestion(
      nonempty(assessment.quote) && input.text.includes(assessment.quote),
      'ANSWER_QUOTE',
    );
    requireQuestion(
      ['answer', 'decline_to_answer', 'defer_answer', 'unrelated', 'uncertain'].includes(
        assessment.relation,
      ),
      'INVALID_RELATION',
    );
    requireQuestion(
      sameThread(question, input) ||
        context.crossChannelGrants?.some(
          (grant) =>
            grant.questionId === question.id &&
            grant.questionSourceId === question.sourceId &&
            grant.inputSourceId === input.sourceId &&
            sameThread(grant.from, question) &&
            sameThread(grant.to, input),
        ),
      'CROSS_CHANNEL_ANSWER_NOT_AUTHORIZED',
    );
    const statusBefore = question.status;
    const replayed = statusBefore !== 'open';
    if (replayed)
      requireQuestion(
        question.status === 'answered' &&
          question.resolution?.sourceId === input.sourceId &&
          question.resolution.kind === assessment.relation &&
          question.resolution.quote === assessment.quote,
        'TERMINAL_QUESTION',
      );
    else if (assessment.relation === 'answer' || assessment.relation === 'decline_to_answer') {
      question.status = 'answered';
      question.resolution = {
        sourceId: input.sourceId,
        quote: assessment.quote,
        at: context.storyAt,
        kind: assessment.relation,
      };
    }
    applied.push({
      questionId: question.id,
      questionSourceId: question.sourceId,
      sourceIds: [input.sourceId],
      at: context.storyAt,
      relation: assessment.relation,
      statusBefore,
      statusAfter: question.status,
      replayed,
      quote: assessment.quote,
    });
  }
  for (const withdrawal of changes.withdrawals ?? []) {
    const question = target(withdrawal.questionId);
    requireQuestion(nonempty(withdrawal.reason), 'WITHDRAWAL_REASON');
    requireQuestion(
      withdrawal.sourceIds.length > 0 &&
        new Set(withdrawal.sourceIds).size === withdrawal.sourceIds.length &&
        withdrawal.sourceIds.every(
          (source) => nonempty(source) && context.withdrawalSourceIds.includes(source),
        ),
      'WITHDRAWAL_SOURCE_NOT_AUTHORIZED',
    );
    const statusBefore = question.status;
    const replayed = statusBefore !== 'open';
    if (replayed)
      requireQuestion(
        question.status === 'withdrawn' &&
          question.resolution &&
          question.resolution.sourceId === withdrawal.sourceIds[0] &&
          question.resolution.kind === 'withdrawal' &&
          question.resolution.reason === withdrawal.reason,
        'TERMINAL_QUESTION',
      );
    else {
      question.status = 'withdrawn';
      question.resolution = {
        sourceId: withdrawal.sourceIds[0]!,
        at: context.storyAt,
        kind: 'withdrawal',
        reason: withdrawal.reason,
      };
    }
    applied.push({
      questionId: question.id,
      questionSourceId: question.sourceId,
      sourceIds: [...withdrawal.sourceIds],
      at: context.storyAt,
      relation: 'withdrawal',
      statusBefore,
      statusAfter: 'withdrawn',
      replayed,
      reason: withdrawal.reason,
    });
  }
  return { state: next, applied };
}

/** The server must have verified each actual message, membership and source version beforehand. */
export type ProvenPendingQuestion = {
  actorId: string;
  question: AgentQuestion;
  sourceWorldVersion: number;
};
export type QuestionResponderSelection =
  | { kind: 'none' }
  | { kind: 'selected'; actorId: string; questionIds: string[] }
  | { kind: 'ambiguous'; actorIds: string[]; reason: 'multiple_threads' | 'same_version' };

/** Ordinary interjections are absent from this pending-question set and cannot hide older questions. */
export function selectQuestionResponder(input: {
  channel?: QuestionChannel;
  threadId?: string;
  questions: readonly ProvenPendingQuestion[];
}): QuestionResponderSelection {
  const pending = input.questions.filter(
    (item) =>
      item.question.status === 'open' &&
      (input.channel === undefined || item.question.channel === input.channel) &&
      (input.threadId === undefined || item.question.threadId === input.threadId),
  );
  if (!pending.length) return { kind: 'none' };
  const ids = new Set<string>();
  for (const item of pending) {
    validQuestion(item.question);
    requireQuestion(nonempty(item.actorId), 'INVALID_ACTOR');
    requireQuestion(
      Number.isSafeInteger(item.sourceWorldVersion) && item.sourceWorldVersion >= 0,
      'INVALID_SOURCE_VERSION',
    );
    requireQuestion(!ids.has(item.question.id), 'DUPLICATE_QUESTION');
    ids.add(item.question.id);
  }
  const actors = (items: typeof pending) => [...new Set(items.map((item) => item.actorId))].sort();
  const threads = new Set(
    pending.map((item) => JSON.stringify([item.question.channel, item.question.threadId])),
  );
  if (threads.size > 1)
    return { kind: 'ambiguous', actorIds: actors(pending), reason: 'multiple_threads' };
  const latest = pending.reduce((version, item) => Math.max(version, item.sourceWorldVersion), 0);
  const newest = pending.filter((item) => item.sourceWorldVersion === latest);
  const candidates = actors(newest);
  if (candidates.length > 1)
    return { kind: 'ambiguous', actorIds: candidates, reason: 'same_version' };
  return {
    kind: 'selected',
    actorId: candidates[0]!,
    questionIds: newest.map((item) => item.question.id).sort(),
  };
}
