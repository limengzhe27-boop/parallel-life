import type { ActorAgentState, AgentInputReceipt } from './agent-runtime.ts';
import type { CommittedAwarenessEvent, DirectorPendingReason } from './world-awareness.ts';

/** A real answer is information progress, never an accepted invitation or completed action. */
export function questionProgressReason(
  event: CommittedAwarenessEvent,
  previous: ActorAgentState | undefined,
  input: AgentInputReceipt | undefined,
  assessmentStoryAt?: string,
): (DirectorPendingReason & { actorId: string }) | null {
  const data = event.data as any,
    runtime = data?.agentRuntime;
  if (
    !previous ||
    !input ||
    input.origin !== 'player' ||
    (!!input.recipientActorId && input.recipientActorId !== previous.actorId) ||
    input.worldId !== event.worldId ||
    ![
      'turn.resolved',
      'agent.state_committed',
      'group.turn_resolved',
      'scene.reaction_recorded',
    ].includes(event.type) ||
    (data.stream && data.stream.unit !== 'final') ||
    runtime?.inputReceiptId !== input.id ||
    previous.worldId !== event.worldId ||
    previous.actorId !== data.actorId ||
    runtime.stateAfter?.worldId !== event.worldId ||
    runtime.stateAfter.actorId !== previous.actorId ||
    runtime.stateAfter.projectedWorldVersion !== event.version ||
    !Array.isArray(runtime.questionChanges)
  )
    return null;
  // Questions are interpreted against the immutable model snapshot, while the
  // final append may occur later as world time continues during generation.
  const assessmentAt = assessmentStoryAt ?? input.storyAt;
  const assessed = Date.parse(assessmentAt),
    received = Date.parse(input.storyAt),
    committed = Date.parse(event.storyAt ?? '');
  if (
    !Number.isFinite(assessed) ||
    !Number.isFinite(received) ||
    !Number.isFinite(committed) ||
    assessed < received ||
    assessed > committed ||
    runtime.inputStoryAt !== input.storyAt
  )
    return null;
  const waitingPlan = previous.plans.some(
    (p) =>
      ['waiting', 'blocked'].includes(p.status) &&
      previous.goals.some(
        (g) => g.id === p.goalId && !['fulfilled', 'withdrawn'].includes(g.status),
      ),
  );
  const changes = runtime.questionChanges.filter((change: any) => {
    if (
      change.replayed !== false ||
      change.statusBefore !== 'open' ||
      change.statusAfter !== 'answered' ||
      !['answer', 'decline_to_answer'].includes(change.relation) ||
      typeof change.quote !== 'string' ||
      !change.quote.trim() ||
      !input.text.includes(change.quote) ||
      change.at !== assessmentAt ||
      !Array.isArray(change.sourceIds) ||
      change.sourceIds.length !== 1 ||
      change.sourceIds[0] !== input.id
    )
      return false;
    const old = previous.questions?.find((q) => q.id === change.questionId);
    const next = runtime.stateAfter.questions?.find((q: any) => q.id === change.questionId);
    const responsibility =
      old?.responsibilityId &&
      previous.responsibilities.find(
        (r) =>
          r.id === old.responsibilityId &&
          r.waitingOn === 'player' &&
          ['open', 'waiting', 'deferred'].includes(r.status),
      );
    return (
      (waitingPlan || responsibility) &&
      old?.status === 'open' &&
      old.sourceId === change.questionSourceId &&
      old.channel === input.channel &&
      old.threadId === input.threadId &&
      next?.status === 'answered' &&
      next.sourceId === old.sourceId &&
      next.resolution?.sourceId === input.id &&
      next.resolution.quote === change.quote &&
      next.resolution.kind === change.relation &&
      next.resolution.at === change.at &&
      runtime.proposal?.replyAssessments?.some(
        (r: any) =>
          r.questionId === old.id &&
          r.sourceId === input.id &&
          r.quote === change.quote &&
          r.relation === change.relation,
      )
    );
  });
  if (!changes.length) return null;
  return {
    id: `${event.id}:cross_impact:${event.id}`,
    eventId: event.id,
    worldVersion: event.version,
    kind: 'cross_impact',
    ref: { kind: 'event', id: event.id },
    actorId: previous.actorId,
  };
}
