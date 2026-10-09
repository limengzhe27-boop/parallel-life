import { applyWorldHistoryEvent } from '../domain/world-history.ts';
import { applyInvitationEvent, type InvitationEvent } from '../domain/invitations.ts';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';
import {
  reduceGroupEvent,
  groupHistory,
  type GroupEvent,
  type GroupReply,
} from '../domain/group-runtime.ts';
import type {
  Participant,
  GroupConversation,
  ExperienceContext,
} from '../domain/experience-rules.ts';
import type { WorldState } from '../domain/types.ts';
import type { GroupRead, GroupTaskInput } from '../application/group-ports.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { enqueue, requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { projectStoryTime } from '../domain/clock.ts';
import {
  GroupConversationSchema,
  GroupMessageSchema,
} from '../../../contracts/world-experiences.ts';

const compact = (w: WorldState) => ({
  ...w,
  messages: [],
  facts: [],
  appointments: [],
  mediaRequests: [],
  notes: [],
});
const key = (p: Participant) => (p.kind === 'player' ? 'player' : p.actorId);
export type GroupCommand = { commandId: string; expectedVersion: number; worldId: string };
export type GroupReceipt = { groupId: string; version: number; eventId: string; commandId: string };

async function loadWorld(
  sql: SqlClient,
  worldId: string,
  now: string,
  lock = false,
): Promise<WorldState> {
  const row = (
    await sql.query(
      `SELECT state,version,owner_id FROM parallel_life.worlds WHERE id=$1${lock ? ' FOR UPDATE' : ' FOR SHARE'}`,
      [worldId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  const state: WorldState = { ...row.state, version: row.version, ownerId: row.owner_id };
  const clock = (
    await sql.query('SELECT * FROM parallel_life.world_clock WHERE world_id=$1', [worldId])
  ).rows[0];
  if (clock) {
    const projected = projectStoryTime(
      {
        storyNow: new Date(clock.story_now).toISOString(),
        lastTickAt: new Date(clock.last_tick_at).toISOString(),
        speed: Number(clock.speed),
        paused: clock.paused,
        missedBeats: clock.missed_beats,
        summary: clock.summary,
      },
      now,
    );
    state.time = projected > state.time ? projected : state.time;
  }
  const initial = (
    await sql.query('SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
      worldId,
    ])
  ).rows[0]?.state;
  const facts = (
    await sql.query(
      'SELECT document FROM parallel_life.world_facts WHERE world_id=$1 ORDER BY ordinal',
      [worldId],
    )
  ).rows.map((r) => r.document);
  state.facts = [...(initial?.facts ?? []), ...facts].filter(
    (f, i, all) => all.findIndex((a) => a.id === f.id) === i,
  );
  state.appointments = (
    await sql.query(
      'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 ORDER BY id',
      [worldId],
    )
  ).rows.map((r) => r.document);
  const responses = (
    await sql.query(
      "SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version<=$2 AND payload->>'type'='invitation.responded' ORDER BY version",
      [worldId, state.version],
    )
  ).rows;
  for (const row of responses) {
    const event = row.payload as InvitationEvent;
    const hydrated = applyInvitationEvent(
      { ...state, version: event.version - 1, time: event.storyTime },
      event,
    );
    state.appointments = hydrated.appointments;
  }
  // Group processing deliberately never loads world_messages or private memories.
  state.messages = [];
  return state;
}
async function experienceContext(sql: SqlClient, world: WorldState): Promise<ExperienceContext> {
  const rows = (
    await sql.query(
      'SELECT id,version,owner_id,world_id FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
      [world.id],
    )
  ).rows;
  return {
    world,
    events: rows.map((r) => ({
      id: r.id,
      version: r.version,
      ownerId: r.owner_id,
      worldId: r.world_id,
    })),
  };
}
async function loadGroup(
  sql: SqlClient,
  worldId: string,
  groupId: string,
): Promise<GroupConversation> {
  const row = (
    await sql.query('SELECT * FROM parallel_life.world_groups WHERE world_id=$1 AND id=$2', [
      worldId,
      groupId,
    ])
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  const rows = (
    await sql.query(
      'SELECT * FROM parallel_life.world_group_memberships WHERE group_id=$1 AND world_id=$2 ORDER BY joined_version,member_key',
      [groupId, worldId],
    )
  ).rows;
  return GroupConversationSchema.parse({
    id: row.id,
    title: row.title,
    ownerId: row.owner_id,
    worldId: row.world_id,
    sourceEventId: row.source_event_id,
    sourceVersion: row.source_version,
    memberships: rows.map((m) => ({
      participant: m.participant,
      joinedVersion: m.joined_version,
      ...(m.left_version === null ? {} : { leftVersion: m.left_version }),
      sourceEventId: m.source_event_id,
      sourceVersion: m.joined_version,
    })),
  });
}
export async function loadGroupRead(
  sql: SqlClient,
  worldId: string,
  groupId: string,
  now: string,
  lock = false,
): Promise<GroupRead> {
  const world = await loadWorld(sql, worldId, now, lock);
  const group = await loadGroup(sql, worldId, groupId);
  const context = await experienceContext(sql, world);
  const rows = (
    await sql.query(
      'SELECT m.document,e.payload,e.occurred_at FROM parallel_life.world_group_messages m JOIN parallel_life.world_events e ON e.id=m.source_event_id AND e.world_id=m.world_id WHERE m.group_id=$1 AND m.world_id=$2 ORDER BY m.source_version,m.id',
      [groupId, worldId],
    )
  ).rows;
  const messages = rows.map((r) => GroupMessageSchema.parse(r.document));
  const messageTimes = Object.fromEntries(
    rows.map((r) => [
      r.document.id,
      { storyAt: r.payload.storyAt, occurredAt: new Date(r.occurred_at).toISOString() },
    ]),
  );
  return { world, group, context, messages, messageTimes };
}
/** One transaction owns World state/event, group projections and the command receipt. */
export async function persistGroupEvent(
  sql: SqlClient,
  world: WorldState,
  event: GroupEvent,
  hash: string,
): Promise<GroupReceipt> {
  const context = await experienceContext(sql, world);
  const previous =
    event.type === 'group.created' ? undefined : await loadGroup(sql, world.id, event.data.groupId);
  const next = applyWorldHistoryEvent(world, event).state;
  const committedContext: ExperienceContext = {
    world: next,
    events: [
      ...context.events,
      { id: event.id, version: event.version, worldId: event.worldId, ownerId: event.ownerId },
    ],
  };
  const projection = reduceGroupEvent(committedContext, previous, event);
  await sql.query(
    "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
    [event.commandId, world.id, world.ownerId, world.version, hash, event],
  );
  await sql.query(
    'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [event.id, world.id, world.ownerId, next.version, event.commandId, event, event.occurredAt],
  );
  if (event.type === 'group.created')
    await sql.query(
      'INSERT INTO parallel_life.world_groups(id,world_id,owner_id,title,source_event_id,source_version) VALUES($1,$2,$3,$4,$5,$6)',
      [
        projection.group.id,
        world.id,
        world.ownerId,
        projection.group.title,
        event.id,
        event.version,
      ],
    );
  for (const member of projection.group.memberships) {
    if (member.sourceEventId === event.id)
      await sql.query(
        'INSERT INTO parallel_life.world_group_memberships(world_id,owner_id,group_id,member_key,participant,joined_version,source_event_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          world.id,
          world.ownerId,
          projection.group.id,
          key(member.participant),
          member.participant,
          member.joinedVersion,
          event.id,
        ],
      );
    else if (member.leftVersion === event.version)
      await sql.query(
        'UPDATE parallel_life.world_group_memberships SET left_version=$4,left_event_id=$5 WHERE world_id=$1 AND group_id=$2 AND member_key=$3 AND left_version IS NULL',
        [world.id, projection.group.id, key(member.participant), event.version, event.id],
      );
  }
  for (const message of projection.messages)
    await sql.query(
      'INSERT INTO parallel_life.world_group_messages(id,world_id,owner_id,group_id,source_event_id,source_version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [message.id, world.id, world.ownerId, projection.group.id, event.id, event.version, message],
    );
  if (event.type === 'group.turn_resolved')
    for (const [i, reply] of event.data.replies.entries()) {
      if (!reply.invitation) continue;
      const id = reply.invitation.id ?? event.id;
      await sql.query(
        'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
        [
          id,
          world.id,
          world.ownerId,
          {
            id,
            ...reply.invitation,
            participantIds: [reply.actorId],
            status: 'proposed',
            sourceEventId: event.id,
          },
        ],
      );
    }
  await sql.query(
    'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
    [world.id, next.version, compact(next)],
  );
  await sql.query(
    "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
    [world.id, event.commandId, event.id, compact(next)],
  );
  return {
    groupId: projection.group.id,
    version: event.version,
    eventId: event.id,
    commandId: event.commandId,
  };
}
async function writable(sql: SqlClient, worldId: string) {
  if (
    (await sql.query('SELECT paused FROM parallel_life.world_clock WHERE world_id=$1', [worldId]))
      .rows[0]?.paused
  )
    throw new DomainError('INVALID_COMMAND', 'WORLD_PAUSED');
}
export class PostgresGroupRepository {
  private readonly db: PostgresDatabase;
  private readonly now: () => string;
  constructor(db: PostgresDatabase, now = () => new Date().toISOString()) {
    this.db = db;
    this.now = now;
  }
  async read(ownerId: string, worldId: string, groupId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const read = await loadGroupRead(sql, worldId, groupId, this.now());
      const messages = groupHistory(read.context, read.group, read.messages, { kind: 'player' });
      const lastRead =
        (
          await sql.query(
            'SELECT last_read_version FROM parallel_life.world_group_reads WHERE group_id=$1 AND world_id=$2',
            [groupId, worldId],
          )
        ).rows[0]?.last_read_version ?? 0;
      return {
        group: read.group,
        version: read.world.version,
        storyAt: read.world.time,
        messages,
        messageTimes: Object.fromEntries(messages.map((m) => [m.id, read.messageTimes![m.id]])),
        lastReadVersion: lastRead,
        unread: messages.filter((m) => m.sender.kind === 'actor' && m.sourceVersion > lastRead)
          .length,
      };
    });
  }
  async markRead(ownerId: string, worldId: string, groupId: string, throughVersion: number) {
    return this.db.transaction(ownerId, async (sql) => {
      const read = await loadGroupRead(sql, worldId, groupId, this.now());
      const visible = groupHistory(read.context, read.group, read.messages, { kind: 'player' });
      const message = visible.find((m) => m.sourceVersion === throughVersion);
      if (!message) throw new DomainError('INVALID_COMMAND');
      await sql.query(
        'INSERT INTO parallel_life.world_group_reads(world_id,owner_id,group_id,last_read_version,source_event_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(group_id) DO UPDATE SET last_read_version=EXCLUDED.last_read_version,source_event_id=EXCLUDED.source_event_id WHERE world_group_reads.last_read_version<EXCLUDED.last_read_version',
        [worldId, ownerId, groupId, throughVersion, message.sourceEventId],
      );
      return {
        groupId,
        lastReadVersion: (
          await sql.query(
            'SELECT last_read_version FROM parallel_life.world_group_reads WHERE group_id=$1',
            [groupId],
          )
        ).rows[0].last_read_version,
      };
    });
  }
  async list(ownerId: string, worldId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const world = await loadWorld(sql, worldId, this.now());
      const rows = (
        await sql.query(
          'SELECT id FROM parallel_life.world_groups WHERE world_id=$1 ORDER BY source_version,id',
          [worldId],
        )
      ).rows;
      const groups = [];
      for (const row of rows) groups.push(await loadGroup(sql, worldId, row.id));
      return { version: world.version, storyAt: world.time, groups };
    });
  }
  private async mutate(
    ownerId: string,
    command: GroupCommand,
    tag: string,
    data: unknown,
    build: (world: WorldState) => GroupEvent,
  ) {
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const world = await loadWorld(sql, command.worldId, this.now(), true);
      const hash = requestHash([tag, command, data]);
      const old = (
        await sql.query(
          'SELECT request_hash,result_event_id,result_state FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
          [command.worldId, command.commandId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
        const ev = (
          await sql.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
            old.result_event_id,
          ])
        ).rows[0]?.payload;
        if (!ev) throw new DomainError('VERSION_CONFLICT');
        return {
          groupId: ev.data.groupId,
          version: ev.version,
          eventId: ev.id,
          commandId: command.commandId,
        } as GroupReceipt;
      }
      if (world.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      await writable(sql, world.id);
      const event = build(world);
      return persistGroupEvent(sql, world, event, hash);
    });
  }
  create(ownerId: string, command: GroupCommand & { title: string; actorIds: string[] }) {
    return this.mutate(
      ownerId,
      command,
      'group.created',
      [command.title, command.actorIds],
      (world) => ({
        schemaVersion: 1,
        id: randomUUID(),
        ownerId,
        worldId: world.id,
        commandId: command.commandId,
        version: world.version + 1,
        occurredAt: this.now(),
        storyAt: world.time,
        type: 'group.created',
        data: { groupId: randomUUID(), title: command.title, actorIds: command.actorIds },
      }),
    );
  }
  membership(
    ownerId: string,
    command: GroupCommand & { groupId: string; participant: Participant; action: 'join' | 'leave' },
  ) {
    return this.mutate(
      ownerId,
      command,
      'group.membership_changed',
      [command.groupId, command.participant, command.action],
      (world) => ({
        schemaVersion: 1,
        id: randomUUID(),
        ownerId,
        worldId: world.id,
        commandId: command.commandId,
        version: world.version + 1,
        occurredAt: this.now(),
        storyAt: world.time,
        type: 'group.membership_changed',
        data: {
          groupId: command.groupId,
          participant: command.participant,
          action: command.action,
        },
      }),
    );
  }
  async send(ownerId: string, command: GroupCommand & { groupId: string; text: string }) {
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const world = await loadWorld(sql, command.worldId, this.now(), true);
      const hash = requestHash(['group.message_sent', command]);
      const old = (
        await sql.query(
          'SELECT request_hash,result_event_id FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
          [world.id, command.commandId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
        const task = await enqueue(sql, ownerId, 'world', world.id, command.commandId, {}, hash);
        const accepted = (
          await sql.query('SELECT version FROM parallel_life.world_events WHERE id=$1', [
            old.result_event_id,
          ])
        ).rows[0];
        return { task, groupId: command.groupId, version: accepted.version };
      }
      if (world.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      await writable(sql, world.id);
      const event: GroupEvent = {
        schemaVersion: 1,
        id: randomUUID(),
        ownerId,
        worldId: world.id,
        commandId: command.commandId,
        version: world.version + 1,
        occurredAt: this.now(),
        storyAt: world.time,
        type: 'group.message_sent',
        data: { groupId: command.groupId, text: command.text, messageId: randomUUID() },
      };
      const receipt = await persistGroupEvent(sql, world, event, hash);
      const input: GroupTaskInput = {
        channel: 'group',
        worldId: world.id,
        groupId: command.groupId,
        expectedVersion: event.version,
        inputEventId: event.id,
        text: command.text,
      };
      const task = await enqueue(sql, ownerId, 'world', world.id, command.commandId, input, hash);
      return { task, groupId: receipt.groupId, version: receipt.version };
    });
  }
}
export function groupReplyEvent(
  ownerId: string,
  world: WorldState,
  taskId: string,
  groupId: string,
  replies: GroupReply[],
  now: string,
): GroupEvent {
  return {
    schemaVersion: 1,
    type: 'group.turn_resolved',
    id: randomUUID(),
    ownerId,
    worldId: world.id,
    version: world.version + 1,
    commandId: taskId,
    occurredAt: now,
    storyAt: world.time,
    data: {
      groupId,
      replies: replies.map((r) => ({
        ...r,
        messageId: randomUUID(),
        ...(r.invitation
          ? {
              invitation: {
                ...r.invitation,
                at: new Date(r.invitation.at).toISOString(),
                id: randomUUID(),
              },
            }
          : {}),
      })),
    },
  };
}
