/** Conservative literal anchor for an explicit current wish, not a profession classifier. */
export function currentFocusAnchor(brief: string): string | null {
  const clauses = brief
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"\n]*"|'[^'\n]*'/gu, '')
    .split(/[，,。；;！!\n]|但(?:是)?(?=我|这次|现在|别|不|想)/u);
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/了$/u, '')
      .replace(/的(?:工作|身份|人生|生活|角色)$/u, '')
      .trim();
  const refused: string[] = [];
  for (const clause of [...clauses].reverse()) {
    const denied = clause.match(
      /(?:不想|不希望|不要|不打算|不准备)(?:体验|成为|当|做|尝试|扮演)(?:一名|一个|一位)?(.{2,40})$/u,
    );
    if (denied) refused.push(normalize(denied[1]!));
    if (
      /[？?]\s*$/u.test(clause) ||
      /^\s*(?:他|她|朋友|同事|别人|对方|有人)(?:说|提到|要求|让我|叫我)/u.test(clause) ||
      /(?:转述|引用|据说|听说)/u.test(clause) ||
      /(?:不想|不希望|不要|不打算|不准备).{0,4}(?:体验|成为|当|做|尝试|扮演)/u.test(clause)
    )
      continue;
    const match = clause.match(
      /(?:^\s*(?:这次|本次|现在)?|我(?:现在|这次|更|只|其实)?)(?:想|希望|要|打算)(?:体验|成为|当|做|尝试|扮演)(?:一名|一个|一位)?(.{2,40}?)(?=而不是|而非|但是|然后|$)/u,
    );
    if (!match) continue;
    const anchor = normalize(match[1]!);
    if (anchor.length >= 2 && anchor.length <= 40 && !refused.includes(anchor)) return anchor;
  }
  return null;
}

/** A name mentioned as a rejected/abandoned identity is not a preserved main role. */
export function preservesFocus(premise: string, anchor: string): boolean {
  const index = premise.indexOf(anchor);
  if (index < 0) return false;
  const prefix = premise.slice(Math.max(0, index - 16), index);
  if (
    /(?:不是|不做|不当|不再|不成为|不担任|不想成为|不想当|放弃|告别|曾经是|原本是).{0,6}$/u.test(
      prefix,
    )
  )
    return false;
  const remainder = premise.slice(index + anchor.length);
  if (/^.{0,16}(?:而是|改为|改当|改做|转行|转向).{1,40}/u.test(remainder)) return false;
  return true;
}
