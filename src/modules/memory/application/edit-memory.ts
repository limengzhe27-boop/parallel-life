import { resolveBlockedSources, type SourceEvidenceItem } from '../domain/algorithms.ts';
import { DomainError } from '../domain/errors.ts';
import type { MemoryRecord } from '../domain/types.ts';

export interface CorrectMemoryInput {
  ownerId: string;
  key: string;
  newText: string;
  scopeType: MemoryRecord['scopeType'];
  scopeId: string;
  branchId?: string;
  characterId?: string;
  sourceMessageIds: string[];
  existingRecords: MemoryRecord[];
}

export interface CorrectMemoryResult {
  newRecord: MemoryRecord;
  supersededRecords: MemoryRecord[];
}

export interface ForgetMemoryInput {
  ownerId: string;
  targetMemoryId: string;
  existingRecords: MemoryRecord[];
  evidence: Record<string, SourceEvidenceItem>;
}

export interface ForgetMemoryResult {
  forgottenRecord: MemoryRecord;
  blockedSources: Set<string>;
  cascadedRecordIds: string[];
}

/**
 * 用户主动纠正与遗忘服务：
 * 遵循 Python Kit 经审阅的核心规范：
 * 1. 用户纠正优先：旧记录标记为 superseded，新记录以 user_correction 优先呈现。
 * 2. 级联遗忘：被遗忘记忆的相关助手回声与下游派生推测全部进入屏蔽集。
 */
export function correctMemory(input: CorrectMemoryInput): CorrectMemoryResult {
  if (!input.newText.trim()) {
    throw new DomainError('INVALID_COMMAND', 'Corrected memory text cannot be empty');
  }
  if (!input.key.trim()) {
    throw new DomainError('INVALID_COMMAND', 'Memory key is required for correction');
  }

  // 找出需要被覆盖的同 key 活跃旧记录
  const supersededRecords: MemoryRecord[] = [];
  for (const record of input.existingRecords) {
    if (
      record.ownerId === input.ownerId &&
      record.key === input.key &&
      record.status === 'active'
    ) {
      supersededRecords.push({
        ...record,
        status: 'superseded',
      });
    }
  }

  const newRecord: MemoryRecord = {
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    branchId: input.branchId,
    characterId: input.characterId,
    kind: 'correction',
    text: input.newText.trim(),
    key: input.key.trim(),
    sourceType: 'user_correction',
    sourceIds: [...new Set(input.sourceMessageIds)],
    status: 'active',
    importance: 10, // 用户直接纠正具有最高置信度与重要性
    createdAt: new Date().toISOString(),
  };

  return {
    newRecord,
    supersededRecords,
  };
}

export function forgetMemory(input: ForgetMemoryInput): ForgetMemoryResult {
  const target = input.existingRecords.find(
    (r) => r.id === input.targetMemoryId && r.ownerId === input.ownerId,
  );
  if (!target) {
    throw new DomainError('NOT_FOUND', `Memory ${input.targetMemoryId} not found`);
  }

  const forgottenRecord: MemoryRecord = {
    ...target,
    status: 'forgotten',
  };

  const updatedRecords = input.existingRecords.map((r) =>
    r.id === target.id ? forgottenRecord : r,
  );

  // 计算级联遗忘屏蔽集
  const blockedSources = resolveBlockedSources({
    records: updatedRecords,
    evidence: input.evidence,
    forgottenSourceIds: target.sourceIds,
  });

  // 级联找出因被屏蔽来源而受影响的下游派生记录
  const cascadedRecordIds = updatedRecords
    .filter(
      (r) =>
        r.id !== target.id &&
        r.status === 'active' &&
        r.sourceType !== 'user_correction' &&
        r.sourceIds.some((s) => blockedSources.has(s)),
    )
    .map((r) => r.id);

  return {
    forgottenRecord,
    blockedSources,
    cascadedRecordIds,
  };
}
