import { worldDayKey } from './display-time.ts';
import type { AgendaThread } from './agenda.ts';
import type { WorldState } from './types.ts';

/** Local scheduling evidence from committed/reconciled beats, never speculative dialogue. */
export type DeliveredBeat = { actorId: string; at: string; version: number };
const COOLDOWN = 12 * 60 * 60_000;

/** A later calendar date alone is not a new reason to contact the player. */
export function followupAgenda(
  state: WorldState,
  agenda: AgendaThread[],
  plannedFor: string,
  delivered: readonly DeliveredBeat[],
): AgendaThread[] {
  return agenda.filter((thread) => {
    const now = Date.parse(plannedFor);
    if (!Number.isFinite(now)) return false;
    // Never deliver a result or dated milestone before its saved story instant.
    if (
      thread.basisAt &&
      (!Number.isFinite(Date.parse(thread.basisAt)) || Date.parse(thread.basisAt) > now)
    )
      return false;
    const previous = [...delivered].reverse().find((beat) => beat.actorId === thread.actorId);
    if (!previous) return true;
    if (
      worldDayKey(previous.at) === worldDayKey(plannedFor) ||
      now - Date.parse(previous.at) < COOLDOWN
    )
      return false;
    if (thread.kind === 'appointment_due' || thread.kind === 'appointment_result') {
      const appointment = state.appointments.find(
        (a) => a.id === thread.basisId && a.participantIds.includes(thread.actorId),
      );
      if (!appointment) return false;
      return thread.kind === 'appointment_due'
        ? appointment.status === 'confirmed' &&
            Date.parse(appointment.at) > Date.parse(previous.at) &&
            Date.parse(appointment.at) <= now
        : ['attended', 'missed'].includes(appointment.status ?? '') &&
            (appointment.responseVersion ?? 0) > previous.version;
    }
    if (thread.kind === 'choice_result' || thread.kind === 'choice_followup') {
      const choice = state.choices?.find(
        (c) => c.id === thread.sourceId && c.actorId === thread.actorId,
      );
      return Boolean(
        choice &&
        (thread.kind === 'choice_result'
          ? (choice.result?.sourceVersion ?? 0)
          : choice.sourceVersion) > previous.version,
      );
    }
    if (thread.kind === 'awaiting_reply') {
      const message = state.messages.at(-1);
      return (
        message?.role === 'user' &&
        message.actorId === thread.actorId &&
        (message.sourceVersion ?? 0) > previous.version &&
        Date.parse(message.at) <= now
      );
    }
    if (thread.kind === 'departure_inquiry') {
      const fact = state.facts.find(
        (f) =>
          f.id === thread.basisId &&
          f.visibility.kind === 'actors' &&
          f.visibility.actorIds.includes(thread.actorId),
      );
      const departureVersion =
        fact?.departure?.eventVersion ??
        (state.space?.positionSource.kind === 'travel' &&
        state.space.positionSource.eventId === fact?.sourceEventId
          ? state.space.positionSource.eventVersion
          : 0);
      return Boolean(fact && departureVersion > previous.version);
    }
    // A commitment, an unanswered invitation or one check-in is not daily progress.
    return false;
  });
}
