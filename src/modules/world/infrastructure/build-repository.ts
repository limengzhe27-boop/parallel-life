import { projectPlayerActors, type SelectedPlayerPerson } from '../domain/player-projection.ts';
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
export async function readBuild(sql: SqlClient, seedId: string) {
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
export async function createWorldBuild(
  sql: SqlClient,
  ownerId: string,
  request: WorldBuildRequest,
) {
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
             JOIN parallel_life.approved_seeds s ON s.id=b.seed_id
             LEFT JOIN LATERAL (
               SELECT * FROM parallel_life.tasks task
                WHERE task.scope_kind='world-build' AND task.scope_id=b.seed_id::text
                ORDER BY task.created_at DESC, task.id DESC LIMIT 1
             ) t ON true
            WHERE s.setting_draft_id IS NULL
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
    return this.db.transaction(ownerId, (sql) => createWorldBuild(sql, ownerId, request));
  }
  async phone(ownerId: string, worldId: string) {
    const metadata = await this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          'SELECT b.*,s.document AS approved_seed FROM parallel_life.world_builds b JOIN parallel_life.approved_seeds s ON s.id=b.seed_id AND s.owner_id=b.owner_id WHERE b.world_id=$1 AND b.opening IS NOT NULL',
          [worldId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      return row;
    });
    const state = await new PostgresWorldRepository(this.db).get({ userId: ownerId }, worldId);
    const choiceEventIds = (state.choices ?? []).flatMap((choice) => [
      choice.sourceEventId,
      ...(choice.nextStep ? [choice.nextStep.sourceEventId] : []),
      ...(choice.recoveryStep ? [choice.recoveryStep.sourceEventId] : []),
      ...(choice.result ? [choice.result.sourceEventId] : []),
    ]);
    const eventTimes = new Map<string, string>();
    if (choiceEventIds.length) {
      const rows = await this.db.transaction(ownerId, (sql) =>
        sql.query(
          'SELECT id,occurred_at FROM parallel_life.world_events WHERE world_id=$1 AND id=ANY($2::text[])',
          [worldId, choiceEventIds],
        ),
      );
      for (const row of rows.rows) eventTimes.set(row.id, new Date(row.occurred_at).toISOString());
    }
    const bindings = await this.db.transaction(ownerId, (sql) =>
      sql.query(
        `SELECT b.actor_id,b.person_id,b.asset_id,b.asset_revision,
          a.world_id IS NOT NULL AS has_current_avatar,a.asset_id AS current_asset_id,a.asset_revision AS current_asset_revision
         FROM parallel_life.world_person_bindings b
         LEFT JOIN parallel_life.world_person_avatars a ON a.world_id=b.world_id AND a.actor_id=b.actor_id AND a.person_id=b.person_id AND a.owner_id=b.owner_id
         WHERE b.world_id=$1 AND b.owner_id=$2`,
        [worldId, ownerId],
      ),
    );
    const seed = ApprovedSeedSchema.parse(metadata.approved_seed);
    const selected: SelectedPlayerPerson[] = bindings.rows.flatMap((binding) => {
      const actor = state.actors.find(
        (actor) => actor.id === binding.actor_id && actor.sourcePersonId === binding.person_id,
      );
      const person = seed.people.find((person) => person.id === binding.person_id);
      if (!actor || !person || !('personRoles' in seed)) return [];
      const role = seed.personRoles?.find((role) => role.personId === person.id)?.role;
      const photo = binding.has_current_avatar
        ? binding.current_asset_id
          ? { assetId: binding.current_asset_id, revision: binding.current_asset_revision }
          : undefined
        : binding.asset_id &&
            binding.asset_id === person.assetId &&
            seed.assets.some(
              (asset) =>
                asset.assetId === binding.asset_id && asset.revision === binding.asset_revision,
            )
          ? { assetId: binding.asset_id, revision: binding.asset_revision }
          : undefined;
      return [
        {
          actorId: actor.id,
          personId: person.id,
          name: person.name,
          relationship: role ?? person.relationship,
          ...(photo ? { photo } : {}),
        },
      ];
    });
    // A dialogue observed by this player introduces its speaker; hidden presence does not.
    const sceneContacts = await this.db.transaction(ownerId, (sql) =>
      sql.query(
        `SELECT DISTINCT i.document->'speaker'->>'actorId' AS actor_id
       FROM parallel_life.scene_items i JOIN parallel_life.world_events e
       ON e.world_id=i.world_id AND e.id=i.source_event_id AND e.owner_id=i.owner_id
       WHERE i.world_id=$1 AND i.owner_id=$2 AND i.kind='entry' AND e.version<=$3
       AND i.document->>'kind'='dialogue'
       AND i.document->'observableTo' @> $4::jsonb
       UNION
       SELECT DISTINCT m.participant->>'actorId' AS actor_id
       FROM parallel_life.world_group_memberships m
       JOIN parallel_life.world_group_memberships p ON p.world_id=m.world_id AND p.group_id=m.group_id AND p.owner_id=m.owner_id
       WHERE m.world_id=$1 AND m.owner_id=$2 AND m.participant->>'kind'='actor'
       AND p.participant->>'kind'='player' AND m.joined_version <= $3 AND p.joined_version <= $3
       AND GREATEST(m.joined_version,p.joined_version) < LEAST(COALESCE(m.left_version,$3+1),COALESCE(p.left_version,$3+1))`,
        [worldId, ownerId, state.version, JSON.stringify([{ kind: 'player' }])],
      ),
    );
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
      choices: (state.choices ?? []).flatMap((choice) => {
        const at = eventTimes.get(choice.sourceEventId);
        if (!at) return [];
        const resultAt = choice.result && eventTimes.get(choice.result.sourceEventId);
        const nextStepAt = choice.nextStep && eventTimes.get(choice.nextStep.sourceEventId);
        const recoveryStepAt =
          choice.recoveryStep && eventTimes.get(choice.recoveryStep.sourceEventId);
        // A shared committed event is the only safe link between the actor's
        // proposal and a calendar invitation. Ambiguous multi-invite turns stay unlinked.
        const nextStepEventId = choice.nextStep?.sourceEventId;
        const sameTurnInvitations = nextStepEventId
          ? state.appointments.filter(
              (appointment) =>
                appointment.sourceEventId === nextStepEventId &&
                appointment.participantIds.length === 1 &&
                appointment.participantIds[0] === choice.actorId &&
                appointment.status !== undefined,
            )
          : [];
        const linkedInvitation =
          sameTurnInvitations.length === 1 ? sameTurnInvitations[0] : undefined;
        return [
          {
            id: choice.id,
            actorId: choice.actorId,
            quote: choice.quote,
            intent: choice.intent,
            at,
            sourceEventId: choice.sourceEventId,
            status: choice.status,
            ...(choice.nextStep && nextStepAt
              ? {
                  nextStep: {
                    quote: choice.nextStep.quote,
                    at: nextStepAt,
                    sourceEventId: choice.nextStep.sourceEventId,
                    sourceMessageId: choice.nextStep.sourceMessageId,
                    ...(linkedInvitation
                      ? {
                          calendar: {
                            id: linkedInvitation.id,
                            title: linkedInvitation.title,
                            at: linkedInvitation.at,
                            status: linkedInvitation.status,
                          },
                        }
                      : {}),
                  },
                }
              : {}),
            ...(choice.result && resultAt
              ? {
                  result: {
                    kind: choice.result.kind,
                    quote: choice.result.quote,
                    at: resultAt,
                    sourceEventId: choice.result.sourceEventId,
                  },
                }
              : {}),
            ...(choice.result?.kind === 'blocked' && choice.recoveryStep && recoveryStepAt
              ? {
                  recoveryStep: {
                    quote: choice.recoveryStep.quote,
                    at: recoveryStepAt,
                    sourceEventId: choice.recoveryStep.sourceEventId,
                    sourceMessageId: choice.recoveryStep.sourceMessageId,
                  },
                }
              : {}),
          },
        ];
      }),
      version: state.version,
      invitations: state.appointments
        .filter((a) => a.status)
        .map(({ sourceEventId: _source, ...a }) => a),
      title: state.title,
      time: storyTime,
      identity: metadata.opening.identity,
      setting: metadata.opening.setting,
      actors: projectPlayerActors(
        state,
        selected,
        sceneContacts.rows.map((row) => row.actor_id),
      ),
      messages: state.messages.map((m) => ({
        id: m.id,
        actorId: m.actorId,
        role: m.role,
        text: m.text,
        at: m.at,
        ...(m.initialRead !== undefined ? { initialRead: m.initialRead } : {}),
        ...(m.history ? { origin: 'fictional_history' as const } : {}),
      })),
      notes: [
        // Generated opening notes have no player-knowledge provenance. Keep them internal.
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
