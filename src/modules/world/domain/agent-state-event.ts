import type { AgentProposal, AgentActionResult, ActorAgentState } from './agent-runtime.ts';
import type { WorldState, WorldEffect } from './types.ts';
import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';
import { linkAppointmentVenue } from './space.ts';

export type AgentRuntimeTransition = {
  schemaVersion: 1;
  engineEpoch: number;
  inputReceiptId: string;
  inputStoryAt: string;
  inputWorldVersion: number;
  actorRevisionBefore: number;
  actorRevisionAfter: number;
  proposal: AgentProposal;
  results: AgentActionResult[];
  /** Proven answer relevance or withdrawal; never an attendance/action completion receipt. */
  questionChanges?: import('./agent-questions.ts').QuestionApplicationReceipt[];
  /** Actual departures certified against route, own origin, result and journey ledger. */
  departures?: import('./agent-travel.ts').AgentJourney[];
  sceneDepartures?: import('./agent-scene-departure.ts').AgentSceneDeparture[];
  /** Kernel-certified report provenance, not a position change. */
  positionKnowledge?: import('./world-awareness.ts').ActorPositionKnowledge[];
  episodeDecision?: import('./agent-narrative.ts').EpisodeParticipationDecision;
  /** Immutable accepted revision for exact receipt replay and explicit state migration. */
  stateAfter: ActorAgentState;
};
/** A real private plan/state transition can commit without fabricating a message. */
export type AgentStateCommittedEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type: 'agent.state_committed';
  data: {
    actorId: string;
    agentRuntime: AgentRuntimeTransition;
    effects?: (
      | Extract<WorldEffect, { type: 'appointment.proposed' }>
      | Extract<WorldEffect, { type: 'appointment.fulfilled' }>
      | Extract<WorldEffect, { type: 'appointment.cancelled' }>
      | Extract<WorldEffect, { type: 'appointment.confirmed' }>
      | Extract<WorldEffect, { type: 'appointment.rescheduled' }>
      | Extract<WorldEffect, { type: 'item.delivered' }>
      | Extract<WorldEffect, { type: 'item.used' }>
      | Extract<WorldEffect, { type: 'media.requested' }>
    )[];
  };
};
export function applyAgentStateEvent(
  current: WorldState,
  event: AgentStateCommittedEvent,
): WorldState {
  if (event.worldId !== current.id || event.version !== current.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  validateEventId(event.id);
  validateEventId(event.commandId);
  isoInstant(event.occurredAt);
  isoInstant(event.storyAt);
  if (
    event.schemaVersion !== 1 ||
    !current.actors.some((actor) => actor.id === event.data.actorId) ||
    event.data.agentRuntime.schemaVersion !== 1 ||
    event.data.agentRuntime.engineEpoch < 2 ||
    event.data.agentRuntime.actorRevisionAfter !==
      event.data.agentRuntime.actorRevisionBefore + 1 ||
    Date.parse(event.storyAt) < Date.parse(current.time) ||
    event.data.agentRuntime.proposal.statements.length > 0
  )
    throw new DomainError('INVALID_PROPOSAL');
  const runtime = event.data.agentRuntime;
  if (
    runtime.stateAfter.worldId !== event.worldId ||
    runtime.stateAfter.actorId !== event.data.actorId ||
    runtime.stateAfter.revision !== runtime.actorRevisionAfter ||
    runtime.stateAfter.projectedWorldVersion !== event.version ||
    runtime.results.some(
      (result) =>
        result.worldId !== event.worldId ||
        result.actorId !== event.data.actorId ||
        result.eventId !== event.id ||
        result.worldVersion !== event.version,
    )
  )
    throw new DomainError('INVALID_PROPOSAL');
  const state = { ...structuredClone(current), version: event.version, time: event.storyAt };
  // Capabilities may produce a calendar proposal without a chat. This never confirms attendance.
  for (const effect of event.data.effects ?? []) {
    if (effect.type === 'appointment.fulfilled') {
      const item = state.appointments.find((a) => a.id === effect.appointmentId);
      if (!item) throw new DomainError('INVALID_PROPOSAL');
      item.status = 'attended';
      item.responseAt = event.storyAt;
      item.responseVersion = event.version;
      continue;
    }
    if (effect.type === 'appointment.cancelled') {
      const item = state.appointments.find((a) => a.id === effect.appointmentId);
      if (!item) throw new DomainError('INVALID_PROPOSAL');
      item.status = 'cancelled';
      item.responseAt = event.storyAt;
      item.responseVersion = event.version;
      continue;
    }
    if (effect.type === 'appointment.confirmed') {
      const item = state.appointments.find((a) => a.id === effect.appointmentId);
      if (!item) throw new DomainError('INVALID_PROPOSAL');
      item.status = 'confirmed';
      item.responseAt = event.storyAt;
      item.responseVersion = event.version;
      continue;
    }
    if (effect.type === 'appointment.rescheduled') {
      const item = state.appointments.find((a) => a.id === effect.appointmentId);
      if (item) {
        if (Date.parse(effect.newAt) <= Date.parse(event.storyAt)) {
          throw new DomainError('INVALID_PROPOSAL');
        }
        item.at = effect.newAt;
        item.status = 'proposed';
        if (effect.placeId || effect.locationId) {
          item.placeId = effect.placeId ?? effect.locationId;
        }
        item.responseAt = event.storyAt;
        item.responseVersion = event.version;
      }
      continue;
    }
    if (effect.type === 'item.delivered') {
      if (effect.fromActorId !== event.data.actorId) {
        throw new DomainError('INVALID_PROPOSAL');
      }
      if (!current.actors.some((actor) => actor.id === effect.toActorId)) {
        throw new DomainError('INVALID_PROPOSAL');
      }
      state.items = state.items ? [...state.items] : [];
      const itemIndex = state.items.findIndex((item) => item.id === effect.itemId);
      if (itemIndex >= 0) {
        state.items[itemIndex] = {
          ...state.items[itemIndex]!,
          holderActorId: effect.toActorId,
          transferredAt: event.storyAt,
          ...(effect.note ? { note: effect.note } : {}),
        };
      } else {
        state.items.push({
          id: effect.itemId,
          title: effect.title ?? effect.itemId,
          holderActorId: effect.toActorId,
          sourceEventId: event.id,
          transferredAt: event.storyAt,
          ...(effect.note ? { note: effect.note } : {}),
        });
      }
      continue;
    }
    if (effect.type === 'item.used') {
      if (effect.actorId !== event.data.actorId) {
        throw new DomainError('INVALID_PROPOSAL');
      }
      state.items = state.items ? [...state.items] : [];
      const itemIndex = state.items.findIndex((item) => item.id === effect.itemId);
      if (itemIndex >= 0) {
        state.items[itemIndex] = {
          ...state.items[itemIndex]!,
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
          sourceEventId: event.id,
          status: effect.consumed ? 'consumed' : 'used',
          usedAt: event.storyAt,
          ...(effect.placeId ? { usedPlaceId: effect.placeId } : {}),
          ...(effect.purpose ? { purpose: effect.purpose } : {}),
          ...(effect.note ? { note: effect.note } : {}),
        });
      }
      continue;
    }
    if (effect.type === 'media.requested') {
      const isVideo = 'mediaType' in effect && effect.mediaType === 'video';
      const mediaType = isVideo ? 'video' : 'image';
      const defaultTitle = isVideo ? '【事件记录】现场动态' : '【事件留影】现场留影';
      const title =
        'title' in effect && typeof effect.title === 'string' && effect.title.trim()
          ? effect.title.trim().slice(0, 80)
          : defaultTitle;
      validateEventId(effect.id);
      state.mediaRequests.push({
        id: effect.id,
        prompt: effect.prompt,
        title,
        status: 'pending',
        sourceEventId: event.id,
        mediaType,
      });
      continue;
    }
    if (
      effect.type !== 'appointment.proposed' ||
      effect.participantIds.length !== 1 ||
      effect.participantIds[0] !== event.data.actorId ||
      Date.parse(effect.at) <= Date.parse(event.storyAt) ||
      !effect.title.trim() ||
      effect.title.length > 120 ||
      state.appointments.some((item) => item.id === effect.id)
    )
      throw new DomainError('INVALID_PROPOSAL');
    isoInstant(effect.at);
    validateEventId(effect.id);
    if (effect.placeId !== undefined)
      state.space = linkAppointmentVenue(state.space, effect.id, effect.placeId);
    state.appointments.push({
      id: effect.id,
      title: effect.title,
      at: effect.at,
      participantIds: effect.participantIds,
      status: 'proposed',
      sourceEventId: event.id,
    });
  }
  return state;
}

