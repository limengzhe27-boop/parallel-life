/**
 * AUD-19: AI 内容安全与生命危机干预守卫
 * 识别自伤、自残、绝望自杀倾向与极端危机意图，提供即时暖心关怀与正规心理援助热线，
 * 绝不允许将自伤/自毁倾向作为长期事实落库到个人档案或世界记忆中。
 */

export interface CrisisDetectionResult {
  isCrisis: boolean;
  reason?: 'self_harm' | 'suicide' | 'extreme_hopelessness';
  interventionText?: string;
}

/** 危机意图关键词与模式（纯前端+服务端双重守卫，低延迟） */
const CRISIS_PATTERNS: Array<{ regex: RegExp; reason: 'self_harm' | 'suicide' | 'extreme_hopelessness' }> = [
  { regex: /(自杀|轻生|跳楼|割腕|想死|不想活了|不想留在这个世界|结束生命|结束这一切|活着没意思|服毒|割脉|安乐死买药)/i, reason: 'suicide' },
  { regex: /(自残|划手腕|用刀割自己|伤害自己|虐待自己)/i, reason: 'self_harm' },
  { regex: /(活着好累想彻底解脱|人间不值得活了|没有活下去的必要了|准备离开这个世界了)/i, reason: 'extreme_hopelessness' },
];

export const CRISIS_HOTLINES = [
  { name: '全国希望24小时心理危机干预热线', phone: '400-161-9995' },
  { name: '北京心理危机研究与干预中心（24小时）', phone: '010-82951332 / 800-810-1117' },
  { name: '教育部华中师大心理援助热线', phone: '400-96-78525' },
  { name: '中科院心理所心理援助热线', phone: '010-64851106' },
];

export const CRISIS_RESPONSE = `我感受到了你此刻的疲惫与艰难。请相信，你的感受是真实且被珍视的，无论经历着什么，你都不必一个人独自承受这份沉重。

生命的每一个时刻都有转机，请试着停下来，深呼吸，给自己一个喘息的机会。如果你愿意，可以随时拨打以下全国免费心理援助热线，那里的专业咨询师会一直陪伴你、倾听你：

📞 全国希望24小时生命危机干预热线：400-161-9995
📞 北京心理危机研究与干预中心：010-82951332
📞 教育部心理援助热线：400-96-78525

或者，尝试联系身边你最信任的朋友、家人，或者去附近的医院寻求专业心理支持。你对这个世界很重要，请一定照顾好自己。`;

/**
 * 检测输入文本是否包含生命安全危机意图
 */
export function detectCrisisIntent(text: string): CrisisDetectionResult {
  if (!text || typeof text !== 'string') {
    return { isCrisis: false };
  }
  const normalized = text.trim();
  for (const { regex, reason } of CRISIS_PATTERNS) {
    if (regex.test(normalized)) {
      return {
        isCrisis: true,
        reason,
        interventionText: CRISIS_RESPONSE,
      };
    }
  }
  return { isCrisis: false };
}
