import { readActorNarrativeObservationSourcesInTransaction } from './actor-narrative-observation-sources.ts';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { readActorSceneObservationSourcesInTransaction } from './actor-scene-observation-sources.ts';
import { readActorGroupObservationSourcesInTransaction } from './actor-group-observation-sources.ts';
import { readConsumedSceneObservationSourcesInTransaction } from './actor-observation-consumption-repository.ts';

/** Durable original scene records are the inbox. No second fact store or implicit map knowledge. */
export async function readActorObservationInbox(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
  options: { includeGroups?: boolean; includeNarrative?: boolean } = {},
) {
  const sources: AgentSnapshot['sources'] = [],
    observations: AgentSnapshot['observations'] = [],
    omittedSourceIds: string[] = [],
    sceneIds: string[] = [];
  if (snapshot.channel.kind !== 'private') return { sources, observations, context: undefined };
  const rw = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
      [snapshot.state.worldId, owner],
    )
  ).rows[0];
  if (!rw || rw.engine_epoch < 2) return { sources, observations, context: undefined };
  const consumed = await readConsumedSceneObservationSourcesInTransaction(sql, owner, {
    worldId: snapshot.state.worldId,
    actorId: snapshot.state.actorId,
    engineEpoch: rw.engine_epoch,
    worldVersion: snapshot.worldVersion,
  });
  const done = new Set(consumed.map((c) => c.sourceId + ':' + c.contentHash));
  const rows = (
    await sql.query(
      `SELECT id FROM parallel_life.scene_sessions WHERE world_id=$1 AND owner_id=$2
    AND document->'presence' @> jsonb_build_array(jsonb_build_object('participant',jsonb_build_object('kind','actor','actorId',$3::text)))
    ORDER BY (document->>'sourceVersion')::integer DESC,id`,
      [snapshot.state.worldId, owner, snapshot.state.actorId],
    )
  ).rows;
  const packets: {
    source: AgentSnapshot['sources'][number];
    observation: AgentSnapshot['observations'][number];
  }[] = [];
  const groupIds: string[] = [];
  let bytes = 0;
  for (const scene of rows) {
    const packet = await readActorSceneObservationSourcesInTransaction(sql, owner, {
      worldId: snapshot.state.worldId,
      actorId: snapshot.state.actorId,
      sceneId: scene.id,
      worldVersion: snapshot.worldVersion,
      storyAt: snapshot.storyAt,
      maxBytes: 16000,
      maxEntries: 80,
      consumedSources: consumed,
    });
    sceneIds.push(scene.id);
    for (const source of [...packet.sources].reverse()) {
      if (done.has(source.id + ':' + source.contentHash)) continue;
      const observation = packet.observations.find((o) => o.sourceId === source.id)!;
      if (options.includeGroups === false) {
        const size = Buffer.byteLength(JSON.stringify({ source, observation }));
        if (sources.length >= 12 || bytes + size > 16000) {
          omittedSourceIds.push(source.id);
          continue;
        }
        sources.push({ ...source, usage: 'private_strategy' });
        observations.push(observation);
        bytes += size;
      } else packets.push({ source, observation });
    }
    omittedSourceIds.push(...packet.omittedSourceIds);
    if (options.includeGroups === false && sources.length >= 12) break;
  }
  // Historical membership is only a lookup hint; the adapter authenticates its producer.
  const groups =
    options.includeGroups === false
      ? []
      : (
          await sql.query(
            `SELECT DISTINCT group_id FROM parallel_life.world_group_memberships
     WHERE world_id=$1 AND owner_id=$2 AND participant->>'kind'='actor'
     AND participant->>'actorId'=$3 ORDER BY group_id`,
            [snapshot.state.worldId, owner, snapshot.state.actorId],
          )
        ).rows;
  for (const group of groups) {
    const packet = await readActorGroupObservationSourcesInTransaction(sql, owner, {
      worldId: snapshot.state.worldId,
      actorId: snapshot.state.actorId,
      engineEpoch: rw.engine_epoch,
      worldVersion: snapshot.worldVersion,
      storyAt: snapshot.storyAt,
      groupId: group.group_id,
      consumedSources: consumed,
      maxBytes: 16000,
      maxEntries: 80,
    });
    groupIds.push(...packet.groupIds);
    for (const source of packet.sources) {
      if (done.has(source.id + ':' + source.contentHash)) continue;
      const observation = packet.observations.find((o) => o.sourceId === source.id);
      if (!observation) throw Error('ACTOR_GROUP_OBSERVATION_PACKET_INVALID');
      packets.push({ source, observation });
    }
    omittedSourceIds.push(...packet.omittedSourceIds);
  }
  const narrativeKnowledgeIds: string[] = [];
  if (options.includeNarrative !== false) {
    const packet = await readActorNarrativeObservationSourcesInTransaction(sql, owner, {
      worldId: snapshot.state.worldId,
      actorId: snapshot.state.actorId,
      worldVersion: snapshot.worldVersion,
      storyAt: snapshot.storyAt,
    });
    for (const source of packet.sources) {
      if (done.has(source.id + ':' + source.contentHash)) continue;
      narrativeKnowledgeIds.push(source.recordId);
      packets.push({
        source,
        observation: packet.observations.find((o) => o.sourceId === source.id)!,
      });
    }
  }
  // A busy newer channel must not starve older unhandled knowledge from another channel.
  if (options.includeGroups !== false)
    packets.sort(
      (a, b) =>
        a.source.worldVersion - b.source.worldVersion || a.source.id.localeCompare(b.source.id),
    );
  for (const { source, observation } of packets) {
    if (sources.some((s) => s.id === source.id)) continue;
    const size = Buffer.byteLength(JSON.stringify({ source, observation }));
    if (sources.length >= 12 || bytes + size > 16000) {
      omittedSourceIds.push(source.id);
      continue;
    }
    sources.push({ ...source, usage: 'private_strategy' });
    observations.push(observation);
    bytes += size;
  }
  return {
    sources,
    observations,
    context: {
      sourceIds: sources.map((s) => s.id),
      sceneIds,
      ...(options.includeNarrative !== false ? { narrativeKnowledgeIds } : {}),
      ...(options.includeGroups !== false ? { groupIds: [...new Set(groupIds)] } : {}),
      omittedSourceIds: [...new Set(omittedSourceIds)].slice(0, 80),
    },
  };
}
export async function validateActorObservationInbox(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
) {
  if (snapshot.actorObservationInbox === undefined) return;
  let actual;
  try {
    actual = await readActorObservationInbox(sql, owner, snapshot, {
      includeGroups: snapshot.actorObservationInbox.groupIds !== undefined,
      includeNarrative: snapshot.actorObservationInbox.narrativeKnowledgeIds !== undefined,
    });
  } catch (error) {
    const code = String((error as { code?: string }).code ?? '');
    if (
      code.startsWith('ACTOR_SCENE_OBSERVATION_') ||
      code.startsWith('ACTOR_GROUP_OBSERVATION_') ||
      code.startsWith('ACTOR_NARRATIVE_OBSERVATION_') ||
      code.startsWith('SCENE_OBSERVATION_CONSUMPTION_')
    )
      throw Object.assign(Error('ACTOR_OBSERVATION_INBOX_CONFLICT'), {
        code: 'ACTOR_OBSERVATION_INBOX_CONFLICT',
      });
    throw error;
  }
  const actualSources = snapshot.sources.filter((s) =>
    snapshot.actorObservationInbox!.sourceIds.includes(s.id),
  );
  const actualObservations = snapshot.observations.filter((o) =>
    snapshot.actorObservationInbox!.sourceIds.includes(o.sourceId),
  );
  if (
    !isDeepStrictEqual(actual.context, snapshot.actorObservationInbox) ||
    !isDeepStrictEqual(actual.sources, actualSources) ||
    !isDeepStrictEqual(actual.observations, actualObservations)
  )
    throw Object.assign(Error('ACTOR_OBSERVATION_INBOX_CONFLICT'), {
      code: 'ACTOR_OBSERVATION_INBOX_CONFLICT',
    });
}
