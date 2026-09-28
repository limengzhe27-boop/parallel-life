import { retainFacts } from './retention.ts';
import { DomainError } from './errors.ts';
import {
  parseProposal,
  isoInstant,
  validateCommand,
  validateEventId,
  isExplicitChoice,
  isExplicitChoiceResult,
} from './validation.ts';
import { validateCharacterEffects } from './character-policy.ts';
import type { WorldState, WorldEvent, OutboxJob } from './types.ts';

/** Pure reducer. All effects validate before the caller commits anything. */
export function applyEvent(
  current: WorldState,
  event: WorldEvent,
): { state: WorldState; jobs: OutboxJob[] } {
  if (event.worldId !== current.id || event.version !== current.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  if (event.schemaVersion !== 1 || event.type !== 'turn.resolved')
    throw new DomainError('INVALID_PROPOSAL');
  isoInstant(event.occurredAt);
  if (event.storyAt) isoInstant(event.storyAt);
  if (event.data.userAt) isoInstant(event.data.userAt);
  validateEventId(event.id);
  validateCommand({
    id: event.commandId,
    worldId: event.worldId,
    expectedVersion: current.version,
    actorId: event.data.actorId,
    text: event.data.userText,
    origin: event.data.origin,
  });
  const actorIds = new Set(current.actors.map((actor) => actor.id));
  if (!actorIds.has(event.data.actorId)) throw new DomainError('INVALID_COMMAND');
  const effects = parseProposal({ schemaVersion: 1, effects: event.data.effects }).effects;
  validateCharacterEffects(event.data.actorId, effects, true);
  const replyAt = event.storyAt ?? current.time;
  const userAt = event.data.userAt ?? current.time;
  if (
    Date.parse(replyAt) < Date.parse(current.time) ||
    Date.parse(userAt) < Date.parse(current.time) ||
    Date.parse(userAt) > Date.parse(replyAt)
  )
    throw new DomainError('INVALID_COMMAND', 'World time cannot run backwards');
  const state = structuredClone(current);
  const usedIds = new Set(
    [
      ...state.facts,
      ...state.messages,
      ...state.appointments,
      ...state.mediaRequests,
      ...(state.choices ?? []),
    ].map((item) => item.id),
  );
  const jobs: OutboxJob[] = [];
  if (
    effects.filter(
      (effect) =>
        effect.type === 'choice.recorded' ||
        effect.type === 'choice.result_reported' ||
        effect.type === 'choice.next_step',
    ).length > 1
  )
    throw new DomainError('INVALID_PROPOSAL', 'Only one choice change per turn');
  if (event.data.origin !== 'director') {
    const userMessageId = `${event.id}_user`;
    if (usedIds.has(userMessageId)) throw new DomainError('INVALID_PROPOSAL');
    usedIds.add(userMessageId);
    state.messages.push({
      id: userMessageId,
      actorId: event.data.actorId,
      role: 'user',
      text: event.data.userText,
      at: userAt,
      sourceEventId: event.id,
      sourceVersion: event.version,
    });
  }
  for (const effect of effects) {
    if (usedIds.has(effect.id)) throw new DomainError('INVALID_PROPOSAL', 'Duplicate effect ID');
    usedIds.add(effect.id);
    const sourceEventId = event.id;
    switch (effect.type) {
      case 'message.received':
        if (!actorIds.has(effect.actorId))
          throw new DomainError('INVALID_PROPOSAL', 'Unknown actor');
        state.messages.push({
          id: effect.id,
          actorId: effect.actorId,
          role: 'assistant',
          text: effect.text,
          at: replyAt,
          sourceEventId,
          sourceVersion: event.version,
        });
        for (const choice of state.choices ?? []) {
          const linkedToCue = event.data.userText.includes(`[choice:${choice.id}]`);
          if (
            event.data.origin === 'director' &&
            linkedToCue &&
            choice.status === 'pending' &&
            choice.actorId === effect.actorId &&
            choice.sourceVersion < event.version &&
            !choice.result
          ) {
            choice.status = 'followed_up';
            choice.followUpEventId = event.id;
          }
          if (
            event.data.origin === 'director' &&
            linkedToCue &&
            choice.actorId === effect.actorId &&
            choice.result &&
            !choice.result.acknowledgedEventId &&
            choice.result.sourceVersion < event.version
          )
            choice.result.acknowledgedEventId = event.id;
        }
        break;
      case 'choice.recorded':
        if (
          event.data.origin === 'director' ||
          !isExplicitChoice(effect.quote, event.data.userText)
        )
          throw new DomainError('INVALID_PROPOSAL', 'Choice must quote an explicit user decision');
        for (const choice of state.choices ?? []) {
          if (choice.status !== 'superseded' && choice.actorId === event.data.actorId)
            choice.status = 'superseded';
        }
        state.choices = [
          ...(state.choices ?? []),
          {
            id: effect.id,
            actorId: event.data.actorId,
            quote: effect.quote,
            intent: effect.intent,
            sourceEventId: event.id,
            sourceVersion: event.version,
            status: 'pending' as const,
          },
        ].slice(-5);
        break;
      case 'choice.next_step': {
        const choice = state.choices?.find((item) => item.id === effect.choiceId);
        const reply = effects.find(
          (item) =>
            item.type === 'message.received' &&
            item.actorId === event.data.actorId &&
            item.text.includes(effect.quote),
        );
        if (
          event.data.origin !== 'director' ||
          !event.data.userText.includes(`[choice:${effect.choiceId}]`) ||
          !choice ||
          choice.actorId !== event.data.actorId ||
          choice.status === 'superseded' ||
          (choice.status === 'followed_up' && choice.followUpEventId !== event.id) ||
          choice.result ||
          choice.nextStep ||
          choice.sourceVersion >= event.version ||
          !reply ||
          effect.quote.length < 6
        )
          throw new DomainError('INVALID_PROPOSAL', 'Next step must quote this actor reply');
        choice.nextStep = {
          quote: effect.quote,
          sourceEventId: event.id,
          sourceMessageId: reply.id,
          sourceVersion: event.version,
        };
        break;
      }
      case 'choice.result_reported': {
        const choice = state.choices?.find((item) => item.id === effect.choiceId);
        if (
          event.data.origin === 'director' ||
          !choice ||
          choice.actorId !== event.data.actorId ||
          choice.status === 'superseded' ||
          !isExplicitChoiceResult(effect.quote, event.data.userText, effect.outcome, choice)
        )
          throw new DomainError(
            'INVALID_PROPOSAL',
            'Result needs a sourced player report about this choice',
          );
        if (choice.result?.kind === effect.outcome && choice.result.quote === effect.quote) break;
        choice.result = {
          kind: effect.outcome,
          quote: effect.quote,
          sourceEventId: event.id,
          sourceVersion: event.version,
        };
        break;
      }
      case 'appointment.proposed':
      case 'appointment.created':
        if (effect.participantIds.some((id) => !actorIds.has(id)) || effect.at < replyAt)
          throw new DomainError('INVALID_PROPOSAL', 'Invalid appointment');
        state.appointments.push({
          ...(effect.type === 'appointment.proposed' ? { status: 'proposed' as const } : {}),
          id: effect.id,
          title: effect.title,
          at: effect.at,
          participantIds: effect.participantIds,
          sourceEventId,
        });
        break;
      case 'belief.recorded':
        state.facts.push({
          id: effect.id,
          text: effect.text,
          kind: 'belief',
          believedByActorId: effect.actorId,
          visibility: { kind: 'actors', actorIds: [effect.actorId] },
          sourceEventId,
        });
        break;
      case 'fact.established':
        if (
          effect.visibility.kind === 'actors' &&
          effect.visibility.actorIds.some((id) => !actorIds.has(id))
        )
          throw new DomainError('INVALID_PROPOSAL', 'Unknown fact audience');
        state.facts.push({
          id: effect.id,
          text: effect.text,
          visibility: effect.visibility,
          sourceEventId,
        });
        break;
      case 'media.requested': {
        const title =
          'title' in effect && typeof effect.title === 'string' && effect.title.trim()
            ? effect.title.trim().slice(0, 80)
            : event.data?.userText
              ? `【事件纪念】${event.data.userText.slice(0, 20)}`
              : '【事件纪念】现场留影';
        state.mediaRequests.push({
          id: effect.id,
          prompt: effect.prompt,
          title,
          status: 'pending',
          sourceEventId,
        });
        jobs.push({
          id: `${event.id}_${effect.id}`,
          eventId: event.id,
          worldId: state.id,
          type: 'image.generate',
          requestId: effect.id,
          prompt: effect.prompt,
          title,
        });
        break;
      }
    }
  }
  /* Facts are projected to world_facts; the state keeps a bounded window so the
     snapshot cannot outgrow its hard size limit as a life continues. */
  state.facts = retainFacts(state.facts);
  state.time = replyAt;
  state.version = event.version;
  return { state, jobs };
}
