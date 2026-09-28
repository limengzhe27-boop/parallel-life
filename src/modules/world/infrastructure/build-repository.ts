import { albumPhotos } from '../../media/infrastructure/album-projection.ts';
import { randomUUID } from 'node:crypto';
import {
  WorldBuildRequestSchema,
  WorldBuildSchema,
  WorldPhoneSchema,
  type WorldBuildRequest,
} from '../../../contracts/world-build.ts';
import { ApprovedSeedSchema } from '../../../contracts/seeds.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  enqueue,
  publicTask,
  requestHash,
  TaskError,
} from '../../tasks/infrastructure/task-repository.ts';
import { PostgresWorldRepository } from './postgres-world-repository.ts';
import { PostgresClockStore } from './clock-repository.ts';
import { projectStoryTime } from '../domain/clock.ts';
async function readBuild(sql: SqlClient, seedId: string) {
  const row = (
    await sql.query('SELECT * FROM parallel_life.world_builds WHERE seed_id=$1', [seedId])
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  const task = (
    await sql.query(
      "SELECT * FROM parallel_life.tasks WHERE scope_kind='world-build' AND scope_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [seedId],
    )
  ).rows[0];
  return WorldBuildSchema.parse({
    seedId: row.seed_id,
    worldId: row.world_id,
    createdAt: row.created_at.toISOString(),
    ready: !!row.opening,
    task: task ? publicTask(task) : null,
  });
}
export class BuildRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  /**
   * One query for the whole list (previously two per build, so up to ~200 round
   * trips on the phone's branch screen).
   */
  async list(ownerId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const rows = (
        await sql.query(
          `SELECT b.seed_id, b.world_id, b.created_at AS build_created_at,
                  b.opening IS NOT NULL AS ready, t.*
             FROM parallel_life.world_builds b
             LEFT JOIN LATERAL (
               SELECT * FROM parallel_life.tasks task
                WHERE task.scope_kind='world-build' AND task.scope_id=b.seed_id::text
                ORDER BY task.created_at DESC, task.id DESC LIMIT 1
             ) t ON true
            ORDER BY b.created_at DESC
            LIMIT 100`,
        )
      ).rows;
      return rows.map((row) =>
        WorldBuildSchema.parse({
          seedId: row.seed_id,
          worldId: row.world_id,
          createdAt: row.build_created_at.toISOString(),
          ready: row.ready,
          task: row.id ? publicTask(row) : null,
        }),
      );
    });
  }
  async create(ownerId: string, raw: WorldBuildRequest) {
    const request = WorldBuildRequestSchema.parse(raw);
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const seedRow = (
        await sql.query('SELECT document FROM parallel_life.approved_seeds WHERE id=$1', [
          request.seedId,
        ])
      ).rows[0];
      if (!seedRow) throw new TaskError('NOT_FOUND');
      ApprovedSeedSchema.parse(seedRow.document);
      const hash = requestHash(['world-build', request.seedId]);
      const duplicate = (
        await sql.query(
          'SELECT request_hash FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=$2',
          [ownerId, request.commandId],
        )
      ).rows[0];
      if (duplicate && duplicate.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
      const existing = (
        await sql.query('SELECT seed_id FROM parallel_life.world_builds WHERE seed_id=$1', [
          request.seedId,
        ])
      ).rows[0];
      if (existing) return readBuild(sql, request.seedId);
      const worldId = randomUUID();
      await sql.query(
        'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id) VALUES($1,$2,$3)',
        [request.seedId, ownerId, worldId],
      );
      await enqueue(
        sql,
        ownerId,
        'world-build',
        request.seedId,
        request.commandId,
        { kind: 'world-build', seedId: request.seedId, worldId },
        hash,
      );
      return readBuild(sql, request.seedId);
    });
  }
  async phone(ownerId: string, worldId: string) {
    const metadata = await this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          'SELECT * FROM parallel_life.world_builds WHERE world_id=$1 AND opening IS NOT NULL',
          [worldId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      return row;
    });
    const state = await new PostgresWorldRepository(this.db).get({ userId: ownerId }, worldId);
    const clock = await new PostgresClockStore(this.db).read(ownerId, worldId);
    const storyTime = new Date(
      Math.max(
        Date.parse(state.time),
        Date.parse(projectStoryTime(clock, new Date().toISOString())),
      ),
    ).toISOString();
    return WorldPhoneSchema.parse({
      id: state.id,
      seedId: metadata.seed_id,
      photos: await this.db.transaction(ownerId, (sql) => albumPhotos(sql, worldId)),
      version: state.version,
      invitations: state.appointments
        .filter((a) => a.status)
        .map(({ sourceEventId: _source, ...a }) => a),
      title: state.title,
      time: storyTime,
      identity: metadata.opening.identity,
      setting: metadata.opening.setting,
      actors: state.actors.map((a, index) => ({
        id: a.id,
        name: a.name,
        relationship: metadata.opening.actors[index]?.relationship ?? '',
        summary: metadata.opening.actors[index]?.persona ?? a.persona,
      })),
      messages: state.messages.map((m) => ({
        id: m.id,
        actorId: m.actorId,
        role: m.role,
        text: m.text,
        at: m.at,
      })),
      notes: [
        /* Opening notes come from the immutable build snapshot. */
        ...metadata.opening.notes.map((note: { title: string; text: string }, index: number) => ({
          id: `${worldId}:opening-note:${index}`,
          title: note.title,
          text: note.text,
          version: 0,
          updatedAt: state.time,
        })),
        /* Saved notes come from their own projection. */
        ...(state.notes ?? []).map((note) => ({
          id: note.id,
          title: note.title,
          text: note.text,
          version: note.version,
          updatedAt: note.updatedAt,
        })),
      ],
    });
  }
}
