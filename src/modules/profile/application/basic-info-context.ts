/** Only literal user statements can move attribution between fiction and reality. */
const fiction =
  /故事(?:里|中)|剧本(?:里|中)|虚构|平行人生|分支世界|角色设定|(?:想|要|来)(?:创建|创作|构思|设计)(?:一[个条段])?(?:故事|人生|世界)|古惑仔/u;
const reality =
  /现实(?:中|里|的我|[：:])|真实(?:的我|情况)|回到(?:现实|我的资料)|说回(?:现实|我自己)/u;

export function realBasicInfoText(text: string, priorUserTexts: readonly string[] = []): string {
  let fictional = false;
  let current: string[] = [];
  for (const [index, message] of [...priorUserTexts, text].entries()) {
    const isCurrent = index === priorUserTexts.length;
    for (const clause of message.split(/[，,。；;！!\n]/u)) {
      // Do not treat negated reality or a quoted character's statement as a switch.
      const reset =
        reality.test(clause) && !/并非现实|不是现实|不是我的现实|[“”「」『』"‘’]/u.test(clause);
      if (reset) fictional = false;
      if (fiction.test(clause)) fictional = true;
      if (isCurrent && !fictional) {
        current.push(
          reset
            ? clause.replace(
                /^(?:回到现实|说回现实|现实中|现实里|现实的我|现实|真实的我|真实情况)[：:\s]*/u,
                '',
              )
            : clause,
        );
      }
    }
  }
  return current.join('，');
}
