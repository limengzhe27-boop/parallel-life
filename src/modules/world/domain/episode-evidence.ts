import type { AgentActionResult } from './agent-runtime.ts';
import type { AgentJourney } from './agent-travel.ts';
import type { InvitationEvent } from './invitations.ts';
import type { Appointment } from './types.ts';

/** Server-owned causal association, resolved from the committed execution, never model prose. */
export type EpisodeEvidenceBinding = {
  worldId: string;
  engineEpoch: number;
  episodeId: string;
  actorId: string;
  actionId: string;
  subject: { kind: 'appointment' | 'journey'; id: string };
};
export type EpisodeEvidenceRecord = EpisodeEvidenceBinding & {
  kind:
    | 'invitation_proposed'
    | 'invitation_accepted'
    | 'invitation_declined'
    | 'travel_started'
    | 'arrived';
  eventId: string;
  sourceId: string;
  commandId?: string;
  worldVersion: number;
  at: string;
};
export type EpisodeEvidenceSource =
  | {
      kind: 'action_result';
      capability: 'appointment.propose' | 'travel.begin';
      result: AgentActionResult;
    }
  | { kind: 'invitation_response'; event: InvitationEvent; beforeAppointment: Appointment }
  | { kind: 'arrival'; journey: AgentJourney };
const nonempty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const version = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const instant = (s: unknown): s is string =>
  typeof s === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
/**
 * Pure deterministic projection. Caller must resolve the original committed source and exact
 * association inside the same transaction; TypeScript objects are not authentication tokens.
 * Never pass an AgentProposal or a director claim as this function's trusted source.
 */
export function verifyEpisodeEvidence(
  binding: EpisodeEvidenceBinding,
  source: EpisodeEvidenceSource,
  priorRecords: readonly EpisodeEvidenceRecord[],
): EpisodeEvidenceRecord | null {
  const input = { ...source, binding };
  const reject = (_reason: string) => null;
  const b = input.binding;
  if (
    !b ||
    ![b.worldId, b.episodeId, b.actorId, b.actionId, b.subject?.id].every(nonempty) ||
    !['appointment', 'journey'].includes(b.subject.kind) ||
    !version(b.engineEpoch) ||
    b.engineEpoch < 2 ||
    !Array.isArray(priorRecords)
  )
    return reject('invalid_evidence');
  if (
    priorRecords.some(
      (r) =>
        r.worldId !== b.worldId || r.engineEpoch !== b.engineEpoch || r.episodeId !== b.episodeId,
    )
  )
    return null;
  let record: EpisodeEvidenceRecord;
  if (input.kind === 'action_result') {
    const r = input.result;
    const subjectKind = input.capability === 'appointment.propose' ? 'appointment' : 'journey';
    if (
      !['appointment.propose', 'travel.begin'].includes(input.capability) ||
      !r ||
      r.outcome !== 'succeeded' ||
      r.worldId !== b.worldId ||
      r.actorId !== b.actorId ||
      r.actionId !== b.actionId ||
      b.subject.kind !== subjectKind ||
      !r.outputRefs?.some((ref) => ref.kind === b.subject.kind && ref.id === b.subject.id)
    )
      return reject('invalid_evidence');
    record = {
      ...structuredClone(b),
      kind: input.capability === 'appointment.propose' ? 'invitation_proposed' : 'travel_started',
      eventId: r.eventId,
      sourceId: r.id,
      worldVersion: r.worldVersion,
      at: r.at,
    };
  } else if (input.kind === 'invitation_response') {
    const e = input.event;
    const before = input.beforeAppointment;
    if (
      b.subject.kind !== 'appointment' ||
      !before ||
      before.id !== b.subject.id ||
      before.status !== 'proposed' ||
      !before.participantIds.includes(b.actorId) ||
      !e ||
      e.schemaVersion !== 1 ||
      e.type !== 'invitation.responded' ||
      e.worldId !== b.worldId ||
      e.data.worldId !== b.worldId ||
      e.data.id !== b.subject.id ||
      e.commandId !== e.data.commandId ||
      !nonempty(e.commandId) ||
      !version(e.data.expectedVersion) ||
      e.version !== e.data.expectedVersion + 1 ||
      e.data.at !== undefined ||
      !['accept', 'cancel'].includes(e.data.operation) ||
      !instant(e.occurredAt)
    )
      return reject('invalid_evidence');
    // cancel is only a declined invitation when the invitation was still proposed; caller must
    // resolve its before-state. An accepted invitation's cancellation is not a refusal receipt.
    const offered = priorRecords.find(
      (r) =>
        r.kind === 'invitation_proposed' &&
        r.actorId === b.actorId &&
        r.actionId === b.actionId &&
        r.subject.kind === 'appointment' &&
        r.subject.id === b.subject.id,
    );
    if (!offered || offered.worldVersion >= e.version) return reject('invalid_evidence');
    const priorDecision = priorRecords.find(
      (r) =>
        ['invitation_accepted', 'invitation_declined'].includes(r.kind) &&
        r.subject.kind === 'appointment' &&
        r.subject.id === b.subject.id &&
        r.eventId !== e.id,
    );
    if (priorDecision) return reject('invalid_evidence');
    record = {
      ...structuredClone(b),
      kind: e.data.operation === 'accept' ? 'invitation_accepted' : 'invitation_declined',
      eventId: e.id,
      sourceId: e.id,
      commandId: e.commandId,
      worldVersion: e.version,
      at: e.storyTime,
    };
  } else if (input.kind === 'arrival') {
    const j = input.journey;
    if (
      b.subject.kind !== 'journey' ||
      !j ||
      j.status !== 'arrived' ||
      j.revision !== 1 ||
      j.worldId !== b.worldId ||
      j.actorId !== b.actorId ||
      j.id !== b.subject.id ||
      j.beginActionId !== b.actionId ||
      j.departure.worldId !== b.worldId ||
      j.departure.actorId !== b.actorId ||
      j.departure.actionId !== b.actionId ||
      j.departure.outcome !== 'succeeded' ||
      j.arrival.worldId !== b.worldId ||
      j.arrival.actorId !== b.actorId ||
      j.arrival.journeyId !== j.id ||
      !nonempty(j.arrival.commandId) ||
      j.arrival.worldVersion <= j.departure.worldVersion ||
      !instant(j.departure.at) ||
      !instant(j.plannedArrivalAt) ||
      Date.parse(j.arrival.at) < Date.parse(j.plannedArrivalAt)
    )
      return reject('invalid_evidence');
    const started = priorRecords.find(
      (r) =>
        r.kind === 'travel_started' &&
        r.actorId === b.actorId &&
        r.actionId === b.actionId &&
        r.sourceId === j.departure.id &&
        r.eventId === j.departure.eventId &&
        r.worldVersion === j.departure.worldVersion &&
        r.subject.id === j.id,
    );
    if (!started) return reject('invalid_evidence');
    record = {
      ...structuredClone(b),
      kind: 'arrived',
      eventId: j.arrival.eventId,
      sourceId: j.arrival.id,
      commandId: j.arrival.commandId,
      worldVersion: j.arrival.worldVersion,
      at: j.arrival.at,
    };
  } else return reject('invalid_evidence');
  if (
    ![record.sourceId, record.eventId].every(nonempty) ||
    !version(record.worldVersion) ||
    record.worldVersion < 1 ||
    !instant(record.at)
  )
    return reject('invalid_evidence');
  return record;
}
