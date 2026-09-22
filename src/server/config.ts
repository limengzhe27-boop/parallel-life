import 'server-only';
import type { GatewayConfig } from '../modules/ai/infrastructure/yibu-text-model.ts';
export function gatewayConfig(): GatewayConfig {
  const apiKey = process.env.YIBU_API_KEY?.trim();
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED');
  return {
    apiKey,
    baseUrl: process.env.YIBU_BASE_URL || 'https://yibuapi.com',
    model: process.env.YIBU_TEXT_MODEL || 'deepseek-v4.1-flash',
    timeoutMs: 85000,
  };
}
