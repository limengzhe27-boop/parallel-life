/** Authored events become appointments only when the manuscript can back them. */
export type AuthoredCandidate = {
  title: string;
  actorKeys: string[];
  direction?: { mode: 'required' | 'optional' };
};
export type OpeningMessage = { key: string; actorKey?: string; origin?: string; at: string };
export type AuthoredAppointment = {
  id: string;
  title: string;
  at: string;
  participantIds: string[];
  sourceEventId: string;
  sourceMessageId: string;
  status: 'proposed';
};

/**
 * Required authored events are the ones the story owes the player, but an appointment
 * must be backed by a real opening message: no source message means no appointment.
 */
export function authoredAppointments(input: {
  candidates: readonly AuthoredCandidate[];
  messages: readonly OpeningMessage[];
  actorIds: ReadonlyMap<string, string>;
  messageIds: ReadonlyMap<string, string>;
  sourceEventId: string;
  newId: () => string;
}): AuthoredAppointment[] {
  return input.candidates
    .filter((candidate) => candidate.direction?.mode === 'required')
    .flatMap((candidate) => {
      const participants = candidate.actorKeys
        .map((key) => input.actorIds.get(key))
        .filter((value): value is string => Boolean(value));
      const source = input.messages.find(
        (message) =>
          message.origin !== 'history' &&
          Boolean(message.actorKey) &&
          candidate.actorKeys.includes(message.actorKey!) &&
          input.messageIds.has(message.key),
      );
      if (!participants.length || !source) return [];
      return [
        {
          id: input.newId(),
          title: candidate.title,
          at: new Date(Date.parse(source.at) + 2 * 60 * 60_000).toISOString(),
          participantIds: participants,
          sourceEventId: input.sourceEventId,
          sourceMessageId: input.messageIds.get(source.key)!,
          status: 'proposed' as const,
        },
      ];
    });
}
