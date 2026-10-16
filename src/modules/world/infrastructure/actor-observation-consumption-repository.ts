import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ConsumedSceneObservationSource } from '../domain/actor-observation-candidate.ts';

const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const key = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(value);
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function fail(code = 'SCENE_OBSERVATION_CONSUMPTION_PROOF_INVALID'): never {
  throw Object.assign(Error(code), { code });
}

/**
 * A source was consumed only if the original paid completion declares it actually supplied and
 * that same actor/input/epoch committed a successful world event. Stored snapshots, actor cursor
 * advances, selected-source lists, and reserved/unknown attempts are never acknowledgements.
 * No writes, fallback fake ACK, new queue, model invocation or cross-channel disclosure grant.
 */
export async function readConsumedSceneObservationSourcesInTransaction(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; actorId: string; engineEpoch: number; worldVersion: number },
): Promise<ConsumedSceneObservationSource[]> {
  if (
    !key(owner) ||
    !key(frame.worldId) ||
    !key(frame.actorId) ||
    !Number.isSafeInteger(frame.engineEpoch) ||
    frame.engineEpoch < 2 ||
    !Number.isSafeInteger(frame.worldVersion) ||
    frame.worldVersion < 0
  )
    fail('SCENE_OBSERVATION_CONSUMPTION_INVALID_FRAME');
  const world = (
    await sql.query(
      `SELECT w.version,w.state,c.engine_epoch FROM parallel_life.worlds w
     JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
     WHERE w.id=$1 AND w.owner_id=$2`,
      [frame.worldId, owner],
    )
  ).rows[0];
  if (
    !world ||
    world.version !== frame.worldVersion ||
    world.engine_epoch !== frame.engineEpoch ||
    world.state.id !== frame.worldId ||
    world.state.ownerId !== owner ||
    !world.state.actors.some((actor: { id: string }) => actor.id === frame.actorId)
  )
    fail('SCENE_OBSERVATION_CONSUMPTION_SCOPE_CONFLICT');
  const rows = (
    await sql.query(
      `SELECT a.*,e.version AS committed_version,e.payload AS committed_event,
       i.document AS accepted_input
     FROM parallel_life.agent_attempts a
     JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id
       AND e.id=a.event_id AND e.command_id=a.command_id AND e.version=a.expected_world_version+1
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id
       AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
       AND c.expected_version=a.expected_world_version
     JOIN parallel_life.agent_input_receipts i ON i.world_id=a.world_id AND i.owner_id=a.owner_id
       AND i.id=a.input_receipt_id AND i.input_hash=a.input_hash
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3 AND a.engine_epoch=$4
       AND a.status='committed' AND a.sent_at IS NOT NULL AND a.response_hash IS NOT NULL
       AND e.version<=$5 ORDER BY e.version,a.id`,
      [frame.worldId, owner, frame.actorId, frame.engineEpoch, frame.worldVersion],
    )
  ).rows;
  const consumed = new Map<string, ConsumedSceneObservationSource>();
  for (const row of rows) {
    const completion = row.response;
    // Old protected completions remain replayable, but cannot prove actual supplied context.
    if (!object(completion) || completion.suppliedContext === undefined) continue;
    const supplied = completion.suppliedContext;
    const snapshot = completion.snapshot;
    const event = row.committed_event;
    const runtime = event?.data?.agentRuntime;
    const input = row.accepted_input;
    if (
      completion.kind !== 'npc_agent_completion' ||
      completion.schemaVersion !== 1 ||
      !object(supplied) ||
      supplied.schemaVersion !== 1 ||
      typeof supplied.promptVersion !== 'string' ||
      !supplied.promptVersion.trim() ||
      supplied.promptVersion.length > 200 ||
      !digest(supplied.modelInputHash) ||
      !digest(row.response_hash) ||
      !Array.isArray(supplied.observations) ||
      supplied.observations.length > 1000 ||
      !object(snapshot) ||
      snapshot.worldVersion !== row.expected_world_version ||
      snapshot.state?.worldId !== frame.worldId ||
      snapshot.state?.actorId !== frame.actorId ||
      snapshot.state?.revision !== row.expected_actor_revision ||
      !object(input) ||
      input.worldId !== frame.worldId ||
      input.id !== row.input_receipt_id ||
      input.inputHash !== row.input_hash ||
      (input.recipientActorId !== null && input.recipientActorId !== frame.actorId) ||
      snapshot.input?.sourceId !== input.id ||
      snapshot.input?.text !== input.text ||
      snapshot.input?.origin !== input.origin ||
      snapshot.channel?.kind !== input.channel ||
      snapshot.channel?.threadId !== input.threadId ||
      event?.worldId !== frame.worldId ||
      event?.id !== row.event_id ||
      event?.commandId !== row.command_id ||
      event?.version !== row.committed_version ||
      event?.data?.actorId !== frame.actorId ||
      runtime?.engineEpoch !== frame.engineEpoch ||
      runtime?.inputReceiptId !== input.id ||
      runtime?.inputWorldVersion !== input.expectedWorldVersion ||
      runtime?.inputStoryAt !== input.storyAt ||
      runtime?.actorRevisionBefore !== row.expected_actor_revision ||
      runtime?.actorRevisionAfter !== row.expected_actor_revision + 1 ||
      runtime?.stateAfter?.worldId !== frame.worldId ||
      runtime?.stateAfter?.actorId !== frame.actorId ||
      runtime?.stateAfter?.revision !== runtime.actorRevisionAfter ||
      runtime?.stateAfter?.projectedWorldVersion !== row.committed_version
    )
      fail();
    if (!supplied.observations.length) continue;
    const context =
      input.channel === 'scene'
        ? snapshot.sceneObservationContext
        : input.channel === 'group'
          ? snapshot.groupObservationContext
          : snapshot.actorObservationInbox;
    if (
      !object(context) ||
      !Array.isArray(context.omittedSourceIds) ||
      !Array.isArray(snapshot.sources) ||
      !Array.isArray(snapshot.observations) ||
      !(
        (input.channel === 'scene' &&
          input.threadId === context.sceneId &&
          key(context.sceneId) &&
          ['complete', 'budget_limited'].includes(context.status) &&
          Array.isArray(context.selectedSourceIds)) ||
        (input.channel === 'group' &&
          input.threadId === context.groupId &&
          key(context.groupId) &&
          context.engineEpoch === frame.engineEpoch &&
          ['complete', 'budget_limited'].includes(context.status) &&
          Array.isArray(context.requestedSourceIds) &&
          Array.isArray(context.selectedSourceIds)) ||
        (input.channel === 'private' &&
          input.threadId === frame.actorId &&
          Array.isArray(context.sourceIds) &&
          Array.isArray(context.sceneIds) &&
          context.sceneIds.every(key) &&
          (context.sceneIds.length > 0 ||
            (Array.isArray(context.groupIds) &&
              context.groupIds.length > 0 &&
              context.groupIds.every(key))))
      )
    )
      fail();
    const selectedSourceIds =
      input.channel === 'private' ? context.sourceIds : context.selectedSourceIds;
    const seen = new Set<string>();
    for (const ref of supplied.observations) {
      if (!object(ref) || !key(ref.sourceId) || !digest(ref.contentHash) || seen.has(ref.sourceId))
        fail();
      seen.add(ref.sourceId);
      const sources = snapshot.sources.filter(
        (source: unknown) => object(source) && source.id === ref.sourceId,
      );
      const observations = snapshot.observations.filter(
        (observation: unknown) => object(observation) && observation.sourceId === ref.sourceId,
      );
      if (
        sources.length !== 1 ||
        observations.length !== 1 ||
        !['scene_entry', 'group_message'].includes(sources[0].kind) ||
        (sources[0].kind === 'group_message' &&
          !(
            (input.channel === 'private' &&
              Array.isArray(context.groupIds) &&
              context.groupIds.length) ||
            (input.channel === 'group' &&
              key(context.groupId) &&
              sources[0].usage === 'channel_context')
          )) ||
        sources[0].id !==
          (sources[0].kind === 'scene_entry' ? 'scene:' : 'group:') + sources[0].recordId ||
        sources[0].contentHash !== ref.contentHash ||
        !Number.isSafeInteger(sources[0].worldVersion) ||
        sources[0].worldVersion < 0 ||
        sources[0].worldVersion > snapshot.worldVersion ||
        !selectedSourceIds.includes(ref.sourceId) ||
        context.omittedSourceIds.includes(ref.sourceId) ||
        typeof observations[0].text !== 'string' ||
        !observations[0].text.trim() ||
        !['scene_record', 'adjudicated_result', 'player_report', 'actor_report'].includes(
          observations[0].evidenceKind,
        )
      )
        fail();
      const value = { sourceId: ref.sourceId, contentHash: ref.contentHash };
      consumed.set(JSON.stringify([value.sourceId, value.contentHash]), value);
    }
  }
  return [...consumed.values()].sort(
    (a, b) => a.sourceId.localeCompare(b.sourceId) || a.contentHash.localeCompare(b.contentHash),
  );
}
