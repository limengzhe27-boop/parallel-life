import { worldDateTimeLabel } from './display-time.ts';
import type { SceneEntry } from './experience-rules.ts';
import { scenePrivateThought } from './scene-runtime.ts';

/** Quote saved conversation, never turn either participant's speech into a verified outcome. */
export function sceneConversationMemory(input: {
  actorId: string;
  storyAt: string;
  location: string;
  presentActorIds: readonly string[];
  action?: { id: string; text: string; sourceEventId: string };
  entries: readonly SceneEntry[];
  dialogues: readonly { actorId: string; text: string }[];
  observableResult: string;
  resultSourceEventId: string;
  blockedSources: ReadonlySet<string>;
}): { text: string; sourceIds: string[] } | null {
  const { actorId, action, blockedSources } = input;
  if (!input.presentActorIds.includes(actorId) || blockedSources.has(input.resultSourceEventId))
    return null;
  // A private thought has no hearer, even if a malformed caller supplied a wider audience.
  if (action && scenePrivateThought(action.text)) return null;
  if (
    action &&
    (blockedSources.has(action.id) ||
      blockedSources.has(action.sourceEventId) ||
      input.entries.some(
        (e) => e.kind === 'user_action' && e.actionId === action.id && blockedSources.has(e.id),
      ))
  )
    return null;
  const publicInput =
    action && !blockedSources.has(action.id) && !blockedSources.has(action.sourceEventId)
      ? input.entries.find(
          (e): e is Extract<SceneEntry, { kind: 'user_action' }> =>
            e.kind === 'user_action' &&
            e.actionId === action.id &&
            e.text === action.text &&
            e.sourceEventId === action.sourceEventId &&
            !blockedSources.has(e.id) &&
            e.observableTo.some((p) => p.kind === 'actor' && p.actorId === actorId),
        )
      : undefined;
  const ownReply = input.dialogues.find((d) => d.actorId === actorId)?.text;
  const units = [
    ...(publicInput ? ['玩家现场原文（说法不证明动作成功）：' + publicInput.text] : []),
    ...(ownReply ? ['本人现场发言（提议/台词不证明事件完成）：' + ownReply] : []),
    ...((!action || publicInput) && input.observableResult.trim()
      ? ['本轮可观察记录：' + input.observableResult.trim()]
      : []),
  ];
  const header =
    '现场原话记录（' + worldDateTimeLabel(input.storyAt) + ' · ' + input.location + '）';
  const kept: string[] = [];
  for (const unit of units) {
    // Preserve complete quotes; an oversized quote is omitted rather than losing a negation.
    if ([header, ...kept, unit].join('\n').length <= 4000) kept.push(unit);
  }
  if (!kept.length) return null;
  return {
    text: [header, ...kept].join('\n'),
    sourceIds: [
      input.resultSourceEventId,
      ...(publicInput && action ? [action.sourceEventId] : []),
    ],
  };
}
