import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { AgentActionResult } from '../domain/agent-runtime.ts';
import type { AgentEpisodeRequest } from '../domain/agent-narrative.ts';
import type { EpisodeFollowUpContext } from '../domain/episode-followup-context.ts';
import { projectEpisodeParticipationLifecycle } from '../domain/episode-participation-lifecycle.ts';
import { agentConditionsReady } from '../application/agent-condition-checks.ts';

/** Read-only, from real committed consideration receipts and the already authorized actor view. */
export async function readEpisodeLifecycleContext(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
): Promise<EpisodeFollowUpContext[]> {
  const state = snapshot.viewState;
  const identities = (state.episodeParticipations ?? []).slice(-24);
  if (!identities.length) return [];
  const rows = (
    await sql.query(
      `SELECT r.*,er.choice,er.reason,er.source_ids,er.world_version,e.payload
 FROM parallel_life.agent_episode_requests r
 JOIN parallel_life.agent_runtime_worlds c ON c.world_id=r.world_id AND c.owner_id=r.owner_id AND c.engine_epoch=r.engine_epoch
 JOIN parallel_life.agent_episode_receipts er ON er.world_id=r.world_id AND er.owner_id=r.owner_id AND er.id=r.receipt_id AND er.request_id=r.id AND er.input_receipt_id=r.input_receipt_id
 JOIN parallel_life.agent_attempts a ON a.world_id=er.world_id AND a.owner_id=er.owner_id AND a.id=er.attempt_id AND a.status='committed' AND a.actor_id=r.actor_id AND a.input_receipt_id=er.input_receipt_id AND a.engine_epoch=r.engine_epoch AND a.event_id=er.source_event_id
 JOIN parallel_life.world_events e ON e.world_id=er.world_id AND e.owner_id=er.owner_id AND e.id=er.source_event_id AND e.version=er.world_version
 JOIN parallel_life.commands cm ON cm.world_id=e.world_id AND cm.id=e.command_id AND cm.status='succeeded' AND cm.result_event_id=e.id
 WHERE r.world_id=$1 AND r.owner_id=$2 AND r.actor_id=$3 AND r.id=ANY($4::text[]) AND r.status='consumed' AND er.world_version<=$5
 ORDER BY er.world_version,r.id`,
      [
        state.worldId,
        owner,
        state.actorId,
        identities.map((x) => x.id),
        state.projectedWorldVersion,
      ],
    )
  ).rows;
  const ids = state.actions.flatMap((a) => (a.resultId ? [a.resultId] : []));
  const allowed = new Set(snapshot.sources.map((s) => s.id));
  const results = (
    await sql.query(
      `SELECT r.document FROM parallel_life.agent_action_results r
 JOIN parallel_life.world_events e ON e.world_id=r.world_id AND e.owner_id=r.owner_id AND e.id=r.source_event_id AND e.version=r.world_version
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
 WHERE r.world_id=$1 AND r.owner_id=$2 AND r.actor_id=$3 AND r.id=ANY($4::text[]) AND r.world_version<=$5`,
      [state.worldId, owner, state.actorId, ids, state.projectedWorldVersion],
    )
  ).rows
    .map((r) => r.document as AgentActionResult)
    .filter((r) => r.evidenceSourceIds.every((id) => allowed.has(id)));
  const own = snapshot.worldContext?.selfPosition;
  const place =
    own?.status === 'at' &&
    own.sourceId &&
    allowed.has(own.sourceId) &&
    own.placeId &&
    snapshot.worldContext?.boundary.placeIds.includes(own.placeId)
      ? own.placeId
      : undefined;
  const out: EpisodeFollowUpContext[] = [];
  for (const row of rows) {
    const saved = identities.find((p) => p.id === row.id);
    const decision = {
      requestId: row.id,
      choice: row.choice,
      reason: row.reason,
      sourceIds: row.source_ids,
    };
    const rt = row.payload?.data?.agentRuntime;
    if (
      !saved ||
      saved.recordedAtVersion !== row.world_version ||
      saved.choice !== decision.choice ||
      saved.reason !== decision.reason ||
      !isDeepStrictEqual(saved.sourceIds, decision.sourceIds) ||
      !isDeepStrictEqual(rt?.episodeDecision, decision) ||
      !isDeepStrictEqual(rt?.proposal?.episodeDecision, decision) ||
      !saved.sourceIds.every((id) => allowed.has(id))
    )
      throw Object.assign(Error('EPISODE_LIFECYCLE_SOURCE_CONFLICT'), {
        code: 'EPISODE_LIFECYCLE_SOURCE_CONFLICT',
      });
    const request: AgentEpisodeRequest = {
      schemaVersion: 1,
      worldId: state.worldId,
      actorId: state.actorId,
      id: row.id,
      episodeId: row.episode_id,
      originDecisionId: row.origin_decision_id,
      engineEpoch: row.engine_epoch,
      createdAtVersion: row.created_at_version,
      activity: row.activity,
      status: row.status,
      inputReceiptId: row.input_receipt_id,
      receiptId: row.receipt_id,
    };
    const satisfied = [
      ...state.plans.flatMap((p) =>
        agentConditionsReady(snapshot, p.triggers, p.sourceIds, results, place) ? p.triggers : [],
      ),
      ...state.responsibilities.flatMap((r) =>
        agentConditionsReady(snapshot, r.nextCheck, r.sourceIds, results, place, [r.id])
          ? r.nextCheck
          : [],
      ),
    ];
    const view = projectEpisodeParticipationLifecycle({
      request,
      decision,
      state,
      results,
      satisfiedConditions: satisfied,
    });
    out.push({
      requestId: request.id,
      episodeId: request.episodeId,
      choice: decision.choice,
      followUp: view.followUp,
      goalIds: view.goals.map((g) => g.id),
      planIds: view.plans.map((p) => p.id),
      responsibilityIds: view.responsibilities.map((r) => r.id),
      readyPlanIds: view.reassessment.basis.filter((b) => b.kind === 'plan').map((b) => b.id),
      readyResponsibilityIds: view.reassessment.basis
        .filter((b) => b.kind === 'responsibility')
        .map((b) => b.id),
    });
  }
  return out;
}

export async function validateEpisodeLifecycleContext(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
) {
  if (snapshot.episodeFollowUps === undefined) return; // Old protected paid results keep their original protocol.
  if (
    !isDeepStrictEqual(
      snapshot.episodeFollowUps,
      await readEpisodeLifecycleContext(sql, owner, snapshot),
    )
  )
    throw Object.assign(Error('EPISODE_LIFECYCLE_SOURCE_CONFLICT'), {
      code: 'EPISODE_LIFECYCLE_SOURCE_CONFLICT',
    });
}
