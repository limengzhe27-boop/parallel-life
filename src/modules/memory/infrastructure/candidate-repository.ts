import { randomUUID } from 'node:crypto';
import {
  MemoryCandidateSchema,
  type MemoryCandidate,
  type MemoryCandidateFromBranch,
} from '../../../contracts/memory.ts';
import { DomainError } from '../domain/errors.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { applyConfirmedCandidateInTransaction } from '../../profile/infrastructure/profile-repository.ts';
import { memoryCommandHash, readMemoryReceipt, saveMemoryReceipt } from './command-receipt.ts';

type CandidateRow = Record<string, unknown>;
const iso = (value: unknown) => new Date(String(value)).toISOString();

function mapCandidate(row: CandidateRow): MemoryCandidate {
  return MemoryCandidateSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourceScopeId: row.source_scope_id,
    category: row.category,
    text: row.text,
    eventDate: row.event_date ?? undefined,
    sourceMessageIds: Array.isArray(row.source_message_ids) ? row.source_message_ids : [],
    status: row.status,
    createdAt: iso(row.created_at),
    confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : undefined,
  });
}

/** Insert a suggested candidate inside an existing worker transaction. */
export async function createCandidateInTransaction(
  sql: import('../../storage/infrastructure/postgres.ts').SqlClient,
  ownerId: string,
  candidate: MemoryCandidate,
): Promise<MemoryCandidate | null> {
  if (candidate.ownerId !== ownerId) throw new DomainError('FORBIDDEN', 'Candidate owner mismatch');
  const input = MemoryCandidateSchema.parse(candidate);
  if (input.status !== 'suggested')
    throw new DomainError('INVALID_COMMAND', 'New memory candidates must start as suggested');
  const row = (
    await sql.query(
      `INSERT INTO parallel_life.memory_candidates
        (id,owner_id,source_type,source_scope_id,category,text,event_date,source_message_ids,status,created_at,confirmed_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
       WHERE NOT EXISTS (
         SELECT 1 FROM parallel_life.memory_candidates
         WHERE owner_id=$2 AND source_scope_id=$4 AND category=$5 AND text=$6 AND status<>'rejected'
       ) RETURNING *`,
      [
        input.id,
        ownerId,
        input.sourceType,
        input.sourceScopeId,
        input.category,
        input.text,
        input.eventDate ?? null,
        JSON.stringify(input.sourceMessageIds),
        input.status,
        input.createdAt,
        input.confirmedAt ?? null,
      ],
    )
  ).rows[0];
  return row ? mapCandidate(row) : null;
}

