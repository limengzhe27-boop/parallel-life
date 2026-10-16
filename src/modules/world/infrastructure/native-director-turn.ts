import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { DirectorSnapshot } from '../domain/director-runtime.ts';
import type { WorldState } from '../domain/types.ts';
import { readLocationReportAudience } from './location-report-audience.ts';

/** Authenticate the original task/input and actual hearers before Director payment and commit. */
export async function validateNativeDirectorTurn(
  sql: SqlClient,
  owner: string,
  world: WorldState,
  turn: NonNullable<DirectorSnapshot['nativeTurn']>,
  candidates: DirectorSnapshot['candidates'],
) {
  const fail = (): never => {
    throw Object.assign(Error('DIRECTOR_NATIVE_TURN_CONFLICT'), {
      code: 'DIRECTOR_NATIVE_TURN_CONFLICT',
    });
  };
  const task = (
    await sql.query(
      `SELECT input FROM parallel_life.tasks WHERE id=$1 AND owner_id=$2
    AND scope_kind='world' AND scope_id=$3 AND status='running' AND lease_until>clock_timestamp()`,
      [turn.taskId, owner, world.id],
    )
  ).rows[0];
  const input = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
      [world.id, owner, turn.inputReceiptId],
    )
  ).rows[0]?.document;
  if (
    !task ||
    !input ||
    input.channel !== turn.channel ||
    input.threadId !== turn.threadId ||
    input.origin !== 'player' ||
    input.recipientActorId !== null ||
    task.input.expectedVersion !== input.expectedWorldVersion ||
    (turn.channel === 'group'
      ? task.input.channel !== 'group' || task.input.groupId !== turn.threadId
      : task.input.type !== 'scene' || task.input.sceneId !== turn.threadId) ||
    !candidates.length ||
    new Set(candidates.map((c) => c.actorId)).size !== candidates.length
  )
    return fail();
  for (const c of candidates) {
    if (
      c.source !== 'conversation' ||
      c.channel !== turn.channel ||
      c.threadId !== turn.threadId ||
      c.sourceIds.length !== 1 ||
      c.sourceIds[0] !== input.id
    )
      return fail();
    const audience = await readLocationReportAudience(sql, owner, world, input, c.actorId);
    if (!audience?.actorIds.includes(c.actorId)) return fail();
    const source = (
      await sql.query(
        'SELECT id FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND command_id=$3 AND version=$4',
        [world.id, owner, input.commandId, input.expectedWorldVersion],
      )
    ).rows[0];
    if (!source || (turn.channel === 'group' && task.input.inputEventId !== source.id))
      return fail();
  }
}
