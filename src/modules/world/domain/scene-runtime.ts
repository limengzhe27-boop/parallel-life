import { DomainError } from './errors.ts';
import type { SceneAction, SceneSession, SceneEntry, Participant } from './experience-rules.ts';
/** Keep original text. Conservative classification cannot turn a stated plan into an executed act. */
export function classifySceneInput(text: string): Pick<SceneAction, 'intent' | 'kind'> {
  if (/^(?:\s*)(?:如果|假如|要是|假设|假想|what if\b|suppose\b)/i.test(text))
    return { intent: 'hypothesis', kind: 'try' };
  if (
    /^(?:\s*)(?:我(?:想|打算|计划|准备|希望)|明天|以后|等会|I (?:plan|want|hope|intend)\b)/i.test(
      text,
    )
  )
    return { intent: 'plan', kind: 'try' };
  const kind = /说|问|告诉|邀请|建议|商量|say\b|ask\b/i.test(text)
    ? 'speak'
    : /看|观察|检查|inspect\b|look\b/i.test(text)
      ? 'inspect'
      : /走|来到|移到|move\b|walk\b/i.test(text)
        ? 'move'
        : /调|拿|放|打开|拍|操作|turn\b|open\b/i.test(text)
          ? 'operate'
          : 'try';
  return { intent: 'attempt', kind };
}
export function scenePresent(scene: SceneSession, version: number): Participant[] {
  return scene.presence
    .filter(
      (p) => p.joinedVersion <= version && (p.leftVersion === undefined || version < p.leftVersion),
    )
    .map((p) => p.participant);
}
export function assertSceneAvailable(
  scene: SceneSession,
  currentSceneId: string | undefined,
  paused: boolean,
  ready: boolean,
) {
  if (
    paused ||
    scene.status !== 'active' ||
    currentSceneId !== scene.id ||
    !scenePresent(scene, Infinity).some((p) => p.kind === 'player')
  )
    throw new DomainError('INVALID_COMMAND', 'Scene is read-only or player has left');
  if (!ready) throw new DomainError('INVALID_COMMAND', 'Scene opening has not been committed');
}
/** Filter before budgeting or model routing; an absent actor never receives later entries. */
export function sceneContextEntries(entries: SceneEntry[], participant: Participant): SceneEntry[] {
  const key = (p: Participant) => (p.kind === 'player' ? 'player' : p.actorId);
  return entries.filter((e) => e.observableTo.some((p) => key(p) === key(participant))).slice(-20);
}
/** Stop before an unanswered person's decision; keep the original input in the action record. */
export function sceneAttemptBoundary(text: string): { now: string; deferred: string | null } {
  const match =
    /(?:等|待)(?:他|她|你|对方|小林|小王).{0,24}?(?:回答|回复|同意|确认|指出|答复)/.exec(text);
  if (!match) return { now: text, deferred: null };
  return {
    now: text.slice(0, match.index).replace(/[，,\s]+$/, '') || '等待对方回答',
    deferred: text.slice(match.index),
  };
}
export function assertsDeferredExecution(deferred: string, result: string): boolean {
  const groups = [
    ['调', '抬', '移'],
    ['放', '摆'],
    ['拿', '取'],
    ['拍', '拍摄'],
    ['打开', '开启'],
    ['关闭'],
  ];
  return groups
    .filter((g) => g.some((v) => deferred.includes(v)))
    .some((g) =>
      g.some((v) =>
        new RegExp(`(?:已经|已|并且|随后|于是).{0,20}${v}|${v}.{0,16}(?:了|完成|成功)`).test(
          result,
        ),
      ),
    );
}
/** Bounded subject check: this runtime never turns the saved player's step into an NPC act. */
export function attributesPlayerStepToActor(
  step: string,
  result: string,
  names: string[],
): boolean {
  const groups = [
    ['\u95ee', '\u8be2\u95ee'],
    ['\u8c03', '\u62ac', '\u79fb'],
    ['\u653e', '\u6446'],
    ['\u62ff', '\u53d6'],
    ['\u62cd', '\u62cd\u6444'],
    ['\u6253\u5f00', '\u5f00\u542f'],
    ['\u5173\u95ed'],
  ];
  const verbs = groups.filter((g) => g.some((v) => step.includes(v))).flat();
  return result.split(/[\u3002\uff01\uff1f\uff0c,\n]/).some((clause) =>
    names.some((name) => {
      if (!clause.trim().startsWith(name)) return false;
      const tail = clause.slice(
        clause.indexOf(name) + name.length,
        clause.indexOf(name) + name.length + 30,
      );
      return verbs.some((v) => {
        const verbAt = tail.indexOf(v);
        if (verbAt < 0) return false;
        const playerAt = [
          tail.indexOf('\u4f60'),
          tail.indexOf('\u6211'),
          tail.indexOf('\u73a9\u5bb6'),
        ].filter((i) => i >= 0);
        return !playerAt.some((i) => i < verbAt);
      });
    }),
  );
}
