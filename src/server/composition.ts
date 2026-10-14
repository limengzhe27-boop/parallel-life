import 'server-only';
import { sceneGatewayConfig } from './scene-model-config.ts';
import type { GatewayConfig } from '../modules/ai/infrastructure/yibu-text-model.ts';
import { gatewayConfig } from './config.ts';
import { YibuTextModel } from '../modules/ai/infrastructure/yibu-text-model.ts';
/** Lazy model factory. Web services and the Worker have separate server-only composition roots. */
export function createTextModel() {
  return new YibuTextModel(gatewayConfig());
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
