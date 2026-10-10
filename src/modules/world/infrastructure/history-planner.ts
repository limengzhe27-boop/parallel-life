import { historyInvitationSchedule } from '../domain/history-invitations.ts';
import { validateHistoryConnections } from '../domain/genesis-links.ts';
import { z } from 'zod';
import type { TextModel, ModelMessage } from '../../ai/application/ports.ts';
import { extractJsonObject } from '../../ai/application/model-json.ts';
import { HistoryConnectionSchema, type WorldOpening } from '../../../contracts/world-build.ts';
import { validateMessageHistory, type MessageHistoryProposal } from '../domain/genesis-messages.ts';

export const HISTORY_OUTPUT_ATTEMPTS = 2;
export const HISTORY_MAX_TOKENS = 4096;
const LetterSchema = z
  .object({
    text: z.string().trim().min(1).max(160),
    minutesBeforeStart: z.number().int().min(60).max(43200),
    connection: HistoryConnectionSchema.optional(),
  })
  .strict();
const LinkedLetterSchema = z.union([
  z.strictObject({
    text: z.string().trim().min(1).max(160),
    minutesBeforeStart: z.number().int().min(60).max(43200),
    connection: z.strictObject({ quote: z.string().trim().min(1).max(80) }).optional(),
  }),
  z.strictObject({
    minutesBeforeStart: z.number().int().min(60).max(43200),
    invitation: z.strictObject({
      slotId: z.enum(['soon', 'next_morning', 'next_evening']),
      body: z.string().trim().min(1).max(60),
    }),
  }),
]);
function responseSchema(linked: boolean) {
  return z.strictObject({
    groups: z
      .array(
        z.strictObject({
          actorIndex: z.number().int().min(0).max(7),
          messages: z
            .array(linked ? LinkedLetterSchema : LetterSchema)
            .min(1)
            .max(6),
        }),
      )
      .min(2)
      .max(8),
  });
}

