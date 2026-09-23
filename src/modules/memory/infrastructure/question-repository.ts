import { InterviewQuestionSchema, type InterviewQuestion } from '../../../contracts/memory.ts';
import { DomainError } from '../domain/errors.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { memoryCommandHash, readMemoryReceipt, saveMemoryReceipt } from './command-receipt.ts';

type QuestionRow = Record<string, unknown>;
const iso = (value: unknown) => new Date(String(value)).toISOString();

function mapQuestion(row: QuestionRow): InterviewQuestion {
  return InterviewQuestionSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    interviewId: row.interview_id,
    text: row.text,
    target: row.target,
    status: row.status,
    sourceMessageId: row.source_message_id,
    answerMessageId: row.answer_message_id ?? undefined,
    createdAt: iso(row.created_at),
    closedAt: row.closed_at ? iso(row.closed_at) : undefined,
    version: Number(row.version),
  });
}

export async function openQuestionInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  interviewId: string,
): Promise<InterviewQuestion | null> {
  const row = (
    await sql.query(
      "SELECT * FROM parallel_life.interview_questions WHERE owner_id=$1 AND interview_id=$2 AND status='open' LIMIT 1",
      [ownerId, interviewId],
    )
  ).rows[0];
  return row ? mapQuestion(row) : null;
}

export async function questionTargetBlockedInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  interviewId: string,
  target: InterviewQuestion['target'],
) {
  return !!(
    await sql.query(
      'SELECT 1 FROM parallel_life.interview_question_blocks WHERE owner_id=$1 AND interview_id=$2 AND target=$3',
      [ownerId, interviewId, target],
    )
  ).rowCount;
}

export async function createQuestionInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  question: InterviewQuestion,
): Promise<InterviewQuestion> {
  if (question.ownerId !== ownerId) throw new DomainError('FORBIDDEN', 'Question owner mismatch');
  const input = InterviewQuestionSchema.parse(question);
  if (!input.interviewId)
    throw new DomainError('INVALID_COMMAND', 'Question interview is required');
  if (input.status !== 'open')
    throw new DomainError('INVALID_COMMAND', 'New question must be open');
  try {
    const row = (
      await sql.query(
        `INSERT INTO parallel_life.interview_questions
          (id,owner_id,interview_id,text,target,status,source_message_id,answer_message_id,created_at,closed_at,version)
         VALUES($1,$2,$3,$4,$5,'open',$6,NULL,$7,NULL,$8) RETURNING *`,
        [
          input.id,
          ownerId,
          input.interviewId,
          input.text,
          input.target,
          input.sourceMessageId,
          input.createdAt,
          input.version,
        ],
      )
    ).rows[0];
    return mapQuestion(row);
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new DomainError('CONFLICT', 'Another interview question is already open');
    throw error;
  }
}

