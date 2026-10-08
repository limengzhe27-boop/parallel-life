import { randomUUID } from 'node:crypto';
import type { ScenePlannerPort } from '../application/scene-ports.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import { SceneTaskInputSchema, scenePlanning, commitSceneProposal } from './scene-repository.ts';
import { SCENE_PROMPT_VERSION } from './scene-planner.ts';
export function sceneTaskHandler(
  queue: PostgresTaskQueue,
  planner: ScenePlannerPort,
  model: string,
) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const started = Date.now();
    try {
      const input = SceneTaskInputSchema.parse(lease.input);
      const context = await queue.read(lease, (sql) =>
        scenePlanning(sql, lease.ownerId, lease.scopeId, input),
      );
      const proposal = await planner.propose(context, signal);
      await queue.commit(lease, async (sql) => {
        const version = await commitSceneProposal(
          sql,
          lease.ownerId,
          lease.scopeId,
          input,
          proposal,
          randomUUID(),
        );
        return {
          value: undefined,
          outcome: {
            status: 'succeeded',
            resultVersion: version,
            model,
            promptVersion: SCENE_PROMPT_VERSION,
            durationMs: Date.now() - started,
          } as const,
        };
      });
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'INVALID_PROPOSAL')
        Object.assign(e, { code: 'INVALID_AI_OUTPUT' });
      if (e instanceof Error)
        Object.assign(e, {
          model,
          promptVersion: SCENE_PROMPT_VERSION,
          durationMs: Date.now() - started,
        });
      throw e;
    }
  };
}