/** The director authors fictional NPC letters. No private interview, hidden personas or other chats are sent. */
export class HistoryPlanner {
  private model: TextModel;
  private linksEnabled: boolean;
  constructor(model: TextModel, linksEnabled = false) {
    this.model = model;
    this.linksEnabled = linksEnabled;
  }
  async propose(
    opening: WorldOpening,
    startAt: string,
    signal?: AbortSignal,
    publicRelationships: ReadonlyMap<string, string> = new Map(),
  ): Promise<MessageHistoryProposal> {
    const cast = opening.actors.map((actor, actorIndex) => ({
      actorIndex,
      name: actor.name,
      relationship: publicRelationships.get(actor.key) ?? '',
    }));
    const schedule = this.linksEnabled ? historyInvitationSchedule(startAt) : undefined;
    const base: ModelMessage[] = [
      {
        role: 'system',
        content:
          '你是虚构人生的导演，为接管时刻以前编写NPC发给主角的微信旧来信。输入是已获准世界，不是现实记录。角色按cast中的actorIndex分别生成，各自只能说自己和主角之间的日常小事，不知道其他人的私聊、内心或幕后秘密。不替主角写发言、回应、选择或接受邀请，不宣称已生成照片。不要输出主角本人或新增人物。\n' +
          '仅返回一个JSON对象：{"groups":[{"actorIndex":0,"messages":[{"text":"这位人物以前发给主角的来信","minutesBeforeStart":2880}]}]}。这是结构示例，必须包含cast中每个actorIndex恰好一次，组的排列顺序不限，禁止漏人、重复或使用不存在的编号。每人通常两条（最少1条、最多6条）具体自然短消息，每条10至60字且最多160字。minutesBeforeStart是距离storyTime.startAt以前的整数分钟，60至43200，同一人物不能同分钟重复。以UTC+08:00故事时刻解读今天/昨天/周几，不用现实日期。group仅含actorIndex和messages；message仅含text和minutesBeforeStart，不添加name、key、actorKey、role、玩家回复或其他字段。不要复制示例文字，不用统一寒暄敷衍每个人。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          storyTime: { startAt, timeZone: 'UTC+08:00' },
          identity: opening.identity,
          setting: opening.setting,
          cast,
          ...(schedule ? { invitationSlots: schedule.slots } : {}),
        }),
      },
    ];
    if (schedule) {
      base[0]!.content = `你是虚构人生导演，编写NPC以前发给主角的来信。cast全部是NPC，不是主角；称主角为“你”，不把cast名字当成主角。各人只知道自己与主角的事情；不写其他人私聊、隐藏内心、玩家发言/选择/答应邀请或已生成照片。
只返回JSON groups，每个actorIndex恰好一组，允许乱序。每人1..6条messages，通常2条，不添加消息凑数。minutesBeforeStart为固定故事T0前60..43200整数分钟，同人不重复。
message严格二选一：普通旧来信{text,minutesBeforeStart,connection?:{quote}}，text最多160字；connection仅建立只读记录，quote为同条连续原文1..80字，禁止calendar。或具体未来邀约{minutesBeforeStart,invitation:{slotId,body}}，不得同时给text/connection/quote/日期/分钟偏移。全世界总共最多2条connection或invitation。
如果人物与场景自然适合提出未来活动，可以用专用invitation：从输入invitationSlots选择一个slotId，body写人物自己的具体活动、地点或未了事情，向“你”提出尚待回应的邀请。优先有明确可见关系的人；如果没有适合的活动或时间槽，允许0条，不强造邀约。不要把问候当活动，不宣称主角已经接受。
body必须1..60字，仅活动文案，不写任何日期/时间/今天/明天/周末/上午/下午等时间词，不输出时间占位符。程序会将所选slot的完整日期加在body前，正文、引用和日历都由程序统一生成；你不要重复计算或复制日期。例如body“来铺子一起整理新配件，愿意来吗？”只是结构说明，必须写该人物在当前世界的具体活动，不照抄示例。同一人物同一slot的同一活动不要重复邀约，不同人物不可互相代发；早餐/午休/晚饭等活动须与所选时段适合。
返回JSON形如{"groups":[{"actorIndex":0,"messages":[{"minutesBeforeStart":1440,"invitation":{"slotId":"next_morning","body":"该人物自己的具体邀约"}}]},{"actorIndex":1,"messages":[{"text":"该人物自己的过去来信","minutesBeforeStart":2880}]}]}；示例仅展示两种结构，必须完整覆盖实际cast所有编号且换成自然内容。
slotId仅输入给出的ID，不修改时间槽、不输出minutesAfterStart、UUID、资料、状态或素材。`;
    }
    let reason = 'INVALID_HISTORY_FIELDS';
    for (let attempt = 1; attempt <= HISTORY_OUTPUT_ATTEMPTS; attempt++) {
      signal?.throwIfAborted();
      // Transport failures occur outside the correction block: unknown/cancelled/truncated never pay again automatically.
      const raw = await this.model.complete(
        attempt === 1
          ? base
          : [
              ...base,
              {
                role: 'user',
                content: schedule
                  ? `上次输出未通过校验（${reason}）。保持相同cast和invitationSlots，重新返回groups。message严格选择普通text/可选仅记录connection或专用invitation{slotId,body}，不能混用；body<=60且无日期/相对时间词，slotId从输入选，0关联也合法。全员恰好一次，每人1..6条，旧分钟60..43200且不重复，总关联<=2。不添加任何其他字段。`
                  : `上次输出未通过校验（${reason}）。重新只返回groups，每组只含actorIndex和messages，message只含text和minutesBeforeStart。必须恰好${cast.length}组、覆盖编号0至${cast.length - 1}各一次，每组至少1条，不添加角色资料或其他字段；分钟60..43200且每人不重复。`,
              },
            ],
        signal,
        HISTORY_MAX_TOKENS,
        { format: 'json_object' },
      );
      signal?.throwIfAborted();
      try {
        const result = responseSchema(this.linksEnabled).parse(extractJsonObject(raw));
        if (
          result.groups.length !== cast.length ||
          new Set(result.groups.map((g) => g.actorIndex)).size !== cast.length ||
          result.groups.some((g) => g.actorIndex >= cast.length)
        )
          throw Error('HISTORY_CAST_COUNT');
        if (
          !this.linksEnabled &&
          result.groups.some((g) => g.messages.some((m) => 'connection' in m && m.connection))
        )
          throw Error('INVALID_MESSAGE_HISTORY');
        for (const group of result.groups) {
          const slots = group.messages.flatMap((m) =>
            'invitation' in m ? [m.invitation.slotId + '\0' + m.invitation.body.trim()] : [],
          );
          if (new Set(slots).size !== slots.length) throw Error('INVALID_HISTORY_INVITATION');
        }
        const history: MessageHistoryProposal = {
          version: 1,
          messages: result.groups.flatMap((group) =>
            group.messages.map((entry, letter) => ({
              key: `past_${group.actorIndex}_${letter}`,
              actorKey: opening.actors[group.actorIndex]!.key,
              ...('invitation' in entry
                ? {
                    minutesBeforeStart: entry.minutesBeforeStart,
                    ...schedule!.render(entry.invitation),
                  }
                : entry),
            })),
          ),
        };
        validateMessageHistory(
          history,
          opening.actors.map((a) => a.key),
        );
        if (this.linksEnabled) validateHistoryConnections(history, startAt);
        return history;
      } catch (error) {
        reason =
          error instanceof Error &&
          [
            'HISTORY_CAST_COUNT',
            'INVALID_MESSAGE_HISTORY',
            'INVALID_GENESIS_LINKS',
            'INVALID_HISTORY_INVITATION',
            'MODEL_OUTPUT_WITHOUT_OBJECT',
            'MODEL_OUTPUT_NOT_JSON',
          ].includes(error.message)
            ? error.message
            : 'INVALID_HISTORY_FIELDS';
        console.warn(JSON.stringify({ planner: 'world-history', attempt, reason }));
        if (attempt === HISTORY_OUTPUT_ATTEMPTS)
          throw Object.assign(Error('INVALID_HISTORY_OUTPUT'), {
            code: 'INVALID_RESPONSE',
            attempts: attempt,
            reason,
          });
      }
    }
    throw Object.assign(Error('INVALID_HISTORY_OUTPUT'), { code: 'INVALID_RESPONSE' });
  }
}
