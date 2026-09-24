import { WorldPlanner } from '../modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../modules/world/infrastructure/build-handler.ts';
import { DiscoveryPlanner } from '../modules/discovery/infrastructure/discovery-planner.ts';
import { discoveryHandler } from '../modules/discovery/infrastructure/discovery-handler.ts';
import 'server-only';
import { gatewayConfig } from './config.ts';
import { YibuTextModel } from '../modules/ai/infrastructure/yibu-text-model.ts';
import { PostgresTaskQueue } from '../modules/tasks/infrastructure/postgres-task-queue.ts';
import { InterviewPlanner } from '../modules/profile/infrastructure/interview-planner.ts';
import { interviewHandler } from '../modules/profile/infrastructure/interview-handler.ts';
import { memoryHandler } from '../modules/memory/infrastructure/memory-handler.ts';
import { mediaHandler } from '../modules/media/infrastructure/media-handler.ts';
export function createWorker() {
  const url = process.env.WORKER_DATABASE_URL;
  if (!url || new URL(url).username.split('.')[0] !== 'pl_worker')
    throw Error('WORKER_NOT_CONFIGURED');
  const config = gatewayConfig(),
    queue = new PostgresTaskQueue(url);
  return {
    queue,
    handlers: {
      'world-build': buildHandler(queue, new WorldPlanner(new YibuTextModel(config)), config.model),
      profile: discoveryHandler(
        queue,
        new DiscoveryPlanner(new YibuTextModel(config)),
        config.model,
      ),
      interview: interviewHandler(
        queue,
        new InterviewPlanner(new YibuTextModel(config)),
        config.model,
      ),
      memory: memoryHandler(queue),
      media: mediaHandler(queue),
    },
  };
}
