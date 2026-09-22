import 'server-only';
import { gatewayConfig } from './config.ts';
import { YibuTextModel } from '../modules/ai/infrastructure/yibu-text-model.ts';
/** Lazy: builds do not require secrets. No HTTP endpoint is exposed until auth/storage exist. */
export function createTextModel() { return new YibuTextModel(gatewayConfig()); }
