import 'server-only';
import type { GatewayConfig } from '../modules/ai/infrastructure/yibu-text-model.ts';
export function gatewayConfig(): GatewayConfig {
  const deepSeekKey = process.env.DEEPSEEK_TEXT_API_KEY?.trim();
  if (deepSeekKey) {
    return {
      apiKey: deepSeekKey,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      timeoutMs: 85000,
      deepSeekJson: true,
    };
  }
  const apiKey = process.env.YIBU_API_KEY?.trim();
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED');
  return {
    apiKey,
    baseUrl: process.env.YIBU_BASE_URL || 'https://yibuapi.com',
    model: process.env.YIBU_TEXT_MODEL || 'gpt-4o-mini',
    timeoutMs: 85000,
  };
}

/** Local progression switch. Infrastructure receives the mode, never the environment. */
export type DirectorIdleBeatMode = 'auto' | 'force' | 'off';
export function directorIdleBeatMode(): DirectorIdleBeatMode {
  const value = process.env.PROGRESSION_IDLE_BEAT;
  return value === 'force' || value === 'off' ? value : 'auto';
}
