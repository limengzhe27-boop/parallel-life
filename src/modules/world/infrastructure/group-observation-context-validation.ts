import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { readActorGroupObservationSourcesInTransaction } from './actor-group-observation-sources.ts';

/** The same original group producer proof is checked before payment and before committing effects. */
export async function validateGroupObservationContext(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
) {
  const context = snapshot.groupObservationContext;
  if (!context) return; // Do not rewrite protected pre-upgrade paid inputs.
  const fail = (): never => {
    throw Object.assign(Error('GROUP_OBSERVATION_SOURCE_CONFLICT'), {
      code: 'GROUP_OBSERVATION_SOURCE_CONFLICT',
    });
  };
  if (snapshot.channel.kind !== 'group' || snapshot.channel.threadId !== context.groupId) fail();
  let packet;
  try {
    packet = await readActorGroupObservationSourcesInTransaction(sql, owner, {
      worldId: snapshot.state.worldId,
      actorId: snapshot.state.actorId,
      groupId: context.groupId,
      engineEpoch: context.engineEpoch,
      worldVersion: snapshot.worldVersion,
      storyAt: snapshot.storyAt,
      sourceIds: context.requestedSourceIds,
    });
  } catch (error) {
    if (String((error as { code?: string }).code ?? '').startsWith('ACTOR_GROUP_OBSERVATION_'))
      fail();
    throw error;
  }
  const sources = snapshot.sources.filter(
    (s) => s.kind === 'group_message' && s.usage === 'channel_context',
  );
  if (
    context.status !== packet.status ||
    context.omittedSourceIds.some((id) => !packet.omittedSourceIds.includes(id)) ||
    !isDeepStrictEqual(
      sources.map((s) => s.id),
      context.selectedSourceIds,
    )
  )
    fail();
  for (const source of sources) {
    const actual = packet.sources.find((s) => s.id === source.id);
    const observations = snapshot.observations.filter((o) => o.sourceId === source.id);
    const actualObservation = packet.observations.find((o) => o.sourceId === source.id);
    if (
      !actual ||
      !isDeepStrictEqual(source, { ...actual, usage: 'channel_context' }) ||
      observations.length !== 1 ||
      !isDeepStrictEqual(observations[0], actualObservation)
    )
      fail();
  }
}
