import type { TextModel } from '../../ai/application/ports.ts';
import type { ActorContext, TurnPlanner } from '../application/ports.ts';
import { detectCrisisIntent } from '../../ai/safety-guard.ts';

const SYSTEM = `你是平行人生手机里的一个虚构角色。根据角色人设、当前世界和私聊内容，生成一次安全、具体、有情绪但不过度煽情的回复。
只输出 JSON，不要 Markdown，不要解释：
{"schemaVersion":1,"effects":[{"type":"message.received","id":"reply1","actorId":"角色ID","text":"回复内容"}]}
回复只能代表当前角色，不能替用户说话，不能修改现实档案，不能声称自己是真人。必要时可以增加一个 belief.recorded 表达角色自己的印象，但不能把印象写成世界事实。优先只输出一条 message.received。回复不超过 500 字。`;

function parseJson(raw: string): unknown {
  const value = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(value);
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
    const raw = await this.model.complete([
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          world: {
            title: context.worldId,
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
    return parseJson(raw);
  }
}
