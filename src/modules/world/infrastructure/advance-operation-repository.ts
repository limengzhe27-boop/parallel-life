import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import {
  advanceOperationState,
  type AdvanceWorkRef,
  type AdvanceWorkState,
} from '../domain/advance-operation.ts';
import type { AdvanceResult } from '../application/advance-world.ts';

export class AdvanceOperationRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async start(owner: string, world: string, id: string) {
    return this.db.transaction(owner, async (sql) => {
      const owned = await sql.query(
        'SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2',
        [world, owner],
      );
      if (!owned.rowCount) throw new DomainError('NOT_FOUND');
      return !!(
        await sql.query(
          `INSERT INTO parallel_life.agent_advance_operations(world_id,owner_id,id)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
          [world, owner, id],
        )
      ).rowCount;
    });
  }
  async track(owner: string, world: string, id: string, work: AdvanceWorkRef) {
    await this.db.transaction(owner, async (sql) => {
      const row = (
        await sql.query(
          `SELECT id FROM parallel_life.agent_advance_operations
        WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND finished_at IS NULL AND lease_until>clock_timestamp() FOR UPDATE`,
          [world, owner, id],
        )
      ).rows[0];
      if (!row) throw new DomainError('VERSION_CONFLICT');
      await sql.query(
        `INSERT INTO parallel_life.agent_advance_operation_work(world_id,owner_id,operation_id,kind,command_id)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [world, owner, id, work.kind, work.commandId],
      );
    });
  }
  async finish(owner: string, world: string, id: string, result?: AdvanceResult, error?: unknown) {
    const code = String((error as { code?: unknown })?.code ?? '');
    const failure =
      error === undefined
        ? null
        : code.includes('CONFLICT')
          ? 'VERSION_CONFLICT'
          : code.includes('INVALID')
            ? 'INVALID_OUTPUT'
            : ['BUSY', 'UNKNOWN', 'ATTEMPT_PENDING'].includes(code)
              ? 'PENDING'
              : 'UNCLASSIFIED';
    await this.db.transaction(owner, (sql) =>
      sql.query(
        `UPDATE parallel_life.agent_advance_operations SET
      finished_at=clock_timestamp(),succeeded=$4,result=$5,failure_code=$6
      WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND finished_at IS NULL`,
        [world, owner, id, error === undefined, result ?? null, failure],
      ),
    );
  }
  async read(owner: string, world: string, id: string) {
    return this.db.transaction(owner, async (sql) => {
      const owned = await sql.query(
        'SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2',
        [world, owner],
      );
      if (!owned.rowCount) throw new DomainError('NOT_FOUND');
      const row = (
        await sql.query(
          `SELECT *,lease_until>clock_timestamp() lease_active FROM parallel_life.agent_advance_operations
        WHERE world_id=$1 AND owner_id=$2 AND id=$3`,
          [world, owner, id],
        )
      ).rows[0];
      if (!row) return { worldId: world, operationId: id, status: 'absent' as const, work: [] };
      const work: AdvanceWorkState[] = (
        await sql.query(
          `SELECT r.kind,r.command_id,
        CASE WHEN r.kind='npc' THEN a.status ELSE d.status END status
        FROM parallel_life.agent_advance_operation_work r
        LEFT JOIN parallel_life.agent_attempts a ON r.kind='npc' AND a.world_id=r.world_id AND a.owner_id=r.owner_id AND a.command_id=r.command_id
        LEFT JOIN parallel_life.director_runtime_attempts d ON r.kind='director' AND d.world_id=r.world_id AND d.owner_id=r.owner_id AND d.command_id=r.command_id
        WHERE r.world_id=$1 AND r.owner_id=$2 AND r.operation_id=$3 ORDER BY r.created_at,r.command_id`,
          [world, owner, id],
        )
      ).rows.map((r) => ({
        kind: r.kind,
        commandId: String(r.command_id),
        status: r.status ?? 'not_started',
      }));
      return {
        worldId: world,
        operationId: id,
        status: advanceOperationState({
          finished: !!row.finished_at,
          succeeded: row.succeeded,
          leaseActive: row.lease_active,
          work,
        }),
        work,
        ...(row.result ? { result: row.result as AdvanceResult } : {}),
        ...(row.failure_code ? { failureCode: String(row.failure_code) } : {}),
      };
    });
  }
}
