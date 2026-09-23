import {
  MemoryRecordSchema,
  MemorySourceRefSchema,
  type MemoryRecord,
  type MemorySourceRef,
} from '../../../contracts/memory.ts';
import { DomainError } from '../domain/errors.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';

type MemoryRow = Record<string, unknown>;

const iso = (value: unknown) => new Date(String(value)).toISOString();

function mapMemory(row: MemoryRow): MemoryRecord {
  return MemoryRecordSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    branchId: row.branch_id ?? undefined,
    characterId: row.character_id ?? undefined,
    kind: row.kind,
    text: row.text,
    key: row.key ?? undefined,
    sourceType: row.source_type,
    sourceIds: Array.isArray(row.source_ids) ? row.source_ids : [],
    status: row.status,
    importance: Number(row.importance),
    createdAt: iso(row.created_at),
  });
}

function mapSourceRef(row: MemoryRow): MemorySourceRef {
  return MemorySourceRefSchema.parse({
    memoryId: row.memory_id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
  });
}

export interface MemoryListFilter {
  scopeType?: MemoryRecord['scopeType'];
  scopeId?: string;
  status?: MemoryRecord['status'];
  limit?: number;
}

/** Durable memory and provenance repository. Every operation runs under owner RLS. */
export class MemoryRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }

  async list(ownerId: string, filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    return this.db.transaction(ownerId, async (sql) => {
      const values: unknown[] = [ownerId];
      const where = ['owner_id=$1'];
      if (filter.scopeType) {
        values.push(filter.scopeType);
        where.push(`scope_type=$${values.length}`);
      }
      if (filter.scopeId) {
        values.push(filter.scopeId);
        where.push(`scope_id=$${values.length}`);
      }
      if (filter.status) {
        values.push(filter.status);
        where.push(`status=$${values.length}`);
      }
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
      values.push(limit);
      const result = await sql.query(
        `SELECT id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at
         FROM parallel_life.memory_records WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapMemory);
    });
  }

  async get(ownerId: string, id: string): Promise<MemoryRecord> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (await sql.query('SELECT * FROM parallel_life.memory_records WHERE id=$1', [id]))
        .rows[0];
      if (!row) throw new DomainError('NOT_FOUND', `Memory ${id} not found`);
      return mapMemory(row);
    });
  }

  async create(ownerId: string, record: MemoryRecord): Promise<MemoryRecord> {
    if (record.ownerId !== ownerId) throw new DomainError('FORBIDDEN', 'Memory owner mismatch');
    const input = MemoryRecordSchema.parse(record);
    if (input.status !== 'active')
      throw new DomainError('INVALID_COMMAND', 'New memory records must start as active');
    return this.db.transaction(ownerId, async (sql) => {
      try {
        const row = (
          await sql.query(
            `INSERT INTO parallel_life.memory_records
              (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING *`,
            [
              input.id,
              ownerId,
              input.scopeType,
              input.scopeId,
              input.branchId ?? null,
              input.characterId ?? null,
              input.kind,
              input.text,
              input.key ?? null,
              input.sourceType,
              JSON.stringify(input.sourceIds),
              input.status,
              input.importance,
              input.createdAt,
            ],
          )
        ).rows[0];
        return mapMemory(row);
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('CONFLICT', `Memory ${input.id} already exists`);
        throw error;
      }
    });
  }

  async addSourceRef(ownerId: string, ref: MemorySourceRef): Promise<MemorySourceRef> {
    if (ref.ownerId !== ownerId) throw new DomainError('FORBIDDEN', 'Source owner mismatch');
    const input = MemorySourceRefSchema.parse(ref);
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `INSERT INTO parallel_life.memory_source_refs(memory_id,owner_id,source_type,source_id)
           VALUES($1,$2,$3,$4) ON CONFLICT (memory_id,source_id) DO NOTHING RETURNING *`,
          [input.memoryId, ownerId, input.sourceType, input.sourceId],
        )
      ).rows[0];
      if (!row) {
        const existing = (
          await sql.query(
            'SELECT * FROM parallel_life.memory_source_refs WHERE memory_id=$1 AND source_id=$2',
            [input.memoryId, input.sourceId],
          )
        ).rows[0];
        if (!existing) throw new DomainError('NOT_FOUND', `Memory ${input.memoryId} not found`);
        return mapSourceRef(existing);
      }
      return mapSourceRef(row);
    });
  }

  async forget(ownerId: string, id: string): Promise<MemoryRecord> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          "UPDATE parallel_life.memory_records SET status='forgotten' WHERE id=$1 AND status<>'forgotten' RETURNING *",
          [id],
        )
      ).rows[0];
      if (!row) {
        const exists = (
          await sql.query('SELECT id FROM parallel_life.memory_records WHERE id=$1', [id])
        ).rows[0];
        if (!exists) throw new DomainError('NOT_FOUND', `Memory ${id} not found`);
        return this.getInTransaction(sql, id);
      }
      return mapMemory(row);
    });
  }

  private async getInTransaction(sql: SqlClient, id: string): Promise<MemoryRecord> {
    const row = (await sql.query('SELECT * FROM parallel_life.memory_records WHERE id=$1', [id]))
      .rows[0];
    if (!row) throw new DomainError('NOT_FOUND', `Memory ${id} not found`);
    return mapMemory(row);
  }
}
