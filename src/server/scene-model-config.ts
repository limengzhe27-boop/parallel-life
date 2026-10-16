import 'server-only';
import { gatewayConfig } from './config.ts';
import type { GatewayConfig } from '../modules/ai/infrastructure/yibu-text-model.ts';
/** Scene delivery may use its own model; all credentials and transport policy remain shared. */
export function sceneGatewayConfig(): GatewayConfig {
  const base = gatewayConfig();
  const model = process.env.YIBU_SCENE_MODEL?.trim() || base.model;
  if (!/^[\w.-]+$/.test(model)) throw new Error('SCENE_MODEL_NOT_CONFIGURED');
  return { ...base, model };
}
