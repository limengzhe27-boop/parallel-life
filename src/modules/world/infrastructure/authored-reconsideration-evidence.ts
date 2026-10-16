import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { DirectorPendingReason } from '../domain/world-awareness.ts';
import type { AuthoredReconsiderationReason } from '../domain/authored-reconsideration.ts';
import { DomainError } from '../domain/errors.ts';

/** Authenticate wake evidence against the immutable executed event, not a caller's report. */
export async function readAuthoredReconsiderationEvidence(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  worldVersion: number,
): Promise<AuthoredReconsiderationReason[]> {
  const rows = (
    await sql.query(
      `SELECT DISTINCT ON (r.document->'ref'->>'actorId',r.document->>'kind') r.id,r.source_event_id,r.source_version,r.document,e.payload,
    a.response->'snapshot'->'state' previous_state
    FROM parallel_life.director_pending_reasons r
    JOIN parallel_life.world_events e ON e.world_id=r.world_id AND e.owner_id=r.owner_id AND e.id=r.source_event_id AND e.version=r.source_version
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    LEFT JOIN parallel_life.agent_attempts a ON a.world_id=e.world_id AND a.owner_id=e.owner_id AND a.event_id=e.id AND a.status='committed'
    WHERE r.world_id=$1 AND r.owner_id=$2 AND r.source_version<=$3
    AND r.document->>'kind' IN ('player_decision','plan_changed','action_result') ORDER BY r.document->'ref'->>'actorId',r.document->>'kind',r.source_version DESC,r.id DESC`,
      [worldId, ownerId, worldVersion],
    )
  ).rows;
  const semanticReasons: AuthoredReconsiderationReason[] = rows.map((row) => {
    const r = row.document as DirectorPendingReason,
      e = row.payload;
    const reject = (): never => {
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_AUTHORED_RECONSIDERATION_EVIDENCE');
    };
    if (
      r.id !== row.id ||
      r.eventId !== row.source_event_id ||
      r.worldVersion !== row.source_version ||
      e.id !== r.eventId ||
      e.worldId !== worldId ||
      e.version !== r.worldVersion ||
      r.ref.kind === 'event'
    )
      return reject();
    const ref = r.ref,
      data = e.data,
      runtime = data?.agentRuntime,
      previous = row.previous_state;
    if (
      e.type === 'invitation.responded' &&
      r.kind === 'player_decision' &&
      ref.kind === 'decision'
    ) {
      if (
        !data.agentProjections?.some(
          (p: any) =>
            p.actorId === ref.actorId &&
            p.worldId === worldId &&
            p.source?.recordId === e.id &&
            p.source.worldVersion === e.version &&
            p.decisions?.some((d: any) => d.id === ref.id && d.sourceId === p.source.id),
        )
      )
        return reject();
      return r;
    }
    if (
      ![
        'turn.resolved',
        'agent.state_committed',
        'group.turn_resolved',
        'scene.reaction_recorded',
      ].includes(e.type) ||
      data?.actorId !== ref.actorId ||
      runtime?.stateAfter?.actorId !== ref.actorId ||
      runtime.stateAfter.worldId !== worldId ||
      runtime.stateAfter.projectedWorldVersion !== e.version ||
      !previous ||
      previous.actorId !== ref.actorId ||
      previous.worldId !== worldId
    )
      return reject();
    if (r.kind === 'plan_changed' && ref.kind === 'plan') {
      const next = runtime.stateAfter.plans.find((p: any) => p.id === ref.id),
        old = previous.plans.find((p: any) => p.id === ref.id);
      if (!next || JSON.stringify(next) === JSON.stringify(old)) return reject();
    } else if (r.kind === 'player_decision' && ref.kind === 'decision') {
      if (
        !runtime.proposal?.decisions?.some((d: any) => d.id === ref.id) ||
        !runtime.stateAfter.decisions.some((d: any) => d.id === ref.id) ||
        previous.decisions.some((d: any) => d.id === ref.id)
      )
        return reject();
    } else if (r.kind === 'action_result' && ref.kind === 'action_result') {
      if (
        !runtime.results?.some(
          (r: any) =>
            r.id === ref.id &&
            r.worldId === worldId &&
            r.actorId === ref.actorId &&
            r.eventId === e.id &&
            r.worldVersion === e.version,
        )
      )
        return reject();
    } else return reject();
    return r;
  });

  const arrivalRows = (
    await sql.query(
      `SELECT DISTINCT ON (
        CASE
          WHEN e.payload->>'type' = 'agent.arrival_committed' THEN 'actor:' || (e.payload->'data'->>'actorId')
          WHEN e.payload->'data'->>'actorId' IS NOT NULL THEN 'actor:' || (e.payload->'data'->>'actorId')
          ELSE 'player'
        END
      )
        r.id,
        r.source_event_id,
        r.source_version,
        r.document,
        e.payload,
        j.document AS journey_document,
        s.document AS scene_document
      FROM parallel_life.director_pending_reasons r
      JOIN parallel_life.world_events e
        ON e.world_id = r.world_id
       AND e.owner_id = r.owner_id
       AND e.id = r.source_event_id
       AND e.version = r.source_version
      JOIN parallel_life.commands c
        ON c.world_id = e.world_id
       AND c.owner_id = e.owner_id
       AND c.id = e.command_id
       AND c.status = 'succeeded'
       AND c.result_event_id = e.id
      LEFT JOIN parallel_life.npc_journeys j
        ON j.world_id = e.world_id
       AND j.owner_id = e.owner_id
       AND j.id = e.payload->'data'->>'journeyId'
      LEFT JOIN parallel_life.scene_sessions s
        ON s.world_id = e.world_id
       AND s.owner_id = e.owner_id
       AND s.id = e.payload->'data'->>'sceneId'
      WHERE r.world_id = $1
        AND r.owner_id = $2
        AND r.source_version <= $3
        AND r.document->>'kind' = 'new_condition'
        AND e.payload->>'type' IN ('travel.completed', 'agent.arrival_committed', 'scene.entered')
      ORDER BY
        CASE
          WHEN e.payload->>'type' = 'agent.arrival_committed' THEN 'actor:' || (e.payload->'data'->>'actorId')
          WHEN e.payload->'data'->>'actorId' IS NOT NULL THEN 'actor:' || (e.payload->'data'->>'actorId')
          ELSE 'player'
        END,
        r.source_version DESC,
        r.id DESC`,
      [worldId, ownerId, worldVersion],
    )
  ).rows;

  const arrivalReasons: AuthoredReconsiderationReason[] = arrivalRows.map((row) => {
    const r = row.document as DirectorPendingReason,
      e = row.payload,
      data = e?.data;
    const reject = (): never => {
      throw new DomainError('INVALID_PROPOSAL', 'INVALID_AUTHORED_RECONSIDERATION_EVIDENCE');
    };
    if (
      r.id !== row.id ||
      r.eventId !== row.source_event_id ||
      r.worldVersion !== row.source_version ||
      r.kind !== 'new_condition' ||
      r.ref?.kind !== 'event' ||
      r.ref.id !== e.id ||
      e.id !== r.eventId ||
      e.worldId !== worldId ||
      e.version !== r.worldVersion
    )
      return reject();
    if (e.type === 'travel.completed') {
      if (
        typeof data?.toPlaceId !== 'string' ||
        !data.toPlaceId ||
        typeof data?.fromPlaceId !== 'string' ||
        !data.fromPlaceId ||
        !data.departedAt ||
        !data.arrivedAt ||
        Date.parse(data.departedAt) > Date.parse(data.arrivedAt) ||
        e.storyAt !== data.arrivedAt
      )
        return reject();
      return {
        ...r,
        placeId: data.toPlaceId,
        subjectKind: 'player',
      };
    }
    if (e.type === 'agent.arrival_committed') {
      const journey = row.journey_document;
      if (
        typeof data?.actorId !== 'string' ||
        !data.actorId ||
        typeof data?.journeyId !== 'string' ||
        !data.journeyId ||
        typeof data?.route?.toPlaceId !== 'string' ||
        !data.route.toPlaceId ||
        !data.arrival ||
        data.arrival.worldId !== worldId ||
        data.arrival.actorId !== data.actorId ||
        !journey ||
        journey.id !== data.journeyId ||
        journey.worldId !== worldId ||
        journey.actorId !== data.actorId ||
        journey.status !== 'arrived' ||
        journey.route?.toPlaceId !== data.route.toPlaceId
      )
        return reject();
      return {
        ...r,
        placeId: data.route.toPlaceId,
        actorId: data.actorId,
        subjectKind: 'actor',
      };
    }
    if (e.type === 'scene.entered') {
      const scene = row.scene_document;
      const placeId = (data?.placeId ?? scene?.placeId) as string | undefined;
      if (
        typeof data?.sceneId !== 'string' ||
        !data.sceneId ||
        !scene ||
        scene.id !== data.sceneId ||
        scene.worldId !== worldId ||
        typeof placeId !== 'string' ||
        !placeId ||
        (data.placeId && scene.placeId && data.placeId !== scene.placeId)
      )
        return reject();
      const actorId = typeof data?.actorId === 'string' ? data.actorId : undefined;
      const hasPresence =
        Array.isArray(scene.presence) &&
        scene.presence.some((p: any) =>
          actorId
            ? p.participant?.kind === 'actor' &&
              p.participant?.actorId === actorId &&
              p.joinedVersion <= e.version
            : p.participant?.kind === 'player' && p.joinedVersion <= e.version,
        );
      if (!hasPresence) return reject();
      return {
        ...r,
        placeId,
        actorId,
        subjectKind: actorId ? 'actor' : 'player',
      };
    }
    return reject();
  });

  return [...semanticReasons, ...arrivalReasons];
}
