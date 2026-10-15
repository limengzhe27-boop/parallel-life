import { randomUUID, createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { acceptAgentInputInTransaction } from './agent-runtime-repository.ts';
import { DomainError } from '../domain/errors.ts';
/** A native player input is accepted with its actual channel event, before any NPC is selected. */
export async function acceptNativeAgentInput(
  sql: SqlClient,
  ownerId: string,
  input: {
    worldId: string;
    commandId: string;
    channel: 'group' | 'scene';
    threadId: string;
    sourceEventId: string;
    sourceVersion: number;
    text: string;
    storyAt: string;
    receivedAt: string;
  },
) {
  const control = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (Number(control?.engine_epoch ?? 1) < 2) return;
  const actual = (
    await sql.query(
      `SELECT e.payload,e.version FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
 WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3 AND e.command_id=$4`,
      [input.worldId, ownerId, input.sourceEventId, input.commandId],
    )
  ).rows[0];
  const payload = actual?.payload;
  if (
    !payload ||
    actual.version !== input.sourceVersion ||
    payload.storyAt !== input.storyAt ||
    (input.channel === 'group'
      ? payload.type !== 'group.message_sent' ||
        payload.data.groupId !== input.threadId ||
        payload.data.text !== input.text
      : payload.type !== 'scene.input_recorded' ||
        payload.data.sceneId !== input.threadId ||
        payload.playerInput?.text !== input.text ||
        payload.data.privateThought)
  )
    throw new DomainError('INVALID_COMMAND');
  const inputHash = createHash('sha256')
    .update(
      JSON.stringify([
        'native',
        input.worldId,
        input.commandId,
        input.channel,
        input.threadId,
        input.sourceEventId,
        input.sourceVersion,
        input.text,
      ]),
    )
    .digest('hex');
  return acceptAgentInputInTransaction(sql, ownerId, {
    id: randomUUID(),
    worldId: input.worldId,
    commandId: input.commandId,
    inputHash,
    channel: input.channel,
    threadId: input.threadId,
    recipientActorId: null,
    expectedWorldVersion: input.sourceVersion,
    text: input.text,
    storyAt: input.storyAt,
    receivedAt: input.receivedAt,
    origin: 'player',
  });
}
