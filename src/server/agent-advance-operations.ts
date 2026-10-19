import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { AdvanceOperationRepository } from '../modules/world/infrastructure/advance-operation-repository.ts';
import {
  advanceRecoveryWaitReason,
  type AdvanceWorkRef,
} from '../modules/world/domain/advance-operation.ts';
import type { AdvanceResult } from '../modules/world/application/advance-world.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresDirectorRuntimeRepository } from '../modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';
import { runNpcAgent } from '../modules/world/application/run-agent.ts';
import { runDirectorAgent } from '../modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../modules/world/infrastructure/director-agent-model.ts';
import { protectedMessageReplayStore } from './npc-agent-services.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
/** This wrapper records the existing scheduler; recovery has no model factory or new work selector. */
export function agentAdvanceOperations(
  db: PostgresDatabase,
  advance: (
    owner: string,
    world: string,
    track: (work: AdvanceWorkRef) => Promise<void>,
  ) => Promise<AdvanceResult | null>,
) {
  const ops = new AdvanceOperationRepository(db),
    npcs = new PostgresAgentRuntimeRepository(db),
    directors = new PostgresDirectorRuntimeRepository(db),
    worlds = new PostgresWorldRepository(db);
  return {
    async perform(
      owner: string,
      world: string,
      id: string,
      action: 'start' | 'lookup' | 'recover',
      reportFailure?: (error: unknown) => void,
    ) {
      if (action === 'start' && (await ops.start(owner, world, id))) {
        try {
          const result = await advance(owner, world, (w) => ops.track(owner, world, id, w));
          if (!result) throw new DomainError('INVALID_COMMAND');
          await ops.finish(owner, world, id, result);
        } catch (error) {
          reportFailure?.(error);
          // Failure to persist the receipt leaves the original operation running/unknown,
          // never permission to rerun its model work.
          await ops.finish(owner, world, id, undefined, error);
        }
      }
      let state = await ops.read(owner, world, id);
      if (action !== 'recover' || state.status !== 'recoverable') return state;
      let waiting = false;
      for (const work of state.work.filter((w) => w.status === 'response_received')) {
        if (work.kind === 'npc') {
          const attempt = await npcs.lookup(owner, world, work.commandId);
          if (!attempt || attempt.status !== 'response_received') continue;
          try {
            await runNpcAgent(
              {
                attempts: protectedMessageReplayStore(npcs, owner, attempt),
                model: {
                  async decide() {
                    throw Error('RECOVERY_MODEL_FORBIDDEN');
                  },
                },
                kernel: new PostgresNpcAgentKernel(db, worlds),
              },
              owner,
              attempt,
              null,
            );
          } catch (error) {
            if (advanceRecoveryWaitReason(error)) {
              waiting = true;
              continue;
            }
            // Kernel persists conflicts/known-invalid. Storage/deferred leaves the protected raw.
            const after = await npcs.lookup(owner, world, work.commandId);
            if (after?.status === 'response_received') throw error;
          }
        } else {
          const attempt = await directors.lookup(owner, world, work.commandId);
          if (!attempt || attempt.status !== 'response_received') continue;
          const saved = await directors.readCompletion(owner, attempt);
          if (!saved.found) continue;
          try {
            await runDirectorAgent(
              {
                attempts: directors,
                model: {
                  async decide() {
                    throw Error('RECOVERY_MODEL_FORBIDDEN');
                  },
                },
                parse: parseDirectorDecision,
              },
              owner,
              attempt,
              saved.snapshot,
            );
          } catch (error) {
            if (advanceRecoveryWaitReason(error)) {
              waiting = true;
              continue;
            }
            const after = await directors.lookup(owner, world, work.commandId);
            if (after?.status === 'response_received') throw error;
          }
        }
      }
      state = await ops.read(owner, world, id);
      return waiting && state.status === 'recoverable'
        ? { ...state, waitingOn: 'clock_or_attention' as const }
        : state;
    },
  };
}
