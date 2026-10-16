import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { ActorEpisodeResultContext } from '../domain/episode-result-context.ts';
import type { EpisodeEvidenceRecord } from '../domain/episode-evidence.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';

/** Only this actor's committed causal milestones. No global episode prose or other NPC decisions. */
export async function readActorEpisodeResults(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
): Promise<ActorEpisodeResultContext[]> {
  if (snapshot.channel.kind !== 'private') return [];
  const episodes = [...new Set((snapshot.episodeFollowUps ?? []).map((p) => p.episodeId))];
  if (!episodes.length) return [];
  const blocked = await forgottenAgentSourceIds(
    sql,
    owner,
    snapshot.state.worldId,
    snapshot.state.actorId,
  );
  const rows = (
    await sql.query(
      `SELECT v.id,v.episode_id,v.actor_id,v.engine_epoch,v.source_event_id,v.world_version,v.kind,v.subject_kind,v.subject_id,v.action_id,v.document,e.payload
 FROM parallel_life.agent_episode_evidence v
 JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=v.world_id AND rw.owner_id=v.owner_id AND rw.engine_epoch=v.engine_epoch
 JOIN parallel_life.world_events e ON e.world_id=v.world_id AND e.owner_id=v.owner_id AND e.id=v.source_event_id AND e.version=v.world_version
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
 WHERE v.world_id=$1 AND v.owner_id=$2 AND v.actor_id=$3 AND v.episode_id=ANY($4::text[]) AND v.world_version<=$5
 AND NOT (v.source_event_id=ANY($6::text[]) OR v.id=ANY($6::text[]) OR ('episode-result:'||v.id)=ANY($6::text[]) OR (v.document->>'sourceId')=ANY($6::text[]) OR ('action-result:'||(v.document->>'sourceId'))=ANY($6::text[]))
 ORDER BY v.world_version DESC,v.id DESC LIMIT 12`,
      [
        snapshot.state.worldId,
        owner,
        snapshot.state.actorId,
        episodes,
        snapshot.worldVersion,
        [...blocked],
      ],
    )
  ).rows;
  const out: ActorEpisodeResultContext[] = [];
  for (const row of rows) {
    const r = row.document as EpisodeEvidenceRecord;
    if (
      blocked.has(row.source_event_id) ||
      blocked.has(row.id) ||
      blocked.has('episode-result:' + row.id) ||
      blocked.has(r?.sourceId) ||
      blocked.has('action-result:' + r?.sourceId)
    )
      continue;
    if (
      !r ||
      r.worldId !== snapshot.state.worldId ||
      r.actorId !== snapshot.state.actorId ||
      r.episodeId !== row.episode_id ||
      r.engineEpoch !== row.engine_epoch ||
      r.eventId !== row.source_event_id ||
      r.worldVersion !== row.world_version ||
      r.kind !== row.kind ||
      r.subject?.kind !== row.subject_kind ||
      r.subject.id !== row.subject_id ||
      r.actionId !== row.action_id ||
      !Number.isFinite(Date.parse(r.at)) ||
      Date.parse(r.at) > Date.parse(snapshot.storyAt)
    )
      throw Object.assign(Error('EPISODE_RESULT_SOURCE_CONFLICT'), {
        code: 'EPISODE_RESULT_SOURCE_CONFLICT',
      });
    // SQL83 accepts only the original kernel/command projection. Read its immutable event again;
    // never accept a model or caller's certifiedReceipt object as evidence.
    if (r.kind === 'invitation_accepted' || r.kind === 'invitation_declined') {
      const e = row.payload;
      if (
        e.type !== 'invitation.responded' ||
        e.data?.id !== r.subject.id ||
        e.data?.operation !== (r.kind === 'invitation_accepted' ? 'accept' : 'cancel') ||
        e.commandId !== r.commandId
      )
        throw Object.assign(Error('EPISODE_RESULT_SOURCE_CONFLICT'), {
          code: 'EPISODE_RESULT_SOURCE_CONFLICT',
        });
    }
    out.push({
      evidenceId: row.id,
      episodeId: r.episodeId,
      actorId: r.actorId,
      kind: r.kind,
      subject: r.subject,
      sourceEventId: r.eventId,
      worldVersion: r.worldVersion,
      occurredAt: r.at,
      overallOutcome: 'not_certified',
    });
  }
  return out.reverse();
}
export async function validateActorEpisodeResults(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
) {
  if (snapshot.episodeResults === undefined) return; // Protected pre-upgrade paid snapshots retain their original input.
  if (
    !isDeepStrictEqual(snapshot.episodeResults, await readActorEpisodeResults(sql, owner, snapshot))
  )
    throw Object.assign(Error('EPISODE_RESULT_SOURCE_CONFLICT'), {
      code: 'EPISODE_RESULT_SOURCE_CONFLICT',
    });
}