/** Native channels share the same accepted transition; only their projection differs. */
export function applyNativeAgentCalendarEffects(
  before: WorldState,
  native: WorldState,
  event: {
    id: string;
    worldId: string;
    commandId: string;
    version: number;
    occurredAt: string;
    storyAt: string;
    data: { actorId?: string; agentRuntime?: AgentRuntimeTransition; effects?: WorldEffect[] };
  },
): WorldState {
  if (!event.data.agentRuntime) {
    if (event.data.effects?.length) throw new DomainError('INVALID_PROPOSAL');
    return native;
  }
  if (!event.data.actorId || native.version !== event.version || native.id !== before.id)
    throw new DomainError('INVALID_PROPOSAL');
  const effects = event.data.effects ?? [];
  if (
    effects.some(
      (e) =>
        e.type !== 'appointment.proposed' &&
        e.type !== 'appointment.fulfilled' &&
        e.type !== 'appointment.cancelled' &&
        e.type !== 'appointment.confirmed' &&
        e.type !== 'media.requested' &&
        e.type !== 'message.received',
    )
  )
    throw new DomainError('INVALID_PROPOSAL');
  const calendar = effects.filter(
    (
      e,
    ): e is
      | Extract<WorldEffect, { type: 'appointment.proposed' }>
      | Extract<WorldEffect, { type: 'appointment.fulfilled' }>
      | Extract<WorldEffect, { type: 'appointment.cancelled' }>
      | Extract<WorldEffect, { type: 'appointment.confirmed' }>
      | Extract<WorldEffect, { type: 'media.requested' }> =>
      e.type === 'appointment.proposed' ||
      e.type === 'appointment.fulfilled' ||
      e.type === 'appointment.cancelled' ||
      e.type === 'appointment.confirmed' ||
      e.type === 'media.requested',
  );
  // Reuse the exact transition/source/result invariants, without pretending the native speech was a DM.
  const projected = applyAgentStateEvent(before, {
    ...event,
    schemaVersion: 1,
    type: 'agent.state_committed',
    data: {
      actorId: event.data.actorId,
      agentRuntime: {
        ...event.data.agentRuntime,
        proposal: { ...event.data.agentRuntime.proposal, statements: [] },
      },
      effects: calendar,
    },
  });
  if (
    calendar
      .filter((e) => e.type === 'appointment.proposed')
      .some((e) => native.appointments.some((a) => a.id === e.id))
  )
    throw new DomainError('INVALID_PROPOSAL');
  return {
    ...native,
    ...(calendar.some((e) => e.type === 'appointment.proposed' && e.placeId !== undefined)
      ? { space: projected.space }
      : {}),
    appointments: [
      ...native.appointments.map((a) => {
        const updated = projected.appointments.find((p) => p.id === a.id);
        return updated ?? a;
      }),
      ...projected.appointments.filter((a) => a.sourceEventId === event.id),
    ],
    mediaRequests: [
      ...native.mediaRequests,
      ...projected.mediaRequests.filter((m) => m.sourceEventId === event.id),
    ],
  };
}
