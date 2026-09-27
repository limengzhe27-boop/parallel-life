import type { TextModel } from '../../ai/application/ports.ts';
import type { ActorContext, TurnPlanner } from '../application/ports.ts';
import { extractJsonObject } from '../../ai/application/model-json.ts';
import { detectCrisisIntent } from '../../ai/safety-guard.ts';

const SYSTEM = `你是平行人生手机微信里的虚构角色。你正在微信上和主角（用户）进行一对一真实私聊。
根据你的角色人设（性格口吻、说话习惯）、你与主角的关系、当前世界的背景与情境，以及两人的历史私聊记录，真切、接地气且极富代入感地回复主角。

【核心交互准则：拒绝套话与念稿，打造真实微信交流】
1. 【第一反应必须接招，严禁自说自话】：
   - 必须先正面、具体地承接主角刚才发送的那句话！无论是主角的冷淡反问（如“什么事”）、开玩笑、疲惫抱怨、还是严肃讨论，你都必须给出符合你人设与情绪立场的本能第一反应；
   - 绝对严禁无视主角的回答而继续自顾自背诵预设台词，绝对严禁像复读机一样机械重复过往话语。
2. 【极具人情味的微信真实私聊口吻】：
   - 杜绝书面化、公文感或小说舞台腔，使用地道真实的中文微信口语，句子自然错落，带生活语气词（“啊/呢/哈/啦/哎/嘛”）；字数通常在 30 至 180 字之间，恰如其分；
   - 展现鲜明的人际关系特质：
     · 【亲人/长辈（姐、妈、爸等）】：中国式亲情的烟火气，刀子嘴豆腐心，生活细节关切（吃没吃饭、天冷加衣、寄了特产或煲了汤、家里亲戚琐事），哪怕嘴上责备催促，字里行间也是血浓于水的牵挂；当主角冷淡反问时，会真实地气结又心疼（“你还问我什么事！昨天电话不接消息不回，妈急得一晚上没睡好……”）；
     · 【朋友/发小/铁哥们】：极度松弛，互损互侃，日常吐槽，分享八卦或热搜，随时约饭约酒、深夜撸串，在主角难受时第一时间站出来给底气；
     · 【事业合伙人/同行】：紧扣具体项目推进（方案截止日、甲方对接、布展进度、合同打款），言简意赅、雷厉风行，但同时是同甘共苦的战友，互相信任托底；
     · 【知己/潜在伴侣】：细腻微妙的情感流动，欲言又止的分享欲（窗外的雨、好听的歌、街角的咖啡），试探性的关心与默契。
3. 【推动情境流动——“接招-推进-抛球”】：
   - ① 接招：先对主角的话与情绪给出明确态度；
   - ② 推进：结合当前世界设定（setting）和日程事项（appointments），自然带出当下的生活动态或突发状况（如“刚才房东来敲门了”、“制片那边刚把合同发过来”）；
   - ③ 抛球：句末自然抛出一个具体的提议、反问或选择（“你今晚到底回不回来？”、“下午两点我们一起去现场碰一下？”），促使主角回复并深入剧情。
4. 只能代表你自己发言，绝不能替主角说话，绝不能伪造主角已做的决定；
5. 当主角向你索取照片、或你们共同经历有纪念意义的事件场景（如开幕展、杀青仪式、深夜畅谈、签约聚餐）时，可以在 effects 中额外附带一个 media.requested 效果解锁事件照片存入相册。

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
}`;

function parseJson(raw: string): unknown {
  try {
    return extractJsonObject(raw);
  } catch {
    return null;
  }
}
function structuredReply(text: string): boolean {
  return (
    /^\s*(?:```|[\[{])/.test(text) ||
    /"(?:schemaVersion|effects|actorId|message\.received)"\s*:/.test(text)
  );
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
          recentMessages: context.messages.filter(
            (message) => message.role === 'user' || !structuredReply(message.text),
          ),
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
          if (
            typeof effect.text !== 'string' ||
            !effect.text.trim() ||
            structuredReply(effect.text)
          ) {
            throw new Error('MODEL_OUTPUT_NOT_DIALOGUE');
          }
          // 强制将 actorId 归一化为当前发言角色的真实 ID，彻底避免模型输出中文或错配导致校验中断
          effect.actorId = targetActorId;
          if (!effect.id) effect.id = `reply_${Date.now()}`;
        }
      }
      return parsed;
    }

    if (!raw.trim() || structuredReply(raw) || parsed !== null) {
      throw new Error('MODEL_OUTPUT_NOT_DIALOGUE');
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
          text: cleanText,
        },
      ],
    };
  }
}
