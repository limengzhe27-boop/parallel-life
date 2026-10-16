import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt } from '../domain/agent-runtime.ts';
import type { WorldState } from '../domain/types.ts';
import type { LocationReportAudience } from '../domain/project-location-report-knowledge.ts';
import { canReadGroupMessage } from '../domain/experience-rules.ts';
import { scenePresent, scenePrivateThought } from '../domain/scene-runtime.ts';
import { loadGroupRead } from './group-repository.ts';
import { loadScene } from './scene-repository.ts';

/**
 * Authenticates historical hearers of this exact committed player input.
 * Current membership, current location, scene status and contact rosters cannot
 * grant knowledge or revoke what a person already legitimately heard.
 */
export async function readLocationReportAudience(
  sql: SqlClient,
  ownerId: string,
  world: WorldState,
  input: AgentInputReceipt,
  responderActorId: string,
): Promise<LocationReportAudience | undefined> {
  const fail = (): never => {
    throw Error('LOCATION_REPORT_AUDIENCE_FORBIDDEN');
  };
  if (
    world.ownerId !== ownerId ||
    input.worldId !== world.id ||
    input.expectedWorldVersion > world.version ||
    input.origin !== 'player' ||
    !world.actors.some((actor) => actor.id === responderActorId) ||
    (input.recipientActorId !== null && input.recipientActorId !== responderActorId)
  )
    fail();
  const stored = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
      [world.id, ownerId, input.id],
    )
  ).rows[0]?.document;
  if (!isDeepStrictEqual(stored, input)) fail();
  if (input.channel === 'private') return undefined;
  const row = (
    await sql.query(
      `SELECT e.id,e.version,e.payload FROM parallel_life.world_events e
       JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id
        AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
       WHERE e.world_id=$1 AND e.owner_id=$2 AND e.command_id=$3 AND e.version=$4`,
      [world.id, ownerId, input.commandId, input.expectedWorldVersion],
    )
  ).rows[0];
  if (
    !row ||
    row.payload.id !== row.id ||
    row.payload.version !== row.version ||
    row.payload.worldId !== world.id ||
    row.payload.storyAt !== input.storyAt
  )
    fail();
  let actorIds: string[];
  if (input.channel === 'group') {
    if (
      row.payload.type !== 'group.message_sent' ||
      row.payload.data?.groupId !== input.threadId ||
      row.payload.data?.text !== input.text
    )
      fail();
    const read = await loadGroupRead(sql, world.id, input.threadId, input.receivedAt);
    if (read.world.ownerId !== ownerId || read.group.ownerId !== ownerId) fail();
    const original = read.messages.filter(
      (message) =>
        message.sourceEventId === row.id &&
        message.sourceVersion === input.expectedWorldVersion &&
        message.sender.kind === 'player' &&
        message.text === input.text,
    );
    if (original.length !== 1) fail();
    actorIds = world.actors
      .filter((actor) =>
        canReadGroupMessage(read.context, read.group, original[0]!, {
          kind: 'actor',
          actorId: actor.id,
        }),
      )
      .map((actor) => actor.id);
  } else if (input.channel === 'scene') {
    if (
      row.payload.type !== 'scene.input_recorded' ||
      row.payload.data?.sceneId !== input.threadId ||
      row.payload.data?.privateThought ||
      scenePrivateThought(input.text)
    )
      fail();
    const read = await loadScene(sql, world.id, input.threadId);
    if (read.scene.ownerId !== ownerId) fail();
    const action = read.actions.find(
      (item) => item.sourceEventId === row.id && item.text === input.text,
    );
    const entries = read.entries.filter(
      (entry) =>
        entry.kind === 'user_action' &&
        entry.actionId === action?.id &&
        entry.sourceEventId === row.id &&
        entry.sourceVersion === input.expectedWorldVersion &&
        entry.text === input.text,
    );
    if (!action || entries.length !== 1) fail();
    const present = scenePresent(read.scene, input.expectedWorldVersion);
    if (!present.some((participant) => participant.kind === 'player')) fail();
    actorIds = world.actors
      .filter(
        (actor) =>
          present.some((p) => p.kind === 'actor' && p.actorId === actor.id) &&
          entries[0]!.observableTo.some((p) => p.kind === 'actor' && p.actorId === actor.id),
      )
      .map((actor) => actor.id);
  } else return fail();
  if (!actorIds.includes(responderActorId)) fail();
  return {
    channel: input.channel,
    threadId: input.threadId,
    inputReceiptId: input.id,
    sourceEventId: String(row.id),
    sourceWorldVersion: input.expectedWorldVersion,
    actorIds,
  };
}
