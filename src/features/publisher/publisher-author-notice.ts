/** Translate system notices only; never rewrite the manuscript or saved content. */
const labels: Record<string, string> = {
  startAt: '开场时间',
  publicSetting: '公开背景',
  hiddenContext: '幕后设定',
  experienceNote: '体验说明',
  initialKnowledge: '人物知情范围',
  initialRelationship: '初始关系',
  personality: '性格',
  speakingStyle: '说话方式',
  privateBackground: '人物背景',
  publicProfile: '公开档案',
  coreDesire: '在乎什么',
  currentGoal: '眼前想做的事',
  boundaryRules: '知情与底线',
  description: '故事介绍',
  title: '标题',
  hook: '一句话简介',
  identity: '身份',
  background: '背景',
  name: '姓名',
  L5: '关系说明',
};
export function authorNotice(value: string) {
  if (/```|\{\s*["']|(?:[a-zA-Z]+\.){2,}[a-zA-Z]+|[a-z]+_[a-z_]+|[a-zA-Z]+\[\d+\]/.test(value))
    return '这项内容仍需核对。请查看对应的故事、人物或剧情，以及保留的原稿；当前提示不代表已经通过检查。';
  return value
    .replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (word) =>
      Object.hasOwn(labels, word) ? labels[word]! : /[a-z][A-Z]/.test(word) ? '相关内容' : word,
    )
    .replace(/有界 JSON|JSON/gi, '可保存的故事内容')
    .replace(/字段长度预算/g, '可填写长度')
    .replace(/字段/g, '内容')
    .replace(/原数据/g, '原内容');
}
