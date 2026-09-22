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
    },
    profile: ProfileSchema.parse({ ...saved.document, version: saved.version }),
  });
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
      const hash = requestHash(['interview', interview.id, input.expectedVersion, input.text]);
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
      await sql.query('UPDATE parallel_life.interviews SET version=version+1 WHERE id=$1', [
        interview.id,
      ]);
      return { task, interview: (await readWorkspace(sql, ownerId)).interview };
    });
  }
}
