import { DomainError } from '../domain/errors.ts';
import type { Fact, Message, WorldState } from '../../world/domain/types.ts';
import { rankAndBudgetMemories } from '../domain/algorithms.ts';
import type { MemoryRecord } from '../domain/types.ts';

export interface CompiledCharacterContext {
  character: {
    id: string;
    name: string;
    persona: string;
  };
  world: {
    id: string;
    version: number;
    time: string;
    title: string;
  };
  visibleFacts: Fact[];
  recentDialogue: Message[];
  retrievedMemories: MemoryRecord[];
  totalChars: number;
}

const CONTEXT_BUDGET_CHARS = 24_000;
const RECENT_DIALOGUE_LIMIT = 20;

/**
 * 角色对话上下文编译器：
 * 统一作为消息、相册、日历应用的唯一世界事实投影与记忆召回管道。
 * 遵循：权限过滤 -> 遗忘屏蔽 -> 分支隔离 -> 24k 字符预算裁剪。
 */
export function compileCharacterContext(params: {
  ownerId: string;
  worldState: WorldState;
  characterId: string;
  queryText: string;
  memoryRecords: MemoryRecord[];
  blockedSources: Set<string>;
}): CompiledCharacterContext {
  const { ownerId, worldState, characterId, queryText, memoryRecords, blockedSources } = params;

  // 1. 验证世界归属与角色存在
  if (worldState.ownerId !== ownerId) {
    throw new DomainError('FORBIDDEN', 'World owner mismatch');
  }

  const actor = worldState.actors.find((a) => a.id === characterId);
  if (!actor) {
    throw new DomainError('NOT_FOUND', `Character ${characterId} not found in world`);
  }

  // 2. 过滤该角色可见的世界事实（公开事实或该角色参与的事实）
  const visibleFacts = worldState.facts.filter((fact) => {
    if (fact.visibility.kind === 'world') return true;
    if (fact.visibility.kind === 'actors' && fact.visibility.actorIds.includes(characterId)) {
      return true;
    }
    return false;
  });

  // 3. 严格隔离私聊：只获取当前用户与该角色的对话，绝不包含其他角色的私密对话
  const characterMessages = worldState.messages.filter((m) => m.actorId === characterId);
  const recentDialogue = characterMessages.slice(-RECENT_DIALOGUE_LIMIT);

  // 4. 记忆召回与预算裁剪（作用域限制在 branch 或 character 自身，并排除被屏蔽的来源）
  const scopedMemories = memoryRecords.filter((record) => {
    if (record.ownerId !== ownerId) return false;
    // 分支隔离：若作用域是 branch 或指定了 branchId，必须与当前世界一致
    if (
      record.scopeType === 'branch' &&
      (record.scopeId !== worldState.id || record.kind === 'episode')
    )
      return false;
    if (record.branchId && record.branchId !== worldState.id) return false;
    // 角色隔离：若作用域是 character 或指定了 characterId，必须与当前角色一致
    if (
      record.scopeType === 'character' &&
      record.characterId &&
      record.characterId !== characterId
    ) {
      return false;
    }
    return true;
  });

  const budgetedMemories = rankAndBudgetMemories({
    records: scopedMemories,
    blockedSources,
    query: queryText,
    charBudget: 12_000, // 留出 12k 给对话与设定
  });

  const compiled: CompiledCharacterContext = {
    character: {
      id: actor.id,
      name: actor.name,
      persona: actor.persona,
    },
    world: {
      id: worldState.id,
      version: worldState.version,
      time: worldState.time,
      title: worldState.title,
    },
    visibleFacts,
    recentDialogue,
    retrievedMemories: budgetedMemories,
    totalChars: 0,
  };

  compiled.totalChars = JSON.stringify(compiled).length;

  if (compiled.totalChars > CONTEXT_BUDGET_CHARS) {
    // 若极端情况仍超限，修剪历史对话
    while (compiled.recentDialogue.length > 5 && compiled.totalChars > CONTEXT_BUDGET_CHARS) {
      compiled.recentDialogue.shift();
      compiled.totalChars = JSON.stringify(compiled).length;
    }
  }

  return compiled;
}
