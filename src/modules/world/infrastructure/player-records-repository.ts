import { historyPersonPhotos } from '../../media/infrastructure/album-projection.ts';
import { mergeAppointments } from '../domain/genesis-links.ts';
import { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { PlayerRecordsReader } from '../application/player-records.ts';
import { projectPlayerRecords, type PlayerRecordsInput } from '../domain/player-records.ts';
import { applyInvitationEvent } from '../domain/invitations.ts';
import { DomainError } from '../domain/errors.ts';
import { PlayerRecordsSchema } from '../../../contracts/world-records.ts';
import { SceneRuntimeActionSchema } from '../../../contracts/scenes.ts';
import { matterSceneObservation } from '../domain/matter-scene-observation.ts';
import type { WorldMatter } from '../domain/matters.ts';
import {
  sceneAttendanceSource,
  type SceneAttendanceEvent,
} from '../domain/scene-attendance-source.ts';

/** Reads all sources at one locked, committed version. Never writes projections/tasks. */
export class PostgresPlayerRecords implements PlayerRecordsReader {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async read(ownerId: string, worldId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const world = (
        await sql.query(
          'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR SHARE',
          [worldId, ownerId],
        )
      ).rows[0];
      if (!world) throw new DomainError('NOT_FOUND');
      const metadata = (
        await sql.query(
          "SELECT b.seed_id,b.opening->>'identity' AS identity,b.opening->>'setting' AS setting,s.document->'source' AS seed_source FROM parallel_life.world_builds b JOIN parallel_life.approved_seeds s ON s.id=b.seed_id AND s.owner_id=b.owner_id WHERE b.world_id=$1 AND b.owner_id=$2 AND b.opening IS NOT NULL",
          [worldId, ownerId],
        )
      ).rows[0];
      const initial = (
        await sql.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
          [worldId, ownerId],
        )
      ).rows[0]?.state;
      const choices = world.state.choices ?? [];
      let appointments = (
        await sql.query(
          "SELECT p.document FROM parallel_life.world_appointments p JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.id=p.document->>'sourceEventId' AND e.owner_id=p.owner_id WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3",
          [worldId, ownerId, world.version],
        )
      ).rows.map((r) => r.document);
      appointments = mergeAppointments(initial?.appointments ?? [], appointments);
      const ids = [
        ...new Set([
          ...choices.flatMap(
            (c: {
              sourceEventId: string;
              nextStep?: { sourceEventId: string };
              recoveryStep?: { sourceEventId: string };
              result?: { sourceEventId: string };
            }) =>
              [
                c.sourceEventId,
                c.nextStep?.sourceEventId,
                c.recoveryStep?.sourceEventId,
                c.result?.sourceEventId,
              ].filter(Boolean),
          ),
          ...appointments.map((a) => a.sourceEventId),
        ]),
      ];
      const events = (
        await sql.query(
          "SELECT id,world_id,version,payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version<=$3 AND (id=ANY($4::text[]) OR payload->>'type'='invitation.responded' OR (version=ANY($5::int[]) AND payload->>'type' IN ('scene.opened','scene.action_resolved'))) ORDER BY version",
          [
            worldId,
            ownerId,
            world.version,
            ids,
            appointments.flatMap((a) =>
              a.responseVersion === undefined ? [] : [a.responseVersion],
            ),
          ],
        )
      ).rows
        .filter(
          (r) =>
            r.payload.id === r.id &&
            r.payload.worldId === r.world_id &&
            r.payload.version === r.version,
        )
        .map((r) => r.payload);
      for (const e of events) {
        if (e.type === 'invitation.responded') {
          const projected = appointments.find((a) => a.id === e.data.id);
          if ((projected?.responseVersion ?? -1) >= e.version) continue;
          appointments = applyInvitationEvent(
            {
              ...world.state,
              id: worldId,
              version: e.version - 1,
              time: e.storyTime,
              appointments,
            },
            e,
          ).appointments;
        }
      }
      const eventIds = events.map((e) => e.id);
      const sceneAttendanceSources = new Map();
      for (const event of events) {
        if (
          !['scene.opened', 'scene.action_resolved'].includes(event.type) ||
          !event.data?.worldResults?.scene
        )
          continue;
        for (const appointment of appointments) {
          const proof = sceneAttendanceSource(
            world.state,
            appointment,
            event as SceneAttendanceEvent,
          );
          if (proof) sceneAttendanceSources.set(appointment.id, proof);
        }
      }
      const messages = (
        await sql.query(
          "SELECT p.document FROM parallel_life.world_messages p JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id AND e.owner_id=p.owner_id WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3 AND e.id=ANY($4::text[])",
          [worldId, ownerId, world.version, eventIds],
        )
      ).rows.map((r) => r.document);
      const matters: WorldMatter[] = world.state.matters ?? [];
      const actionIds = matters.flatMap((m) =>
        m.evidence?.kind === 'scene_action' ? [m.evidence.actionId] : [],
      );
      const actionRows = actionIds.length
        ? (
            await sql.query(
              `SELECT i.document,e.id AS event_id,e.version AS event_version,e.payload
         FROM parallel_life.scene_items i JOIN parallel_life.world_events e
           ON e.id=i.document#>>'{resolution,sourceEventId}' AND e.world_id=i.world_id AND e.owner_id=i.owner_id
         WHERE i.world_id=$1 AND i.owner_id=$2 AND i.kind='action' AND i.id=ANY($4::text[]) AND e.version<=$3`,
              [worldId, ownerId, world.version, actionIds],
            )
          ).rows
        : [];
      const matterObservations = new Map<string, string>();
      for (const row of actionRows) {
        const parsed = SceneRuntimeActionSchema.safeParse(row.document);
        if (
          !parsed.success ||
          row.payload.type !== 'scene.action_resolved' ||
          row.payload.id !== row.event_id ||
          row.payload.worldId !== worldId ||
          row.payload.version !== row.event_version ||
          row.payload.data?.sceneId !== parsed.data.sceneId
        )
          continue;
        for (const matter of matters) {
          const observation = matterSceneObservation(matter, parsed.data, {
            ownerId,
            worldId,
            worldVersion: world.version,
            eventId: row.event_id,
            eventVersion: row.event_version,
          });
          if (observation) matterObservations.set(matter.id, observation);
        }
      }
      const input: PlayerRecordsInput = {
        worldId,
        worldVersion: world.version,
        choices,
        matters,
        matterObservations,
        sceneAttendanceSources,
        appointments,
        messages,
        events,
        ...(initial ? { initial } : {}),
        historyPhotos: await historyPersonPhotos(sql, worldId),
        actors: (world.state.actors ?? []).map((a: { id: string; name: string }) => ({
          id: a.id,
          name: a.name,
        })),
        ...(metadata
          ? {
              opening: {
                seedId: metadata.seed_id,
                identity: metadata.identity,
                setting: metadata.setting,
                ...(metadata.seed_source?.kind === 'official_life'
                  ? {
                      officialSource: {
                        presetId: metadata.seed_source.presetId,
                        version: metadata.seed_source.version,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
      return PlayerRecordsSchema.parse(projectPlayerRecords(input));
    });
  }
}
