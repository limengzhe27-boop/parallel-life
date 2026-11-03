import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState, AgentProposal } from '../domain/agent-runtime.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { bindNpcFollowUpQuestion } from './npc-model-protocol.ts';

/** Derive only a missing association proven by a complete, committed original
 * turn. No acceptance, completion, replay, model call or historical write. A
 * subsequent normal kernel commit may persist the association in current state.
 */
export async function readEpisodeQuestionLinksInTransaction(
  sql: SqlClient,
  ownerId: string,
  state: ActorAgentState,
): Promise<ActorAgentState> {
  const waitingRequests = state.responsibilities
    .filter(
      (r) => r.status === 'waiting' && r.waitingOn === 'player' && r.subject.kind === 'request',
    )
    .map((r) => r.subject.id);
  if (!waitingRequests.length) return state;
  const questions = (state.questions ?? []).filter(
    (q) =>
      q.status === 'open' &&
      !q.responsibilityId &&
      q.channel === 'private' &&
      q.threadId === state.actorId &&
      q.sourceId.startsWith('message:'),
  );
  const identities = questions.flatMap((q) => {
    const match = /^(.*)_question_(0|[1-9][0-9]*)$/.exec(q.id);
    return match ? [{ question: q, eventId: match[1]!, ordinal: Number(match[2]) }] : [];
  });
  if (!identities.length) return state;
  const rows = (
    await sql.query(
      `SELECT e.id,e.payload,a.response->'snapshot' snapshot,r.document receipt
     FROM parallel_life.world_events e
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id
       AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
       AND c.expected_version=e.version-1
     JOIN parallel_life.agent_attempts a ON a.world_id=e.world_id AND a.owner_id=e.owner_id
       AND a.event_id=e.id AND a.status='committed' AND a.command_id=e.command_id
       AND a.actor_id=$3 AND a.response->>'kind'='npc_agent_completion'
       AND a.response->>'schemaVersion'='1'
     JOIN parallel_life.agent_input_receipts r ON r.world_id=a.world_id AND r.owner_id=a.owner_id
       AND r.id=a.input_receipt_id AND r.input_hash=a.input_hash
     WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=ANY($4::text[])
       AND e.payload#>>'{data,agentRuntime,proposal,episodeDecision,requestId}'=ANY($6::text[])
       AND e.version<=$5 AND e.payload#>>'{data,actorId}'=$3
       AND e.payload#>>'{data,agentRuntime,inputReceiptId}'=r.id
       AND e.payload#>>'{data,agentRuntime,engineEpoch}'=a.engine_epoch::text
       AND e.payload#>>'{data,agentRuntime,actorRevisionBefore}'=a.expected_actor_revision::text
       AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_attempt_stream_segments sg
         WHERE sg.world_id=a.world_id AND sg.owner_id=a.owner_id AND sg.attempt_id=a.id
           AND sg.completion_status IN ('partial_interrupted','superseded'))`,
      [
        state.worldId,
        ownerId,
        state.actorId,
        [...new Set(identities.map((i) => i.eventId))],
        state.projectedWorldVersion,
        waitingRequests,
      ],
    )
  ).rows;
  const linked = new Map<string, string>();
  for (const row of rows) {
    const snapshot = row.snapshot as AgentSnapshot | undefined;
    const receipt = row.receipt;
    const transition = row.payload?.data?.agentRuntime;
    const proposal = transition?.proposal as AgentProposal | undefined;
    const after = transition?.stateAfter as ActorAgentState | undefined;
    if (
      !snapshot ||
      !proposal ||
      !after ||
      snapshot.state?.worldId !== state.worldId ||
      snapshot.state.actorId !== state.actorId ||
      after.worldId !== state.worldId ||
      after.actorId !== state.actorId ||
      snapshot.channel?.kind !== 'private' ||
      snapshot.channel.threadId !== state.actorId ||
      receipt.channel !== 'private' ||
      receipt.recipientActorId !== state.actorId ||
      receipt.threadId !== state.actorId ||
      snapshot.input?.sourceId !== receipt.id ||
      snapshot.input.text !== receipt.text ||
      snapshot.input.origin !== receipt.origin ||
      !Array.isArray(proposal.statements) ||
      !Array.isArray(proposal.responsibilities) ||
      !Array.isArray(snapshot.sources) ||
      !Array.isArray(after.questions) ||
      !Array.isArray(after.responsibilities)
    )
      continue;
    const sources = new Set(snapshot.sources.map((s) => s.id));
    if (
      proposal.episodeDecision?.sourceIds.some((id) => !sources.has(id)) ||
      proposal.responsibilities.some((r) => r.sourceIds.some((id) => !sources.has(id)))
    )
      continue;
    const bound = bindNpcFollowUpQuestion(snapshot, proposal);
    for (const { question, ordinal, eventId } of identities) {
      if (eventId !== row.id || !Number.isSafeInteger(ordinal)) continue;
      const original = after.questions.find((q) => q.id === question.id);
      const statement = bound.statements[ordinal];
      const responsibilityId = statement?.questionForResponsibilityId;
      if (
        !original ||
        original.responsibilityId ||
        !responsibilityId ||
        statement.requestsPlayerReply !== true ||
        statement.text !== question.text ||
        original.sourceId !== question.sourceId ||
        original.text !== question.text ||
        original.channel !== question.channel ||
        original.threadId !== question.threadId ||
        original.askedAt !== question.askedAt ||
        original.status !== 'open'
      )
        continue;
      const effect = row.payload?.data?.effects?.filter((e: any) => e.type === 'message.received')[
        ordinal
      ];
      if (!effect || `message:${effect.id}` !== question.sourceId) continue;
      const historical = after.responsibilities.find((r) => r.id === responsibilityId);
      const proposed = proposal.responsibilities.find((r) => r.id === responsibilityId);
      const current = state.responsibilities.find((r) => r.id === responsibilityId);
      if (
        !historical ||
        !proposed ||
        !current ||
        !isDeepStrictEqual(
          Object.fromEntries(Object.entries(historical).filter(([key]) => key !== 'revision')),
          Object.fromEntries(Object.entries(proposed).filter(([key]) => key !== 'revision')),
        ) ||
        current.status !== 'waiting' ||
        current.waitingOn !== 'player' ||
        !isDeepStrictEqual(current.subject, historical.subject) ||
        !historical.sourceIds.every((id) => current.sourceIds.includes(id))
      )
        continue;
      linked.set(question.id, responsibilityId);
    }
  }
  return linked.size
    ? {
        ...state,
        questions: state.questions!.map((q) =>
          linked.has(q.id) ? { ...q, responsibilityId: linked.get(q.id)! } : q,
        ),
      }
    : state;
}
