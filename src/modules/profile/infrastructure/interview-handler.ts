import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Id, Version } from '../../../contracts/api.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { InterviewPlanner, INTERVIEW_PROMPT_VERSION } from './interview-planner.ts';
import {
  appendAssistantMessage,
  incrementInterviewVersion,
  readWorkspace,
} from './interview-repository.ts';
import { createCandidateInTransaction } from '../../memory/infrastructure/candidate-repository.ts';
import {
  createQuestionInTransaction,
  openQuestionInTransaction,
  questionTargetBlockedInTransaction,
} from '../../memory/infrastructure/question-repository.ts';
import { applyConfirmedCandidateInTransaction, isSimilarText } from './profile-repository.ts';
const Input = z.strictObject({
  interviewId: Id,
  inputMessageId: Id,
  expectedInterviewVersion: Version,
});
async function hasUserSources(
  sql: SqlClient,
  ownerId: string,
  interviewId: string,
  sourceMessageIds: string[],
) {
  const ids = [...new Set(sourceMessageIds)];
  if (!ids.length) return false;
  const result = await sql.query(
    `SELECT id FROM parallel_life.interview_messages
     WHERE owner_id=$1 AND interview_id=$2 AND role='user' AND id=ANY($3::uuid[])`,
    [ownerId, interviewId, ids],
  );
  return result.rowCount === ids.length;
}
export function interviewHandler(
  queue: PostgresTaskQueue,
  planner: InterviewPlanner,
  modelName: string,
) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const input = Input.parse(lease.input),
      started = Date.now();
    if (input.interviewId !== lease.scopeId) throw Error('INVALID_SCOPE');
    const base = await queue.read(lease, (sql) => readWorkspace(sql, lease.ownerId));
    if (
      base.interview.version !== input.expectedInterviewVersion ||
      base.interview.messages.at(-1)?.id !== input.inputMessageId
    ) {
      await queue.finish(lease, { status: 'conflict', errorCode: 'VERSION_CONFLICT' });
      return;
    }
    const proposal = await planner.propose(
      base.profile,
      base.interview.messages,
      signal,
      base.interview.blockedTargets,
    );
    await queue.commit(lease, async (sql) => {
      const current = (
        await sql.query('SELECT version FROM parallel_life.interviews WHERE id=$1 FOR UPDATE', [
          input.interviewId,
        ])
      ).rows[0];
      if (!current || current.version !== input.expectedInterviewVersion)
        return { value: undefined, outcome: { status: 'conflict', errorCode: 'VERSION_CONFLICT' } };
      // 1. 严格防重：过滤掉 facts 中与 events 重复提取的经历
      const eventCandidates = proposal.events.map((event) => ({
        category: 'experience' as const,
        text: event.title.trim(),
        eventDate: event.date ?? undefined,
        sourceMessageIds: event.sourceMessageIds,
      }));

      const filteredFactCandidates = proposal.facts
        .filter((fact) => {
          if (
            fact.category === 'experience' &&
            eventCandidates.some((ev) => isSimilarText(ev.text, fact.value))
          ) {
            return false;
          }
          return true;
        })
        .map((fact) => ({
          category: fact.category,
          text: fact.value.trim(),
          eventDate: undefined,
          sourceMessageIds: fact.sourceMessageIds,
        }));

      // 2. 批次内去重：相同或相似文本只保留一条，合并来源
      const rawCandidates = [...filteredFactCandidates, ...eventCandidates];
      const deduplicatedCandidates: typeof rawCandidates = [];
      for (const item of rawCandidates) {
        const existing = deduplicatedCandidates.find(
          (c) => c.category === item.category && isSimilarText(c.text, item.text),
        );
        if (existing) {
          existing.sourceMessageIds = [
            ...new Set([...existing.sourceMessageIds, ...item.sourceMessageIds]),
          ];
          if (!existing.eventDate && item.eventDate) existing.eventDate = item.eventDate;
        } else {
          deduplicatedCandidates.push({ ...item });
        }
      }

      // 3. 直接写入用户 Profile，状态直接确认为 confirmed，用户可在“我的”页面自由编辑与删除
      for (const candidate of deduplicatedCandidates) {
        const sourceMessageIds = [...new Set(candidate.sourceMessageIds)];
        if (!(await hasUserSources(sql, lease.ownerId, input.interviewId, sourceMessageIds)))
          continue;

        // 直接写入真实 Profile（内置相似度与历史防重保护）
        await applyConfirmedCandidateInTransaction(sql, lease.ownerId, candidate);

        // 同时以 confirmed 状态保留候选溯源审计记录
        await createCandidateInTransaction(sql, lease.ownerId, {
          id: randomUUID(),
          ownerId: lease.ownerId,
          sourceType: 'interview',
          sourceScopeId: input.interviewId,
          category: candidate.category,
          text: candidate.text,
          eventDate: candidate.eventDate,
          sourceMessageIds,
          status: 'confirmed',
          createdAt: new Date().toISOString(),
        });
      }

      // Persist at most one open question per interview. If an earlier open
      // question exists, the reply remains useful and the new question is
      // intentionally discarded instead of violating the database invariant.
      if (
        proposal.question &&
        !(await questionTargetBlockedInTransaction(
          sql,
          lease.ownerId,
          input.interviewId,
          proposal.question.target,
        ))
      ) {
        const openQuestion = await openQuestionInTransaction(sql, lease.ownerId, input.interviewId);
        if (!openQuestion) {
          await createQuestionInTransaction(sql, lease.ownerId, {
            id: randomUUID(),
            ownerId: lease.ownerId,
            interviewId: input.interviewId,
            text: proposal.question.text,
            target: proposal.question.target,
            status: 'open',
            sourceMessageId: input.inputMessageId,
            createdAt: new Date().toISOString(),
            version: 0,
          });
        }
      }
      await appendAssistantMessage(sql, lease.ownerId, input.interviewId, proposal.reply, lease.id);
      await incrementInterviewVersion(sql, input.interviewId);
      return {
        value: undefined,
        outcome: {
          status: 'succeeded',
          resultVersion: current.version + 1,
          model: modelName,
          promptVersion: INTERVIEW_PROMPT_VERSION,
          durationMs: Date.now() - started,
        },
      };
    });
  };
}
