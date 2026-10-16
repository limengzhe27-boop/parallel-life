import { createHash, randomUUID } from 'node:crypto';
import type { TextModel } from '../modules/ai/application/ports.ts';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import type { TaskLease } from '../modules/tasks/domain/types.ts';
import type { AgentInputReceipt, ActorAgentState } from '../modules/world/domain/agent-runtime.ts';
import { PostgresDirectorSnapshotRepository } from '../modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../modules/world/infrastructure/director-agent-model.ts';
import { runDirectorAgent } from '../modules/world/application/run-director-agent.ts';

/** The same persistent Director, only for ambiguous explicit player turns, never per ordinary message. */
export async function coordinateNativeResponder(
  db: PostgresDatabase,
  model: () => TextModel,
  lease: TaskLease,
  frame: {
    receipt: AgentInputReceipt;
    states: ActorAgentState[];
    actorIds: string[];
    worldVersion: number;
    epoch: number;
  },
  signal: AbortSignal,
): Promise<string | null> {
  const store = new PostgresDirectorRuntimeRepository(db);
  const commandId = 'native-routing:' + lease.id;
  const previous = await store.lookup(lease.ownerId, lease.scopeId, commandId);
  const saved = previous ? await store.readCompletion(lease.ownerId, previous) : null;
  const snapshot = saved?.found
    ? saved.snapshot
    : await new PostgresDirectorSnapshotRepository(db).read(lease.ownerId, {
        worldId: lease.scopeId,
        engineEpoch: frame.epoch,
        worldVersion: frame.worldVersion,
        candidates: frame.states
          .filter((s) => frame.actorIds.includes(s.actorId))
          .map((state) => ({
            id:
              'native-speaker:' +
              createHash('sha256')
                .update(JSON.stringify([lease.id, state.actorId]))
                .digest('hex'),
            worldId: lease.scopeId,
            actorId: state.actorId,
            source: 'conversation',
            episodeId: null,
            actionId: null,
            resourceIds: [],
            channel: frame.receipt.channel,
            threadId: frame.receipt.threadId,
            sourceIds: [frame.receipt.id],
            expectedWorldVersion: frame.worldVersion,
            expectedActorRevision: state.revision,
            priority: 1,
            reason:
              '玩家当前在此渠道发言，需要按实际对话与本人责任选择承接者；不是指令、成果或强制发言。',
            requiresCoordination: true,
          })),
        blockers: [],
        nativeTurn: {
          taskId: lease.id,
          inputReceiptId: frame.receipt.id,
          channel: frame.receipt.channel as 'group' | 'scene',
          threadId: frame.receipt.threadId,
        },
      });
  let decision;
  try {
    decision = await runDirectorAgent(
      {
        attempts: store,
        model: {
          validateInput: (s) => new WorldDirectorAgentModel(model()).validateInput(s),
          decide: (s, abort) => new WorldDirectorAgentModel(model()).decide(s, abort),
        },
        parse: parseDirectorDecision,
      },
      lease.ownerId,
      previous ?? {
        id: randomUUID(),
        worldId: lease.scopeId,
        commandId,
        engineEpoch: frame.epoch,
        expectedWorldVersion: snapshot.worldVersion,
        inputHash: directorSnapshotInputHash(snapshot),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      },
      snapshot,
      signal,
    );
  } catch (error) {
    const status = await store
      .lookup(lease.ownerId, lease.scopeId, commandId)
      .then((a) => a?.status)
      .catch(() => null);
    if (error instanceof Error && ['unknown_after_send', 'request_sent'].includes(status ?? ''))
      Object.assign(error, { code: 'UPSTREAM_FAILED' });
    throw error;
  }
  if (decision.selectedCandidateIds.length) {
    const selected = snapshot.candidates.find((c) => c.id === decision.selectedCandidateIds[0]);
    if (!selected || !frame.actorIds.includes(selected.actorId))
      throw Error('DIRECTOR_NATIVE_TURN_CONFLICT');
    return selected.actorId;
  }
  // A durable quiet coordination is a completed assessment, not a fabricated NPC turn/world result.
  await db.transaction(lease.ownerId, async (sql) => {
    const updated = await sql.query(
      `UPDATE parallel_life.tasks t SET status='succeeded',result_version=$5,updated_at=now()
      WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_kind='world' AND t.scope_id=$3
       AND t.lease_token=$4 AND t.status='running' AND t.lease_until>clock_timestamp()
       AND EXISTS(SELECT 1 FROM parallel_life.director_decisions d JOIN parallel_life.director_runtime_attempts a
         ON a.id=d.attempt_id AND a.world_id=d.world_id AND a.owner_id=d.owner_id
         WHERE d.id=$6 AND d.world_id=t.scope_id AND d.owner_id=t.owner_id AND a.status='committed'
          AND a.snapshot->'nativeTurn'->>'taskId'=t.id::text AND a.snapshot->'nativeTurn'->>'inputReceiptId'=$7
          AND d.document->'selectedCandidateIds'='[]'::jsonb AND d.document->'opportunities'='[]'::jsonb)`,
      [
        lease.id,
        lease.ownerId,
        lease.scopeId,
        lease.token,
        frame.worldVersion,
        decision.id,
        frame.receipt.id,
      ],
    );
    if (updated.rowCount !== 1) throw Error('NATIVE_COORDINATION_TASK_CONFLICT');
  });
  return null;
}
