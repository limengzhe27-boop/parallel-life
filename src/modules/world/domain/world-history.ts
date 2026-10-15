import { resultAckText } from './matter-progression.ts';
import {
  applyAgentStateEvent,
  applyNativeAgentCalendarEffects,
  type AgentStateCommittedEvent,
  type AgentRuntimeTransition,
} from './agent-state-event.ts';
import { applyAppointmentWaitEvent, type AppointmentWaitEvent } from './appointment-wait.ts';
import { applyStoryWaitEvent, type StoryWaitEvent } from './story-wait.ts';
import { applySceneWorldResults, type SceneWorldResults } from './scene-world-results.ts';
import {
  applySpaceEvent,
  type TravelEvent,
  type SpaceEstablishedEvent,
  type SpacePlaceRevealedEvent,
} from './space.ts';
import type { WorldEvent, WorldState, OutboxJob } from './types.ts';
import { applyEvent } from './reducer.ts';
import { applyInvitationEvent, type InvitationEvent } from './invitations.ts';
import { applyNoteEvent, type NoteEvent } from './notes.ts';
import {
  applyGroupWorldEvent,
  isGroupEvent,
  reduceGroupEvent,
  type GroupEvent,
} from './group-runtime.ts';
import type { GroupConversation, GroupMessage } from './experience-rules.ts';
import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';
type SceneWorldEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type:
    | 'scene.entered'
    | 'scene.input_recorded'
    | 'scene.opened'
    | 'scene.action_resolved'
    | 'scene.reaction_recorded'
    | 'scene.view_changed'
    | 'scene.left';
  data: unknown;
};
/** Stored event union is separate from the existing private-turn command contract. */
export type WorldHistoryEvent =
  | AgentStateCommittedEvent
  | WorldEvent
  | InvitationEvent
  | NoteEvent
  | GroupEvent
  | SceneWorldEvent
  | TravelEvent
  | AppointmentWaitEvent
  | StoryWaitEvent
  | SpaceEstablishedEvent
  | SpacePlaceRevealedEvent;
