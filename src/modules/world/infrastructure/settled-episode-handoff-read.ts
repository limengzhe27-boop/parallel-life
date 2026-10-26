import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState, AgentCondition } from '../domain/agent-runtime.ts';

type ScopedState = Pick<
  ActorAgentState,
  'goals' | 'plans' | 'actions' | 'responsibilities' | 'questions'
>;
type Scope = { episodeId: string; requestId: string; inputReceiptId: string | null };

/** A quiet receipt only releases this handoff's scheduling slot, never anyone's other work. */
export function hasHandoffFollowup(state: ScopedState | null, scope: Scope): boolean {
  if (!state) return false;
  const roots = new Set([
    `episode-intent:${scope.requestId}`,
    ...(scope.inputReceiptId ? [scope.inputReceiptId] : []),
  ]);
  type Node = { key: string; active: boolean; seed: boolean; links: string[] };
  const nodes: Node[] = [];
  const key = (kind: string, id: string) => kind + ':' + id;
  const based = (sourceIds: readonly string[] = []) => sourceIds.some((id) => roots.has(id));
  const conditionLinks = (conditions: readonly AgentCondition[] = []) =>
    conditions.flatMap((c) =>
      c.kind === 'result'
        ? [key('action', c.actionId)]
        : c.kind === 'player_decision'
          ? [key('responsibility', c.responsibilityId)]
          : [],
    );
  const conditionBased = (conditions: readonly AgentCondition[] = []) =>
    conditions.some((c) => 'sourceId' in c && roots.has(c.sourceId));
  for (const g of state.goals ?? [])
    nodes.push({
      key: key('goal', g.id),
      active: !['fulfilled', 'withdrawn', 'expired'].includes(g.status),
      seed: based(g.sourceIds),
      links: [],
    });
  for (const p of state.plans ?? [])
    nodes.push({
      key: key('plan', p.id),
      active: !['finished', 'withdrawn'].includes(p.status),
      seed: based(p.sourceIds) || conditionBased(p.triggers),
      links: [
        key('goal', p.goalId),
        ...(p.actionIds ?? []).map((id) => key('action', id)),
        ...(p.nextActionId ? [key('action', p.nextActionId)] : []),
        ...conditionLinks(p.triggers),
      ],
    });
  for (const r of state.responsibilities ?? [])
    nodes.push({
      key: key('responsibility', r.id),
      active: ['open', 'waiting', 'deferred'].includes(r.status),
      seed:
        based(r.sourceIds) ||
        conditionBased(r.nextCheck) ||
        (r.subject.kind === 'episode' && r.subject.id === scope.episodeId) ||
        (r.subject.kind === 'request' &&
          [scope.requestId, scope.inputReceiptId].includes(r.subject.id)),
      links: conditionLinks(r.nextCheck),
    });
  for (const a of state.actions ?? [])
    nodes.push({
      key: key('action', a.id),
      active: !['succeeded', 'failed', 'withdrawn'].includes(a.status),
      seed: based(a.sourceIds) || conditionBased(a.preconditions),
      links: [
        ...(a.goalId ? [key('goal', a.goalId)] : []),
        ...(a.dependsOnActionIds ?? []).map((id) => key('action', id)),
        ...(a.handlesResponsibilityIds ?? []).map((id) => key('responsibility', id)),
        ...conditionLinks(a.preconditions),
      ],
    });
  for (const q of state.questions ?? [])
    nodes.push({
      key: key('question', q.id),
      active: q.status === 'open',
      seed: roots.has(q.sourceId),
      links: q.responsibilityId ? [key('responsibility', q.responsibilityId)] : [],
    });
  const known = new Map(nodes.map((node) => [node.key, node]));
  const neighbors = new Map(nodes.map((node) => [node.key, new Set<string>()]));
  for (const node of nodes)
    for (const link of node.links)
      if (known.has(link)) {
        neighbors.get(node.key)!.add(link);
        neighbors.get(link)!.add(node.key);
      }
  const related = new Set(nodes.filter((node) => node.seed).map((node) => node.key));
  const pending = [...related];
  while (pending.length)
    for (const link of neighbors.get(pending.pop()!) ?? [])
      if (!related.has(link)) {
        related.add(link);
        pending.push(link);
      }
  return nodes.some((node) => node.active && related.has(node.key));
}

/** A consumed quiet consideration is not a presented/finished episode. It only
 * releases scheduling capacity for OTHER, still-unassessed catalogue entries. */
