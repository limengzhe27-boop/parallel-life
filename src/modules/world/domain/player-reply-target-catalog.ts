import {
  playerReplyTargets,
  type PlayerInputInterpretation,
  type PlayerInterpretationScope,
} from './agent-input-interpretation.ts';
import type { PlayerDecisionKind } from './agent-runtime.ts';

export type CompactPlayerReply = {
  targetRef: string;
  relation: 'answer' | 'decline_to_answer' | 'defer_answer';
  decision: PlayerDecisionKind | null;
};
export type CompactPlayerInterpretation = {
  kind: 'related_reply';
  sourceId: string;
  quote: string;
  replies: CompactPlayerReply[];
};
/** Ephemeral aliases use the original, authorized snapshot; never persist or rebase them. */
export function playerReplyTargetCatalog(scope: PlayerInterpretationScope) {
  return playerReplyTargets(scope).map((target, index) => ({
    ref: `reply:${index + 1}`,
    questionId: target.questionId,
    responsibilityId: target.responsibilityId,
  }));
}

/** A question-only target can record an answer but has no decision to update. */
export function expandCompactPlayerInterpretation(
  scope: PlayerInterpretationScope,
  interpretation: CompactPlayerInterpretation,
): PlayerInputInterpretation {
  const targets = playerReplyTargets(scope);
  return {
    kind: 'related_reply',
    sourceId: interpretation.sourceId,
    quote: interpretation.quote,
    replies: interpretation.replies.map(({ targetRef, relation, decision }) => {
      if (!/^reply:[1-9]\d*$/.test(targetRef)) throw Error('NPC_REPLY_TARGET_REFERENCE');
      const index = Number(targetRef.slice(6)) - 1;
      const target = targets[index];
      if (!target || !Number.isSafeInteger(index)) throw Error('NPC_REPLY_TARGET_REFERENCE');
      return { ...target, relation, decision: target.responsibilityId ? decision : null };
    }),
  };
}
