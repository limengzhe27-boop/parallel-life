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
const ResponseSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            actorIndex: z.number().int().min(0).max(7),
            messages: z.array(LetterSchema).min(1).max(6),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();

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
    const connectionRule = this.linksEnabled
      ? '\nOptional connection on at most TWO letters globally: {"quote":"exact continuous substring of this same text, 1..80 characters","calendar":{"minutesAfterStart":1440}}. calendar is optional; without it the letter has only a read-only history record. Use this only for a concrete unresolved proposal; otherwise omit connection. Calendar proposes a future activity 30..10080 whole minutes AFTER storyTime.startAt; sender alone participates and the player has NOT accepted. Put a story-local date and time formatted M\u6708D\u65e5HH:mm in the exact quote matching that instant, rather than ambiguous tomorrow relative to old sent time. Include a suitable future invitation when the setting supports one, never fabricate player past actions. No asset, photo, UUID, role, status, acceptance or extra fields. Bad connections are rejected, not silently dropped.'
      : '';
    const base: ModelMessage[] = [
      {
        role: 'system',
        content:
          '你是虚构人生的导演，为接管时刻以前编写NPC发给主角的微信旧来信。输入是已获准世界，不是现实记录。角色按cast中的actorIndex分别生成，各自只能说自己和主角之间的日常小事，不知道其他人的私聊、内心或幕后秘密。不替主角写发言、回应、选择或接受邀请，不宣称已生成照片。不要输出主角本人或新增人物。\n' +
          '仅返回一个JSON对象：{"groups":[{"actorIndex":0,"messages":[{"text":"这位人物以前发给主角的来信","minutesBeforeStart":2880}]}]}。这是结构示例，必须包含cast中每个actorIndex恰好一次，组的排列顺序不限，禁止漏人、重复或使用不存在的编号。每人通常两条（最少1条、最多6条）具体自然短消息，每条10至60字且最多160字。minutesBeforeStart是距离storyTime.startAt以前的整数分钟，60至43200，同一人物不能同分钟重复。以UTC+08:00故事时刻解读今天/昨天/周几，不用现实日期。group仅含actorIndex和messages；message仅含text和minutesBeforeStart，不添加name、key、actorKey、role、玩家回复或其他字段。不要复制示例文字，不用统一寒暄敷衍每个人。' +
          connectionRule,
      },
      {
        role: 'user',
        content: JSON.stringify({
          storyTime: { startAt, timeZone: 'UTC+08:00' },
          identity: opening.identity,
          setting: opening.setting,
          cast,
        }),
      },
    ];
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
                content: `上次输出未通过校验（${reason}）。重新只返回groups，每组只含actorIndex和messages，message只含text和minutesBeforeStart。必须恰好${cast.length}组、覆盖编号0至${cast.length - 1}各一次，每组至少1条，不添加角色资料或其他字段；分钟60..43200且每人不重复。${connectionRule}`,
              },
            ],
        signal,
        HISTORY_MAX_TOKENS,
        { format: 'json_object' },
      );
      signal?.throwIfAborted();
      try {
        const result = ResponseSchema.parse(extractJsonObject(raw));
        if (
          result.groups.length !== cast.length ||
          new Set(result.groups.map((g) => g.actorIndex)).size !== cast.length ||
          result.groups.some((g) => g.actorIndex >= cast.length)
        )
          throw Error('HISTORY_CAST_COUNT');
        if (!this.linksEnabled && result.groups.some((g) => g.messages.some((m) => m.connection)))
          throw Error('INVALID_MESSAGE_HISTORY');
        const history: MessageHistoryProposal = {
          version: 1,
          messages: result.groups.flatMap((group) =>
            group.messages.map((entry, letter) => ({
              key: `past_${group.actorIndex}_${letter}`,
              actorKey: opening.actors[group.actorIndex]!.key,
              ...entry,
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