export function applyWorldHistoryEvent(
  current: WorldState,
  event: WorldHistoryEvent,
  initial: WorldState = current,
): { state: WorldState; jobs: OutboxJob[] } {
  if (event.worldId !== current.id || event.version !== current.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  if (event.schemaVersion !== 1) throw new DomainError('INVALID_PROPOSAL');
  validateEventId(event.id);
  validateEventId(event.commandId);
  isoInstant(event.occurredAt);
  if (event.type === 'agent.state_committed')
    return { state: applyAgentStateEvent(current, event), jobs: [] };
  if (isGroupEvent(event)) {
    const native = applyGroupWorldEvent(current, event);
    if (event.type !== 'group.turn_resolved') return { state: native, jobs: [] };
    if (event.data.agentRuntime && event.data.replies.some((reply) => reply.invitation))
      throw new DomainError('INVALID_PROPOSAL');
    return { state: applyNativeAgentCalendarEffects(current, native, event), jobs: [] };
  }
  if (event.type === 'appointment.waited')
    return { state: applyAppointmentWaitEvent(current, event), jobs: [] };
  if (event.type === 'story.waited')
    return { state: applyStoryWaitEvent(current, event), jobs: [] };
  if (
    event.type === 'travel.completed' ||
    event.type === 'space.established' ||
    event.type === 'space.place_revealed'
  )
    return { state: applySpaceEvent(current, event), jobs: [] };
  if (event.type === 'turn.resolved') {
    const next = applyEvent(current, event);
    // Retain only the bounded proofs referenced by pursuit milestones. Generic
    // facts still obey the existing snapshot budget; replay never runs jobs.
    const proofRefs = (current.matters ?? [])
      .filter((m) => m.worldId === current.id && m.visibility === 'player_visible')
      .flatMap((m) =>
        (m.pursuitProgress?.milestones ?? []).slice(0, 10).flatMap((s) => {
          const target = current.matters?.find(
            (t) =>
              t.id === s.matterId && t.worldId === current.id && t.visibility === 'player_visible',
          );
          if (
            s.eventVersion > current.version ||
            target?.evidence?.kind !== 'scene_action' ||
            target.evidence.eventId !== s.eventId ||
            target.evidence.eventVersion !== s.eventVersion ||
            target.evidence.outcome !== 'succeeded' ||
            target.assertion !== 'world_verified' ||
            target.status !== 'completed'
          )
            return [];
          return [
            { id: `matter_result:${s.eventId}:${s.matterId}`, eventId: s.eventId },
            { id: `pursuit_result:${s.eventId}:${m.id}`, eventId: s.eventId },
          ];
        }),
      );
    const proofIds = new Set(
      current.facts
        .filter(
          (f) =>
            f.kind === 'canonical' &&
            f.visibility.kind === 'actors' &&
            proofRefs.some((r) => r.id === f.id && r.eventId === f.sourceEventId),
        )
        .map((f) => f.id),
    );
    for (const f of current.facts.filter((f) => proofIds.has(f.id))) {
      if (f.visibility.kind !== 'actors') continue;
      for (const actorId of f.visibility.actorIds) {
        const receipt = current.facts.find(
          (r) =>
            r.kind === 'belief' &&
            r.believedByActorId === actorId &&
            r.text === resultAckText(f) &&
            current.messages.some(
              (m) =>
                m.actorId === actorId &&
                m.role === 'assistant' &&
                m.sourceEventId === r.sourceEventId,
            ),
        );
        if (receipt) proofIds.add(receipt.id);
      }
    }
    next.state.facts = [
      ...current.facts.filter(
        (f) => proofIds.has(f.id) && !next.state.facts.some((n) => n.id === f.id),
      ),
      ...next.state.facts,
    ];
    return next;
  }
  if (event.type === 'invitation.responded') {
    isoInstant(event.storyTime);
    if (Date.parse(event.storyTime) < Date.parse(current.time))
      throw new DomainError('INVALID_COMMAND');
    return { state: applyInvitationEvent({ ...current, time: event.storyTime }, event), jobs: [] };
  }
  if (event.type === 'note.saved') return { state: applyNoteEvent(current, event), jobs: [] };
  if (
    [
      'scene.entered',
      'scene.input_recorded',
      'scene.opened',
      'scene.action_resolved',
      'scene.reaction_recorded',
      'scene.view_changed',
      'scene.left',
    ].includes(event.type)
  ) {
    const scene = event as SceneWorldEvent;
    isoInstant(scene.storyAt);
    if (Date.parse(scene.storyAt) < Date.parse(current.time))
      throw new DomainError('INVALID_COMMAND');
    // Runtime-validated world deltas share the scene event and replay without jobs.
    return {
      state: applyNativeAgentCalendarEffects(
        current,
        applySceneWorldResults(
          current,
          {
            ...scene,
            data: scene.data as { worldResults?: SceneWorldResults },
          },
          initial,
        ),
        {
          ...scene,
          data: scene.data as {
            actorId?: string;
            agentRuntime?: AgentRuntimeTransition;
            effects?: import('./types.ts').WorldEffect[];
          },
        },
      ),
      jobs: [],
    };
  }
  throw new DomainError('INVALID_PROPOSAL', 'Unsupported historical event');
}
/** Rebuilds historical World and group projections for reads/branch preparation; never executes jobs. */
export function replayWorldHistory(
  initial: WorldState,
  events: WorldHistoryEvent[],
  throughVersion = Infinity,
  invitationPlaces: readonly {
    invitationId: string;
    placeId: string;
    sourceEventId: string;
  }[] = [],
) {
  let world = structuredClone(initial);
  const groups = new Map<string, GroupConversation>();
  const messages: GroupMessage[] = [];
  const sources: { id: string; version: number; ownerId: string; worldId: string }[] = [];
  for (const event of events) {
    if (event.version > throughVersion) break;
    let next = applyWorldHistoryEvent(world, event, initial).state;
    // Associations come from the verified publication binding, and become available
    // only with the actual offering event. They never move anyone or create an invitation.
    const linked = invitationPlaces.filter(
      (l) =>
        l.sourceEventId === event.id &&
        next.appointments.some((a) => a.id === l.invitationId && a.sourceEventId === event.id),
    );
    if (next.space && linked.length)
      next = {
        ...next,
        space: {
          ...next.space,
          places: next.space.places.map((p) => ({
            ...p,
            appointmentIds: [
              ...new Set([
                ...p.appointmentIds,
                ...linked.filter((l) => l.placeId === p.id).map((l) => l.invitationId),
              ]),
            ],
          })),
        },
      };
    sources.push({
      id: event.id,
      version: event.version,
      ownerId: world.ownerId,
      worldId: world.id,
    });
    if (isGroupEvent(event)) {
      const result = reduceGroupEvent(
        { world: next, events: sources },
        groups.get(event.data.groupId),
        event,
      );
      groups.set(result.group.id, result.group);
      messages.push(...result.messages);
    }
    world = next;
  }
  return { world, groups: [...groups.values()], messages };
}
