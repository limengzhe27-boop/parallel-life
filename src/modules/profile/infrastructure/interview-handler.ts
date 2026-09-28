import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Id, ProfileSchema, Version } from '../../../contracts/api.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  InterviewPlanner,
  INTERVIEW_PROMPT_VERSION,
  groundBasicInfo,
} from './interview-planner.ts';
import {
  appendAssistantMessage,
  incrementInterviewVersion,
  readWorkspace,
} from './interview-repository.ts';
import {
  createQuestionInTransaction,
  openQuestionInTransaction,
  questionTargetBlockedInTransaction,
} from '../../memory/infrastructure/question-repository.ts';
import {
  applyConfirmedCandidateInTransaction,
  applyBasicInfoInTransaction,
  isSimilarText,
} from './profile-repository.ts';
import { deriveAndStoreMemories } from '../../memory/infrastructure/memory-store.ts';
import { createCandidateInTransaction } from '../../memory/infrastructure/candidate-repository.ts';
import {
  dedupeBatch,
  directlyGroundedInUserText,
  rejectReason,
} from '../application/fact-quality.ts';
const Input = z.strictObject({
  interviewId: Id,
  inputMessageId: Id,
  expectedInterviewVersion: Version,
});
async function userSources(
  sql: SqlClient,
  ownerId: string,
  interviewId: string,
  sourceMessageIds: string[],
): Promise<string[] | null> {
  const ids = [...new Set(sourceMessageIds)];
  if (!ids.length) return null;
  const result = await sql.query(
    `SELECT id,text FROM parallel_life.interview_messages
     WHERE owner_id=$1 AND interview_id=$2 AND role='user' AND id=ANY($3::uuid[])`,
    [ownerId, interviewId, ids],
  );
  return result.rowCount === ids.length ? result.rows.map((row) => String(row.text)) : null;
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
      const deduplicatedCandidates = dedupeBatch(
        [...filteredFactCandidates, ...eventCandidates],
        isSimilarText,
      );

      // 2.5 基础资料写入：若用户提到了生日、姓名、城市等，直接更新到个人资料卡片结构化字段中
      const inputMsg = base.interview.messages.find((m) => m.id === input.inputMessageId);
      const effectiveBasicInfo = groundBasicInfo(inputMsg?.text ?? '', proposal.basicInfo);

      if (Object.values(effectiveBasicInfo).some(Boolean)) {
        const applied = await applyBasicInfoInTransaction(sql, lease.ownerId, effectiveBasicInfo, [
          input.inputMessageId,
        ]);
        if (applied.disputedBirthdate)
          await createCandidateInTransaction(sql, lease.ownerId, {
            id: randomUUID(),
            ownerId: lease.ownerId,
            sourceType: 'interview',
            sourceScopeId: input.interviewId,
            category: 'identity',
            text: `生日：${applied.disputedBirthdate}`,
            eventDate: null,
            sourceMessageIds: [input.inputMessageId],
            status: 'suggested',
            createdAt: new Date().toISOString(),
          });
      }

      // 3. 提炼后直接写入真实档案（confirmed）：用户要的是「聊完就沉淀好」，
      //    不再要求逐条采纳。去重与合并由 applyConfirmedCandidateInTransaction 完成，
      //    噪声（寒暄、情绪、AI 自己的话、基础资料重复）由 rejectReason 拦掉。
      const stored = (
        await sql.query('SELECT document FROM parallel_life.profiles WHERE owner_id=$1', [
          lease.ownerId,
        ])
      ).rows[0];
      const existingProfile = stored ? ProfileSchema.parse(stored.document) : null;
      const basicInfoBlob = existingProfile?.facts.find((fact) =>
        fact.value.startsWith('个人资料\n'),
      )?.value;
      const accepted: {
        category: string;
        text: string;
        eventDate?: string;
        sourceMessageIds: string[];
      }[] = [];
      for (const candidate of deduplicatedCandidates) {
        // 彻底阻断任何 identity 事实落库为独立文本事实，基础资料 100% 归入 basicInfo 结构化表单
        if (candidate.category === 'identity') continue;
        if (
          candidate.text.includes('出生') ||
          candidate.text.includes('生日') ||
          candidate.text.includes('年出生') ||
          candidate.text.includes('名字叫') ||
          candidate.text.includes('我叫')
        ) {
          continue;
        }

        const sourceMessageIds = [...new Set(candidate.sourceMessageIds)];
        const sources = await userSources(sql, lease.ownerId, input.interviewId, sourceMessageIds);
        if (!sources) continue;
        if (
          rejectReason(candidate, {
            facts: existingProfile?.facts ?? [],
            events: existingProfile?.events ?? [],
            basicInfoBlob,
          })
        )
          continue;

        if (!directlyGroundedInUserText(candidate, sources)) {
          await createCandidateInTransaction(sql, lease.ownerId, {
            id: randomUUID(),
            ownerId: lease.ownerId,
            sourceType: 'interview',
            sourceScopeId: input.interviewId,
            category: candidate.category,
            text: candidate.text,
            eventDate: candidate.eventDate ?? null,
            sourceMessageIds,
            status: 'suggested',
            createdAt: new Date().toISOString(),
          });
          continue;
        }

        await applyConfirmedCandidateInTransaction(sql, lease.ownerId, {
          category: candidate.category,
          text: candidate.text,
          eventDate: candidate.eventDate,
          sourceMessageIds,
        });
        accepted.push(candidate);
      }

      /*
      记忆接线：同一次提炼的结果也写入记忆库（profile 作用域，来源=本次用户消息），
      使「纠正 / 遗忘 / 按来源检索」有据可依。抽取本身不额外调用模型；重复表述在
      写入层合并来源而不是再存一条。
      */
      if (accepted.length) {
        const storedProfile = (
          await sql.query('SELECT id FROM parallel_life.profiles WHERE owner_id=$1', [
            lease.ownerId,
          ])
        ).rows[0];
        if (storedProfile)
          await deriveAndStoreMemories(
            sql,
            accepted.map(
              (candidate: {
                category: string;
                text: string;
                eventDate?: string;
                sourceMessageIds: string[];
              }) => ({
                ownerId: lease.ownerId,
                scopeType: 'profile' as const,
                scopeId: String(storedProfile.id),
                text: candidate.text,
                key: `interview:${candidate.category}:${candidate.text.slice(0, 80)}`.slice(0, 128),
                kind: candidate.eventDate ? ('episode' as const) : ('preference' as const),
                sourceType: 'user_statement' as const,
                sourceIds: [...new Set(candidate.sourceMessageIds)],
                evidence: Object.fromEntries(
                  [...new Set(candidate.sourceMessageIds)].map((id: string) => [
                    id,
                    { id, role: 'user' as const, text: candidate.text },
                  ]),
                ),
              }),
            ),
          );
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
