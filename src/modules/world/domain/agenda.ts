import type { WorldState } from './types.ts';

/**
 * What is still open in a life. The director uses this to decide who acts next, so
 * beats are driven by unfinished business rather than by a round-robin: someone owes
 * the protagonist a reply, or a proposed appointment is still waiting.
 *
 * Pure and deterministic — the same world always produces the same agenda.
 */
export type AgendaThread = {
  kind: 'awaiting_reply' | 'proposed_appointment';
  actorId: string;
  detail: string;
};

export function buildAgenda(state: WorldState, limit = 5): AgendaThread[] {
  const threads: AgendaThread[] = [];
  const last = state.messages.at(-1);
  const actorIds = new Set(state.actors.map((actor) => actor.id));
  /* The protagonist just spoke to someone: that character owes an answer. */
  if (last?.role === 'user' && actorIds.has(last.actorId))
    threads.push({
      kind: 'awaiting_reply',
      actorId: last.actorId,
      detail: '你刚说过话，对方还没有回应',
    });
  for (const appointment of state.appointments) {
    if (appointment.status !== 'proposed') continue;
    for (const participantId of appointment.participantIds) {
      if (!actorIds.has(participantId)) continue;
      threads.push({
        kind: 'proposed_appointment',
        actorId: participantId,
        detail: `还有一条没定下来的约定：${appointment.title}`,
      });
    }
  }
  return threads.slice(0, limit);
}

/** The most pressing thread for one character, if any. */
export function threadFor(agenda: AgendaThread[], actorId: string): AgendaThread | undefined {
  return (
    agenda.find((thread) => thread.actorId === actorId && thread.kind === 'awaiting_reply') ??
    agenda.find((thread) => thread.actorId === actorId)
  );
}