/** Candidate facts remain suggested until a user explicitly confirms them. */
export class MemoryCandidateRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }

  async list(ownerId: string, status?: MemoryCandidate['status']): Promise<MemoryCandidate[]> {
    return this.db.transaction(ownerId, async (sql) => {
      const params: unknown[] = [ownerId];
      const condition = ['owner_id=$1'];
      if (status) {
        params.push(status);
        condition.push(`status=$${params.length}`);
      }
      const rows = (
        await sql.query(
          `SELECT * FROM parallel_life.memory_candidates WHERE ${condition.join(' AND ')} ORDER BY created_at DESC,id DESC`,
          params,
        )
      ).rows;
      return rows.map(mapCandidate);
    });
  }

  async create(ownerId: string, candidate: MemoryCandidate): Promise<MemoryCandidate> {
    return this.db.transaction(ownerId, async (sql) => {
      const saved = await createCandidateInTransaction(sql, ownerId, candidate);
      if (!saved) throw new DomainError('CONFLICT', 'A matching candidate already exists');
      return saved;
    });
  }

  /**
   * First confirmation for a branch writeback. The branch memory is copied as
   * a suggested candidate only after the user explicitly consents in-world.
   */
  async createFromBranch(
    ownerId: string,
    input: MemoryCandidateFromBranch,
  ): Promise<MemoryCandidate> {
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const requestHash = memoryCommandHash('memory_branch_candidate', {
        branchMemoryId: input.branchMemoryId,
        category: input.category,
        userConsented: input.userConsented,
      });
      const duplicate = await readMemoryReceipt(
        sql,
        ownerId,
        input.commandId,
        'memory_branch_candidate',
        requestHash,
      );
      if (duplicate) {
        const saved = (duplicate as { candidate?: unknown }).candidate;
        if (!saved) throw new DomainError('INVALID_STATE', 'Candidate receipt is malformed');
        return MemoryCandidateSchema.parse(saved);
      }
      const row = (
        await sql.query(
          `SELECT id,owner_id,scope_type,scope_id,branch_id,text,source_ids,status
           FROM parallel_life.memory_records
           WHERE owner_id=$1 AND id=$2
           FOR SHARE`,
          [ownerId, input.branchMemoryId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND', `Memory ${input.branchMemoryId} not found`);
      if (row.scope_type !== 'branch' || row.branch_id !== row.scope_id || row.status !== 'active')
        throw new DomainError('INVALID_COMMAND', 'Only active branch memories can be proposed');
      if (String(row.text).length > 2000)
        throw new DomainError('INVALID_COMMAND', 'Branch memory is too long for a candidate');
      const rawSourceIds: unknown[] = Array.isArray(row.source_ids) ? row.source_ids : [];
      const sourceMessageIds: string[] = [
        ...new Set(rawSourceIds.filter((id): id is string => typeof id === 'string')),
      ];
      if (!sourceMessageIds.length)
        throw new DomainError('INVALID_COMMAND', 'Branch memory has no source messages');
      const sources = await sql.query(
        'SELECT id FROM parallel_life.world_messages WHERE owner_id=$1 AND world_id=$2 AND id=ANY($3::text[])',
        [ownerId, row.scope_id, sourceMessageIds],
      );
      if (sources.rowCount !== sourceMessageIds.length)
        throw new DomainError('INVALID_COMMAND', 'Branch memory sources are not available');
      const candidate = await createCandidateInTransaction(sql, ownerId, {
        id: randomUUID(),
        ownerId,
        sourceType: 'branch',
        sourceScopeId: row.scope_id,
        category: input.category,
        text: row.text,
        eventDate: null,
        sourceMessageIds,
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      if (!candidate) throw new DomainError('CONFLICT', 'A matching candidate already exists');
      await saveMemoryReceipt(
        sql,
        ownerId,
        input.commandId,
        'memory_branch_candidate',
        requestHash,
        {
          candidate,
        },
      );
      return candidate;
    });
  }

  async confirm(
    ownerId: string,
    id: string,
    commandId: string,
    now = new Date().toISOString(),
  ): Promise<MemoryCandidate> {
    return this.transition(ownerId, id, 'confirmed', now, commandId);
  }

  async reject(ownerId: string, id: string, commandId: string): Promise<MemoryCandidate> {
    return this.transition(ownerId, id, 'rejected', null, commandId);
  }

  private async transition(
    ownerId: string,
    id: string,
    status: Extract<MemoryCandidate['status'], 'confirmed' | 'rejected'>,
    confirmedAt: string | null,
    commandId: string,
  ): Promise<MemoryCandidate> {
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const requestHash = memoryCommandHash('memory_candidate', {
        candidateId: id,
        status,
      });
      const duplicate = await readMemoryReceipt(
        sql,
        ownerId,
        commandId,
        'memory_candidate',
        requestHash,
      );
      if (duplicate) {
        const saved = (duplicate as { candidate?: unknown }).candidate;
        if (!saved) throw new DomainError('INVALID_STATE', 'Candidate receipt is malformed');
        return MemoryCandidateSchema.parse(saved);
      }
      const row = (
        await sql.query(
          `UPDATE parallel_life.memory_candidates
           SET status=$3,confirmed_at=$4
           WHERE owner_id=$1 AND id=$2 AND status='suggested'
           RETURNING *`,
          [ownerId, id, status, confirmedAt],
        )
      ).rows[0];
      if (!row) {
        const exists = (
          await sql.query(
            'SELECT * FROM parallel_life.memory_candidates WHERE owner_id=$1 AND id=$2',
            [ownerId, id],
          )
        ).rows[0];
        if (!exists) throw new DomainError('NOT_FOUND', `Candidate ${id} not found`);
        throw new DomainError('CONFLICT', `Candidate ${id} is no longer suggested`);
      }
      const candidate = mapCandidate(row);
      if (status === 'confirmed')
        await applyConfirmedCandidateInTransaction(
          sql,
          ownerId,
          candidate,
          confirmedAt ?? new Date().toISOString(),
        );
      await saveMemoryReceipt(sql, ownerId, commandId, 'memory_candidate', requestHash, {
        candidate,
      });
      return candidate;
    });
  }
}
