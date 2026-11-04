import 'server-only';
import { roleTextModel } from './role-text-model.ts';
import { sceneGatewayConfig } from './scene-model-config.ts';
import type { GatewayConfig } from '../modules/ai/infrastructure/yibu-text-model.ts';
import { gatewayConfig } from './config.ts';
import { YibuTextModel } from '../modules/ai/infrastructure/yibu-text-model.ts';
/** Lazy model factory. Web services and the Worker have separate server-only composition roots. */
export function createTextModel() {
  const config = gatewayConfig();
  const base = new YibuTextModel(config);
  const npcModel = process.env.YIBU_NPC_MODEL?.trim();
  // This is model capacity shared by global and private background decisions,
  // not shared Agent state. Direct player replies keep the fast NPC override.
  const directorModel = process.env.YIBU_DIRECTOR_MODEL?.trim();
  // Explicit provider configuration; never infer support from a model name.
  const npcEffort =
    process.env.YIBU_NPC_REASONING_EFFORT?.trim() as GatewayConfig['reasoningEffort'];
  return npcModel || directorModel || npcEffort
    ? roleTextModel(
        base,
        npcModel || npcEffort
          ? new YibuTextModel({
              ...config,
              model: npcModel || config.model,
              ...(npcEffort ? { reasoningEffort: npcEffort } : {}),
            })
          : base,
        directorModel ? new YibuTextModel({ ...config, model: directorModel }) : undefined,
      )
    : base;
}
/** Authoring compiles a whole screenplay; its model can be configured independently of chat. */
export function createManuscriptTextModel() {
  const config = gatewayConfig();
  return new YibuTextModel({
    ...config,
    model: process.env.YIBU_PREPARATION_MODEL?.trim() || config.model,
  });
}
export { sameOrigin as sessionOriginAllowed } from '../modules/identity/infrastructure/signed-session.ts';

/** The scene director and independent scene speakers share this isolated selection. */
export function createSceneTextModel(config: GatewayConfig = sceneGatewayConfig()) {
  return new YibuTextModel(config);
}
