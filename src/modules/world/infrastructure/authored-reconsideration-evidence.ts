import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { DirectorPendingReason } from '../domain/world-awareness.ts';
import { DomainError } from '../domain/errors.ts';

/** Authenticate wake evidence against the immutable executed event, not a caller's report. */
export async function readAuthoredReconsiderationEvidence(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  worldVersion: number,
): Promise<DirectorPendingReason[]> {
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
  return rows.map((row) => {
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
}
