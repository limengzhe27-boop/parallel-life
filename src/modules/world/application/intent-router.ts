import type { TurnMode } from '../../../contracts/world-interaction.ts';

const EXPLICIT_IMAGE_PATTERNS = [
  /发[一两几]?张.*(照片|图|照)/i,
  /发个(自拍|照|照片|图)/i,
  /画[一两几]?张.*(图|画)/i,
  /拍[一两几]?张.*(照|图)/i,
  /看看你(此刻|现在)?在干嘛/i,
  /看看窗外/i,
];

export interface IntentAnalysisResult {
  turnMode: TurnMode;
  imagePrompt?: string;
  isAction: boolean;
}

/**
 * 意图路由调度器：
 * 精准识别用户输入的模式（chat / image / world）。
 * 核心设计准则：普通闲聊（chat）绝不唤醒世界结算、绝不递增 world.version。
 */
export function routeUserIntent(params: {
  text: string;
  imageRequest?: string;
  userAction?: Record<string, unknown>;
}): IntentAnalysisResult {
  // 1. 显式 userAction 必定走 world 模式
  if (params.userAction && Object.keys(params.userAction).length > 0) {
    return {
      turnMode: 'world',
      isAction: true,
    };
  }

  // 2. 显式提供了 imageRequest 字段
  if (params.imageRequest && params.imageRequest.trim().length > 0) {
    return {
      turnMode: 'image',
      imagePrompt: params.imageRequest.trim(),
      isAction: false,
    };
  }

  // 3. 自然语言索图意图识别
  const trimmed = params.text.trim();
  for (const pattern of EXPLICIT_IMAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        turnMode: 'image',
        imagePrompt: trimmed,
        isAction: false,
      };
    }
  }

  // 4. 默认走轻量私聊模式
  return {
    turnMode: 'chat',
    isAction: false,
  };
}
