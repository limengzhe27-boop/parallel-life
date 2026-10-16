import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { readActorSceneObservationSourcesInTransaction } from './actor-scene-observation-sources.ts';

/** Rebuild the actual same-scene producer proof, before payment and before effects. */
export async function validateSceneObservationContext(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
) {
  const context = snapshot.sceneObservationContext;
  if (!context) return; // Old protected paid snapshots keep their accepted protocol.
  const fail = () => {
    throw Object.assign(Error('SCENE_OBSERVATION_SOURCE_CONFLICT'), {
      code: 'SCENE_OBSERVATION_SOURCE_CONFLICT',
    });
  };
  if (snapshot.channel.kind !== 'scene' || snapshot.channel.threadId !== context.sceneId) fail();
  let packet;
  try {
    packet = await readActorSceneObservationSourcesInTransaction(sql, owner, {
      worldId: snapshot.state.worldId,
      actorId: snapshot.state.actorId,
      sceneId: context.sceneId,
      worldVersion: snapshot.worldVersion,
      storyAt: snapshot.storyAt,
    });
  } catch (error) {
    if (String((error as { code?: string }).code ?? '').startsWith('ACTOR_SCENE_OBSERVATION_'))
      fail();
    throw error;
  }
  if (
    context.status !== packet.status ||
    context.omittedSourceIds.some((id) => !packet.omittedSourceIds.includes(id))
  )
    fail();
  const sources = snapshot.sources.filter(
    (s) => s.kind === 'scene_entry' && s.usage === 'channel_context',
  );
  if (
    !isDeepStrictEqual(
      sources.map((s) => s.id),
      context.selectedSourceIds,
    )
  )
    fail();
  for (const source of sources) {
    const actual = packet.sources.find((s) => s.id === source.id);
    if (!actual || !isDeepStrictEqual(source, { ...actual, usage: 'channel_context' })) fail();
    const observations = snapshot.observations.filter((o) => o.sourceId === source.id);
    const actualObservation = packet.observations.find((o) => o.sourceId === source.id);
    if (observations.length !== 1 || !isDeepStrictEqual(observations[0], actualObservation)) fail();
  }
}
