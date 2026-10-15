import type {
  ActorAgentState,
  AgentPlayerDecision,
  AgentSource,
  AgentResponsibility,
} from './agent-runtime.ts';
import type { InvitationEvent } from './invitations.ts';
import type { Appointment } from './types.ts';
import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';

/** Server-produced replay delta on the original calendar event; never an AI proposal. */
export type AgentExternalProjection = {
  schemaVersion: 1;
  kind: 'invitation_decision';
  worldId: string;
  actorId: string;
  appointmentId: string;
  operation: 'accept' | 'cancel';
  actorRevisionBefore: number;
  actorRevisionAfter: number;
  source: AgentSource;
  responsibilities: {
    id: string;
    revisionBefore: number;
    revisionAfter: number;
    removeDeadline: boolean;
    deadlineBefore: NonNullable<AgentResponsibility['deadline']> | null;
  }[];
  decisions: AgentPlayerDecision[];
};
export type ProjectedInvitationEvent = InvitationEvent & {
  data: InvitationEvent['data'] & { agentProjections?: AgentExternalProjection[] };
};
function invalid(reason: string): never {
  throw new DomainError('INVALID_PROPOSAL', reason);
}
const terminal = (status: AgentResponsibility['status']) =>
  ['fulfilled', 'withdrawn', 'expired'].includes(status);
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  const keys = Object.keys(a).sort(),
    other = Object.keys(b).sort();
  return (
    keys.length === other.length &&
    keys.every(
      (key, i) =>
        key === other[i] &&
        same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function validateSource(projection: AgentExternalProjection) {
  const source = projection.source;
  if (
    projection.schemaVersion !== 1 ||
    projection.kind !== 'invitation_decision' ||
    !['accept', 'cancel'].includes(projection.operation) ||
    !integer(projection.actorRevisionBefore) ||
    projection.actorRevisionAfter !== projection.actorRevisionBefore + 1 ||
    source.kind !== 'world_event' ||
    source.id !== `calendar-response:${source.recordId}` ||
    !integer(source.worldVersion) ||
    source.worldVersion < 1 ||
    source.usage !== 'private_strategy' ||
    source.deadlineAt !== undefined
  )
    invalid('INVALID_CALENDAR_PROJECTION');
  validateEventId(source.recordId);
  isoInstant(source.at);
  if (
    !projection.responsibilities.length ||
    projection.decisions.length !== projection.responsibilities.length ||
    new Set(projection.responsibilities.map((r) => r.id)).size !==
      projection.responsibilities.length ||
    new Set(projection.decisions.map((d) => d.id)).size !== projection.decisions.length
  )
    invalid('INVALID_CALENDAR_PROJECTION');
}

/** Applies exactly the external delta; replay leaves a later actor state intact. */
export function applyAgentExternalProjection(
  state: ActorAgentState,
  projection: AgentExternalProjection,
): ActorAgentState {
  validateSource(projection);
  if (state.worldId !== projection.worldId || state.actorId !== projection.actorId)
    invalid('CALENDAR_PROJECTION_SCOPE');
  const expectedKind = projection.operation === 'accept' ? 'accepted' : 'declined';
  for (const [index, change] of projection.responsibilities.entries()) {
    const decision = projection.decisions[index];
    if (
      !integer(change.revisionBefore) ||
      change.revisionAfter !== change.revisionBefore + 1 ||
      !decision ||
      decision.id !== `calendar-decision:${projection.source.recordId}:${index}` ||
      decision.responsibilityId !== change.id ||
      decision.responsibilityRevision !== change.revisionAfter ||
      decision.kind !== expectedKind ||
      decision.sourceId !== projection.source.id ||
      decision.quote !== projection.operation ||
      change.removeDeadline !== (change.deadlineBefore !== null)
    )
      invalid('INVALID_CALENDAR_DELTA');
  }
  const recorded = projection.decisions.map((d) => state.decisions.find((old) => old.id === d.id));
  if (recorded.some(Boolean)) {
    if (
      state.revision < projection.actorRevisionAfter ||
      state.projectedWorldVersion < projection.source.worldVersion ||
      !recorded.every((old, index) => old && same(old, projection.decisions[index]))
    )
      invalid('CALENDAR_PROJECTION_REPLAY_CONFLICT');
    return structuredClone(state);
  }
  if (
    state.revision !== projection.actorRevisionBefore ||
    state.projectedWorldVersion >= projection.source.worldVersion
  )
    throw new DomainError('VERSION_CONFLICT', 'AGENT_REVISION_CONFLICT');
  const next = structuredClone(state);
  for (const change of projection.responsibilities) {
    const responsibility = next.responsibilities.find((r) => r.id === change.id);
    if (
      !responsibility ||
      responsibility.subject.kind !== 'appointment' ||
      responsibility.subject.id !== projection.appointmentId ||
      terminal(responsibility.status) ||
      (responsibility.revision ?? 0) !== change.revisionBefore ||
      !same(responsibility.deadline ?? null, change.deadlineBefore)
    )
      invalid('CALENDAR_RESPONSIBILITY_MISMATCH');
    responsibility.revision = change.revisionAfter;
    responsibility.status = 'open';
    responsibility.waitingOn = 'self';
    responsibility.sourceIds = [...new Set([...responsibility.sourceIds, projection.source.id])];
    responsibility.nextCheck = [{ kind: 'observation', sourceId: projection.source.id }];
    if (change.removeDeadline) delete responsibility.deadline;
  }
  next.decisions.push(...structuredClone(projection.decisions));
  next.knowledgeSourceIds = [...new Set([...next.knowledgeSourceIds, projection.source.id])];
  next.revision = projection.actorRevisionAfter;
  next.projectedWorldVersion = projection.source.worldVersion;
  return next;
}

/** Pure prepare step. Caller has already validated the original invitation against hydrated world. */
export function projectInvitationAgentDecision(
  state: ActorAgentState,
  event: InvitationEvent,
  beforeAppointment: Appointment,
): { actorId: string; stateAfter: ActorAgentState; projection: AgentExternalProjection } | null {
  if (!['accept', 'cancel'].includes(event.data.operation)) return null;
  if (
    event.schemaVersion !== 1 ||
    event.type !== 'invitation.responded' ||
    state.worldId !== event.worldId ||
    event.worldId !== event.data.worldId ||
    event.commandId !== event.data.commandId ||
    !integer(event.data.expectedVersion) ||
    event.version !== event.data.expectedVersion + 1 ||
    state.projectedWorldVersion > event.data.expectedVersion ||
    beforeAppointment.id !== event.data.id ||
    !beforeAppointment.status ||
    !['proposed', 'confirmed'].includes(beforeAppointment.status) ||
    (event.data.operation === 'accept' && beforeAppointment.status !== 'proposed') ||
    event.data.at !== undefined
  )
    invalid('INVALID_CALENDAR_EVENT');
  for (const id of [event.id, event.worldId, event.commandId]) validateEventId(id);
  isoInstant(event.storyTime);
  isoInstant(event.occurredAt);
  if (
    event.data.operation === 'accept' &&
    Date.parse(beforeAppointment.at) < Date.parse(event.storyTime)
  )
    invalid('CALENDAR_ACCEPT_IN_PAST');
  if (!beforeAppointment.participantIds.includes(state.actorId)) return null;
  const responsibilities = state.responsibilities.filter(
    (r) =>
      r.subject.kind === 'appointment' &&
      r.subject.id === beforeAppointment.id &&
      !terminal(r.status),
  );
  if (!responsibilities.length) return null;
  const source: AgentSource = {
    id: `calendar-response:${event.id}`,
    kind: 'world_event',
    recordId: event.id,
    worldVersion: event.version,
    at: event.storyTime,
    usage: 'private_strategy',
  };
  const projection: AgentExternalProjection = {
    schemaVersion: 1,
    kind: 'invitation_decision',
    worldId: state.worldId,
    actorId: state.actorId,
    appointmentId: beforeAppointment.id,
    operation: event.data.operation as 'accept' | 'cancel',
    actorRevisionBefore: state.revision,
    actorRevisionAfter: state.revision + 1,
    source,
    responsibilities: responsibilities.map((r) => ({
      id: r.id,
      revisionBefore: r.revision ?? 0,
      revisionAfter: (r.revision ?? 0) + 1,
      removeDeadline: r.deadline !== undefined,
      deadlineBefore: r.deadline ? structuredClone(r.deadline) : null,
    })),
    decisions: responsibilities.map((r, index) => ({
      id: `calendar-decision:${event.id}:${index}`,
      responsibilityId: r.id,
      responsibilityRevision: (r.revision ?? 0) + 1,
      kind: event.data.operation === 'accept' ? 'accepted' : 'declined',
      sourceId: source.id,
      // The original button value, not a fabricated private-chat utterance.
      quote: event.data.operation,
    })),
  };
  return {
    actorId: state.actorId,
    stateAfter: applyAgentExternalProjection(state, projection),
    projection,
  };
}
