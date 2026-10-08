import type { WorldState } from './types.ts';
import type { AgendaThread } from './agenda.ts';

/** Inputs are the speaker's visible projection, never a new omniscient story context. */
export function returnMessageLines(
  state: WorldState,
  actorId: string,
  thread?: AgendaThread,
): string[] {
  const conversation = state.messages.filter((m) => m.actorId === actorId);
  const last = conversation.at(-1);
  const minutes = last
    ? Math.max(0, Math.floor((Date.parse(state.time) - Date.parse(last.at)) / 60000))
    : 0;
  const elapsed =
    minutes < 60
      ? `${minutes}分钟`
      : minutes < 1440
        ? `约${Math.floor(minutes / 60)}小时`
        : `约${Math.floor(minutes / 1440)}天`;
  const lastPlayer = [...conversation].reverse().find((m) => m.role === 'user');
  const visibleFacts = state.facts
    .filter(
      (f) =>
        f.visibility.kind === 'world' ||
        (f.visibility.kind === 'actors' && f.visibility.actorIds.includes(actorId)),
    )
    .slice(-2);
  return [
    `（距本人物上次已保存交流${elapsed}；这是故事时间间隔，不代表你知道主角为何没来，也不代表他承诺的事已完成。）`,
    lastPlayer ? `（上次主角原话：${lastPlayer.text.slice(0, 180)}）` : '',
    last?.role === 'assistant'
      ? `（你上次已说：${last.text.slice(0, 180)}；不要把同一问候或提醒再发一遍。）`
      : '',
    ...visibleFacts.map(
      (f) =>
        `（已保存${f.believedByActorId ? '人物看法，未核实' : '可见事实'}：${f.text.slice(0, 180)}）`,
    ),
    thread?.kind === 'appointment_due' || thread?.kind === 'proposed_appointment'
      ? '约定仍按已保存状态处理；时间已过就谈当前可做的调整，不假装刚发邀请，更不能替主角确认、到场或失约。'
      : thread?.kind === 'choice_result' || thread?.kind === 'appointment_result'
        ? '先承接已保存的新结果；旧阻碍或危机已处理就说当前下一步，不能再把旧问题当突发坏消息。'
        : '承接原来那件事和你自己的目标；短间隔只走一小步，长间隔也不自动产生事故、背叛、失联或惩罚。',
    '本轮来信要有一个具体的新进展或可实行的下一步、你此刻联系主角的原因、一个可自然回应的点。不要把这三项写成标题或选择菜单，通常一两句，保持自己说话习惯。',
    '消息正文必须带出上述话题中至少一个有辨识度的对象或限制，以及针对它的具体操作；不能只用“那件事/你的部分/准备好了”代称整个话题。不要重复上次已提出的帮助，换成一个更具体、可以立即回答的小步骤。',
    ...(state.choices ?? [])
      .filter((c) => c.actorId === actorId && c.status === 'pending' && !c.result)
      .slice(-1)
      .map(
        (c) =>
          `（待执行决定：${c.quote}；尚无执行结果。不能说“你做好的/已经完成的”，只可提议如何落实、询问具体条件或提供可实行帮助。）`,
      ),
    '依据不足不编造重大事件或第三人的行动；可以提出你能做的准备、提供具体帮助或留下一个可选邀约，不冒称已完成。不要默认有人隐瞒，不用“你人呢/怎么不回”作固定开头。',
    '文字消息优先，不发起图片任务，不因需要吸引注意就生图；没有当前人物可见的真实已完成素材，不声称新照片已经拍好或生成。',
    '来信只是当前人物能知道和能说的内容；全局事实必须已有依据，事件、用户决定、邀约状态和图片不能只凭台词变成已发生。',
  ].filter(Boolean);
}

/** Bounded guard for major offline outcomes; message text cannot create such world facts. */
export function unsupportedReturnClaim(state: WorldState, actorId: string, text: string): boolean {
  const canonical = state.facts.filter(
    (f) =>
      f.kind === 'canonical' &&
      !f.believedByActorId &&
      (f.visibility.kind === 'world' ||
        (f.visibility.kind === 'actors' && f.visibility.actorIds.includes(actorId))),
  );
  const normalize = (value: string) => value.replace(/已经|刚刚|刚|已|确实|现在/gu, '');
  for (const match of text.matchAll(
    /受伤|住院|送医|抢救|出院|康复|去世|死亡|被捕|坐牢|被开除|被裁员|破产|失踪/gu,
  )) {
    const claim = match[0];
    // Adjacent subject/context must also be supported: one person's injury is
    // not evidence that another person was injured. This stays conservative.
    const prefix =
      normalize(text.slice(0, match.index)).match(/[\p{Script=Han}]{1,2}$/u)?.[0] ?? '';

    const negatedHere = (value: string, index: number) =>
      /(?:避免|不要|别|不会|没有|没|并未)[^，。！？；\n]{0,5}$/u.test(
        value.slice(Math.max(0, index - 12), index),
      );
    if (negatedHere(text, match.index)) continue;
    if (
      !canonical.some((f) =>
        [...normalize(f.text).matchAll(new RegExp(claim, 'gu'))].some(
          (evidence) =>
            normalize(f.text).slice(0, evidence.index).endsWith(prefix) &&
            !negatedHere(normalize(f.text), evidence.index),
        ),
      )
    )
      return true;
  }
  if (
    (state.choices ?? []).some((c) => c.actorId === actorId && c.status === 'pending' && !c.result)
  ) {
    for (const clause of text.split(/[。！？!?；;\n]/u)) {
      if (/(?:如果|等你|当你|剪完后|完成后|先.{0,30}再)/u.test(clause)) continue;
      if (
        /(?:发|给|检查|看看).{0,8}(?:你|已经|已)?(?:剪好|剪掉|做完|完成|拍好)的|(?:剪好|剪掉|做完|完成|拍好)的[^，。！？；]{0,20}(?:发给|给我|检查)/u.test(
          clause,
        )
      )
        return true;
    }
  }
  if (
    /照片.{0,8}(?:拍好了|做好了|生成了)|(?:已经|刚).{0,5}(?:拍好|生成).{0,5}(?:照片|图片)/u.test(
      text,
    )
  ) {
    const ready = state.mediaRequests.some(
      (m) =>
        m.status === 'ready' &&
        m.assetId &&
        state.messages.some((s) => s.actorId === actorId && s.sourceEventId === m.sourceEventId),
    );
    if (!ready) return true;
  }
  return false;
}