/** Persistent counterpart of QuestionStateMachine. */
export class InterviewQuestionRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }

  async list(ownerId: string, interviewId: string): Promise<InterviewQuestion[]> {
    return this.db.transaction(ownerId, async (sql) => {
      const rows = (
        await sql.query(
          'SELECT * FROM parallel_life.interview_questions WHERE owner_id=$1 AND interview_id=$2 ORDER BY created_at ASC,id ASC',
          [ownerId, interviewId],
        )
      ).rows;
      return rows.map(mapQuestion);
    });
  }

  async open(ownerId: string, interviewId: string): Promise<InterviewQuestion | null> {
    return this.db.transaction(ownerId, (sql) =>
      openQuestionInTransaction(sql, ownerId, interviewId),
    );
  }

  async create(ownerId: string, question: InterviewQuestion): Promise<InterviewQuestion> {
    if (question.ownerId !== ownerId) throw new DomainError('FORBIDDEN', 'Question owner mismatch');
    const input = InterviewQuestionSchema.parse(question);
    if (!input.interviewId)
      throw new DomainError('INVALID_COMMAND', 'Question interview is required');
    if (input.status !== 'open')
      throw new DomainError('INVALID_COMMAND', 'New question must be open');
    return this.db.transaction(ownerId, (sql) => createQuestionInTransaction(sql, ownerId, input));
  }

  answer(
    ownerId: string,
    id: string,
    answerMessageId: string,
    expectedVersion: number,
    commandId?: string,
  ) {
    return this.close(ownerId, id, 'answered', answerMessageId, expectedVersion, commandId);
  }

  skip(ownerId: string, id: string, expectedVersion: number, commandId: string) {
    return this.close(ownerId, id, 'skipped', null, expectedVersion, commandId);
  }

  dismiss(ownerId: string, id: string, expectedVersion: number, commandId: string) {
    return this.close(ownerId, id, 'dismissed', null, expectedVersion, commandId);
  }

  async block(ownerId: string, id: string, expectedVersion: number, commandId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const requestHash = memoryCommandHash('interview_question_block', {
        questionId: id,
        expectedVersion,
      });
      const duplicate = await readMemoryReceipt(
        sql,
        ownerId,
        commandId,
        'interview_question_block',
        requestHash,
      );
      if (duplicate) {
        const saved = (duplicate as { question?: unknown }).question;
        if (!saved) throw new DomainError('INVALID_STATE', 'Question receipt is malformed');
        return InterviewQuestionSchema.parse(saved);
      }
      const current = (
        await sql.query(
          "SELECT * FROM parallel_life.interview_questions WHERE owner_id=$1 AND id=$2 AND status='open' AND version=$3 FOR UPDATE",
          [ownerId, id, expectedVersion],
        )
      ).rows[0];
      if (!current) {
        const exists = (
          await sql.query(
            'SELECT status,version FROM parallel_life.interview_questions WHERE owner_id=$1 AND id=$2',
            [ownerId, id],
          )
        ).rows[0];
        if (!exists) throw new DomainError('NOT_FOUND', `Question ${id} not found`);
        throw new DomainError('CONFLICT', `Question ${id} has changed or is already closed`);
      }
      const updated = (
        await sql.query(
          "UPDATE parallel_life.interview_questions SET status='dismissed',closed_at=now(),version=version+1 WHERE owner_id=$1 AND id=$2 AND status='open' AND version=$3 RETURNING *",
          [ownerId, id, expectedVersion],
        )
      ).rows[0];
      const question = mapQuestion(updated);
      await sql.query(
        'INSERT INTO parallel_life.interview_question_blocks(owner_id,interview_id,target) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [ownerId, current.interview_id, current.target],
      );
      await saveMemoryReceipt(sql, ownerId, commandId, 'interview_question_block', requestHash, {
        question,
      });
      return question;
    });
  }

  private async close(
    ownerId: string,
    id: string,
    status: Extract<InterviewQuestion['status'], 'answered' | 'skipped' | 'dismissed'>,
    answerMessageId: string | null,
    expectedVersion: number,
    commandId?: string,
  ): Promise<InterviewQuestion> {
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const requestHash = commandId
        ? memoryCommandHash('interview_question', {
            questionId: id,
            status,
            answerMessageId,
            expectedVersion,
          })
        : undefined;
      if (commandId && requestHash) {
        const duplicate = await readMemoryReceipt(
          sql,
          ownerId,
          commandId,
          'interview_question',
          requestHash,
        );
        if (duplicate) {
          const saved = (duplicate as { question?: unknown }).question;
          if (!saved) throw new DomainError('INVALID_STATE', 'Question receipt is malformed');
          return InterviewQuestionSchema.parse(saved);
        }
      }
      const row = (
        await sql.query(
          `UPDATE parallel_life.interview_questions
           SET status=$3,answer_message_id=$4,closed_at=now(),version=version+1
           WHERE owner_id=$1 AND id=$2 AND status='open' AND version=$5
           RETURNING *`,
          [ownerId, id, status, answerMessageId, expectedVersion],
        )
      ).rows[0];
      if (row) {
        const question = mapQuestion(row);
        if (commandId && requestHash)
          await saveMemoryReceipt(sql, ownerId, commandId, 'interview_question', requestHash, {
            question,
          });
        return question;
      }
      const exists = (
        await sql.query(
          'SELECT status,version FROM parallel_life.interview_questions WHERE owner_id=$1 AND id=$2',
          [ownerId, id],
        )
      ).rows[0];
      if (!exists) throw new DomainError('NOT_FOUND', `Question ${id} not found`);
      throw new DomainError('CONFLICT', `Question ${id} has changed or is already closed`);
    });
  }
}
