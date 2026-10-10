import { verifiedGenesisLinks } from './genesis-links.ts';
import type { Appointment, Message, StoryChoice, WorldEvent, WorldState } from './types.ts';
import type { InvitationEvent } from './invitations.ts';

export type RecordSource =
  | {
      kind: 'world_genesis';
      worldId: string;
      seedId: string;
      messageId: string;
      snapshotVersion: 0;
      at: string;
      timeBasis: 'story';
    }
  | {
      kind: 'opening_field';
      seedId: string;
      field: 'identity' | 'setting' | 'official_note' | 'official_invitation';
      key?: string;
    }
  | {
      kind: 'world_event';
      eventId: string;
      eventVersion: number;
      messageId?: string;
      at: string;
      timeBasis: 'story' | 'recorded';
    };
export type PlayerRecord = {
  id: string;
  kind: 'player_choice' | 'actor_suggestion' | 'invitation' | 'opening_context' | 'history_message';
  title: string;
  text: string;
  state:
    | 'planned'
    | 'suggested'
    | 'blocked'
    | 'reported_done'
    | 'abandoned'
    | 'superseded'
    | 'proposed'
    | 'confirmed'
    | 'cancelled'
    | 'attended'
    | 'missed'
    | 'starting_point';
  stateLabel: string;
  assertion: 'player_statement' | 'actor_statement' | 'invitation_status' | 'starting_context';
  source: RecordSource;
  origin?: Extract<RecordSource, { kind: 'world_genesis' }>;
  relatedLinks?: {
    app: 'messages' | 'calendar' | 'notes' | 'photos';
    target: string;
    label: string;
  }[];
  navigation?: { app: 'wechat'; actorId: string } | { app: 'calendar'; invitationId: string };
};
export type PlayerRecords = {
  schemaVersion: 1;
  worldId: string;
  worldVersion: number;
  coverage: 'recent';
  current: PlayerRecord[];
  about: PlayerRecord[];
  history: PlayerRecord[];
};
export type PlayerRecordsInput = {
  worldId: string;
  worldVersion: number;
  initial?: WorldState;
  historyPhotos?: ReadonlyMap<string, string[]>;
  opening?: {
    seedId: string;
    identity?: string;
    setting?: string;
    officialSource?: { presetId: string; version: number };
  };
  choices: StoryChoice[];
  appointments: Appointment[];
  messages: Message[];
  actors: { id: string; name: string }[];
  events: (WorldEvent | InvitationEvent)[];
};
const labels: Record<PlayerRecord['state'], string> = {
  planned: '你记录的计划',
  suggested: '人物建议',
  blocked: '你说遇到阻碍',
  reported_done: '你说已完成',
  abandoned: '你说已放下',
  superseded: '此前计划记录',
  proposed: '待回应的邀约',
  confirmed: '已确认的日程',
  cancelled: '已取消',
  attended: '已记录赴约',
  missed: '已记录错过',
  starting_point: '人生起点',
};