export async function readSettledUnpresentedHandoffs(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; engineEpoch: number; worldVersion: number },
) {
  const rows = (
    await sql.query(
      `
    SELECT ep.id, jsonb_agg(jsonb_build_object('id',er.id,'version',er.world_version,
      'requestId',q.id,'inputReceiptId',q.input_receipt_id,
      'state',jsonb_build_object(
        'goals',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',g->'id','status',g->'status','sourceIds',g->'sourceIds')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(s.document->'goals','[]'::jsonb)) g),
        'plans',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p->'id','status',p->'status','sourceIds',p->'sourceIds','goalId',p->'goalId','actionIds',p->'actionIds','nextActionId',p->'nextActionId','triggers',p->'triggers')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(s.document->'plans','[]'::jsonb)) p),
        'actions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',ac->'id','status',ac->'status','sourceIds',ac->'sourceIds','goalId',ac->'goalId','dependsOnActionIds',ac->'dependsOnActionIds','handlesResponsibilityIds',ac->'handlesResponsibilityIds','preconditions',ac->'preconditions')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(s.document->'actions','[]'::jsonb)) ac),
        'responsibilities',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r->'id','status',r->'status','sourceIds',r->'sourceIds','subject',r->'subject','nextCheck',r->'nextCheck')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(s.document->'responsibilities','[]'::jsonb)) r),
        'questions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',qn->'id','status',qn->'status','sourceId',qn->'sourceId','responsibilityId',qn->'responsibilityId')),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(s.document->'questions','[]'::jsonb)) qn)),
      'pending',EXISTS (SELECT 1 FROM parallel_life.agent_attempts pending
        WHERE pending.world_id=q.world_id AND pending.owner_id=q.owner_id AND pending.actor_id=q.actor_id AND pending.engine_epoch=$3
          AND pending.status IN ('reserved','request_sent','response_received','unknown_after_send')
          AND (pending.input_receipt_id=q.input_receipt_id OR EXISTS (
            SELECT 1 FROM parallel_life.agent_episode_attempt_bindings binding WHERE binding.world_id=pending.world_id AND binding.owner_id=pending.owner_id AND binding.actor_id=pending.actor_id AND binding.attempt_id=pending.id AND binding.engine_epoch=$3 AND binding.request_id=q.id)))) ORDER BY er.id) receipts
    FROM parallel_life.shared_episodes ep
    JOIN parallel_life.director_decisions d ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id AND d.id=ep.origin_decision_id AND d.engine_epoch=$3
    JOIN parallel_life.agent_episode_requests q ON q.world_id=ep.world_id AND q.owner_id=ep.owner_id AND q.episode_id=ep.id AND q.origin_decision_id=d.id AND q.engine_epoch=$3
    LEFT JOIN parallel_life.agent_episode_receipts er ON er.world_id=q.world_id AND er.owner_id=q.owner_id AND er.id=q.receipt_id AND er.request_id=q.id AND er.actor_id=q.actor_id AND er.episode_id=q.episode_id AND er.input_receipt_id=q.input_receipt_id
    LEFT JOIN parallel_life.agent_attempts a ON a.world_id=er.world_id AND a.owner_id=er.owner_id AND a.id=er.attempt_id AND a.actor_id=er.actor_id AND a.engine_epoch=$3 AND a.input_receipt_id=er.input_receipt_id AND a.status='committed' AND a.event_id=er.source_event_id
    LEFT JOIN parallel_life.world_events e ON e.world_id=er.world_id AND e.owner_id=er.owner_id AND e.id=er.source_event_id AND e.version=er.world_version
    LEFT JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    LEFT JOIN parallel_life.actor_agent_states s ON s.world_id=q.world_id AND s.owner_id=q.owner_id AND s.actor_id=q.actor_id
    WHERE ep.world_id=$1 AND ep.owner_id=$2 AND ep.document->>'status'='proposed'
    GROUP BY ep.id,ep.document
    HAVING count(DISTINCT q.actor_id)=jsonb_array_length(ep.document->'participantActorIds')
      AND bool_and(ep.document->'participantActorIds' ? q.actor_id)
      AND bool_and(COALESCE(q.status='consumed' AND er.choice='quiet' AND er.presented_message_ids='[]'::jsonb
        AND er.world_version<=$4 AND a.id IS NOT NULL AND e.id IS NOT NULL AND c.id IS NOT NULL
        AND e.payload#>>'{data,agentRuntime,episodeDecision,requestId}'=q.id
        AND e.payload#>>'{data,agentRuntime,episodeDecision,choice}'='quiet',false))
    ORDER BY ep.id`,
      [frame.worldId, owner, frame.engineEpoch, frame.worldVersion],
    )
  ).rows;
  type Proof = {
    id: string;
    version: number;
    requestId: string;
    inputReceiptId: string | null;
    state: ScopedState | null;
    pending: boolean;
  };
  return rows.flatMap((r) => {
    const proofs = r.receipts as Proof[];
    if (
      proofs.some(
        (proof) =>
          proof.pending ||
          hasHandoffFollowup(proof.state, {
            episodeId: String(r.id),
            requestId: proof.requestId,
            inputReceiptId: proof.inputReceiptId,
          }),
      )
    )
      return [];
    return [
      { episodeId: String(r.id), receipts: proofs.map(({ id, version }) => ({ id, version })) },
    ];
  });
}
