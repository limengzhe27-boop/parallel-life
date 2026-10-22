import type { AgentProposal } from './agent-runtime.ts';

/** Semantic stickers are chosen from what the reply is expressing, never from a fixed actor preference. */
const CUES: Array<[RegExp, string]> = [
  [/(笑|哈哈|好笑|逗|有趣)/, 'xswl'],
  [/(累|困|睡|晚安|熬夜)/, 'kun'],
  [/(无语|算了|随便|不想说)/, 'wuyu'],
  [/(真的|不会吧|怀疑|不信)/, 'zhende'],
  [/(就这|绝了|离谱|逆天)/, 'jiuzhe'],
  [/(摆烂|不想动|躺平|没动力)/, 'bailan'],
  [/(冲|出发|搞起|开干)/, 'chong'],
  [/(在吗|人呢|在不在)/, 'zaima'],
  [/(饿|吃饭|宵夜)/, 'e'],
  [/(摸鱼|上班|打工)/, 'moyu'],
  [/(加油|你可以|会好的)/, 'jiayou'],
  [/(可以|没问题|好的)/, 'keyi'],
  [/(赞|厉害|牛)/, 'zan'],
  [/(啊？|疑惑|奇怪)/, 'a'],
  [/(不要|拒绝|不行)/, 'bie'],
  [/(晚安|睡了)/, 'wanan'],
];

function stableGate(text: string) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash % 100 < 45;
}

/**
 * A model may omit an optional sticker field even when it is natural. This server-side
 * semantic fallback only fires for private player dialogue, at most one extra bubble,
 * and never replaces the text. It is deliberately gated so every message is not a sticker.
 */
export function withAmbientSticker(
  proposal: AgentProposal,
  input: { channelKind?: string; origin?: string; text: string },
): AgentProposal {
  if (input.channelKind !== 'private' || input.origin !== 'player') return proposal;
  if (!proposal.statements.length) return proposal;
  if (proposal.statements.some((statement) => statement.text.trim().startsWith('[[sticker:'))) {
    return proposal;
  }
  const text = input.text.trim();
  if (text.length < 2 || !stableGate(text)) return proposal;
  const cue = CUES.find(([pattern]) => pattern.test(text));
  if (!cue) return proposal;
  return {
    ...proposal,
    statements: [...proposal.statements, { text: `[[sticker:${cue[1]}]]`, dependsOnActionIds: [] }],
  };
}
