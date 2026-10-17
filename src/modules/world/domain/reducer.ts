import { retainFacts } from './retention.ts';
import { DomainError } from './errors.ts';
import {
  parseProposal,
  isoInstant,
  validateCommand,
  validateEventId,
  isExplicitChoice,
  isExplicitChoiceResult,
  isExplicitlyConfidential,
} from './validation.ts';
import { validateCharacterEffects } from './character-policy.ts';
import { canShareWith } from './relationships.ts';
import { createWorldMatter, transitionWorldMatter } from './matters.ts';
import type { WorldState, WorldEvent, OutboxJob, ActorTie } from './types.ts';
import { linkAppointmentVenue } from './space.ts';

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
  validateCharacterEffects(event.data.actorId, effects, true, event.data.origin);
  const replyAt = event.storyAt ?? current.time;
  const userAt = event.data.userAt ?? current.time;
  const acceptedInput = event.data.agentRuntime;
  const acceptedEarlier =
    acceptedInput?.schemaVersion === 1 &&
    acceptedInput.engineEpoch >= 2 &&
    acceptedInput.inputStoryAt === userAt &&
    Number.isInteger(acceptedInput.inputWorldVersion) &&
    acceptedInput.inputWorldVersion <= current.version &&
    acceptedInput.inputWorldVersion >= 0;
  if (
    Date.parse(replyAt) < Date.parse(current.time) ||
    (!acceptedEarlier && Date.parse(userAt) < Date.parse(current.time)) ||
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
      ...(state.matters ?? []),
      ...(state.items ?? []),
    ].map((item) => item.id),
  );
  const jobs: OutboxJob[] = [];
  if (
    effects.filter(
      (effect) =>
        effect.type === 'choice.recorded' ||
        effect.type === 'choice.result_reported' ||
        effect.type === 'choice.next_step' ||
        effect.type === 'choice.recovery_step',
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
      case 'choice.recovery_step': {
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
          choice.result?.kind !== 'blocked' ||
          choice.result.sourceVersion >= event.version ||
          (choice.result.acknowledgedEventId !== undefined &&
            choice.result.acknowledgedEventId !== event.id) ||
          choice.recoveryStep ||
          !reply ||
          effect.quote.length < 8
        )
          throw new DomainError(
            'INVALID_PROPOSAL',
            'Recovery must quote this actor after a setback',
          );
        choice.recoveryStep = {
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
        // A later player report makes the older recovery proposal historical.
        choice.recoveryStep = undefined;
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
        if (effect.type === 'appointment.proposed' && effect.placeId !== undefined)
          state.space = linkAppointmentVenue(state.space, effect.id, effect.placeId);
        state.appointments.push({
          ...(effect.type === 'appointment.proposed' ? { status: 'proposed' as const } : {}),
          id: effect.id,
          title: effect.title,
          at: effect.at,
          participantIds: effect.participantIds,
          sourceEventId,
        });
        break;
      case 'appointment.fulfilled': {
        const target = state.appointments.find((a) => a.id === effect.appointmentId);
        if (target) {
          target.status = 'attended';
          target.responseAt = event.storyAt;
          target.responseVersion = event.version;
        }
        break;
      }
      case 'appointment.cancelled': {
        const target = state.appointments.find((a) => a.id === effect.appointmentId);
        if (target) {
          target.status = 'cancelled';
          target.responseAt = event.storyAt;
          target.responseVersion = event.version;
        }
        break;
      }
      case 'appointment.confirmed': {
        const target = state.appointments.find((a) => a.id === effect.appointmentId);
        if (target) {
          target.status = 'confirmed';
          target.responseAt = event.storyAt;
          target.responseVersion = event.version;
        }
        break;
      }
      case 'appointment.rescheduled': {
        const target = state.appointments.find((a) => a.id === effect.appointmentId);
        if (target) {
          target.at = effect.newAt;
          target.status = 'proposed';
          if (effect.placeId || effect.locationId) {
            target.placeId = effect.placeId ?? effect.locationId;
          }
          target.responseAt = event.storyAt;
          target.responseVersion = event.version;
        }
        break;
      }
      case 'item.delivered': {
        if (!actorIds.has(effect.toActorId)) {
          throw new DomainError('INVALID_PROPOSAL', 'Unknown recipient');
        }
        state.items = state.items ? [...state.items] : [];
        const existingIndex = state.items.findIndex((item) => item.id === effect.itemId);
        if (existingIndex >= 0) {
          state.items[existingIndex] = {
            ...state.items[existingIndex]!,
            holderActorId: effect.toActorId,
            transferredAt: event.storyAt,
            ...(effect.note ? { note: effect.note } : {}),
          };
        } else {
          state.items.push({
            id: effect.itemId,
            title: effect.title ?? effect.itemId,
            holderActorId: effect.toActorId,
            sourceEventId,
            transferredAt: event.storyAt,
            ...(effect.note ? { note: effect.note } : {}),
          });
        }
        break;
      }
      case 'item.used': {
        state.items = state.items ? [...state.items] : [];
        const existingIndex = state.items.findIndex((item) => item.id === effect.itemId);
        if (existingIndex >= 0) {
          state.items[existingIndex] = {
            ...state.items[existingIndex]!,
            status: effect.consumed ? 'consumed' : 'used',
            usedAt: event.storyAt,
            ...(effect.placeId ? { usedPlaceId: effect.placeId } : {}),
            ...(effect.purpose ? { purpose: effect.purpose } : {}),
            ...(effect.note ? { note: effect.note } : {}),
          };
        } else {
          state.items.push({
            id: effect.itemId,
            title: effect.title ?? effect.itemId,
            holderActorId: effect.actorId,
            sourceEventId,
            status: effect.consumed ? 'consumed' : 'used',
            usedAt: event.storyAt,
            ...(effect.placeId ? { usedPlaceId: effect.placeId } : {}),
            ...(effect.purpose ? { purpose: effect.purpose } : {}),
            ...(effect.note ? { note: effect.note } : {}),
          });
        }
        break;
      }
      case 'activity.participated': {
        state.activities = state.activities ? [...state.activities] : [];
        state.activities.push({
          id: effect.id,
          activityId: effect.activityId,
          title: effect.title,
          initiatorActorId: effect.actorId,
          participantActorIds: effect.participantActorIds,
          placeId: effect.placeId,
          sourceEventId,
          occurredAt: effect.at,
          ...(effect.outcome ? { outcome: effect.outcome } : {}),
          ...(effect.note ? { note: effect.note } : {}),
        });
        break;
      }
      case 'relationship.bonded': {
        state.actorTies = state.actorTies ? [...state.actorTies] : [];
        const existingTieIndex = state.actorTies.findIndex(
          (t) => t.fromActorId === effect.fromActorId && t.toActorId === effect.toActorId,
        );
        const updatedTie: ActorTie = {
          fromActorId: effect.fromActorId,
          toActorId: effect.toActorId,
          relationship: effect.relationship,
          mayShare: effect.mayShare ?? true,
        };
        if (existingTieIndex >= 0) {
          state.actorTies[existingTieIndex] = updatedTie;
        } else {
          state.actorTies.push(updatedTie);
        }
        const targetActor = state.actors.find((a) => a.id === effect.toActorId);
        if (targetActor) {
          targetActor.relationship = effect.relationship;
        }
        break;
      }
      case 'moment.published': {
        state.moments = state.moments ? [...state.moments] : [];
        state.moments.push({
          id: effect.id,
          key: effect.key,
          actorId: effect.actorId,
          name: effect.name,
          text: effect.text,
          at: effect.at,
          ...(effect.placeId ? { placeId: effect.placeId } : {}),
          ...(effect.image ? { image: effect.image } : {}),
          ...(effect.images && effect.images.length ? { images: effect.images } : {}),
          ...(effect.note ? { note: effect.note } : {}),
          sourceEventId,
        });
        break;
      }
      case 'moment.interacted': {
        state.momentInteractions = state.momentInteractions ? [...state.momentInteractions] : [];
        state.momentInteractions.push({
          id: effect.id,
          momentKey: effect.momentKey,
          actorId: effect.actorId,
          kind: effect.kind,
          ...(effect.comment ? { comment: effect.comment } : {}),
          at: effect.at,
          ...(effect.note ? { note: effect.note } : {}),
          sourceEventId,
        });
        break;
      }
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
      case 'information.shared': {
        const source = current.messages.find((message) => message.id === effect.sourceMessageId);
        const priorDisclosure = current.facts.some(
          (fact) =>
            fact.disclosure?.sourceMessageId === effect.sourceMessageId &&
            fact.believedByActorId === effect.recipientActorId,
        );
        if (
          event.data.origin !== 'director' ||
          !source ||
          source.role !== 'user' ||
          source.actorId !== event.data.actorId ||
          !actorIds.has(effect.recipientActorId) ||
          effect.recipientActorId === event.data.actorId ||
          !source.text.includes(effect.quote) ||
          effect.quote.length < 4 ||
          priorDisclosure ||
          isExplicitlyConfidential(source.text) ||
          (event.data.disclosurePolicyVersion === 2 &&
            !canShareWith(current, event.data.actorId, effect.recipientActorId))
        )
          throw new DomainError(
            'INVALID_PROPOSAL',
            'Disclosure needs a shareable source from this actor',
          );
        const speaker = current.actors.find((actor) => actor.id === event.data.actorId)!;
        state.facts.push({
          id: effect.id,
          text: `${speaker.name}告诉我：${effect.quote}`,
          kind: 'belief',
          believedByActorId: effect.recipientActorId,
          visibility: { kind: 'actors', actorIds: [effect.recipientActorId] },
          sourceEventId,
          disclosure: {
            fromActorId: event.data.actorId,
            sourceMessageId: effect.sourceMessageId,
            quote: effect.quote,
          },
        });
        break;
      }
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
        const isVideo = 'mediaType' in effect && effect.mediaType === 'video';
        const mediaType = isVideo ? 'video' : 'image';
        const defaultTitle = isVideo ? '【事件记录】现场动态' : '【事件纪念】现场留影';
        const title =
          'title' in effect && typeof effect.title === 'string' && effect.title.trim()
            ? effect.title.trim().slice(0, 80)
            : event.data?.userText
              ? `【事件${isVideo ? '记录' : '纪念'}】${event.data.userText.slice(0, 20)}`
              : defaultTitle;
        state.mediaRequests.push({
          id: effect.id,
          prompt: effect.prompt,
          title,
          status: 'pending',
          sourceEventId,
          mediaType,
        });
        jobs.push({
          id: `${event.id}_${effect.id}`,
          eventId: event.id,
          worldId: state.id,
          type: isVideo ? 'video.generate' : 'image.generate',
          requestId: effect.id,
          prompt: effect.prompt,
          title,
          mediaType,
        });
        break;
      }
      case 'matter.proposed': {
        const replies = effects.filter(
          (e) => e.type === 'message.received' && e.actorId === event.data.actorId,
        );
        if (
          effect.quote.length < 5 ||
          !replies.some((r) => r.type === 'message.received' && r.text.includes(effect.quote))
        )
          throw new DomainError(
            'INVALID_PROPOSAL',
            'Matter proposal needs this character actual reply',
          );
        const prior = state.matters ?? [];
        if (
          prior.some(
            (m) =>
              m.visibility === 'player_visible' &&
              m.span === effect.span &&
              m.title.replace(/\s/g, '') === effect.title.replace(/\s/g, ''),
          )
        )
          break;
        if (prior.length >= 50)
          throw new DomainError('INVALID_PROPOSAL', 'Matter capacity reached');
        const matter = createWorldMatter({
          id: effect.id,
          worldId: state.id,
          span: effect.span,
          title: effect.title,
          description: effect.description,
          status: 'not_started',
          relatedActorIds: [event.data.actorId],
          assertion: 'actor_statement',
          source: {
            kind: 'actor_proposal',
            actorId: event.data.actorId,
            eventId: event.id,
            eventVersion: event.version,
            at: replyAt,
          },
          now: replyAt,
        });
        state.matters = [...prior, matter];
        break;
      }
      case 'matter.created': {
        const m = effect.matter,
          source = m.source;
        if (
          m.worldId !== state.id ||
          m.version !== 1 ||
          m.rewardClaimed ||
          !['not_started', 'in_progress'].includes(m.status) ||
          m.assertion !== 'actor_statement' ||
          m.evidence ||
          m.createdAt !== replyAt ||
          m.updatedAt !== replyAt ||
          !['director_proposal', 'actor_proposal'].includes(source.kind) ||
          !('eventId' in source) ||
          source.eventId !== event.id ||
          source.eventVersion !== event.version ||
          source.at !== replyAt ||
          (source.kind === 'actor_proposal' && source.actorId !== event.data.actorId) ||
          m.relatedActorIds?.some((id) => !actorIds.has(id)) ||
          (m.relatedPlaceId && !state.space?.places.some((p) => p.id === m.relatedPlaceId)) ||
          (m.relatedInvitationId &&
            !state.appointments.some((a) => a.id === m.relatedInvitationId)) ||
          m.prerequisites?.some(
            (id) =>
              id === m.id ||
              !state.matters?.some(
                (p) => p.id === id && (m.status === 'not_started' || p.status === 'completed'),
              ),
          )
        )
          throw new DomainError(
            'INVALID_PROPOSAL',
            'Matter provenance or references do not match this world event',
          );
        if ((state.matters?.length ?? 0) >= 50)
          throw new DomainError('INVALID_PROPOSAL', 'Matter capacity reached');
        if (!state.matters) state.matters = [];
        if (state.matters.some((m) => m.id === effect.matter.id)) {
          throw new DomainError('INVALID_PROPOSAL', 'Duplicate matter ID');
        }
        state.matters.push(effect.matter);
        break;
      }
      case 'matter.updated': {
        if (!state.matters) state.matters = [];
        const matter = state.matters.find((m) => m.id === effect.matterId);
        if (!matter) {
          throw new DomainError('INVALID_PROPOSAL', 'Matter not found');
        }
        const evidence = effect.evidence;
        if (
          evidence.kind !== 'user_report' ||
          evidence.eventId !== event.id ||
          evidence.eventVersion !== event.version ||
          evidence.at !== replyAt ||
          !matter.relatedActorIds?.includes(event.data.actorId) ||
          matter.visibility !== 'player_visible' ||
          !isExplicitChoiceResult(evidence.quote, event.data.userText, evidence.outcome, {
            quote: matter.title,
            intent: matter.description,
          } as import('./types.ts').StoryChoice) ||
          effect.status !==
            ({ reported_done: 'completed', blocked: 'blocked', abandoned: 'abandoned' } as const)[
              evidence.outcome
            ]
        )
          throw new DomainError(
            'INVALID_PROPOSAL',
            'Matter report requires matching user text and actual event provenance',
          );
        const updated = transitionWorldMatter(matter, {
          status: effect.status,
          evidence: effect.evidence,
          assertion: effect.assertion,
          now: replyAt,
          allMatters: state.matters,
        });
        const index = state.matters.indexOf(matter);
        state.matters[index] = updated;
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
