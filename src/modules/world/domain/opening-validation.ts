/** Only explicit hierarchy contradictions; this is not a general semantic judge. */
export function contradictsSelectedRole(role: string, text: string): boolean {
  const equal = /同级|平等|没有上下级|无上下级/.test(role);
  const subordinate = /(?:我的|你的|主角的)(?:下属|员工|助理)/.test(role);
  const superior = /(?:我的|你的|主角的)(?:老板|领导|上司)/.test(role);
  if (!equal && !subordinate && !superior) return false;
  const claims = superior
    ? /(?:我是|他是|她是|作为)(?:你|主角|用户)的(?:下属|员工)|(?:你|主角|用户)是(?:我|他|她)的(?:老板|上司)/g
    : /(?:我是|他是|她是|作为)(?:你的?|主角的|用户的)(?:直属)?(?:老板|上司|领导)|(?:你|主角|用户)的直属上司|(?:你|主角|用户)(?:必须|只能)(?:服从|听从)(?:我|他|她)|(?:决定|决策|安排)(?:都|全部|一律)?(?:由|交由)(?:我|他|她)(?:来)?(?:批准|审批)/g;
  for (const match of text.matchAll(claims)) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (
      /(?:不是|不再是|并非|不能说|不要说|别说|不应声称|不代表|没有)[^。！？；，,]{0,5}$/.test(
        before,
      )
    )
      continue;
    return true;
  }
  return false;
}