/** Whitelisted, sourced records only. No private facts, memories or model calls. */
export function projectPlayerRecords(input: PlayerRecordsInput): PlayerRecords {
  const output: PlayerRecords = {
    schemaVersion: 1,
    worldId: input.worldId,
    worldVersion: input.worldVersion,
    coverage: 'recent',
    current: [],
    about: [],
    history: [],
  };
  const events = new Map(
    input.events
      .filter(
        (e) => e.worldId === input.worldId && e.version > 0 && e.version <= input.worldVersion,
      )
      .map((e) => [e.id, e]),
  );
  const actorIds = new Set(input.actors.map((a) => a.id));
  const source = (e: WorldEvent | InvitationEvent, message?: Message): RecordSource => ({
    kind: 'world_event',
    eventId: e.id,
    eventVersion: e.version,
    ...(message ? { messageId: message.id } : {}),
    at:
      e.type === 'turn.resolved' && (e.storyAt || e.data.userAt)
        ? (message?.at ?? e.storyAt ?? e.data.userAt!)
        : e.type === 'invitation.responded'
          ? e.storyTime
          : e.occurredAt,
    timeBasis:
      e.type === 'invitation.responded' ||
      (e.type === 'turn.resolved' && (e.storyAt || e.data.userAt))
        ? 'story'
        : 'recorded',
  });
  const add = (row: Omit<PlayerRecord, 'stateLabel'>, historical = false) =>
    (historical ? output.history : output.current).push({ ...row, stateLabel: labels[row.state] });
  for (const field of ['identity', 'setting'] as const) {
    const text = input.opening?.[field]?.trim();
    if (text && input.opening)
      output.about.push({
        id: `sys/opening/${input.worldId}/${field}`,
        kind: 'opening_context',
        title: field === 'identity' ? '起点身份' : '起点处境',
        text,
        state: 'starting_point',
        stateLabel: labels.starting_point,
        assertion: 'starting_context',
        source: { kind: 'opening_field', seedId: input.opening.seedId, field },
      });
  }
  const official = input.initial?.officialLife;
  const officialSource = input.opening?.officialSource;
  if (
    official &&
    officialSource &&
    input.opening &&
    official.presetId === officialSource.presetId &&
    official.version === officialSource.version
  ) {
    for (const note of official.notes)
      output.about.push({
        id: 'sys/official/' + input.worldId + '/note/' + note.key,
        kind: 'opening_context',
        title: note.title,
        text: note.text,
        state: 'starting_point',
        stateLabel: labels.starting_point,
        assertion: 'starting_context',
        source: {
          kind: 'opening_field',
          seedId: input.opening.seedId,
          field: 'official_note',
          key: note.key,
        },
      });
    for (const initial of input.initial!.appointments) {
      const current = input.appointments.find((a) => a.id === initial.id);
      if (
        !current?.status ||
        initial.sourceEventId !== 'genesis:' + input.worldId ||
        current.sourceEventId !== initial.sourceEventId
      )
        continue;
      const response =
        current.responseVersion === undefined
          ? undefined
          : input.events.find(
              (e) =>
                e.type === 'invitation.responded' &&
                e.version === current.responseVersion &&
                e.data.id === current.id,
            );
      if (current.responseVersion !== undefined && !response) continue;
      const recordSource: RecordSource = response
        ? {
            kind: 'world_event',
            eventId: response.id,
            eventVersion: response.version,
            at: response.type === 'invitation.responded' ? response.storyTime : response.occurredAt,
            timeBasis: 'story',
          }
        : {
            kind: 'opening_field',
            seedId: input.opening.seedId,
            field: 'official_invitation',
            key: current.id,
          };
      output.current.push({
        id: 'sys/official/' + input.worldId + '/invitation/' + current.id,
        kind: 'invitation',
        title: current.title,
        text: current.at,
        state: current.status,
        stateLabel: labels[current.status],
        assertion: 'invitation_status',
        source: recordSource,
        navigation: { app: 'calendar', invitationId: current.id },
      });
    }
  }
  if (input.initial?.genesisLinks) {
    if (
      input.initial.id !== input.worldId ||
      input.initial.version !== 0 ||
      input.initial.genesisLinks.seedId !== input.opening?.seedId
    )
      throw Error('INVALID_GENESIS_LINKS');
    for (const entry of verifiedGenesisLinks(input.initial)) {
      const name = input.actors.find((a) => a.id === entry.actorId)?.name;
      if (!name) throw Error('INVALID_GENESIS_LINKS');
      const links: NonNullable<PlayerRecord['relatedLinks']> = [
        { app: 'messages', target: entry.actorId, label: '\u67e5\u770b\u6765\u6e90\u5bf9\u8bdd' },
        ...(entry.invitationId
          ? [
              {
                app: 'calendar' as const,
                target: entry.invitationId,
                label: '\u67e5\u770b\u65e5\u7a0b',
              },
            ]
          : []),
        ...(input.historyPhotos?.get(entry.actorId) ?? []).slice(0, 2).map((target) => ({
          app: 'photos' as const,
          target,
          label: '\u76f8\u5173\u4eba\u7269\u7167\u7247',
        })),
      ];
      output.history.push({
        id: entry.recordId,
        kind: 'history_message',
        title: name + '\u7684\u65e7\u6765\u4fe1',
        text: entry.quote,
        state: 'starting_point',
        stateLabel: '\u865a\u6784\u8d77\u70b9\u6765\u4fe1',
        assertion: 'actor_statement',
        source: entry.source,
        relatedLinks: links,
        navigation: { app: 'wechat', actorId: entry.actorId },
      });
      if (!entry.appointment) continue;
      const current = input.appointments.find((a) => a.id === entry.invitationId);
      if (
        !current ||
        !current.status ||
        current.title !== entry.quote ||
        current.sourceMessageId !== entry.messageId ||
        current.sourceEventId !== entry.message.sourceEventId ||
        current.participantIds.length !== 1 ||
        current.participantIds[0] !== entry.actorId
      )
        throw Error('INVALID_GENESIS_LINKS');
      let currentSource: RecordSource = entry.source;
      if (current.responseVersion !== undefined) {
        const response = [...events.values()].find(
          (e) =>
            e.type === 'invitation.responded' &&
            e.version === current.responseVersion &&
            e.data.id === current.id,
        );
        const states = {
          accept: 'confirmed',
          cancel: 'cancelled',
          reschedule: 'proposed',
          attend: 'attended',
          miss: 'missed',
        } as const;
        if (
          !response ||
          response.type !== 'invitation.responded' ||
          states[response.data.operation] !== current.status ||
          current.responseAt !== response.storyTime ||
          (response.data.operation === 'reschedule' && response.data.at !== current.at)
        )
          throw Error('INVALID_GENESIS_LINKS');
        currentSource = source(response);
      } else if (
        current.status !== 'proposed' ||
        current.at !== entry.appointment.at ||
        current.responseAt !== undefined
      )
        throw Error('INVALID_GENESIS_LINKS');
      add(
        {
          id: `sys/invitation/${input.worldId}/${current.id}`,
          kind: 'invitation',
          title: current.title,
          text: current.at,
          state: current.status,
          assertion: 'invitation_status',
          source: currentSource,
          origin: entry.source,
          navigation: { app: 'calendar', invitationId: current.id },
          relatedLinks: [
            {
              app: 'messages',
              target: entry.actorId,
              label: '\u67e5\u770b\u6765\u6e90\u5bf9\u8bdd',
            },
            {
              app: 'notes',
              target: entry.recordId,
              label: '\u67e5\u770b\u65e7\u6765\u4fe1\u8bb0\u5f55',
            },
          ],
        },
        ['cancelled', 'attended', 'missed'].includes(current.status),
      );
    }
  }
  for (const choice of input.choices.slice(-5)) {
    const event = events.get(choice.sourceEventId);
    if (
      !event ||
      event.type !== 'turn.resolved' ||
      event.version !== choice.sourceVersion ||
      event.data.origin === 'director' ||
      event.data.actorId !== choice.actorId ||
      !actorIds.has(choice.actorId)
    )
      continue;
    const effect = event.data.effects.find(
      (e) =>
        e.type === 'choice.recorded' &&
        e.id === choice.id &&
        e.quote === choice.quote &&
        e.intent === choice.intent,
    );
    const user = input.messages.find(
      (m) =>
        m.sourceEventId === event.id &&
        m.role === 'user' &&
        m.actorId === choice.actorId &&
        m.text === event.data.userText &&
        m.text.includes(choice.quote),
    );
    if (!effect || !user) continue;
    let state: PlayerRecord['state'] = choice.status === 'superseded' ? 'superseded' : 'planned';
    let text = choice.quote,
      recordSource = source(event, user);
    const result = choice.result,
      resultEvent = result && events.get(result.sourceEventId);
    if (
      result &&
      resultEvent?.type === 'turn.resolved' &&
      resultEvent.data.origin !== 'director' &&
      resultEvent.data.actorId === choice.actorId &&
      resultEvent.version === result.sourceVersion
    ) {
      const report = input.messages.find(
        (m) =>
          m.sourceEventId === resultEvent.id &&
          m.role === 'user' &&
          m.actorId === choice.actorId &&
          m.text === resultEvent.data.userText &&
          m.text.includes(result.quote),
      );
      if (
        report &&
        resultEvent.data.effects.some(
          (e) =>
            e.type === 'choice.result_reported' &&
            e.choiceId === choice.id &&
            e.quote === result.quote &&
            e.outcome === result.kind,
        )
      ) {
        state = choice.status === 'superseded' ? 'superseded' : result.kind;
        text = result.quote;
        recordSource = source(resultEvent, report);
      }
    }
    const historical = ['reported_done', 'abandoned', 'superseded'].includes(state);
    add(
      {
        id: `sys/choice/${input.worldId}/${choice.id}`,
        kind: 'player_choice',
        title: '你的计划',
        text,
        state,
        assertion: 'player_statement',
        source: recordSource,
        navigation: { app: 'wechat', actorId: choice.actorId },
      },
      historical,
    );
    for (const [kind, step] of [
      ['next_step', choice.nextStep],
      ['recovery_step', state === 'blocked' ? choice.recoveryStep : undefined],
    ] as const) {
      if (!step) continue;
      const e = events.get(step.sourceEventId);
      const message = input.messages.find(
        (m) =>
          m.id === step.sourceMessageId &&
          m.sourceEventId === step.sourceEventId &&
          m.role === 'assistant' &&
          m.actorId === choice.actorId &&
          m.text.includes(step.quote),
      );
      if (
        !e ||
        e.type !== 'turn.resolved' ||
        e.version !== step.sourceVersion ||
        e.data.actorId !== choice.actorId ||
        e.data.origin !== 'director' ||
        !message ||
        !e.data.effects.some(
          (f) =>
            f.type === `choice.${kind}` &&
            'choiceId' in f &&
            f.choiceId === choice.id &&
            'quote' in f &&
            f.quote === step.quote,
        ) ||
        !e.data.effects.some(
          (f) =>
            f.type === 'message.received' &&
            f.id === message.id &&
            f.actorId === message.actorId &&
            f.text === message.text,
        )
      )
        continue;
      // A later report retires the earlier suggestion without turning it into an accepted action.
      add(
        {
          id: `sys/suggestion/${input.worldId}/${choice.id}/${kind}`,
          kind: 'actor_suggestion',
          title: `${input.actors.find((a) => a.id === choice.actorId)!.name}的建议`,
          text: step.quote,
          state: 'suggested',
          assertion: 'actor_statement',
          source: source(e, message),
          navigation: { app: 'wechat', actorId: choice.actorId },
        },
        historical || (kind === 'next_step' && state === 'blocked'),
      );
    }
  }
  for (const appointment of input.appointments) {
    const e = events.get(appointment.sourceEventId);
    if (
      !appointment.status ||
      !e ||
      e.type !== 'turn.resolved' ||
      !appointment.participantIds.every((id) => actorIds.has(id))
    )
      continue;
    const proposed = e.data.effects.find(
      (f) =>
        f.type === 'appointment.proposed' &&
        f.id === appointment.id &&
        f.title === appointment.title &&
        f.participantIds.length === appointment.participantIds.length &&
        f.participantIds.every((id, i) => id === appointment.participantIds[i]),
    );
    if (!proposed || proposed.type !== 'appointment.proposed') continue;
    const visibleReply = input.messages.find(
      (m) =>
        m.sourceEventId === e.id &&
        m.role === 'assistant' &&
        m.actorId === e.data.actorId &&
        e.data.effects.some(
          (f) =>
            f.type === 'message.received' &&
            f.id === m.id &&
            f.actorId === m.actorId &&
            f.text === m.text,
        ),
    );
    if (!visibleReply) continue;

    let currentSource: WorldEvent | InvitationEvent = e;
    if (appointment.responseVersion !== undefined) {
      const response = [...events.values()].find(
        (r) =>
          r.type === 'invitation.responded' &&
          r.version === appointment.responseVersion &&
          r.data.id === appointment.id,
      );
      if (!response || response.type !== 'invitation.responded') continue;
      const states = {
        accept: 'confirmed',
        cancel: 'cancelled',
        reschedule: 'proposed',
        attend: 'attended',
        miss: 'missed',
      } as const;
      if (
        states[response.data.operation] !== appointment.status ||
        (response.data.operation === 'reschedule' && response.data.at !== appointment.at)
      )
        continue;
      currentSource = response;
    } else if (appointment.status !== 'proposed' || proposed.at !== appointment.at) continue;
    add(
      {
        id: `sys/invitation/${input.worldId}/${appointment.id}`,
        kind: 'invitation',
        title: appointment.title,
        text: appointment.at,
        state: appointment.status,
        assertion: 'invitation_status',
        source: source(currentSource, currentSource.id === e.id ? visibleReply : undefined),
        navigation: { app: 'calendar', invitationId: appointment.id },
      },
      ['cancelled', 'attended', 'missed'].includes(appointment.status),
    );
  }
  return output;
}
