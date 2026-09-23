import { DomainError } from '../world/domain/errors.ts';

export interface SentenceItem {
  id: number;
  text: string;
}

export interface DialogueReview {
  keep: number[];
  issues: string[];
}

const SENTENCE_END = /[。！？!?]+[”’"』」]*|\.(?!\d)[”’"']*(?=\s|$)/g;

/**
 * 提取句子切片，生成不可变句子 ID。
 * 绝不用正则或关键词做破坏性删除，保留原句完整性。
 */
export function dialogueSentences(candidate: string): SentenceItem[] {
  if (typeof candidate !== 'string' || candidate.length > 6000) {
    throw new DomainError('INVALID_COMMAND', 'invalid_dialogue_draft');
  }
  const cleaned = candidate.trim();
  if (!cleaned) return [];

  const sentences: SentenceItem[] = [];
  let start = 0;
  let match: RegExpExecArray | null;

  SENTENCE_END.lastIndex = 0;
  while ((match = SENTENCE_END.exec(cleaned)) !== null) {
    const end = match.index + match[0].length;
    const text = cleaned.slice(start, end);
    if (text.trim()) {
      sentences.push({ id: sentences.length, text });
    }
    start = end;
  }

  if (start < cleaned.length) {
    const remaining = cleaned.slice(start);
    if (remaining.trim()) {
      sentences.push({ id: sentences.length, text: remaining });
    }
  }

  return sentences;
}

/**
 * 删除式台词校稿机制：
 * 校稿模型只充当“裁判”判定原句去留，绝不允许校稿模型重写或重排句子！
 * 仅由程序按原顺序拼接被保留的句子。
 * 若全部原句均被否决，抛出异常，由上层标记为失败待重试，防止幻觉扩散。
 */
export function selectReviewedDialogue(
  sentences: SentenceItem[],
  review: { keep: number[]; issues?: string[] },
): string {
  if (
    !review ||
    !Array.isArray(review.keep) ||
    !Array.isArray(review.issues || []) ||
    (review.issues && review.issues.length > 20)
  ) {
    throw new DomainError('INVALID_COMMAND', 'invalid_dialogue_review');
  }

  const keep = review.keep;
  const total = sentences.length;

  // 必须是有效数字索引且无重复
  const uniqueKeep = new Set<number>();
  for (const idx of keep) {
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= total) {
      throw new DomainError('INVALID_COMMAND', 'invalid_dialogue_review');
    }
    if (uniqueKeep.has(idx)) {
      throw new DomainError('INVALID_COMMAND', 'invalid_dialogue_review');
    }
    uniqueKeep.add(idx);
  }

  // 严格按原句原始顺序拼接，不随 keep 数组乱序
  const result = sentences
    .filter((s) => uniqueKeep.has(s.id))
    .map((s) => s.text)
    .join('')
    .trim();

  if (!result) {
    throw new DomainError('INVALID_COMMAND', 'dialogue_draft_rejected');
  }

  return result;
}

/**
 * 构造删除式校稿审查 Prompt
 */
export function buildReviewPrompt(params: {
  sentences: SentenceItem[];
  worldFacts: Record<string, unknown>;
  characterRole: Record<string, unknown>;
  userText: string;
}): string {
  return [
    '【角色台词校稿任务】',
    '你是一名严格的世界设定审查员。当前角色生成了一段候选台词草稿，切分为如下带编号的原句：',
    JSON.stringify(params.sentences, null, 2),
    '',
    '【已知世界事实与限制】',
    JSON.stringify(params.worldFacts, null, 2),
    '',
    '【当前角色人设】',
    JSON.stringify(params.characterRole, null, 2),
    '',
    '【用户刚说的输入】',
    params.userText,
    '',
    '【审查规则】',
    '1. 逐句检查台词是否违背已有世界事实、是否擅自替用户做决定、是否虚构角色未参与的经历。',
    '2. 你绝对不能重写或添加任何文字！你只能决定保留哪几个句子的编号。',
    '3. 返回且仅返回严格 JSON 格式：{"keep": [保留的句子编号...], "issues": ["存在的问题说明..."]}',
  ].join('\n');
}
