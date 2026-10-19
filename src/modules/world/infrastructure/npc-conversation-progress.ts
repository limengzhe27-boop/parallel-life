import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';

type ProgressInput = Pick<AgentSnapshot, 'viewState' | 'sources' | 'channel'>;

/** A compact, read-only view of already authorized conversation state. */
export type NpcConversationProgress = {
  questions: {
    id: string;
    sourceId: string;
    text: string;
    textTruncated?: true;
    status: 'open' | 'answered';
    responsibilityId?: string;
    answer?: {
      sourceId: string;
      quote: string;
      quoteTruncated?: true;
      kind: 'answer' | 'decline_to_answer';
      at: string;
    };
  }[];
  waitingOnPlayer: {
    id: string;
    summary: string;
    summaryTruncated?: true;
    status: 'open' | 'waiting' | 'deferred';
    sourceIds: string[];
    relatedQuestionIds: string[];
  }[];
};

const MAX_EXCERPT_CHARS = 500;
function excerpt(value: string): { value: string; truncated: boolean } {
  const characters = Array.from(value);
  return {
    value: characters.slice(0, MAX_EXCERPT_CHARS).join(''),
    truncated: characters.length > MAX_EXCERPT_CHARS,
  };
}

/**
 * Projection only: an answered question is evidence of a reply, never proof that
 * a linked responsibility was fulfilled. No missing thread affiliation is guessed.
 */
export function projectNpcConversationProgress(input: ProgressInput): NpcConversationProgress {
  const authorized = new Set(
    input.sources
      .filter((source) => source.usage !== 'private_strategy')
      .map((source) => source.id),
  );
  const questions = (input.viewState.questions ?? [])
    .filter(
      (question) =>
        question.channel === input.channel.kind &&
        question.threadId === input.channel.threadId &&
        authorized.has(question.sourceId) &&
        question.text.trim() &&
        (question.status === 'open' ||
          (question.status === 'answered' &&
            question.resolution &&
            (question.resolution.kind === 'answer' ||
              question.resolution.kind === 'decline_to_answer') &&
            authorized.has(question.resolution.sourceId) &&
            question.resolution.quote?.trim())),
    )
    .slice(-8)
    .map((question) => {
      const text = excerpt(question.text);
      const answer = question.resolution?.quote ? excerpt(question.resolution.quote) : null;
      return {
        id: question.id,
        sourceId: question.sourceId,
        text: text.value,
        ...(text.truncated ? { textTruncated: true as const } : {}),
        status: question.status as 'open' | 'answered',
        ...(question.responsibilityId ? { responsibilityId: question.responsibilityId } : {}),
        ...(question.status === 'answered' && question.resolution && answer
          ? {
              answer: {
                sourceId: question.resolution.sourceId,
                quote: answer.value,
                ...(answer.truncated ? { quoteTruncated: true as const } : {}),
                kind: question.resolution.kind as 'answer' | 'decline_to_answer',
                at: question.resolution.at,
              },
            }
          : {}),
      };
    });
  const focus = input.viewState.focus;
  const focusedId =
    focus?.channel === input.channel.kind && focus.threadId === input.channel.threadId
      ? focus.subjectId
      : null;
  const waitingOnPlayer = input.viewState.responsibilities
    .filter(
      (responsibility) =>
        responsibility.waitingOn === 'player' &&
        (responsibility.status === 'open' ||
          responsibility.status === 'waiting' ||
          responsibility.status === 'deferred') &&
        responsibility.sourceIds.every((id) => authorized.has(id)) &&
        (responsibility.id === focusedId ||
          questions.some((question) => question.responsibilityId === responsibility.id)),
    )
    .slice(-8)
    .map((responsibility) => {
      const summary = excerpt(responsibility.summary);
      return {
        id: responsibility.id,
        summary: summary.value,
        ...(summary.truncated ? { summaryTruncated: true as const } : {}),
        status: responsibility.status as 'open' | 'waiting' | 'deferred',
        sourceIds: [...responsibility.sourceIds],
        relatedQuestionIds: questions
          .filter((question) => question.responsibilityId === responsibility.id)
          .map((question) => question.id),
      };
    });
  return { questions, waitingOnPlayer };
}
