import type {
  InteractEvent,
  InteractRequest,
  InteractResponse,
} from '../../../contracts/world-interaction.ts';
import {
  dialogueSentences,
  selectReviewedDialogue,
  type DialogueReview,
} from '../../ai/dialogue-reviewer.ts';
import { DomainError } from '../domain/errors.ts';
import type { WorldState } from '../domain/types.ts';
import { actorContext } from './actor-context.ts';
import { routeUserIntent } from './intent-router.ts';

export interface DialogueGeneratorPort {
  generateDraft(prompt: string): Promise<string>;
  reviewDraft?(prompt: string): Promise<DialogueReview>;
}

/**
 * 角色单次回合交互编排用例
 */
export async function resolveInteractTurn(params: {
  request: InteractRequest;
  state: WorldState;
  generator: DialogueGeneratorPort;
}): Promise<InteractResponse> {
  const { request, state, generator } = params;

  // 1. 验证目标角色存在
  const actor = state.actors.find((a) => a.id === request.characterId);
  if (!actor) {
    throw new DomainError('NOT_FOUND', `Actor ${request.characterId} not found`);
  }

  // 2. 意图路由分类
  const intent = routeUserIntent({
    text: request.text,
    imageRequest: request.imageRequest,
    userAction: request.userAction,
  });

  // 3. 提取带权限过滤和预算裁剪的角色上下文
  const context = actorContext(state, actor.id, request.text);

  // 4. 模拟或真实调用模型生成角色对白草稿
  const prompt = [
    `角色人设: ${actor.persona}`,
    `当前时间: ${context.time}`,
    `历史对话数: ${context.messages.length}`,
    `用户说: ${request.text}`,
  ].join('\n');

  let replyText: string | undefined;
  let replyStatus: 'ready' | 'failed' | 'not_requested' = 'ready';
  const errors: string[] = [];

  try {
    const rawDraft = await generator.generateDraft(prompt);
    const sentences = dialogueSentences(rawDraft);

    if (sentences.length === 0) {
      replyStatus = 'failed';
      errors.push('empty_dialogue_draft');
    } else if (generator.reviewDraft) {
      // 触发删除式校稿
      const review = await generator.reviewDraft(rawDraft);
      replyText = selectReviewedDialogue(sentences, review);
    } else {
      replyText = rawDraft;
    }
  } catch (err: unknown) {
    replyStatus = 'failed';
    errors.push(err instanceof Error ? err.message : String(err));
  }

  // 5. 按照意图模式决定是否推进世界版本
  const newEvents: InteractEvent[] = [];
  const now = new Date().toISOString();

  if (replyText) {
    newEvents.push({
      id: crypto.randomUUID(),
      kind: 'message',
      description: `${actor.name}: ${replyText}`,
      payload: { actorId: actor.id, text: replyText },
      at: now,
    });
  }

  let newWorldVersion = state.version;
  const newConversationVersion = request.conversationVersion + 1;

  if (intent.turnMode === 'world') {
    newWorldVersion += 1;
    newEvents.push({
      id: crypto.randomUUID(),
      kind: 'action',
      description: `Action executed: ${JSON.stringify(request.userAction)}`,
      payload: request.userAction ?? {},
      at: now,
    });
  }

  return {
    turnMode: intent.turnMode,
    replyStatus,
    replyText,
    characterId: actor.id,
    worldVersion: newWorldVersion,
    conversationVersion: newConversationVersion,
    events: newEvents,
    errors,
    media:
      intent.turnMode === 'image'
        ? {
            status: 'queued',
            subject: intent.imagePrompt,
            jobId: crypto.randomUUID(),
          }
        : undefined,
  };
}
