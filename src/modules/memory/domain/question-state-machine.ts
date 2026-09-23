import { DomainError } from './errors.ts';
import type { InterviewQuestion, QuestionTarget } from './types.ts';

export class QuestionStateMachine {
  private questions: InterviewQuestion[] = [];
  /** Only an explicit topic opt-out blocks future questions. A normal skip is temporary. */
  private blockedTargets: Set<QuestionTarget> = new Set();

  constructor(initialQuestions: InterviewQuestion[] = []) {
    this.questions = [...initialQuestions];
  }

  /**
   * 获取当前唯一处于 open 状态的问题
   */
  getOpenQuestion(): InterviewQuestion | null {
    const openList = this.questions.filter((q) => q.status === 'open');
    if (openList.length > 1) {
      throw new DomainError(
        'INVALID_STATE',
        'Multiple open interview questions detected. Invariant violated.',
      );
    }
    return openList[0] ?? null;
  }

  /**
   * 发起一个新问题：
   * 必须满足：当前无 open 问题，且该 target 没有被用户明确要求避开
   */
  proposeQuestion(params: {
    id: string;
    ownerId: string;
    interviewId: string;
    text: string;
    target: QuestionTarget;
    sourceMessageId: string;
    version?: number;
    now?: string;
  }): InterviewQuestion {
    const openQ = this.getOpenQuestion();
    if (openQ) {
      throw new DomainError(
        'CONFLICT',
        `Cannot propose a new question while question ${openQ.id} is still open`,
      );
    }

    if (this.blockedTargets.has(params.target)) {
      throw new DomainError(
        'INVALID_COMMAND',
        `Target '${params.target}' was blocked by the user and must not be repeated`,
      );
    }

    const newQuestion: InterviewQuestion = {
      id: params.id,
      ownerId: params.ownerId,
      interviewId: params.interviewId,
      text: params.text,
      target: params.target,
      status: 'open',
      sourceMessageId: params.sourceMessageId,
      createdAt: params.now ?? new Date().toISOString(),
      version: params.version ?? 0,
    };

    this.questions.push(newQuestion);
    return newQuestion;
  }

  /**
   * 回答当前问题
   */
  answer(questionId: string, answerMessageId: string, now?: string): InterviewQuestion {
    const q = this.questions.find((item) => item.id === questionId);
    if (!q || q.status !== 'open') {
      throw new DomainError('NOT_FOUND', `Open question ${questionId} not found`);
    }

    q.status = 'answered';
    q.answerMessageId = answerMessageId;
    q.closedAt = now ?? new Date().toISOString();
    q.version += 1;
    return q;
  }

  /**
   * 用户跳过当前问题。跳过不会永久封锁该主题，后续可在更合适的语境重新询问。
   */
  skip(questionId: string, now?: string): InterviewQuestion {
    const q = this.questions.find((item) => item.id === questionId);
    if (!q || q.status !== 'open') {
      throw new DomainError('NOT_FOUND', `Open question ${questionId} not found`);
    }

    q.status = 'skipped';
    q.closedAt = now ?? new Date().toISOString();
    q.version += 1;
    return q;
  }

  /**
   * 用户拒绝或反驳该问题
   */
  dismiss(questionId: string, now?: string): InterviewQuestion {
    const q = this.questions.find((item) => item.id === questionId);
    if (!q || q.status !== 'open') {
      throw new DomainError('NOT_FOUND', `Open question ${questionId} not found`);
    }

    q.status = 'dismissed';
    q.closedAt = now ?? new Date().toISOString();
    q.version += 1;
    return q;
  }

  /** 用户明确要求不再讨论某个主题时调用。 */
  blockTarget(target: QuestionTarget): void {
    this.blockedTargets.add(target);
  }

  getAllQuestions(): InterviewQuestion[] {
    return [...this.questions];
  }
}
