import type { ActorAgentState } from '../domain/agent-runtime.ts';

/** Search hints only, not new facts or a replacement for the original input.
 * Caller supplies this actor's authenticated narrative packet, never global author material. */
export function actorRetrievalQueries(input: {
  origin: string;
  state: ActorAgentState | null;
  actorId: string;
  threadId: string;
  narrative: readonly { sourceId: string; text: string; evidenceKind?: string }[];
  blockedSources: ReadonlySet<string>;
}): string[] {
  if (input.origin === 'player') return [];
  const visible = (id: string) =>
    !input.blockedSources.has(id) &&
    !input.blockedSources.has(id.replace(/^(?:message|fact|opening):/, ''));
  const hints: string[] = [];
  const add = (text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const hint = text.trim().slice(0, 600);
    if (!hints.includes(hint)) hints.push(hint);
  };
  for (const observation of input.narrative) {
    if (!visible(observation.sourceId) || observation.evidenceKind !== 'authored_context') continue;
    try {
      const outer = JSON.parse(observation.text);
      const report = typeof outer?.text === 'string' ? JSON.parse(outer.text) : outer;
      if (
        report?.type === 'received_opening_information' &&
        report.assertion === 'report' &&
        report.executionEvidence === false
      )
        add(report.content);
    } catch {
      /* An unrecognized packet is not an authorized topic shortcut. */
    }
    if (hints.length >= 4) break;
  }
  const state = input.state;
  if (state?.actorId === input.actorId) {
    for (const goal of state.goals)
      if (goal.status === 'active' && visible(goal.id) && goal.sourceIds.every(visible))
        add(goal.summary);
    for (const plan of state.plans)
      if (
        !['finished', 'withdrawn'].includes(plan.status) &&
        visible(plan.id) &&
        plan.sourceIds.every(visible)
      )
        add(plan.summary);
    const questions = (state.questions ?? []).filter(
      (q) =>
        q.status === 'open' &&
        q.channel === 'private' &&
        q.threadId === input.threadId &&
        visible(q.id) &&
        visible(q.sourceId),
    );
    for (const question of questions) add(question.text);
  }
  return hints.slice(0, 16);
}
