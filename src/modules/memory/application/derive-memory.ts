import { validateMemorySourceKind, type SourceEvidenceItem } from '../domain/algorithms.ts';
import { DomainError } from '../domain/errors.ts';
import type { MemoryKind, MemoryRecord, MemoryScope, MemorySourceType } from '../domain/types.ts';

export interface DeriveMemoryInput {
  ownerId: string;
  scopeType: MemoryScope;
  scopeId: string;
  branchId?: string;
  characterId?: string;
  text: string;
  key?: string;
  kind: MemoryKind;
  sourceType: MemorySourceType;
  sourceIds: string[];
  importance?: number;
  evidence: Record<string, SourceEvidenceItem>;
}

/**
 * 记忆推导服务：
 * 从对话与事件中提取记忆，坚守来源门禁：
 * - 纯助手来源强制降级为 'belief' / 'agent_inference'，不能冒充客观事实。
 * - 用户纠正显式赋予 'correction'。
 * - 原始证据消息只读，绝不篡改。
 */
export function deriveMemory(input: DeriveMemoryInput): MemoryRecord {
  if (!input.text.trim()) {
    throw new DomainError('INVALID_COMMAND', 'Memory text cannot be empty');
  }
  if (!input.sourceIds.length) {
    throw new DomainError('INVALID_COMMAND', 'Memory must have at least one source evidence id');
  }

  // 1. 严格来源门禁校验：如果全由助手生成，强制降级
  const validatedKind = validateMemorySourceKind({
    kind: input.kind,
    sourceType: input.sourceType,
    sourceIds: input.sourceIds,
    evidence: input.evidence,
  });

  const finalSourceType: MemorySourceType =
    validatedKind === 'belief' && input.sourceType !== 'user_statement'
      ? 'agent_inference'
      : input.sourceType;

  const importance = Math.min(Math.max(input.importance ?? 5, 1), 10);

  return {
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    branchId: input.branchId,
    characterId: input.characterId,
    kind: validatedKind,
    text: input.text.trim(),
    key: input.key?.trim() || undefined,
    sourceType: finalSourceType,
    sourceIds: [...new Set(input.sourceIds)],
    status: 'active',
    importance,
    createdAt: new Date().toISOString(),
  };
}
