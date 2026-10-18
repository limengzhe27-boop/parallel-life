import type { TurnMode } from '../../../contracts/world-interaction.ts';

const EXPLICIT_VIDEO_PATTERNS = [
  /发[一两几]?个?.*(视频|录像|录屏|动图)/i,
  /发[一两几]?段.*(视频|录像|录屏|动图)/i,
  /拍[一两几]?个?.*(视频|录像)/i,
  /拍[一两几]?段.*(视频|录像)/i,
  /录[一两几]?个?.*(视频|录像)/i,
  /录[一两几]?段.*(视频|录像)/i,
  /看看.*(现场动态|小视频|动态视频|视频)/i,
];

const EXPLICIT_IMAGE_PATTERNS = [
  /发[一两几]?张.*(照片|图|照|自拍)/i,
  /发个(自拍|照|照片|图)/i,
  /画[一两几]?张.*(图|画)/i,
  /拍[一两几]?张.*(照|图|自拍)/i,
  /看看你(此刻|现在)?在干嘛/i,
  /看看窗外/i,
];

export interface IntentAnalysisResult {
  turnMode: TurnMode;
  imagePrompt?: string;
  videoPrompt?: string;
  isAction: boolean;
}

/**
 * 意图路由调度器：
 * 精准识别用户输入的模式（chat / image / video / world）。
 * 核心设计准则：普通闲聊（chat）绝不唤醒世界结算、绝不递增 world.version。
 * 视频属于高成本关键片段，必须显式触发，默认绝不自动生成，绝不阻塞文字。
 */
export function routeUserIntent(params: {
  text: string;
  imageRequest?: string;
  videoRequest?: string;
  userAction?: Record<string, unknown>;
}): IntentAnalysisResult {
  // 1. 显式 userAction 必定走 world 模式
  if (params.userAction && Object.keys(params.userAction).length > 0) {
    return {
      turnMode: 'world',
      isAction: true,
    };
  }

  // 2. 显式提供了 videoRequest 字段
  if (params.videoRequest && params.videoRequest.trim().length > 0) {
    return {
      turnMode: 'video',
      videoPrompt: params.videoRequest.trim(),
      isAction: false,
    };
  }

  // 3. 自然语言索要视频意图识别（关键片段验证，必须显式触发，绝不默认自动生成）
  const trimmed = params.text.trim();
  for (const pattern of EXPLICIT_VIDEO_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        turnMode: 'video',
        videoPrompt: trimmed,
        isAction: false,
      };
    }
  }

  // 4. 显式提供了 imageRequest 字段
  if (params.imageRequest && params.imageRequest.trim().length > 0) {
    return {
      turnMode: 'image',
      imagePrompt: params.imageRequest.trim(),
      isAction: false,
    };
  }

  // 5. 自然语言索图意图识别
  for (const pattern of EXPLICIT_IMAGE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        turnMode: 'image',
        imagePrompt: trimmed,
        isAction: false,
      };
    }
  }

  // 6. 默认走轻量私聊模式（不自动触发视频或图片生成，不阻塞文字）
  return {
    turnMode: 'chat',
    isAction: false,
  };
}
