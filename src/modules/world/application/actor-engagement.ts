import type { ActorContext } from './ports.ts';

/** Creative direction only: never a goal, action permission or completion receipt. */
export const ACTOR_ENGAGEMENT_RULES = `先承接玩家当前的话和已经保存的聊天、现场经历及答复，再根据本人已有动机与已知事件判断是否自然提出一个小下一步。本人目标只从actor.persona、自己的设定/约定/记忆取材，knownMatters或worldMatters是你获准知道的事项状态，不能把玩家的事项自动当作你的目标，也不代表动作许可。人物可以主动请求、协商、提出帮助、表达不同意见或调整计划；不必每轮问问题，不新增无依据的任务。已明确回答、拒绝或已完成的内容不能重问或当成未处理；玩家拒绝、转话题或想休息时先接受这一边界，可解释本人限制、换方案或暂缓，不用惩罚/危机逼迫，也不当场换另一件事继续施压。玩家以后主动重提时可以重新商量，不把一次拒绝永久扩大为全部拒绝。现场和手机同一人物承接本人确实经历/听见的原话；复述引文时先辨认说话人：玩家原话中的“我”是玩家，转述应说“你”；本人原话中的“我”才是NPC。不要把玩家想休息改说成NPC想休息，不用“我们都”替玩家概括未明确表达的态度，也不从自己的动机推断玩家内心；记忆里的玩家输入或人物发言仅证明说过，不证明赴约、交付、成果或日历已经改变。推进须由原运行时保存的行动/事件与条件支持，不凭台词完成任务或奖励。幕后策略与来源编号不写进对白。`;

export function actorEngagementBrief(context: ActorContext) {
  return {
    version: 'actor-engagement-1' as const,
    ownMotivationSource: context.authoredLifeModules?.drives
      ? 'actor.persona and ownCharacterSettings.drives'
      : 'actor.persona',
    // Already clipped by actorContext. The full descriptions stay in the supplied knownMatters.
    knownMatterState: (context.matters ?? []).map(({ id, status, assertion }) => ({
      id,
      status,
      assertion,
    })),
    choiceState: (context.choices ?? []).map((choice) => ({
      id: choice.id,
      status: choice.status,
      statedIntent: choice.intent,
      ...(choice.result ? { reportedOutcome: choice.result.kind } : {}),
    })),
    progressIsReferenceNotExecutionPermission: true,
    responseOrder: ['current_input', 'saved_response_and_boundary', 'one_relevant_own_next_step'],
    quotedSpeechRoles: {
      playerQuote: { firstPerson: 'player', secondPerson: 'current_actor' },
      ownReplyQuote: { firstPerson: 'current_actor', secondPerson: 'player' },
    },
    mayPauseOwnGoal: true,
    mayRevisitOnlyWhenPlayerReopens: true,
  };
}
