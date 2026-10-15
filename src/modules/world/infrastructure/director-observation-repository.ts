import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { PublicationEventProgressRepository } from '../../settings/infrastructure/publication-event-progress-repository.ts';
import type { DirectorObservation } from '../domain/director-observation.ts';
import type { StoryWorldInput } from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';

/** Per-actor latest successful exchange, so a busy conversation cannot erase the rest of the cast. */
export function readDirectorObservation(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  worldVersion: number,
  storyAt: string,
): Promise<DirectorObservation> {
  return db.transaction(ownerId, async (sql) => {
    const world = (
      await sql.query(
        'SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR SHARE',
        [worldId, ownerId],
      )
    ).rows[0];
    if (!world) throw new DomainError('NOT_FOUND');
    if (world.version !== worldVersion) throw new DomainError('VERSION_CONFLICT');
    const ids: string[] = world.state.actors.map((a: { id: string }) => a.id);
    const rows = (
      await sql.query(
        `SELECT latest.* FROM unnest($4::text[]) actor(id)
      CROSS JOIN LATERAL (
        SELECT e.id,e.version,e.payload,m.document AS message FROM parallel_life.world_events e
        JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
          AND c.status='succeeded' AND c.result_event_id=e.id AND e.version=c.expected_version+1
        JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.owner_id=e.owner_id
          AND m.actor_id=actor.id AND m.document->>'sourceEventId'=e.id
        WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 AND e.payload->>'type'='turn.resolved'
          AND e.payload->'data'->>'actorId'=actor.id AND m.document->>'role'='assistant'
          AND m.document->>'actorId'=actor.id AND m.document->'sourceVersion'=to_jsonb(e.version)
          AND NOT (m.document ? 'history') AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'effects') effect
            WHERE effect->>'type'='message.received' AND effect->>'id'=m.id AND effect->>'actorId'=actor.id AND effect->>'text'=m.document->>'text')
          AND NOT EXISTS(SELECT 1 FROM parallel_life.memory_records r WHERE r.owner_id=e.owner_id AND r.status='forgotten'
            AND ((r.scope_type='character' AND r.character_id=actor.id) OR (r.scope_type='branch' AND r.scope_id=$1))
            AND (r.source_ids ? e.id OR r.source_ids ? m.id))
        ORDER BY e.version DESC,m.ordinal DESC LIMIT 1
      ) latest ORDER BY latest.version DESC LIMIT 12`,
        [worldId, ownerId, worldVersion, ids],
      )
    ).rows;
    const changes = await new PublicationEventProgressRepository().recentWorldInputs(
      sql,
      ownerId,
      worldId,
      worldVersion,
    );
    const actorExchanges: DirectorObservation['actorExchanges'] = [];
    for (const row of rows) {
      if (
        !Number.isFinite(Date.parse(storyAt)) ||
        !Number.isFinite(Date.parse(row.message.at)) ||
        Date.parse(row.message.at) > Date.parse(storyAt)
      )
        continue;
      const director = row.payload.data.origin === 'director';
      const exchange = {
        actorId: row.message.actorId,
        sourceEventId: row.id,
        sourceVersion: row.version,
        at: row.message.at,
        origin: director ? ('director' as const) : ('user' as const),
        playerText: director ? null : String(row.payload.data.userText ?? '').slice(0, 500),
        actorText: String(row.message.text).slice(0, 600),
      };
      if (JSON.stringify([...actorExchanges, exchange]).length > 9000) break;
      actorExchanges.push(exchange);
    }
    const progressRows = (
      await sql.query(
        `SELECT p.node_key,p.state,e.id,e.version
      FROM parallel_life.publication_story_progress p
      JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.owner_id=p.owner_id AND e.id=p.state->>'lastSourceEventId'
      JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
      WHERE p.world_id=$1 AND p.owner_id=$2 AND p.world_version<=$3 AND e.version<=$3
        AND (p.state->>'cursorVersion')::int=e.version ORDER BY p.world_version DESC,p.node_key LIMIT 12`,
        [worldId, ownerId, worldVersion],
      )
    ).rows;
    const eventProgress: NonNullable<DirectorObservation['eventProgress']> = [];
    for (const progress of progressRows) {
      const state = progress.state;
      if (!['introduced', 'engaged', 'resolved'].includes(state.phase)) continue;
      const actors: NonNullable<DirectorObservation['eventProgress']>[number]['actors'] = [];
      for (const actorId of Object.keys(state.actorGoalStatus ?? {})
        .filter((id) => ids.includes(id))
        .slice(0, 24)) {
        const valid = async (sources: unknown) => {
          if (
            !Array.isArray(sources) ||
            sources.length !== 2 ||
            sources.some((s) => typeof s !== 'string')
          )
            return false;
          return (
            (
              await sql.query(
                `SELECT 1 FROM parallel_life.world_events e
            JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
            JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.id=$5 AND m.actor_id=$4 AND m.document->>'sourceEventId'=e.id
            WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3 AND e.version<=$6 AND m.document->'sourceVersion'=to_jsonb(e.version)
              AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'actorId'=$4
              AND ((m.document->>'role'='user' AND coalesce(e.payload->'data'->>'origin','user')<>'director' AND m.document->>'text'=e.payload->'data'->>'userText')
                OR (m.document->>'role'='assistant' AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'effects') x WHERE x->>'type'='message.received' AND x->>'id'=m.id AND x->>'actorId'=$4 AND x->>'text'=m.document->>'text')))
              AND NOT EXISTS(SELECT 1 FROM parallel_life.memory_records r WHERE r.owner_id=e.owner_id AND r.status='forgotten'
                AND ((r.scope_type='character' AND r.character_id=$4) OR (r.scope_type='branch' AND r.scope_id=$1))
                AND (r.source_ids ? e.id OR r.source_ids ? m.id))`,
                [worldId, ownerId, sources[0], actorId, sources[1], worldVersion],
              )
            ).rowCount === 1
          );
        };
        const participation =
          (await valid(state.actorParticipationSources?.[actorId])) &&
          ['engaged', 'declined'].includes(state.actorParticipation?.[actorId])
            ? state.actorParticipation[actorId]
            : 'unknown';
        const status =
          (await valid(state.actorGoalStatusSources?.[actorId])) &&
          ['active', 'deferred', 'fulfilled', 'withdrawn'].includes(state.actorGoalStatus[actorId])
            ? state.actorGoalStatus[actorId]
            : 'active';
        actors.push({ actorId, participation, status });
      }
      const entry = {
        nodeKey: progress.node_key,
        phase: state.phase,
        resolution: ['fulfilled', 'withdrawn', 'missed', 'alternative', 'unresolved'].includes(
          state.resolution,
        )
          ? state.resolution
          : null,
        sourceEventId: progress.id,
        sourceVersion: progress.version,
        actors,
      };
      if (JSON.stringify([...eventProgress, entry]).length > 6000) break;
      eventProgress.push(entry);
    }
    return {
      worldVersion,
      storyAt,
      actorExchanges,
      eventProgress,
      recentWorldInputs: changes.filter(
        (change): change is StoryWorldInput =>
          Date.parse(change.storyAt) <= Date.parse(storyAt) &&
          (change.kind === 'invitation_response'
            ? ['accept', 'cancel', 'attend', 'miss', 'reschedule'].includes(change.operation)
            : change.kind === 'scene_result'
              ? change.outcome === null ||
                ['succeeded', 'partial', 'failed'].includes(change.outcome)
              : true),
      ),
    };
  });
}
