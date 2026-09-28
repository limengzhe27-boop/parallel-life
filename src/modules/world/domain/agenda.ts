import type { WorldState } from './types.ts';

/**
 * What is still open in a life. The director uses this to decide who acts next, so
 * beats are driven by unfinished business rather than by a round-robin: someone owes
 * the protagonist a reply, or a proposed appointment is still waiting.
 *
 * Pure and deterministic — the same world always produces the same agenda.
 */
export type AgendaThread = {
  kind: 'awaiting_reply' | 'proposed_appointment' | 'commitment';
  actorId: string;
  detail: string;
};

/** The minimum a memory must expose to become an agenda thread. */
export type CommitmentMemory = {
  scopeType: string;
  characterId?: string;
  kind: string;
  text: string;
  status: string;
};

export function buildAgenda(
  state: WorldState,
  limit = 5,
  memories: CommitmentMemory[] = [],
): AgendaThread[] {
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
      const firstNotice = state.messages.findIndex(
        (message) => message.sourceEventId === appointment.sourceEventId,
      );
      if (
        firstNotice >= 0 &&
        state.messages
          .slice(firstNotice + 1)
          .some(
            (message) =>
              message.actorId === participantId &&
              message.role === 'assistant' &&
              message.sourceEventId !== appointment.sourceEventId,
          )
      )
        continue;
      threads.push({
        kind: 'proposed_appointment',
        actorId: participantId,
        detail: `还有一条没定下来的约定：${appointment.title}`,
      });
    }
  }
  /* What a character promised the protagonist is unfinished business too. */
  for (const memory of memories) {
    if (memory.kind !== 'commitment' || memory.status !== 'active') continue;
    if (memory.scopeType !== 'character' || !memory.characterId) continue;
    if (!actorIds.has(memory.characterId)) continue;
    threads.push({
      kind: 'commitment',
      actorId: memory.characterId,
      detail: `他之前答应过你：${memory.text.slice(0, 80)}`,
    });
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
