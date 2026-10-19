import type { ActorAgentState, PlayerDecisionKind } from './agent-runtime.ts';

export type PlayerReplyTarget = {
  questionId: string | null;
  questionSourceId: string | null;
  responsibilityId: string | null;
  responsibilityRevision: number | null;
};
export type PlayerInputInterpretation =
  | { kind: 'new_request' | 'topic_change' | 'uncertain'; sourceId: string; quote: string }
  | {
      kind: 'related_reply';
      sourceId: string;
      quote: string;
      replies: (PlayerReplyTarget & {
        relation: 'answer' | 'decline_to_answer' | 'defer_answer';
        decision: PlayerDecisionKind | null;
      })[];
    };
export type PlayerInterpretationScope = {
  state: Pick<ActorAgentState, 'responsibilities' | 'questions' | 'focus'>;
  input: { origin: string; sourceId: string; text: string };
  channel: { kind: 'private' | 'group' | 'scene'; threadId: string };
  authorizedSourceIds?: ReadonlySet<string>;
};
/** Topic links are evidence already persisted by the kernel, never a model-created join. */
export function playerReplyTargets(scope: PlayerInterpretationScope): PlayerReplyTarget[] {
  if (scope.input.origin !== 'player') return [];
  const visible = (id: string) => !scope.authorizedSourceIds || scope.authorizedSourceIds.has(id);
  const responsibilities = new Map(
    scope.state.responsibilities
      .filter(
        (r) =>
          ['open', 'waiting', 'deferred'].includes(r.status) &&
          r.waitingOn === 'player' &&
          r.sourceIds.every(visible),
      )
      .map((r) => [r.id, r]),
  );
  const targets: PlayerReplyTarget[] = (scope.state.questions ?? [])
    .filter(
      (q) =>
        q.status === 'open' &&
        q.channel === scope.channel.kind &&
        q.threadId === scope.channel.threadId &&
        visible(q.sourceId) &&
        q.sourceId !== scope.input.sourceId,
    )
    .map((q) => {
      const responsibility = q.responsibilityId
        ? responsibilities.get(q.responsibilityId)
        : undefined;
      return {
        questionId: q.id,
        questionSourceId: q.sourceId,
        responsibilityId: responsibility?.id ?? null,
        responsibilityRevision: responsibility ? (responsibility.revision ?? 0) : null,
      };
    });
  const focus = scope.state.focus;
  if (
    focus?.channel === scope.channel.kind &&
    focus.threadId === scope.channel.threadId &&
    focus.subjectId
  ) {
    const r = responsibilities.get(focus.subjectId);
    // A focus with a question source must prove that question in the current channel.
    const focusedQuestion = focus.questionSourceId
      ? targets.find(
          (t) => t.questionSourceId === focus.questionSourceId && t.responsibilityId === r?.id,
        )
      : undefined;
    if (
      r &&
      (!focus.questionSourceId || focusedQuestion) &&
      !targets.some((t) => t.responsibilityId === r.id)
    )
      targets.push({
        questionId: null,
        questionSourceId: null,
        responsibilityId: r.id,
        responsibilityRevision: r.revision ?? 0,
      });
  }
  return targets;
}
/** A single semantic choice yields question progress and player decisions together. */
export function bindPlayerInputInterpretation(
  scope: PlayerInterpretationScope,
  interpretation: PlayerInputInterpretation | null,
) {
  const fail = (): never => {
    throw Error('PLAYER_INPUT_INTERPRETATION_SCOPE');
  };
  if (scope.input.origin !== 'player') {
    if (interpretation !== null) fail();
    return [];
  }
  if (!interpretation) return fail();
  if (
    interpretation.sourceId !== scope.input.sourceId ||
    !interpretation.quote.trim() ||
    !scope.input.text.includes(interpretation.quote)
  )
    return fail();
  if (interpretation.kind !== 'related_reply') return [];
  const targets = playerReplyTargets(scope);
  const seen = new Set<string>();
  const decided = new Set<string>();
  if (!interpretation.replies.length || interpretation.replies.length > 16) fail();
  for (const reply of interpretation.replies) {
    const matched = targets.find(
      (t) =>
        t.questionId === reply.questionId &&
        t.questionSourceId === reply.questionSourceId &&
        t.responsibilityId === reply.responsibilityId &&
        t.responsibilityRevision === reply.responsibilityRevision,
    );
    const key = JSON.stringify([reply.questionId, reply.responsibilityId]);
    if (!matched || seen.has(key) || (reply.decision !== null && !matched.responsibilityId)) fail();
    // Declining to provide information is not the same act as declining the underlying request.
    if (reply.decision !== null) {
      if (
        reply.relation === 'decline_to_answer' ||
        (reply.relation === 'defer_answer' && !['deferred', 'undecided'].includes(reply.decision))
      )
        fail();
      if (decided.has(reply.responsibilityId!)) fail();
      decided.add(reply.responsibilityId!);
    }
    seen.add(key);
  }
  return interpretation.replies;
}
