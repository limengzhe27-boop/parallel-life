import type { Appointment, GenesisLinks, Message, WorldState } from './types.ts';
import type { MessageHistoryProposal } from './genesis-messages.ts';
import { validateMessageHistory } from './genesis-messages.ts';

function invalid(): never {
  throw Error('INVALID_GENESIS_LINKS');
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createGenesisLinks(input: {
  worldId: string;
  seedId: string;
  startAt: string;
  history: MessageHistoryProposal;
  actorIds: ReadonlyMap<string, string>;
  messages: Message[];
  newId: () => string;
}): { genesisLinks: GenesisLinks; appointments: Appointment[] } {
  validateMessageHistory(input.history, [...input.actorIds.keys()]);
  validateHistoryConnections(input.history, input.startAt);
  const start = Date.parse(input.startAt);
  if (!Number.isFinite(start) || !uuid.test(input.worldId) || !uuid.test(input.seedId)) invalid();
  const entries: GenesisLinks['entries'] = [],
    appointments: Appointment[] = [];
  for (const letter of input.history.messages) {
    if (!letter.connection) continue;
    const actorId = input.actorIds.get(letter.actorKey)!;
    const message = input.messages.find((m) => m.history?.key === letter.key);
    if (
      !message ||
      message.actorId !== actorId ||
      message.role !== 'assistant' ||
      message.sourceEventId !== `genesis:${input.worldId}` ||
      message.text !== letter.text ||
      Date.parse(message.at) !== start - letter.minutesBeforeStart * 60000
    )
      invalid();
    const id = input.newId(),
      invitationId = letter.connection.calendar ? input.newId() : undefined;
    entries.push({
      id,
      messageId: message.id,
      actorId,
      quote: letter.connection.quote,
      ...(invitationId ? { invitationId } : {}),
    });
    if (invitationId)
      appointments.push({
        id: invitationId,
        title: letter.connection.quote,
        at: new Date(start + letter.connection.calendar!.minutesAfterStart * 60000).toISOString(),
        participantIds: [actorId],
        sourceEventId: message.sourceEventId,
        sourceMessageId: message.id,
        status: 'proposed',
      });
  }
  const genesisLinks: GenesisLinks = { version: 1, seedId: input.seedId, entries };
  verifiedGenesisLinks({
    id: input.worldId,
    genesisLinks,
    messages: input.messages,
    messageHistory: { version: 1, startAt: input.startAt, timeZone: 'UTC+08:00' },
    actors: [...input.actorIds.values()].map((id) => ({ id })),
    appointments,
  });
  return { genesisLinks, appointments };
}

type GenesisState = Pick<
  WorldState,
  'id' | 'genesisLinks' | 'messages' | 'messageHistory' | 'appointments'
> & { actors: { id: string }[] };
export function verifiedGenesisLinks(state: GenesisState) {
  if (!state.genesisLinks) return [];
  const meta = state.genesisLinks;
  if (
    Object.keys(meta).some((k) => !['version', 'seedId', 'entries'].includes(k)) ||
    meta.version !== 1 ||
    !uuid.test(meta.seedId) ||
    !state.messageHistory ||
    !Array.isArray(meta.entries) ||
    meta.entries.length > 2 ||
    new Set(meta.entries.map((e) => e.id)).size !== meta.entries.length ||
    new Set(meta.entries.map((e) => e.messageId)).size !== meta.entries.length
  )
    invalid();
  return meta.entries.map((entry) => {
    if (
      Object.keys(entry).some(
        (k) => !['id', 'messageId', 'actorId', 'quote', 'invitationId'].includes(k),
      ) ||
      !uuid.test(entry.id) ||
      !uuid.test(entry.messageId) ||
      !uuid.test(entry.actorId) ||
      !state.actors.some((a) => a.id === entry.actorId) ||
      typeof entry.quote !== 'string' ||
      !entry.quote.trim() ||
      entry.quote.length > 80
    )
      invalid();
    const message = state.messages.find((m) => m.id === entry.messageId);
    if (
      !message ||
      !message.history ||
      message.role !== 'assistant' ||
      message.actorId !== entry.actorId ||
      message.sourceEventId !== `genesis:${state.id}` ||
      !message.text.includes(entry.quote) ||
      !Number.isFinite(Date.parse(message.at)) ||
      Date.parse(message.at) >= Date.parse(state.messageHistory!.startAt)
    )
      invalid();
    const appointment = entry.invitationId
      ? state.appointments.find((a) => a.id === entry.invitationId)
      : undefined;
    if (
      entry.invitationId &&
      (!uuid.test(entry.invitationId) ||
        !appointment ||
        appointment.title !== entry.quote ||
        appointment.sourceEventId !== message.sourceEventId ||
        appointment.sourceMessageId !== message.id ||
        appointment.participantIds.length !== 1 ||
        appointment.participantIds[0] !== entry.actorId ||
        !appointment.status)
    )
      invalid();
    if (appointment && appointment.responseVersion === undefined) {
      const minutes =
        (Date.parse(appointment.at) - Date.parse(state.messageHistory!.startAt)) / 60000;
      if (
        appointment.status !== 'proposed' ||
        appointment.responseAt !== undefined ||
        !Number.isInteger(minutes) ||
        minutes < 30 ||
        minutes > 10080
      )
        invalid();
      validateHistoryConnections(
        {
          version: 1,
          messages: [
            {
              key: message.history!.key,
              actorKey: 'source',
              text: message.text,
              minutesBeforeStart: 60,
              connection: { quote: entry.quote, calendar: { minutesAfterStart: minutes } },
            },
          ],
        },
        state.messageHistory!.startAt,
      );
    }
    return {
      ...entry,
      message,
      ...(appointment ? { appointment } : {}),
      recordId: `sys/history/${state.id}/${entry.id}`,
      source: {
        kind: 'world_genesis' as const,
        worldId: state.id,
        seedId: meta.seedId,
        messageId: message.id,
        snapshotVersion: 0 as const,
        at: message.at,
        timeBasis: 'story' as const,
      },
    };
  });
}

export function mergeAppointments(initial: Appointment[], projected: Appointment[]): Appointment[] {
  const map = new Map<string, Appointment>();
  for (const a of [...initial, ...projected]) {
    const old = map.get(a.id);
    if (old && appointmentSignature(old) !== appointmentSignature(a)) invalid();
    if (!old) map.set(a.id, a);
  }
  return [...map.values()];
}

/** Calendar dates must name the same fixed UTC+08 instant as the proposed offset. */
export function validateHistoryConnections(history: MessageHistoryProposal, startAt: string) {
  const start = Date.parse(startAt);
  if (!Number.isFinite(start)) invalid();
  for (const m of history.messages) {
    const calendar = m.connection?.calendar;
    if (!calendar) continue;
    const local = new Date(start + calendar.minutesAfterStart * 60000 + 8 * 3600000);
    const matches = [
      ...m.connection!.quote.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/g),
    ];
    if (matches.length !== 1) invalid();
    const [, year, month, day, hour, minute] = matches[0]!;
    if (
      (year !== undefined && Number(year) !== local.getUTCFullYear()) ||
      Number(month) !== local.getUTCMonth() + 1 ||
      Number(day) !== local.getUTCDate() ||
      Number(hour) !== local.getUTCHours() ||
      Number(minute) !== local.getUTCMinutes()
    )
      invalid();
  }
}

function appointmentSignature(a: Appointment) {
  return JSON.stringify([
    a.id,
    a.title,
    a.at,
    a.participantIds,
    a.sourceEventId,
    a.sourceMessageId ?? null,
    a.status ?? null,
    a.responseAt ?? null,
    a.responseVersion ?? null,
  ]);
}
