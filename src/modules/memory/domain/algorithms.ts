import { DomainError } from './errors.ts';
import type { MemoryRecord } from './types.ts';

export interface SourceEvidenceItem {
  id: string;
  role?: 'user' | 'assistant';
  requestId?: string;
  text: string;
}

/**
 * 提取中英文检索关键词
 */
export function extractSearchTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const enWords = text.toLowerCase().match(/[a-z0-9_]{2,}/gu) ?? [];
  for (const w of enWords) terms.add(w);

  const hanRuns = text.match(/[\u3400-\u9fff]+/gu) ?? [];
  for (const run of hanRuns) {
    for (let i = 0; i < Math.max(1, run.length - 1); i++) {
      terms.add(run.slice(i, i + 2));
    }
  }
  return terms;
}

/**
 * 级联遗忘与纠正屏蔽算法：
 * 追踪被遗忘记录或被覆盖记录的祖先链，
 * 并向前扩展到同一个 requestId 的 assistant 回复以及下游派生记忆。
 */
export function resolveBlockedSources(params: {
  records: MemoryRecord[];
  evidence: Record<string, SourceEvidenceItem>;
  forgottenSourceIds: string[];
}): Set<string> {
  const blocked = new Set<string>(params.forgottenSourceIds);

  const correctedKeys = new Set(
    params.records.filter((r) => r.sourceType === 'user_correction').map((r) => r.key ?? r.id),
  );

  for (const record of params.records) {
    if (record.status === 'forgotten') {
      for (const s of record.sourceIds) blocked.add(s);
    } else if (record.status === 'superseded' && record.key && correctedKeys.has(record.key)) {
      for (const s of record.sourceIds) blocked.add(s);
    }
  }

  // 级联向前屏蔽
  while (true) {
    const beforeSize = blocked.size;

    const requests = new Set<string>();
    for (const [id, row] of Object.entries(params.evidence)) {
      if (blocked.has(id) && row.requestId) {
        requests.add(row.requestId);
      }
    }

    for (const row of Object.values(params.evidence)) {
      if (row.role === 'assistant' && row.requestId && requests.has(row.requestId)) {
        blocked.add(row.id);
      }
    }

    for (const record of params.records) {
      if (record.sourceType !== 'user_correction') {
        if (record.sourceIds.some((s) => blocked.has(s))) {
          blocked.add(record.id);
        }
      }
    }

    if (blocked.size === beforeSize) {
      break;
    }
  }

  return blocked;
}

/**
 * 严格来源门禁检查：
 * 如果一条记忆的来源全部由 assistant 角色产生，或者来自未经确认的推测，
 * 绝不允许将其标记为事实，强制将其归类为 'belief'。
 */
export function validateMemorySourceKind(params: {
  kind: MemoryRecord['kind'];
  sourceType: MemoryRecord['sourceType'];
  sourceIds: string[];
  evidence: Record<string, SourceEvidenceItem>;
}): MemoryRecord['kind'] {
  if (params.sourceType === 'user_correction') {
    return 'correction';
  }

  if (params.sourceIds.length > 0) {
    const isAllAssistant = params.sourceIds.every(
      (id) => params.evidence[id]?.role === 'assistant',
    );
    if (isAllAssistant && params.kind !== 'belief') {
      // 降级为 belief，不能伪造为事实
      return 'belief';
    }
  }

  return params.kind;
}

/**
 * 记忆相关性排序与 24,000 字符预算裁剪流水线
 */
export function rankAndBudgetMemories(params: {
  records: MemoryRecord[];
  blockedSources: Set<string>;
  query: string;
  charBudget?: number;
}): MemoryRecord[] {
  const budget = params.charBudget ?? 24_000;
  const queryTerms = extractSearchTerms(params.query);

  const activeRecords = params.records.filter((r) => {
    if (r.status !== 'active') return false;
    if (r.sourceType === 'user_correction') return true;
    if (params.blockedSources.has(r.id)) return false;
    if (r.sourceIds.some((s) => params.blockedSources.has(s))) return false;
    return true;
  });

  const scored = activeRecords.map((record) => {
    const itemTerms = extractSearchTerms(record.text);
    let matchCount = 0;
    for (const qt of queryTerms) {
      if (itemTerms.has(qt)) matchCount++;
    }

    let weight = record.importance ?? 1;
    if (record.sourceType === 'user_correction') weight += 100;
    if (record.kind === 'commitment') weight += 50;
    if (record.kind === 'preference') weight += 20;

    return { record, score: matchCount * 10 + weight };
  });

  scored.sort((a, b) => b.score - a.score);

  const result: MemoryRecord[] = [];
  let usedChars = 0;

  for (const { record } of scored) {
    const itemLen = JSON.stringify(record).length;
    if (usedChars + itemLen <= budget) {
      result.push(record);
      usedChars += itemLen;
    }
  }

  return result;
}
