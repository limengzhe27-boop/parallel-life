import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';

/** Real player commands only. NPC/director decisions must use their own attempt/kernel boundary. */
export const PLAYER_WORLD_COMMAND_KINDS = [
  'note_save',
  'invitation_respond',
  'space_travel',
  'scene_enter',
  'scene_input',
  'group_input',
  'group_membership',
  'story_wait',
  'clock_control',
  'world_branch',
  'world_delete',
] as const;
export type PlayerWorldCommandKind = (typeof PLAYER_WORLD_COMMAND_KINDS)[number];

/**
 * The caller owns the transaction and all domain/source/command-specific validation.
 * This function only authorizes an actual player write against its current world/engine.
 * It opens no connection, writes no receipt/state, and grants no NPC attempt authority.
 */
export async function authorizeWorldCommandInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: {
    worldId: string;
    expectedWorldVersion: number;
    commandId: string;
    kind: PlayerWorldCommandKind;
  },
): Promise<{ engineEpoch: number; worldVersion: number }> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !['worldId', 'expectedWorldVersion', 'commandId', 'kind'].includes(key),
    ) ||
    !PLAYER_WORLD_COMMAND_KINDS.includes(input.kind) ||
    typeof ownerId !== 'string' ||
    !ownerId ||
    typeof input.worldId !== 'string' ||
    !/^[a-zA-Z0-9_:-]{1,160}$/.test(input.worldId) ||
    typeof input.commandId !== 'string' ||
    !/^[a-zA-Z0-9_:-]{1,160}$/.test(input.commandId) ||
    !Number.isSafeInteger(input.expectedWorldVersion) ||
    input.expectedWorldVersion < 0
  )
    throw new DomainError('INVALID_COMMAND');

  const auth = (
    await sql.query(
      `SELECT current_setting('app.user_id',true) AS owner_id,
       pg_has_role(current_user,'pl_app','MEMBER') AS app,
       pg_has_role(current_user,'pl_worker','MEMBER') AS worker,
       pg_current_xact_id()::text AS transaction_id,
       current_setting('app.agent_commit_attempt_id',true) AS agent_attempt_id`,
    )
  ).rows[0];
  // A worker cannot turn a task lease or a forged app.user_id into player authority.
  if (!auth || auth.worker || !auth.app || auth.owner_id !== ownerId)
    throw new DomainError('NOT_FOUND');
  if (auth.agent_attempt_id)
    throw new DomainError('INVALID_COMMAND', 'Cannot mix player authorization with an NPC commit');

  // Every authorization/switch/commit follows world -> control lock order.
  const world = (
    await sql.query(
      'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (!world) throw new DomainError('NOT_FOUND');
  if (world.version !== input.expectedWorldVersion) throw new DomainError('VERSION_CONFLICT');
  const control = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [input.worldId, ownerId],
    )
  ).rows[0];
  const engineEpoch = Number(control?.engine_epoch ?? 1);
  if (!Number.isSafeInteger(engineEpoch) || engineEpoch < 1)
    throw new DomainError('INVALID_COMMAND', 'Invalid world engine control');

  const local = (
    await sql.query(
      `SELECT pg_current_xact_id()::text AS transaction_id,
       set_config('app.agent_world_id',$1,true),
       set_config('app.agent_engine_epoch',$2,true)`,
      [input.worldId, String(engineEpoch)],
    )
  ).rows[0];
  // In autocommit each statement has another transaction; its local settings already expired.
  if (!local || local.transaction_id !== auth.transaction_id)
    throw new DomainError('INVALID_COMMAND', 'An explicit player command transaction is required');
  return { engineEpoch, worldVersion: world.version };
}
