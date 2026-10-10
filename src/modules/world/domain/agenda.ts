import { worldDateTimeLabel } from './display-time.ts';
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
    | 'commitment'
    | 'disclosure_followup'
    | 'departure_inquiry'
    | 'reconnect';
  actorId: string;
  detail: string;
  /** Only choice threads need a source marker for exact acknowledgement. */
  sourceId?: string;
  /** Saved dated milestone, kept separate from choice acknowledgement markers. */
  basisId?: string;
  basisAt?: string;
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
      if (
        appointment.status === 'confirmed' &&
        Date.parse(appointment.at) <= Date.parse(state.time)
      ) {
        if (
          state.messages.some(
            (message) =>
              message.actorId === participantId &&
              message.role === 'assistant' &&
              message.sourceEventId !== appointment.sourceEventId &&
              Date.parse(message.at) >= Date.parse(appointment.at),
          )
        )
          continue;
        const venue = state.space?.places.find((p) => p.appointmentIds.includes(appointment.id));
        const detail = venue
          ? state.space?.currentPlaceId === venue.id
            ? `你们明确约在「${venue.name}」的「${appointment.title}」原定于${worldDateTimeLabel(appointment.at)}，时间已到，主角此刻就在${venue.name}。作为约定参与者，在现场自然碰面或开启当面交流；绝不能声称主角迟到或失约。`
            : `你们明确约在「${venue.name}」的「${appointment.title}」原定于${worldDateTimeLabel(appointment.at)}，时间已到或已过，但主角尚未到达约定现场。作为等待的参与者，你可以询问主角是否路上耽搁或需要改期；你不知道主角去了哪里，绝不能无端指责主角故意失约，也不能假装主角已经到场。`
          : `你们明确约好的「${appointment.title}」原定于${worldDateTimeLabel(appointment.at)}，这个节点现在已到或已过。承接这件事当前可做的调整或后续，不假装刚发邀请、不继续催赴已经过时的约；没有到场或结果记录时不能声称已经发生、失约或完成。`;
        threads.push({
          kind: 'appointment_due',
          actorId: participantId,
          basisId: appointment.id,
          basisAt: appointment.at,
          detail,
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
          basisId: appointment.id,
          basisAt: appointment.responseAt,
          detail: `用户已在日历明确标记「${appointment.title}」${appointment.status === 'attended' ? '已赴约' : '未赴约'}。只承接这个结果，别编造现场细节。`,
        });
        continue;
      }
      if (appointment.status !== 'proposed' || Date.parse(appointment.at) <= Date.parse(state.time))
        continue;
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
        basisId: appointment.id,
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
  for (const fact of state.facts) {
    if (!fact.disclosure || !fact.believedByActorId) continue;
    if (!actorIds.has(fact.believedByActorId)) continue;
    const sourceTurn = state.messages.find(
      (message) => message.sourceEventId === fact.sourceEventId && message.role === 'assistant',
    );
    if (!sourceTurn?.sourceVersion) continue;
    if (
      state.messages.some(
        (message) =>
          message.actorId === fact.believedByActorId &&
          message.role === 'assistant' &&
          (message.sourceVersion ?? 0) > sourceTurn.sourceVersion!,
      )
    )
      continue;
    threads.push({
      kind: 'disclosure_followup',
      actorId: fact.believedByActorId,
      detail: `你是从${state.actors.find((actor) => actor.id === fact.disclosure?.fromActorId)?.name ?? '另一位人物'}那里听到主角说过「${fact.disclosure.quote}」，不是主角亲自告诉你。是否向主角提起，取决于你的性格和关系；若提起必须说清消息来源，不能声称自己亲眼见过。`,
    });
  }
  for (const fact of state.facts) {
    if (fact.kind !== 'canonical' || fact.visibility.kind !== 'actors') continue;
    const isDeparture =
      fact.departure !== undefined || fact.text.includes('亲眼看到主角离开了');
    if (!isDeparture) continue;
    for (const actorId of fact.visibility.actorIds) {
      if (!actorIds.has(actorId)) continue;
      const departureVersion =
        fact.departure?.eventVersion ??
        (state.space?.positionSource.kind === 'travel' &&
        state.space.positionSource.eventId === fact.sourceEventId
          ? state.space.positionSource.eventVersion
          : 0);
      const alreadySpoke = state.messages.some(
        (message) =>
          message.actorId === actorId &&
          message.role === 'assistant' &&
          (departureVersion > 0
            ? (message.sourceVersion ?? 0) >= departureVersion
            : message.sourceEventId !== fact.sourceEventId),
      );
      if (alreadySpoke) continue;
      const fromPlaceName =
        fact.departure?.fromPlaceName ??
        fact.text.match(/离开了(.+?)，没有/)?.[1] ??
        '现场';
      threads.push({
        kind: 'departure_inquiry',
        actorId,
        basisId: fact.id,
        detail: `你亲眼看到主角离开了${fromPlaceName}，没有获知目的地。基于你们的关系与现场情况，可以询问主角去向；绝不能假装知道目的地。`,
      });
    }
  }
  // An established relationship can make one quiet, low-pressure check-in
  // after a day apart. Never treat an unopened world or an unanswered cold
  // opening as consent to keep pinging the player.
  const DAY = 24 * 60 * 60_000;
  for (const actor of state.actors) {
    const conversation = state.messages.filter((message) => message.actorId === actor.id);
    const latest = conversation.at(-1);
    if (!latest || latest.role !== 'assistant') continue;
    const hasPlayerReply = conversation.some((message) => message.role === 'user');
    const silentFor = Date.parse(state.time) - Date.parse(latest.at);
    if (!Number.isFinite(silentFor) || silentFor < (hasPlayerReply ? DAY : 2 * DAY)) continue;
    const playerLine = [...conversation].reverse().find((message) => message.role === 'user');
    if (playerLine) {
      const sincePlayer = conversation.slice(conversation.lastIndexOf(playerLine) + 1);
      if (sincePlayer.filter((message) => message.role === 'assistant').length > 1) continue;
    } else if (conversation.length !== 1) continue;
    threads.push({
      kind: 'reconnect',
      actorId: actor.id,
      detail: playerLine
        ? `你们上次真实聊到「${playerLine.text.slice(0, 80)}」。已经隔了一段时间。只有符合你们的关系、你自己的生活和当时的话题时，才发一条自然的近况；不要催用户回复，也不要编造这期间他做过什么。`
        : `你之前只发过一句「${latest.text.slice(0, 80)}」，主角尚未回应。隔了几天，若你们关系与当时的话题确实值得承接，可以再说一句具体近况；这只允许一次，不催回复。`,
    });
  }
  return threads.slice(0, limit);
}

/** A new player answer deserves a response even if this person spoke recently.
 * Ordinary prompts still respect the cooldown; a single advance cannot use the
 * exception repeatedly: advanceWorld also gates later beats by story date and new sourced nodes.
 */
export function eligibleAgenda(
  agenda: AgendaThread[],
  recentActors: ReadonlySet<string>,
): AgendaThread[] {
  const owedNow = new Set<AgendaThread['kind']>([
    'awaiting_reply',
    'choice_result',
    'appointment_result',
    'departure_inquiry',
  ]);
  return agenda.filter((thread) => !recentActors.has(thread.actorId) || owedNow.has(thread.kind));
}

/** The most pressing thread for one character, if any. */
export function threadFor(agenda: AgendaThread[], actorId: string): AgendaThread | undefined {
  return (
    agenda.find((thread) => thread.actorId === actorId && thread.kind === 'awaiting_reply') ??
    agenda.find((thread) => thread.actorId === actorId && thread.kind === 'choice_result') ??
    agenda.find((thread) => thread.actorId === actorId && thread.kind === 'departure_inquiry') ??
    agenda.find((thread) => thread.actorId === actorId)
  );
}
