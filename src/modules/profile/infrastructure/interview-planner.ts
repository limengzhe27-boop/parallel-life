import { explicitBirthdate } from '../domain/explicit-birthdate.ts';
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
export const INTERVIEW_PROMPT_VERSION = 'interview-1.4.0';
export const InterviewProposalSchema = z.strictObject({
  reply: z.string().trim().min(1).max(4000),
  question: z
    .strictObject({
      text: z.string().trim().min(1).max(1000),
      target: QuestionTargetSchema,
    })
    .optional(),
  basicInfo: z
    .strictObject({
      name: z.string().trim().max(50).optional(),
      birthdate: z
        .string()
        .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
        .optional(),
      birthTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional(),
      location: z.string().trim().max(50).optional(),
      occupation: z.string().trim().max(50).optional(),
      hometown: z.string().trim().max(50).optional(),
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
const SYSTEM = `你是“如果”的个人向导。先理解这个人，再和他商量想体验怎样的另一种人生。
【交流与引导】
1. 先回应用户这一句具体在说什么。像自然交谈，通常2—4句，不套用长篇共情或人生比喻。最多问一个有用的问题，也可以不提问。
2. 用户只想倾诉时先倾听；对经历不清楚时问一个关键细节；表达另一种生活的愿望时才邀请一起构思。不要每轮都推销平行人生，不主动制造创伤或替用户决定梦想。
3. 构思时逐步弄清他想成为谁、改变哪次选择、期待怎样的关系，以及不想遇到什么。信息不足就讨论，不假装已经准备好完整世界；明确选择后才展示方向供他查看。
4. 姓名、生日等不是聊天或体验的门槛，不必专门追问，不从生日或星座推断性格。只记录用户明确说的本人信息。毕业年份、朋友的生日和假设都不是本人生日；只有明确的本人出生陈述才能写 birthdate。
5. 你只能讨论或提议分支。不能声称正在创建、已经创建或马上打开手机；真正创建需要用户查看方向并选择带入资料。用户说不创建时继续聊天。
6. [照片:...] 只是上传标记，你没有看到图像内容。可以问照片背后的故事，不能声称看到了长相、表情或画面细节。

【输出格式与严格防重规则】
仅输出 JSON 对象，无 Markdown：{"reply":"自然真诚的回应","question":{"text":"可选的一个启发式追问","target":"identity|interest|personality|relationship|experience|wish"},"basicInfo":{"name":"明确提及的名字/称呼","birthdate":"明确提及的出生日期YYYY-MM-DD或年份YYYY","birthTime":"HH:mm","location":"所在城市","occupation":"职业","hometown":"家乡"},"facts":[{"category":"interest|personality|wish","value":"用户明确表达的一条简短静态信息（爱好、性格、心愿）","sourceMessageIds":["对应的用户消息ID"]}],"events":[{"title":"用户明确讲述的本人事件、经历、遗憾或关键转折（动词/事件属性）","date":"明确提及的年份或YYYY-MM-DD，未知为null","sourceMessageIds":["用户消息ID"]}]}。
【基础资料直接进入 basicInfo 与更正覆盖】：
1. 当用户在对话中提到或更正自己的【生日/出生年月日/出生年份】（如“我是01年的”、“我其实是2001年的”、“之前说错了，我是05年的”）、【姓名/称呼】、【出生具体时间】、【所在城市】、【职业】、【家乡】时，必须提取并直接填入 basicInfo 对象中。
   - birthdate：若是完整日期输出 YYYY-MM-DD（如 2001-05-12）；若是年份（如“01年”、“05年”），输出标准 4 位年份 YYYY（如 2001 或 2005）。
   - 若用户指出“之前信息有误/说错了”，以用户最新指出的正确信息为准更新 basicInfo，并在 reply 中温和确认更正。
2. 属于基础资料的任何信息，绝对严禁再在 facts 或 events 中输出平铺文本！所有身份信息唯一归入 basicInfo，严禁污染文字档案。
【只记录值得长期保留的内容】：
1. 只有对理解这个人长期成立的、能影响人生选择的信息才记录：稳定的身份与处境、长期兴趣与偏好、重要的关系、有分量的经历/转折/遗憾、真实的愿望。
2. 以下一律不记录：寒暄与客套（“你好”“谢谢”）、当下的情绪或临时状态（“今天有点累”）、一次性的琐碎动作（“刚吃完午饭”）、你自己说过的话或推测、用户的反问与疑问、玩笑与测试内容、产品操作本身。
3. 用户以“如果/假如/要是”开头的设想，只有在他明确表达成愿望时才能记为 wish，不能当成已发生的事实或经历。
4. profileNotes 里已经记录过的信息不要重复提取；只是换了说法、加了无关细节的同一件事，不要再输出。
【事实与经历分开】：
1. 涉及用户亲身经历、人生阶段、重大转折、遗憾后悔等具体事情，必须且只能输出到 events，绝对严禁在 facts 中重复提取！
2. facts 严格限定记录客观静态信息（interest/personality/wish），绝对不要输出 identity 或与 events 重复的 experience。
3. 宁少勿滥：最多 3 条新事实、1 个新事件；没有值得记录的就给空数组 []。输入中的 blockedTargets 是用户明确不愿讨论的主题，不可追问。sourceMessageIds 只能引用下文提供的 user 消息 ID。`;
export function extractBasicInfoFromText(
  text: string,
): NonNullable<InterviewProposal['basicInfo']> {
  const result: NonNullable<InterviewProposal['basicInfo']> = {};
  const birthdate = explicitBirthdate(text);
  if (birthdate) result.birthdate = birthdate;
  // A model-provided field is not evidence. Use explicit self-attribution only;
  // unresolved shorthand stays in the conversation rather than overwriting the profile.
  if (
    /[“”「」『』"‘’]|如果|假如|要是|不要|不想|不是|不叫|不住|不在|并非|别|可能|好像|大概|[？?]/u.test(
      text,
    )
  )
    return result;
  for (const clause of text.split(/[，,。；;！!\n]/u).map((part) => part.trim())) {
    const name = clause.match(
      /^(?:我叫|我的名字是|称呼我为|叫我)([^\s，。！？、]{1,20}?)(?:就好|就行)?$/u,
    )?.[1];
    if (name) result.name = name;
    const location = clause.match(
      /^我(?:现在)?(?:生活在|住在|定居在)([^\s，。！？、]{2,20})$/u,
    )?.[1];
    if (location) result.location = location;
    const occupation = clause.match(/^(?:我的职业是|我从事)([^\s，。！？、]{2,20})$/u)?.[1];
    if (occupation) result.occupation = occupation;
    const hometown = clause.match(/^(?:我的家乡是|我来自)([^\s，。！？、]{2,20})$/u)?.[1];
    if (hometown) result.hometown = hometown;
    const time = clause.match(/^我的出生时间是([01]\d|2[0-3]):([0-5]\d)$/u);
    if (time) result.birthTime = `${time[1]}:${time[2]}`;
  }
  return result;
}

/** Apply the same attribution checks at both parsing and persistence boundaries. */
export function groundBasicInfo(text: string, _proposed?: InterviewProposal['basicInfo']) {
  return extractBasicInfoFromText(text);
}

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

    // 启发式双重兜底：若用户直接说了生日或姓名，即使模型漏提也自动补齐
    const lastUserText = selected.filter((m) => m.role === 'user').at(-1)?.text ?? '';
    proposal.basicInfo = groundBasicInfo(lastUserText, proposal.basicInfo);

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
