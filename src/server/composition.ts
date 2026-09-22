import 'server-only';
import { gatewayConfig } from './config.ts';
import { YibuTextModel } from '../modules/ai/infrastructure/yibu-text-model.ts';
/** Lazy model factory. Web services and the Worker have separate server-only composition roots. */
export function createTextModel() {
  return new YibuTextModel(gatewayConfig());
}
export { sameOrigin as sessionOriginAllowed } from '../modules/identity/infrastructure/signed-session.ts';
