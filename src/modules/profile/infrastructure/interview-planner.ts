import { z } from 'zod';
import type { TextModel, ModelMessage } from '../../ai/application/ports.ts';
import {
  FactCategory,
  Id,
  ShortText,
  type Profile,
  type Interview,
} from '../../../contracts/api.ts';
import { QuestionTargetSchema } from '../../../contracts/memory.ts';
import { extractJsonObject } from '../../ai/application/model-json.ts';
import { detectCrisisIntent, CRISIS_RESPONSE } from '../../ai/safety-guard.ts';
export const INTERVIEW_PROMPT_VERSION = 'interview-1.3.0';
export const InterviewProposalSchema = z.strictObject({
  reply: z.string().trim().min(1).max(4000),
  question: z
    .strictObject({
      text: z.string().trim().min(1).max(1000),
      target: QuestionTargetSchema,
    })
    .optional(),
  facts: z
    .array(
      z.strictObject({
        category: FactCategory,
        value: ShortText,
        sourceMessageIds: z.array(Id).min(1).max(5),
      }),
    )
    .max(3),
  events: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1).max(120),
        date: z
          .string()
          .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
          .nullable(),
        sourceMessageIds: z.array(Id).min(1).max(5),
      }),
    )
    .max(1),
});
export type InterviewProposal = z.infer<typeof InterviewProposalSchema>;
const SYSTEM = `你是“如果 · Parallel Life”的平行人生向导。你的使命是帮助用户看一看：如果在某个重要节点改变了人生的走向，平行世界的他正在过着怎样的人生。你的对话不是枯燥的问卷调查，而是为了帮他提取性格基底与人生关键分叉点，进而塑造专属于他的平行世界剧本。

【对话引导节奏与原则】
1. 明确好处与期待：让用户每次倾诉都能感受到“这是在为他雕刻专属的另一种可能”。语气真诚、细腻、有共鸣，通常回复 60–160 个字，每轮最多提出一个有深度、引人探索的具体追问。
2. 基础锚点（性格基调）：若用户尚未提及生日或出生时间，可以自然引导他提供出生年月日；基于时间与自述，细腻捕捉他的性格特质（如理性内敛、渴望远方、重情执着等），作为后续平行生活的底色，不搞迷信八字套路，注重现实共鸣。
3. 挖掘核心分叉点（剧本种子）：自然推进探寻用户的【当下烦恼】与【人生重大抉择/遗憾】（例如：“最近有什么让你烦恼心累的事？”“在过往经历中，有哪些是你觉得最关键、或者最想重新选择的决定？”）。因为只有摸清这些真实的遗憾与重要事件，才能精准为他演绎平行世界的另一种生活。
4. 先回应用户的当下话语，再给出具体启发式追问。尊重用户的边界，不想说的绝不勉强。

【输出格式与严格防重规则】
仅输出 JSON 对象，无 Markdown：{"reply":"自然真诚的回应","question":{"text":"可选的一个启发式追问","target":"identity|interest|personality|relationship|experience|wish"},"facts":[{"category":"identity|interest|personality|relationship|wish","value":"用户明确表达的一条简短静态信息（如生日、爱好、性格、心愿）","sourceMessageIds":["对应的用户消息ID"]}],"events":[{"title":"用户明确讲述的本人事件、经历、遗憾或关键转折（动词/事件属性）","date":"明确提及的年份或YYYY-MM-DD，未知为null","sourceMessageIds":["用户消息ID"]}]}。
【只记录值得长期保留的内容】：
1. 只有对理解这个人长期成立的、能影响人生选择的信息才记录：稳定的身份与处境、长期兴趣与偏好、重要的关系、有分量的经历/转折/遗憾、真实的愿望。
2. 以下一律不记录：寒暄与客套（“你好”“谢谢”）、当下的情绪或临时状态（“今天有点累”）、一次性的琐碎动作（“刚吃完午饭”）、你自己说过的话或推测、用户的反问与疑问、玩笑与测试内容、产品操作本身。
3. 用户以“如果/假如/要是”开头的设想，只有在他明确表达成愿望时才能记为 wish，不能当成已发生的事实或经历。
4. profileNotes 里已经记录过的信息不要重复提取；只是换了说法、加了无关细节的同一件事，不要再输出。
5. 基础资料（姓名/昵称、生日、出生时间、所在城市、职业、家乡）已由用户在卡片里填写，不要重复提取；只有用户补充了卡片之外的实质信息（例如具体职责、变化、计划）才记录。
【事实与经历分开】：
1. 涉及用户亲身经历、人生阶段、重大转折、遗憾后悔等具体事情，必须且只能输出到 events，绝对严禁在 facts 中重复提取！
2. facts 严格限定记录客观静态信息（identity/interest/personality/relationship/wish），不要输出与 events 重复的 experience。
3. 宁少勿滥：最多 3 条新事实、1 个新事件；没有值得记录的就给空数组 []。输入中的 blockedTargets 是用户明确不愿讨论的主题，不可追问。sourceMessageIds 只能引用下文提供的 user 消息 ID。`;
export class InvalidInterviewOutput extends Error {
  readonly code = 'INVALID_RESPONSE';
  constructor() {
    super('INVALID_INTERVIEW_OUTPUT');
  }
}
export class InterviewPlanner {
  private model: TextModel;
  constructor(model: TextModel) {
    this.model = model;
  }
  private context(
    profile: Profile,
    messages: Interview['messages'],
    blockedTargets: string[] = [],
  ): { context: ModelMessage[]; selected: Interview['messages'] } {
    // Budget before network invocation; always retain the latest user turn. No full private profile in logs.
    const selected: Interview['messages'] = [];
    let used = 0;
    for (const message of [...messages].reverse()) {
      const size = message.text.length + 100;
      if (used + size > 22000) break;
      selected.unshift(message);
      used += size;
    }
    if (!selected.length || selected.at(-1)?.role !== 'user') throw new InvalidInterviewOutput();
    const facts = profile.facts
      .filter((fact) => fact.status === 'confirmed')
      .map(({ category, value }) => ({ category, value, status: 'confirmed' as const }));
    const memory = JSON.stringify({
      facts,
      events: profile.events.map(({ title, date }) => ({ title, date })),
      people: profile.people.map(({ name, relationship }) => ({ name, relationship })),
    }).slice(0, 16000);
    const context: ModelMessage[] = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          profileNotes: memory,
          blockedTargets,
          messages: selected.map(({ id, role, text }) => ({ id, role, text })),
        }),
      },
    ];
    return { context, selected };
  }

  private parse(raw: string, selected: Interview['messages']): InterviewProposal {
    let proposal: InterviewProposal;
    try {
      proposal = InterviewProposalSchema.parse(extractJsonObject(raw));
    } catch {
      // If parsing fails, try rescuing reply before rejecting
      const replyMarker = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (replyMarker?.[1]) {
        try {
          const decoded = JSON.parse(`"${replyMarker[1]}"`) as string;
          if (decoded && typeof decoded === 'string' && decoded.trim()) {
            return {
              reply: decoded.trim(),
              facts: [],
              events: [],
            };
          }
        } catch {
          /* Fall through to error below */
        }
      }
      throw new InvalidInterviewOutput();
    }
    const userIds = new Set(selected.filter((x) => x.role === 'user').map((x) => x.id));
    if (
      [...proposal.facts, ...proposal.events].some((item) =>
        item.sourceMessageIds.some((id) => !userIds.has(id)),
      )
    )
      throw new InvalidInterviewOutput();
    return proposal;
  }
  async propose(
    profile: Profile,
    messages: Interview['messages'],
    signal?: AbortSignal,
    blockedTargets: string[] = [],
  ): Promise<InterviewProposal> {
    const lastUserMessage = messages.filter((m) => m.role === 'user').at(-1);
    if (lastUserMessage) {
      const crisis = detectCrisisIntent(lastUserMessage.text);
      if (crisis.isCrisis) {
        return {
          reply: crisis.interventionText ?? CRISIS_RESPONSE,
          facts: [],
          events: [],
        };
      }
    }
    const prepared = this.context(profile, messages, blockedTargets);
    return this.parse(await this.model.complete(prepared.context, signal), prepared.selected);
  }
  async proposeStream(
    profile: Profile,
    messages: Interview['messages'],
    onToken: (token: string) => void,
    signal?: AbortSignal,
    blockedTargets: string[] = [],
  ): Promise<InterviewProposal> {
    const lastUserMessage = messages.filter((m) => m.role === 'user').at(-1);
    if (lastUserMessage) {
      const crisis = detectCrisisIntent(lastUserMessage.text);
      if (crisis.isCrisis) {
        const intervention = crisis.interventionText ?? CRISIS_RESPONSE;
        onToken(intervention);
        return {
          reply: intervention,
          facts: [],
          events: [],
        };
      }
    }
    const prepared = this.context(profile, messages, blockedTargets);
    let raw = '';
    let emittedReply = '';
    const emitReply = () => {
      const marker = raw.match(/"reply"\s*:\s*"/);
      if (!marker || marker.index === undefined) return;
      const encoded = raw.slice(marker.index + marker[0].length);
      let safe = '';
      for (let index = 0; index < encoded.length; index++) {
        const char = encoded[index]!;
        if (char === '"') break;
        if (char === '\\') {
          const next = encoded[index + 1];
          if (next === undefined) break;
          if (next === 'u') {
            const hex = encoded.slice(index + 2, index + 6);
            if (hex.length < 4 || !/^[0-9a-f]{4}$/i.test(hex)) break;
            safe += encoded.slice(index, index + 6);
            index += 5;
            continue;
          }
          if (!/["\\/bfnrt]/.test(next)) break;
          safe += encoded.slice(index, index + 2);
          index++;
          continue;
        }
        safe += char;
      }
      try {
        const decoded = JSON.parse(`"${safe}"`) as string;
        if (decoded.length > emittedReply.length) {
          onToken(decoded.slice(emittedReply.length));
          emittedReply = decoded;
        }
      } catch {
        /* Wait for the next complete JSON escape sequence. */
      }
    };
    if (!this.model.streamComplete) {
      raw = await this.model.complete(prepared.context, signal);
      emitReply();
    } else {
      for await (const token of this.model.streamComplete(prepared.context, signal)) {
        raw += token;
        emitReply();
      }
    }
    return this.parse(raw, prepared.selected);
  }
}
