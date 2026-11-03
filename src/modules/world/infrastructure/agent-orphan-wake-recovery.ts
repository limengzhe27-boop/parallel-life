import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt } from '../domain/agent-runtime.ts';
import { wakeCandidateIdFromInputText } from '../domain/agent-wake-recovery.ts';

/**
 * Reuse an accepted, never-claimed wake only after the scheduler has rediscovered
 * the same eligible candidate. This does not grant execution: claim still locks
 * the world, checks the current frame, and owns the unique command/actor slot.
 * Keeping the original command fences a delayed original runner and concurrent
 * recoveries without another recovery table, synthetic attempt, or paid retry.
 */
export async function readUnclaimedWakeInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: {
    worldId: string;
    actorId: string;
    commandId: string;
    candidateId: string;
    worldVersion: number;
    engineEpoch: number;
    visibleSourceIds: readonly string[];
    candidateSourceIds: readonly string[];
    candidateSource: string;
    actionId?: string | null;
  },
): Promise<AgentInputReceipt | null> {
  const frame = (
    await sql.query(
      `SELECT w.version,r.engine_epoch FROM parallel_life.worlds w
       JOIN parallel_life.agent_runtime_worlds r ON r.world_id=w.id AND r.owner_id=w.owner_id
       WHERE w.id=$1 AND w.owner_id=$2 FOR UPDATE OF w`,
      [input.worldId, ownerId],
    )
  ).rows[0];
  if (
    !frame ||
    frame.version !== input.worldVersion ||
    frame.engine_epoch !== input.engineEpoch ||
    input.engineEpoch < 2
  )
    throw Object.assign(Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' });
  const row = (
    await sql.query(
      `SELECT r.document, EXISTS(SELECT 1 FROM parallel_life.agent_attempts a
         WHERE a.world_id=r.world_id AND a.owner_id=r.owner_id
           AND (a.input_receipt_id=r.id OR a.command_id=r.command_id)) AS claimed
       FROM parallel_life.agent_input_receipts r
       WHERE r.world_id=$1 AND r.owner_id=$2 AND r.command_id=$3`,
      [input.worldId, ownerId, input.commandId],
    )
  ).rows[0];
  if (!row || row.claimed) return null;
  const receipt = row.document as AgentInputReceipt;
  const body = (() => {
    try {
      return JSON.parse(receipt.text);
    } catch {
      return null;
    }
  })();
  const visible = new Set(input.visibleSourceIds);
  if (
    receipt.worldId !== input.worldId ||
    receipt.commandId !== input.commandId ||
    receipt.origin !== 'wake' ||
    receipt.channel !== 'private' ||
    receipt.threadId !== input.actorId ||
    receipt.recipientActorId !== input.actorId ||
    !Number.isSafeInteger(receipt.expectedWorldVersion) ||
    receipt.expectedWorldVersion < 0 ||
    receipt.expectedWorldVersion > input.worldVersion ||
    wakeCandidateIdFromInputText(receipt.text) !== input.candidateId ||
    body?.source !== input.candidateSource ||
    body?.actionId !== input.actionId ||
    !Array.isArray(body?.basisSourceIds) ||
    JSON.stringify([...new Set(body.basisSourceIds)].sort()) !==
      JSON.stringify([...new Set(input.candidateSourceIds)].sort()) ||
    body.basisSourceIds.some((id: unknown) => typeof id !== 'string' || !visible.has(id)) ||
    !Array.isArray(body.nudges) ||
    body.nudges.some(
      (n: any) =>
        !Array.isArray(n?.basisSourceIds) ||
        n.basisSourceIds.some((id: unknown) => typeof id !== 'string' || !visible.has(id)),
    )
  )
    throw Object.assign(Error('INPUT_SCOPE_FORBIDDEN'), { code: 'INPUT_SCOPE_FORBIDDEN' });
  return receipt;
}
