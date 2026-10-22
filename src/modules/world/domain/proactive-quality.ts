import type { AgentProposal } from './agent-runtime.ts';

/** Low-content waiting/reporting lines are not proactive contact; keep concrete speech. */
const GENERIC_WAITING = [
  /^(我这边)?(暂时|也)?(真的)?没什么(新)?(事|事情|情况|变化|好说的|新意|要说的)/u,
  /(就先?这样|不急着说|没什么新意要说了|等.{0,18}(明朗|新消息|新情况).{0,8}(再|说)|有(什么)?(新)?(事|情况).{0,12}(告诉|联系|说)|我这边.{0,12}准备好.{0,8}(告诉|联系))/u,
];

const CONCRETE_DETAIL =
  /(明天|今天|今晚|点|咖啡|车|店|活|钱|家|刘航|老周|林悦|阿杰|陈国强|见面|过来|回去|修|买|吃|工|地址|时间|资料|天气)/u;
const EMPTY_PLAN = /(没什么新?(打算|想法|计划)|没别的想法|先这样吧|就这样吧)/u;

export function isGenericProactiveLine(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (value.length <= 60 && EMPTY_PLAN.test(value) && !CONCRETE_DETAIL.test(value)) return true;
  return GENERIC_WAITING.some((pattern) => pattern.test(value));
}

/**
 * Proactive wakes may legitimately stay silent. This gate only removes content-free
 * waiting lines; it never rewrites a concrete plan, observation, question or sticker.
 */
export function withProactiveQuality(
  proposal: AgentProposal,
  input: { channelKind?: string; origin?: string; recentSelfTexts?: readonly string[] },
): AgentProposal {
  if (input.channelKind !== 'private' || !['wake', 'coordination'].includes(input.origin ?? ''))
    return proposal;
  const recent = new Set((input.recentSelfTexts ?? []).map((text) => text.trim()).filter(Boolean));
  const statements = proposal.statements.filter(
    (statement) =>
      statement.stickerId !== undefined ||
      (!isGenericProactiveLine(statement.text) && !recent.has(statement.text.trim())),
  );
  return statements.length === proposal.statements.length ? proposal : { ...proposal, statements };
}
