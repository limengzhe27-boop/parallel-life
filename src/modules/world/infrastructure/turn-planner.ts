import type { TextModel } from '../../ai/application/ports.ts';
import type { ActorContext, TurnPlanner } from '../application/ports.ts';
import { detectCrisisIntent } from '../../ai/safety-guard.ts';

const SYSTEM = `你是平行人生手机世界里的虚构角色。你正在微信上和主角（用户）进行一对一真实私聊。
根据你的角色人设（性格口吻、行事风格）、你与主角的关系、当前世界的背景与情境，以及两人的历史私聊记录，真切且有代入感地回复主角。

【核心交互准则】
1. 真实接收主角的每一句对话与反馈：仔细聆听并正面回应主角所说的话，接住话题，给出符合你角色立场的态度、情绪与看法，绝不复读敷衍，绝不每次都推脱在忙；
2. 推动情境与真实流动：结合你的职业分工和当前待办事项，提出具体建设性意见、追问、或者提供新的故事线索，让交流富有吸引力与戏剧张力；
3. 只能代表你自己发言，绝不能替主角说话，绝不能伪造主角已做的决定；
4. 当主角向你索取照片、或你们共同经历有纪念意义的事件场景（如开幕展、杀青仪式、深夜畅谈、签约聚餐）时，可以在 effects 中额外附带一个 media.requested 效果解锁事件照片存入相册。

只输出 JSON，不要 Markdown，不要解释：
{
  "schemaVersion": 1,
  "effects": [
    {
      "type": "message.received",
      "id": "reply_1",
      "actorId": "ACTOR_ID",
      "text": "你的具体私聊回复内容"
    }
  ]
}
回复简明生动、符合微信口吻，字数在 20 至 350 字之间。`;

function parseJson(raw: string): unknown {
  const value = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }
}

/** Production adapter for the existing World command/reducer boundary. */
export class WorldTurnPlanner implements TurnPlanner {
  private readonly model: TextModel;
  constructor(model: TextModel) {
    this.model = model;
  }

  async propose(input: { context: ActorContext; userText: string }): Promise<unknown> {
    const crisis = detectCrisisIntent(input.userText);
    if (crisis.isCrisis) {
      return {
        schemaVersion: 1,
        effects: [
          {
            type: 'message.received',
            id: `reply_${Date.now()}`,
            actorId: input.context.actor.id,
            text: `我非常担心你。请停下来深呼吸，无论面对什么，你都不是一个人。\n\n如果你感到痛苦难忍，请立刻拨打全国 24 小时免费心理危机援助热线：400-161-9995，或联系身边的亲友与专业医生。你的生命是最珍贵的，请一定保重好自己。`,
          },
        ],
      };
    }
    const { context, userText } = input;
    const targetActorId = context.actor.id;
    const raw = await this.model.complete([
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          world: {
            title: context.worldTitle ?? context.worldId,
            time: context.time,
            facts: context.facts,
          },
          actor: context.actor,
          recentMessages: context.messages,
          appointments: context.appointments,
          userText,
        }),
      },
    ]);

    const parsed = parseJson(raw) as {
      schemaVersion?: number;
      effects?: Array<{
        type?: string;
        actorId?: string;
        id?: string;
        text?: string;
        prompt?: string;
      }>;
    } | null;

    if (parsed && Array.isArray(parsed.effects) && parsed.effects.length > 0) {
      for (const effect of parsed.effects) {
        if (effect.type === 'message.received') {
          // 强制将 actorId 归一化为当前发言角色的真实 ID，彻底避免模型输出中文或错配导致校验中断
          effect.actorId = targetActorId;
          if (!effect.id) effect.id = `reply_${Date.now()}`;
        }
      }
      return parsed;
    }

    // 容错回退：若模型偶尔未遵循严格 JSON 格式而直接输出自然对话文本，自动包装为合法的 message.received
    const cleanText = raw
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();
    return {
      schemaVersion: 1,
      effects: [
        {
          type: 'message.received',
          id: `reply_${Date.now()}`,
          actorId: targetActorId,
          text: cleanText || `${context.actor.name}收到了你的消息，正准备进一步跟你商量。`,
        },
      ],
    };
  }
}

