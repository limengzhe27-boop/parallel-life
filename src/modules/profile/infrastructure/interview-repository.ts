import { randomUUID } from 'node:crypto';
import {
  ProfileSchema,
  InterviewWorkspaceSchema,
  InterviewSendSchema,
  type InterviewSend,
  type InterviewWorkspace,
} from '../../../contracts/api.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  enqueue,
  requestHash,
  publicTask,
  TaskError,
} from '../../tasks/infrastructure/task-repository.ts';
import { consumeLimit } from '../../storage/infrastructure/limits.ts';
import type { InterviewPlanner } from './interview-planner.ts';
import {
  applyConfirmedCandidateInTransaction,
  applyBasicInfoInTransaction,
  isSimilarText,
} from './profile-repository.ts';
import { dedupeBatch, rejectReason } from '../application/fact-quality.ts';
import {
  createQuestionInTransaction,
  openQuestionInTransaction,
  questionTargetBlockedInTransaction,
} from '../../memory/infrastructure/question-repository.ts';
import { INTERVIEW_PROMPT_VERSION } from './interview-planner.ts';
export async function readWorkspace(sql: SqlClient, ownerId: string): Promise<InterviewWorkspace> {
  const interview = (
    await sql.query('SELECT id,version FROM parallel_life.interviews WHERE owner_id=$1', [ownerId])
  ).rows[0];
  const saved = (
    await sql.query('SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1', [
      ownerId,
    ])
  ).rows[0];
  if (!interview || !saved) throw new TaskError('NOT_FOUND');
  const rows = (
    await sql.query(
      'SELECT id,role,text,created_at,task_id FROM parallel_life.interview_messages WHERE interview_id=$1 ORDER BY ordinal DESC LIMIT 200',
      [interview.id],
    )
  ).rows.reverse();
  const latest = (
    await sql.query(
      "SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='interview' AND scope_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [ownerId, interview.id],
    )
  ).rows[0];
  const openQuestion = (
    await sql.query(
      "SELECT id,version FROM parallel_life.interview_questions WHERE owner_id=$1 AND interview_id=$2 AND status='open' LIMIT 1",
      [ownerId, interview.id],
    )
  ).rows[0];
  const blockedTargets = (
    await sql.query(
      'SELECT target FROM parallel_life.interview_question_blocks WHERE owner_id=$1 AND interview_id=$2 ORDER BY target ASC',
      [ownerId, interview.id],
    )
  ).rows.map((row) => row.target);
  return InterviewWorkspaceSchema.parse({
    interview: {
      ...interview,
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        text: r.text,
        createdAt: r.created_at.toISOString(),
        taskId: r.task_id,
      })),
      activeTask: latest ? publicTask(latest) : null,
      openQuestion: openQuestion
        ? { id: openQuestion.id, version: Number(openQuestion.version) }
        : null,
      blockedTargets,
    },
    profile: ProfileSchema.parse({ ...saved.document, version: saved.version }),
  });
}
export async function appendAssistantMessage(
  sql: SqlClient,
  ownerId: string,
  interviewId: string,
  text: string,
  taskId: string,
) {
  const id = randomUUID();
  await sql.query(
    "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text,task_id) VALUES($1,$2,$3,'assistant',$4,$5)",
    [id, ownerId, interviewId, text, taskId],
  );
  return id;
}
export async function incrementInterviewVersion(sql: SqlClient, interviewId: string) {
  await sql.query('UPDATE parallel_life.interviews SET version=version+1 WHERE id=$1', [
    interviewId,
  ]);
}
export class InterviewRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async get(ownerId: string) {
    return this.db.transaction(ownerId, (sql) => readWorkspace(sql, ownerId));
  }
  async send(ownerId: string, raw: InterviewSend) {
    const input = InterviewSendSchema.parse(raw);
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const interview = (
        await sql.query(
          'SELECT id,version FROM parallel_life.interviews WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!interview) throw new TaskError('NOT_FOUND');
      const hash = requestHash([
        'interview',
        interview.id,
        input.expectedVersion,
        input.text,
        input.questionId ?? null,
        input.questionVersion ?? null,
      ]);
      const duplicate = (
        await sql.query('SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=$2', [
          ownerId,
          input.commandId,
        ])
      ).rows[0];
      if (duplicate) {
        if (duplicate.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return {
          task: publicTask(duplicate),
          interview: (await readWorkspace(sql, ownerId)).interview,
        };
      }
      const openQuestion = (
        await sql.query(
          "SELECT id,version FROM parallel_life.interview_questions WHERE owner_id=$1 AND interview_id=$2 AND status='open' FOR UPDATE",
          [ownerId, interview.id],
        )
      ).rows[0];
      if (
        (openQuestion &&
          (input.questionId !== openQuestion.id ||
            input.questionVersion !== Number(openQuestion.version))) ||
        (!openQuestion && input.questionId)
      )
        throw new TaskError('VERSION_CONFLICT');
      if (interview.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      const messageId = randomUUID();
      const task = await enqueue(
        sql,
        ownerId,
        'interview',
        interview.id,
        input.commandId,
        {
          interviewId: interview.id,
          inputMessageId: messageId,
          expectedInterviewVersion: interview.version + 1,
        },
        hash,
      );
      await sql.query(
        "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text,task_id) VALUES($1,$2,$3,'user',$4,$5)",
        [messageId, ownerId, interview.id, input.text, task.id],
      );
      // A new user message answers only the question selected by the caller.
      // The message is inserted first so the foreign key also proves provenance.
      if (openQuestion) {
        const answered = await sql.query(
          "UPDATE parallel_life.interview_questions SET status='answered',answer_message_id=$3,closed_at=now(),version=version+1 WHERE owner_id=$1 AND id=$2 AND status='open' AND version=$4",
          [ownerId, input.questionId, messageId, input.questionVersion],
        );
        if (!answered.rowCount) throw new TaskError('VERSION_CONFLICT');
      }
      await sql.query('UPDATE parallel_life.interviews SET version=version+1 WHERE id=$1', [
        interview.id,
      ]);
      return { task, interview: (await readWorkspace(sql, ownerId)).interview };
    });
  }

  /**
   * Short interview turns run inside the web request. The user message and a
   * running task are committed before the model call; the assistant reply,
   * candidate suggestions and next question are committed atomically after
   * the stream finishes. The task row keeps idempotency and recovery semantics
   * without requiring a resident worker for this interactive path.
   */
  async sendStreaming(
    ownerId: string,
    raw: InterviewSend,
    planner: InterviewPlanner,
    onToken: (token: string) => void,
    signal?: AbortSignal,
  ) {
    const input = InterviewSendSchema.parse(raw);
    const prepared = await this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const interview = (
        await sql.query(
          'SELECT id,version FROM parallel_life.interviews WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!interview) throw new TaskError('NOT_FOUND');
      const hash = requestHash([
        'interview-stream',
        interview.id,
        input.expectedVersion,
        input.text,
        input.questionId ?? null,
        input.questionVersion ?? null,
      ]);
      const duplicate = (
        await sql.query('SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=$2', [
          ownerId,
          input.commandId,
        ])
      ).rows[0];
      if (duplicate) {
        if (duplicate.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        if (['queued', 'running'].includes(String(duplicate.status))) throw new TaskError('BUSY');
        return {
          replay: true as const,
          task: publicTask(duplicate),
          interview: (await readWorkspace(sql, ownerId)).interview,
        };
      }
      if (
        (
          await sql.query(
            "SELECT 1 FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='interview' AND scope_id=$2 AND status IN ('queued','running')",
            [ownerId, interview.id],
          )
        ).rowCount
      )
        throw new TaskError('BUSY');
      const openQuestion = (
        await sql.query(
          "SELECT id,version FROM parallel_life.interview_questions WHERE owner_id=$1 AND interview_id=$2 AND status='open' FOR UPDATE",
          [ownerId, interview.id],
        )
      ).rows[0];
      if (
        (openQuestion &&
          (input.questionId !== openQuestion.id ||
            input.questionVersion !== Number(openQuestion.version))) ||
        (!openQuestion && input.questionId)
      )
        throw new TaskError('VERSION_CONFLICT');
      if (interview.version !== input.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      await consumeLimit(sql, ownerId, 'generation-day', 120, 86400);
      const messageId = randomUUID();
      const taskId = randomUUID();
      const taskRow = (
        await sql.query(
          `INSERT INTO parallel_life.tasks
             (id,owner_id,scope_kind,scope_id,command_id,request_hash,input,status,lease_token,lease_until)
           VALUES($1,$2,'interview',$3,$4,$5,$6,'running',gen_random_uuid(),now()+interval '120 seconds')
           RETURNING *`,
          [
            taskId,
            ownerId,
            interview.id,
            input.commandId,
            hash,
            {
              interviewId: interview.id,
              inputMessageId: messageId,
              expectedInterviewVersion: interview.version + 1,
            },
          ],
        )
      ).rows[0];
      await sql.query(
        "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text,task_id) VALUES($1,$2,$3,'user',$4,$5)",
        [messageId, ownerId, interview.id, input.text, taskId],
      );
      if (openQuestion) {
        const answered = await sql.query(
          "UPDATE parallel_life.interview_questions SET status='answered',answer_message_id=$3,closed_at=now(),version=version+1 WHERE owner_id=$1 AND id=$2 AND status='open' AND version=$4",
          [ownerId, input.questionId, messageId, input.questionVersion],
        );
        if (!answered.rowCount) throw new TaskError('VERSION_CONFLICT');
      }
      await sql.query('UPDATE parallel_life.interviews SET version=version+1 WHERE id=$1', [
        interview.id,
      ]);
      return {
        replay: false as const,
        task: publicTask(taskRow),
        interview: (await readWorkspace(sql, ownerId)).interview,
        profile: (await readWorkspace(sql, ownerId)).profile,
      };
    });
    if (prepared.replay) return prepared;
    const started = Date.now();
    try {
      const proposal = await planner.proposeStream(
        prepared.profile,
        prepared.interview.messages,
        onToken,
        signal,
        prepared.interview.blockedTargets,
      );
      const result = await this.db.transaction(ownerId, async (sql) => {
        const current = (
          await sql.query(
            'SELECT id,version FROM parallel_life.interviews WHERE owner_id=$1 AND id=$2 FOR UPDATE',
            [ownerId, prepared.interview.id],
          )
        ).rows[0];
        if (!current || current.version !== prepared.interview.version)
          throw new TaskError('VERSION_CONFLICT');
        const candidates = [
          ...proposal.facts.map((fact) => ({
            category: fact.category,
            text: fact.value,
            eventDate: undefined,
            sourceMessageIds: fact.sourceMessageIds,
          })),
          ...proposal.events.map((event) => ({
            category: 'experience' as const,
            text: event.title,
            eventDate: event.date,
            sourceMessageIds: event.sourceMessageIds,
          })),
        ];
        if (proposal.basicInfo && Object.values(proposal.basicInfo).some(Boolean)) {
          await applyBasicInfoInTransaction(sql, ownerId, proposal.basicInfo, [
            prepared.interview.messages.at(-1)?.id ?? '',
          ]);
        }
        /* Same policy as the worker handler: refine, drop noise and near-duplicates,
           then write straight into the real profile. No approval step. */
        const existingProfile = prepared.profile;
        const basicInfoBlob = existingProfile.facts.find((fact) =>
          fact.value.startsWith('个人资料\n'),
        )?.value;
        const kept = dedupeBatch(candidates, isSimilarText);
        for (const candidate of kept) {
          if (
            proposal.basicInfo?.birthdate &&
            (candidate.text.includes(proposal.basicInfo.birthdate) ||
              candidate.text.includes('出生') ||
              candidate.text.includes('生日'))
          ) {
            continue;
          }
          if (
            proposal.basicInfo?.name &&
            (candidate.text.includes(proposal.basicInfo.name) ||
              candidate.text.includes('名字叫') ||
              candidate.text.includes('我叫'))
          ) {
            continue;
          }
          const sourceMessageIds = [...new Set(candidate.sourceMessageIds)];
          const sources = await sql.query(
            `SELECT id FROM parallel_life.interview_messages
             WHERE owner_id=$1 AND interview_id=$2 AND role='user' AND id=ANY($3::uuid[])`,
            [ownerId, prepared.interview.id, sourceMessageIds],
          );
          if (sources.rowCount !== sourceMessageIds.length) continue;
          if (
            rejectReason(candidate, {
              facts: existingProfile.facts,
              events: existingProfile.events,
              basicInfoBlob,
            })
          )
            continue;
          await applyConfirmedCandidateInTransaction(sql, ownerId, {
            category: candidate.category,
            text: candidate.text,
            eventDate: candidate.eventDate,
            sourceMessageIds,
          });
        }
        if (
          proposal.question &&
          !(await questionTargetBlockedInTransaction(
            sql,
            ownerId,
            prepared.interview.id,
            proposal.question.target,
          )) &&
          !(await openQuestionInTransaction(sql, ownerId, prepared.interview.id))
        ) {
          await createQuestionInTransaction(sql, ownerId, {
            id: randomUUID(),
            ownerId,
            interviewId: prepared.interview.id,
            text: proposal.question.text,
            target: proposal.question.target,
            status: 'open',
            sourceMessageId: prepared.interview.messages.at(-1)!.id,
            createdAt: new Date().toISOString(),
            version: 0,
          });
        }
        await appendAssistantMessage(
          sql,
          ownerId,
          prepared.interview.id,
          proposal.reply,
          prepared.task.id,
        );
        await sql.query('UPDATE parallel_life.interviews SET version=version+1 WHERE id=$1', [
          prepared.interview.id,
        ]);
        const done = (
          await sql.query(
            `UPDATE parallel_life.tasks SET status='succeeded',result_version=$3,model=$4,prompt_version=$5,
             duration_ms=$6,lease_token=NULL,lease_until=NULL,updated_at=now()
             WHERE id=$1 AND owner_id=$2 AND status='running' RETURNING *`,
            [
              prepared.task.id,
              ownerId,
              current.version + 1,
              'stream',
              INTERVIEW_PROMPT_VERSION,
              Date.now() - started,
            ],
          )
        ).rows[0];
        if (!done) throw new TaskError('CONFLICT');
        return { task: publicTask(done), interview: (await readWorkspace(sql, ownerId)).interview };
      });
      return { replay: false, ...result };
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String((error as Error & { code?: string }).code)
          : 'UNKNOWN';
      await this.db
        .transaction(ownerId, async (sql) => {
          await sql.query(
            `UPDATE parallel_life.tasks SET status=$3,error_code=$4,lease_token=NULL,lease_until=NULL,updated_at=now()
           WHERE id=$1 AND owner_id=$2 AND status='running'`,
            [prepared.task.id, ownerId, code === 'VERSION_CONFLICT' ? 'conflict' : 'unknown', code],
          );
        })
        .catch(() => {});
      throw error;
    }
  }
}
