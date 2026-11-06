import { projectStoryTime } from '../domain/clock.ts';
import { readClockInTransaction } from './clock-repository.ts';
import { historyPersonPhotos } from '../../media/infrastructure/album-projection.ts';
import { isDeepStrictEqual } from 'node:util';
import { mergeAppointments } from '../domain/genesis-links.ts';
import { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { PlayerRecordsReader } from '../application/player-records.ts';
import {
  projectPlayerRecords,
  urgentArrivalRequest,
  urgentArrivalRelease,
  urgentArrivalWasRelieved,
  type PlayerRecordsInput,
  type VisibleStoryRequest,
} from '../domain/player-records.ts';
import { replayWorldHistory, type WorldHistoryEvent } from '../domain/world-history.ts';
import { readPublicationInvitationLinks } from '../../settings/infrastructure/publication-story-repository.ts';
import { applyInvitationEvent } from '../domain/invitations.ts';
import { DomainError } from '../domain/errors.ts';
import { PlayerRecordsSchema } from '../../../contracts/world-records.ts';
import { SceneRuntimeActionSchema } from '../../../contracts/scenes.ts';
import { matterSceneObservation } from '../domain/matter-scene-observation.ts';
import type { WorldMatter } from '../domain/matters.ts';
import type { Appointment } from '../domain/types.ts';
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
      let appointments: Appointment[] = (
        await sql.query(
          "SELECT p.document FROM parallel_life.world_appointments p JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.id=p.document->>'sourceEventId' AND e.owner_id=p.owner_id WHERE p.world_id=$1 AND p.owner_id=$2 AND e.version<=$3",
          [worldId, ownerId, world.version],
        )
      ).rows.map((r) => r.document);
      appointments = mergeAppointments(initial?.appointments ?? [], appointments);
      // Genesis invitations keep their original source; a scene attendance result is
      // recovered from committed events rather than an unverified projection overwrite.
      if (initial) {
        const attendance = await sql.query(
          "SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version<=$3 AND payload->'data'->'worldResults'->'attendance' IS NOT NULL LIMIT 1",
          [worldId, ownerId, world.version],
        );
        if (attendance.rowCount) {
          const history = (
            await sql.query(
              'SELECT id,world_id,version,payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version<=$3 ORDER BY version',
              [worldId, ownerId, world.version],
            )
          ).rows
            .filter(
              (r) =>
                r.payload.id === r.id &&
                r.payload.worldId === r.world_id &&
                r.payload.version === r.version,
            )
            .map((r) => r.payload) as WorldHistoryEvent[];
          appointments = replayWorldHistory(
            initial,
            history,
            world.version,
            await readPublicationInvitationLinks(sql, ownerId, worldId),
          ).world.appointments;
        }
      }
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
          ...(world.state.matters ?? []).flatMap((m: WorldMatter) => [
            ...(m.source.kind === 'director_proposal' ? [m.source.eventId] : []),
            ...(m.pursuitProgress?.milestones.map((step) => step.eventId) ?? []),
            ...(m.evidence?.kind === 'scene_steps' ? [m.evidence.eventId] : []),
            ...(m.visibility === 'player_visible'
              ? (m.stepProgress?.steps ?? [])
                  .slice(0, 7)
                  .flatMap((step) => [step.inputEventId, step.eventId])
              : []),
          ]),
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
      const openInvitations = new Map(
        appointments
          .filter((a) => a.status === 'proposed' || a.status === 'confirmed')
          .map((a) => [a.id, a.sourceEventId]),
      );
      const directedInvitationIds = new Set<string>();
      if (openInvitations.size) {
        const evidence = await sql.query(
          `SELECT ev.subject_id, ev.source_event_id
           FROM parallel_life.agent_episode_evidence ev
           JOIN parallel_life.shared_episodes ep
             ON ep.world_id=ev.world_id AND ep.owner_id=ev.owner_id AND ep.id=ev.episode_id
           JOIN parallel_life.director_decisions d
             ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id AND d.id=ep.origin_decision_id
           JOIN parallel_life.director_runtime_attempts a
             ON a.world_id=d.world_id AND a.owner_id=d.owner_id AND a.id=d.attempt_id
               AND a.decision_id=d.id AND a.status='committed'
           WHERE ev.world_id=$1 AND ev.owner_id=$2 AND ev.world_version<=$3
             AND ev.kind='invitation_proposed' AND ev.subject_kind='appointment'
             AND ev.subject_id=ANY($4::text[]) AND ep.document->>'status'<>'withdrawn'`,
          [worldId, ownerId, world.version, [...openInvitations.keys()]],
        );
        for (const row of evidence.rows)
          if (openInvitations.get(row.subject_id) === row.source_event_id)
            directedInvitationIds.add(row.subject_id);
      }
      // The director's internal text never leaves the server. Join only the NPC's
      // actual player-visible question and its still-waiting, same-episode responsibility.
      const pendingStoryRequests = (
        await sql.query(
          `SELECT * FROM (
           SELECT DISTINCT ON (r.id) r.id AS request_id, r.actor_id, m.id AS message_id,
                  m.document->>'text' AS text, m.document->>'at' AS at,
                  e.id AS event_id, e.version AS event_version, m.ordinal AS message_ordinal
           FROM parallel_life.actor_agent_states s
           JOIN parallel_life.agent_runtime_worlds runtime
             ON runtime.world_id=s.world_id AND runtime.owner_id=s.owner_id
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.document->'questions','[]')) q
           JOIN LATERAL jsonb_array_elements(COALESCE(s.document->'responsibilities','[]')) responsibility
             ON responsibility->>'id'=q->>'responsibilityId'
           JOIN parallel_life.agent_episode_requests r
             ON r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.actor_id=s.actor_id
               AND r.id=responsibility#>>'{subject,id}' AND r.engine_epoch=runtime.engine_epoch
               AND r.status='consumed'
           JOIN parallel_life.agent_episode_receipts receipt
             ON receipt.world_id=r.world_id AND receipt.owner_id=r.owner_id AND receipt.id=r.receipt_id
               AND receipt.request_id=r.id AND receipt.actor_id=r.actor_id
               AND receipt.input_receipt_id=r.input_receipt_id AND receipt.choice='engage'
           JOIN parallel_life.shared_episodes episode
             ON episode.world_id=r.world_id AND episode.owner_id=r.owner_id AND episode.id=r.episode_id
               AND episode.origin_decision_id=r.origin_decision_id AND episode.document->>'status'='active'
           JOIN parallel_life.world_messages m
             ON m.world_id=r.world_id AND m.owner_id=r.owner_id AND m.actor_id=r.actor_id
               AND left(q->>'sourceId',8)='message:' AND m.id=substring(q->>'sourceId' from 9)
               AND receipt.presented_message_ids ? m.id
               AND m.document->>'role'='assistant' AND m.document->>'text'=q->>'text'
           JOIN parallel_life.world_events e
             ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.document->>'sourceEventId'
               AND e.version<=receipt.world_version
           JOIN parallel_life.commands command
             ON command.world_id=e.world_id AND command.owner_id=e.owner_id AND command.id=e.command_id
               AND command.result_event_id=e.id AND command.status='succeeded'
           WHERE s.world_id=$1 AND s.owner_id=$2 AND s.projected_world_version<=$3
             AND receipt.world_version<=$3
             AND q->>'status'='open' AND q->>'channel'='private' AND q->>'threadId'=s.actor_id
             AND responsibility->>'waitingOn'='player' AND responsibility->>'status' IN ('open','waiting','deferred')
             AND responsibility#>>'{subject,kind}'='request'
             AND (responsibility->'sourceIds' ? r.input_receipt_id
               OR responsibility->'sourceIds' ? ('episode-intent:'||r.id))
           ORDER BY r.id,e.version DESC,m.ordinal DESC
           ) pending ORDER BY event_version DESC,request_id`,
          [worldId, ownerId, world.version],
        )
      ).rows;
      const urgentRequests = pendingStoryRequests.filter((row) =>
        urgentArrivalRequest.test(row.text),
      );
      const relieved = new Set<string>();
      if (urgentRequests.length) {
        const unambiguous = urgentRequests.filter(
          (row) => urgentRequests.filter((other) => other.actor_id === row.actor_id).length === 1,
        );
        if (unambiguous.length) {
          const later = await sql.query(
            `SELECT pending.request_id, followup.text
             FROM unnest($4::text[], $5::text[], $6::bigint[]) pending(request_id, actor_id, ordinal)
             CROSS JOIN LATERAL (
               SELECT m.document->>'text' AS text, m.ordinal
               FROM parallel_life.world_messages m
               JOIN parallel_life.world_events e
                 ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.document->>'sourceEventId'
               JOIN parallel_life.commands c
                 ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
                   AND c.result_event_id=e.id AND c.status='succeeded'
               WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=pending.actor_id
                 AND e.version<=$3 AND m.ordinal>pending.ordinal
                 AND m.document->>'role'='assistant'
                 AND (m.document->>'text' ~ $7 OR m.document->>'text' ~ $8)
               ORDER BY m.ordinal DESC LIMIT 1
             ) followup`,
            [
              worldId,
              ownerId,
              world.version,
              unambiguous.map((row) => row.request_id),
              unambiguous.map((row) => row.actor_id),
              unambiguous.map((row) => row.message_ordinal),
              urgentArrivalRequest.source,
              urgentArrivalRelease.source,
            ],
          );
          for (const row of later.rows)
            if (urgentArrivalWasRelieved(row.text)) relieved.add(row.request_id);
        }
      }
      const storyRequests = pendingStoryRequests
        .filter((row) => !relieved.has(row.request_id))
        .slice(0, 3)
        .map((row): VisibleStoryRequest => ({
          requestId: row.request_id,
          actorId: row.actor_id,
          text: row.text,
          source: {
            kind: 'world_event',
            eventId: row.event_id,
            eventVersion: row.event_version,
            messageId: row.message_id,
            at: row.at,
            timeBasis: 'story',
          },
        }));
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
      const stepRefs = matters.flatMap((m) =>
        m.visibility === 'player_visible' ? (m.stepProgress?.steps ?? []).slice(0, 7) : [],
      );
      const actionIds = [
        ...new Set([
          ...matters.flatMap((m) =>
            m.evidence?.kind === 'scene_action' || m.evidence?.kind === 'scene_steps'
              ? [m.evidence.actionId]
              : [],
          ),
          ...stepRefs.map((step) => step.actionId),
        ]),
      ];
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
      const sceneStepSources: NonNullable<PlayerRecordsInput['sceneStepSources']>[number][] = [];
      const savedSources = new Set<string>();
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
        const action = parsed.data;
        const original = events.find((event) => event.id === action.sourceEventId);
        if (
          stepRefs.some((step) => step.actionId === action.id && step.eventId === row.event_id) &&
          action.worldId === worldId &&
          action.ownerId === ownerId &&
          action.status === 'resolved' &&
          original?.type === 'scene.input_recorded' &&
          original.version === action.sourceVersion &&
          original.data?.sceneId === action.sceneId &&
          original.data?.privateThought === false &&
          isDeepStrictEqual(row.payload.data?.worldResults?.action, action) &&
          !savedSources.has(action.id + ':' + row.event_id)
        ) {
          savedSources.add(action.id + ':' + row.event_id);
          sceneStepSources.push({
            inputEvent: {
              id: original.id,
              worldId: original.worldId,
              version: original.version,
              type: 'scene.input_recorded',
              sceneId: original.data.sceneId,
              privateThought: false,
            },
            resultEvent: row.payload,
            action,
          });
        }
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
      const realNow = new Date().toISOString();
      const clock = matters.some((matter) => matter.span === 'near_term' && matter.relatedPlaceId)
        ? await readClockInTransaction(sql, ownerId, worldId, realNow)
        : undefined;
      const input: PlayerRecordsInput = {
        ...(clock
          ? {
              sceneTaskContext: {
                space: world.state.space,
                storyAt: new Date(
                  Math.max(
                    Date.parse(world.state.time),
                    Date.parse(projectStoryTime(clock, realNow)),
                  ),
                ).toISOString(),
              },
            }
          : {}),
        worldId,
        worldVersion: world.version,
        choices,
        matters,
        matterObservations,
        sceneAttendanceSources,
        progressionEvents: events.filter((e) => e.type === 'scene.action_resolved'),
        sceneStepSources,
        appointments,
        directedInvitationIds,
        storyRequests,
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
