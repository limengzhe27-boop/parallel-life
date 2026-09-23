import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';

export type MemoryCommandKind =
  | 'interview_question'
  | 'interview_question_block'
  | 'memory_candidate'
  | 'memory_branch_candidate';

export function memoryCommandHash(kind: MemoryCommandKind, input: unknown) {
  return createHash('sha256').update(JSON.stringify({ kind, input })).digest('hex');
}

export async function readMemoryReceipt(
  sql: SqlClient,
  ownerId: string,
  commandId: string,
  kind: MemoryCommandKind,
  requestHash: string,
) {
  const row = (
    await sql.query(
      'SELECT kind,request_hash,result FROM parallel_life.memory_command_receipts WHERE owner_id=$1 AND command_id=$2',
      [ownerId, commandId],
    )
  ).rows[0];
  if (!row) return undefined;
  if (row.kind !== kind || row.request_hash !== requestHash)
    throw new DomainError('CONFLICT', 'This command id was already used for another request');
  return row.result as unknown;
}

export async function saveMemoryReceipt(
  sql: SqlClient,
  ownerId: string,
  commandId: string,
  kind: MemoryCommandKind,
  requestHash: string,
  result: unknown,
) {
  await sql.query(
    `INSERT INTO parallel_life.memory_command_receipts
      (owner_id,command_id,kind,request_hash,result)
     VALUES($1,$2,$3,$4,$5)`,
    [ownerId, commandId, kind, requestHash, JSON.stringify(result)],
  );
}
