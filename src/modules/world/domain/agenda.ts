import type { WorldState } from './types.ts';

/**
 * What is still open in a life. The director uses this to decide who acts next, so
 * beats are driven by unfinished business rather than by a round-robin: someone owes
 * the protagonist a reply, or a proposed appointment is still waiting.
 *
 * Pure and deterministic — the same world always produces the same agenda.
 */
export type AgendaThread = {
  kind:
    | 'awaiting_reply'
    | 'proposed_appointment'
    | 'appointment_due'
    | 'appointment_result'
    | 'choice_followup'
    | 'choice_result'
    | 'commitment';
  actorId: string;
  detail: string;
  /** Only choice threads need a source marker for exact acknowledgement. */
  sourceId?: string;
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
  for (const choice of [...(state.choices ?? [])].reverse()) {
    if (choice.status === 'superseded' || !actorIds.has(choice.actorId)) continue;
    if (choice.result && !choice.result.acknowledgedEventId) {
      const label =
        choice.result.kind === 'reported_done'
          ? '说自己已完成'
          : choice.result.kind === 'blocked'
            ? '说自己遇到阻碍'
            : '说自己决定放弃';
      threads.push({
        kind: 'choice_result',
        actorId: choice.actorId,
        sourceId: choice.id,
        detail: `用户对「${choice.quote}」${label}：「${choice.result.quote}」。这是用户自述，不是你已核实的结果。给出你真实知道的回应或下一步，不编造完成证据。`,
      });
      continue;
    }
    if (choice.status !== 'pending' || choice.result) continue;
    threads.push({
      kind: 'choice_followup',
      actorId: choice.actorId,
      sourceId: choice.id,
      detail: `用户亲口决定「${choice.quote}」。你已在当时回应；这次只承接你后来实际能做的一小步或具体障碍，不能声称用户已经做完或取得结果。`,
    });
  }
  for (const appointment of state.appointments) {
    if (!['proposed', 'confirmed', 'attended', 'missed'].includes(appointment.status ?? ''))
      continue;
    for (const participantId of appointment.participantIds) {
      if (!actorIds.has(participantId)) continue;
      if (appointment.status === 'confirmed' && appointment.at <= state.time) {
        if (
          state.messages.some(
            (message) =>
              message.actorId === participantId &&
              message.role === 'assistant' &&
              message.sourceEventId !== appointment.sourceEventId &&
              message.at >= appointment.at,
          )
        )
          continue;
        threads.push({
          kind: 'appointment_due',
          actorId: participantId,
          detail: `你们约好的「${appointment.title}」时间到了。可以关心用户是否赴约，但不能声称已经发生。`,
        });
        continue;
      }
      if (appointment.status === 'attended' || appointment.status === 'missed') {
        if (!appointment.responseAt || !appointment.responseVersion) continue;
        if (
          state.messages.some(
            (message) =>
              message.actorId === participantId &&
              message.role === 'assistant' &&
              (message.sourceVersion ?? -1) > appointment.responseVersion!,
          )
        )
          continue;
        threads.push({
          kind: 'appointment_result',
          actorId: participantId,
          detail: `用户已在日历明确标记「${appointment.title}」${appointment.status === 'attended' ? '已赴约' : '未赴约'}。只承接这个结果，别编造现场细节。`,
        });
        continue;
      }
      if (appointment.status !== 'proposed') continue;
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

/** A new player answer deserves a response even if this person spoke recently.
 * Ordinary prompts still respect the cooldown; a single advance cannot use the
 * exception twice because selectSpeaker also tracks speakers for that advance.
 */
export function eligibleAgenda(
  agenda: AgendaThread[],
  recentActors: ReadonlySet<string>,
): AgendaThread[] {
  const owedNow = new Set<AgendaThread['kind']>([
    'awaiting_reply',
    'choice_result',
    'appointment_result',
  ]);
  return agenda.filter((thread) => !recentActors.has(thread.actorId) || owedNow.has(thread.kind));
}

/** The most pressing thread for one character, if any. */
export function threadFor(agenda: AgendaThread[], actorId: string): AgendaThread | undefined {
  return (
    agenda.find((thread) => thread.actorId === actorId && thread.kind === 'awaiting_reply') ??
    agenda.find((thread) => thread.actorId === actorId && thread.kind === 'choice_result') ??
    agenda.find((thread) => thread.actorId === actorId)
  );
}
