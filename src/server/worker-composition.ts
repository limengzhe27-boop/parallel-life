import { nativeNpcTaskHandler } from './npc-agent-channel-services.ts';
import { getServices } from './services.ts';
import { createTextModel } from './composition.ts';
import { createPrivateAssetStore } from './private-asset-store.ts';
import type { AssetStore } from '../modules/media/application/asset-store.ts';
import {
  InterviewPhotoReader,
  interviewPhotoMetadata,
} from '../modules/profile/infrastructure/interview-photo-reader.ts';
import { worldTaskDispatcher } from './world-task-dispatcher.ts';
import { groupTaskHandler } from '../modules/world/infrastructure/group-task-handler.ts';
import { WorldGroupPlanner } from '../modules/world/infrastructure/group-planner.ts';
import { ScenePlanner } from '../modules/world/infrastructure/scene-planner.ts';
import { sceneTaskHandler } from '../modules/world/infrastructure/scene-task-handler.ts';
import { sceneEnvironmentTaskHandler } from '../modules/world/infrastructure/agent-scene-environment.ts';
import { WorldPlanner } from '../modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../modules/world/infrastructure/build-handler.ts';
import { DiscoveryPlanner } from '../modules/discovery/infrastructure/discovery-planner.ts';
import { discoveryHandler } from '../modules/discovery/infrastructure/discovery-handler.ts';
import 'server-only';
import { sceneGatewayConfig } from './scene-model-config.ts';
import { createSceneTextModel } from './composition.ts';
import { gatewayConfig } from './config.ts';
import { YibuTextModel } from '../modules/ai/infrastructure/yibu-text-model.ts';
import { PostgresTaskQueue } from '../modules/tasks/infrastructure/postgres-task-queue.ts';
import { InterviewPlanner } from '../modules/profile/infrastructure/interview-planner.ts';
import { interviewHandler } from '../modules/profile/infrastructure/interview-handler.ts';
import { memoryHandler } from '../modules/memory/infrastructure/memory-handler.ts';
import { mediaHandler } from '../modules/media/infrastructure/media-handler.ts';
import { YibuMediaProviderAdapter } from '../modules/media/infrastructure/yibu-media-provider-adapter.ts';
import { PostgresCharacterVisualAnchorRepository } from '../modules/media/infrastructure/character-reference-resolver.ts';
import { ReplicateMediaProviderAdapter } from '../modules/media/infrastructure/replicate-provider-adapter.ts';
import { MediaPipelineService } from '../modules/media/infrastructure/media-pipeline-service.ts';

export function createWorker() {
  const url = process.env.WORKER_DATABASE_URL;
  if (!url || new URL(url).username.split('.')[0] !== 'pl_worker')
    throw Error('WORKER_NOT_CONFIGURED');
  const config = gatewayConfig(),
    queue = new PostgresTaskQueue(url);

  let sceneHandler: ReturnType<typeof sceneTaskHandler> | undefined;
  let assetStore: AssetStore | undefined;
  const readStore = () => (assetStore ??= createPrivateAssetStore());
  let mediaService: MediaPipelineService | undefined;
  const readMediaService = () => {
    if (!mediaService) {
      const db = getServices().db;
      const store = readStore();
      const visualAnchorRepo = new PostgresCharacterVisualAnchorRepository(db);
      /* The project gateway already serves an image model; prefer it, keep Replicate as fallback. */
      const providerAdapter = process.env.YIBU_API_KEY?.trim()
        ? new YibuMediaProviderAdapter({
            apiKey: process.env.YIBU_API_KEY,
            baseUrl: process.env.YIBU_BASE_URL,
            model: process.env.YIBU_IMAGE_MODEL,
          })
        : new ReplicateMediaProviderAdapter({
            apiToken: process.env.REPLICATE_API_TOKEN,
          });
      const referenceAssetReader = async (assetId: string, ownerId?: string) => {
        let storageKey: string | undefined;
        let mimeType: string | undefined;
        if (ownerId) {
          const row = (
            await db.transaction(ownerId, async (sql) =>
              sql.query(
                `SELECT storage_key, mime_type FROM parallel_life.assets WHERE id = $1 AND owner_id = $2`,
                [assetId, ownerId],
              ),
            )
          ).rows[0];
          storageKey = row?.storage_key;
          mimeType = row?.mime_type;
        }
        if (!storageKey) return null;
        const bytes = await store.get(storageKey);
        return { bytes, mimeType: mimeType || 'image/jpeg' };
      };
      mediaService = new MediaPipelineService({
        providerAdapter,
        assetStore: store,
        visualAnchorRepo,
        referenceAssetReader,
      });
    }
    return mediaService;
  };
  return {
    queue,
    handlers: {
      world: worldTaskDispatcher({
        agent: async (lease, signal) => {
          const db = getServices().db;
          if (await sceneEnvironmentTaskHandler(db)(lease, signal)) return true;
          return nativeNpcTaskHandler(db, createTextModel)(lease, signal);
        },
        scene: (lease, signal) => {
          if (!sceneHandler) {
            const sceneConfig = sceneGatewayConfig();
            sceneHandler = sceneTaskHandler(
              queue,
              new ScenePlanner(createSceneTextModel(sceneConfig)),
              sceneConfig.model,
            );
          }
          return sceneHandler(lease, signal);
        },
        group: groupTaskHandler(
          queue,
          new WorldGroupPlanner(new YibuTextModel(config)),
          config.model,
        ),
      }),
      'world-build': buildHandler(
        queue,
        new WorldPlanner(new YibuTextModel(config), {
          historyEnabled: true,
          historyMode: 'two-step',
          historyLinksEnabled: true,
        }),
        config.model,
      ),
      profile: discoveryHandler(
        queue,
        new DiscoveryPlanner(new YibuTextModel(config)),
        config.model,
      ),
      interview: interviewHandler(
        queue,
        new InterviewPlanner(new YibuTextModel(config)),
        config.model,
        (lease) =>
          new InterviewPhotoReader(
            (input) => queue.read(lease, (sql) => interviewPhotoMetadata(sql, input)),
            readStore,
          ),
      ),
      memory: memoryHandler(queue),
      media: mediaHandler(queue, readMediaService),
    },
  };
}
