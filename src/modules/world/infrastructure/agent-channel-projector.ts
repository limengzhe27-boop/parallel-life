import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { AgentAttempt, AgentStatement } from '../domain/agent-runtime.ts';
import type { AgentRuntimeTransition } from '../domain/agent-state-event.ts';
import type { WorldEffect, WorldState } from '../domain/types.ts';
import { reduceGroupEvent, currentGroupMember } from '../domain/group-runtime.ts';
import {
  assertSceneEntry,
  type ExperienceContext,
  type SceneEntry,
} from '../domain/experience-rules.ts';
import { scenePresent } from '../domain/scene-runtime.ts';
import { applyWorldHistoryEvent, type WorldHistoryEvent } from '../domain/world-history.ts';
import { DomainError } from '../domain/errors.ts';
import { loadGroupRead } from './group-repository.ts';
import { loadScene } from './scene-repository.ts';
import { compactWorldState } from './postgres-world-repository.ts';

export type NativeAgentChannelProjection = {
  attempt: AgentAttempt;
  snapshot: AgentSnapshot;
  transition: AgentRuntimeTransition;
  eventId: string;
  occurredAt: string;
  storyAt: string;
  effects: WorldEffect[];
  statements: AgentStatement[];
};
function reject(reason: string): never {
  throw new DomainError('INVALID_PROPOSAL', reason);
}

/** Deterministic UUIDv8; existing channel read contracts require UUID projection IDs. */
export function nativeAgentProjectionId(
  eventId: string,
  channel: 'group' | 'scene',
  index: number,
): string {
  const hex = createHash('sha256')
    .update(JSON.stringify([eventId, channel, index]))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** App-only UoW component. Caller owns begin/finishAgentCommit and the transaction. */
export async function projectNativeAgentChannelInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: NativeAgentChannelProjection,
): Promise<void> {
  const { attempt, snapshot, transition, eventId, occurredAt, storyAt, effects, statements } =
    input;
  const channel = snapshot.channel;
  if (!['group', 'scene'].includes(channel.kind)) reject('NATIVE_CHANNEL_REQUIRED');
  const row = (
    await sql.query(
      'SELECT owner_id,version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [attempt.worldId, ownerId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  if (row.version !== attempt.expectedWorldVersion || snapshot.worldVersion !== row.version)
    throw new DomainError('VERSION_CONFLICT');
  const fence = (
    await sql.query(
      "SELECT current_setting('app.agent_commit_attempt_id',true) AS attempt,current_setting('app.agent_world_id',true) AS world,current_setting('app.agent_engine_epoch',true) AS epoch",
    )
  ).rows[0];
  if (
    fence.attempt !== attempt.id ||
    fence.world !== attempt.worldId ||
    Number(fence.epoch) !== attempt.engineEpoch
  )
    reject('AGENT_UOW_REQUIRED');
  const receipt = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
      [attempt.worldId, ownerId, attempt.inputReceiptId],
    )
  ).rows[0]?.document;
  const source = snapshot.sources.find((s) => s.id === snapshot.input.sourceId);
  if (
    !receipt ||
    receipt.channel !== channel.kind ||
    receipt.threadId !== channel.threadId ||
    (receipt.recipientActorId !== null && receipt.recipientActorId !== attempt.actorId) ||
    receipt.inputHash !== attempt.inputHash ||
    receipt.text !== snapshot.input.text ||
    receipt.origin !== snapshot.input.origin ||
    !source ||
    source.id !== receipt.id ||
    source.kind !== 'accepted_input' ||
    source.at !== receipt.storyAt ||
    source.worldVersion !== receipt.expectedWorldVersion ||
    transition.inputReceiptId !== receipt.id ||
    transition.inputStoryAt !== receipt.storyAt ||
    transition.inputWorldVersion !== receipt.expectedWorldVersion ||
    receipt.expectedWorldVersion > row.version
  )
    reject('NATIVE_INPUT_SOURCE_MISMATCH');
  const version = row.version + 1;
  if (
    snapshot.state.worldId !== attempt.worldId ||
    snapshot.state.actorId !== attempt.actorId ||
    transition.stateAfter.worldId !== attempt.worldId ||
    transition.stateAfter.actorId !== attempt.actorId ||
    transition.actorRevisionBefore !== attempt.expectedActorRevision ||
    transition.actorRevisionAfter !== attempt.expectedActorRevision + 1 ||
    transition.stateAfter.revision !== transition.actorRevisionAfter ||
    transition.stateAfter.projectedWorldVersion !== version ||
    transition.engineEpoch !== attempt.engineEpoch ||
    !isDeepStrictEqual(statements, transition.proposal.statements)
  )
    reject('NATIVE_TRANSITION_MISMATCH');
  if (
    !Number.isFinite(Date.parse(storyAt)) ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    Date.parse(storyAt) < Date.parse(row.state.time) ||
    Date.parse(receipt.storyAt) > Date.parse(storyAt)
  )
    reject('NATIVE_CLOCK_INVALID');
  const messages = effects.filter((e) => e.type === 'message.received');
  if (
    messages.length &&
    (!isDeepStrictEqual(
      messages.map((e) => e.text),
      statements.map((s) => s.text),
    ) ||
      messages.some((e) => e.actorId !== attempt.actorId))
  )
    reject('NATIVE_SPEAKER_MISMATCH');
  for (const effect of effects) {
    if (effect.type === 'message.received') continue;
    if (effect.type !== 'appointment.proposed') reject('NATIVE_EFFECT_UNSUPPORTED');
    if (effect.participantIds.length !== 1 || effect.participantIds[0] !== attempt.actorId)
      reject('NATIVE_EFFECT_ACTOR');
  }
  const initial = (
    await sql.query(
      'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
      [attempt.worldId, ownerId],
    )
  ).rows[0]?.state;
  const projectedAppointments = (
    await sql.query(
      'SELECT document FROM parallel_life.world_appointments WHERE world_id=$1 AND owner_id=$2',
      [attempt.worldId, ownerId],
    )
  ).rows.map((r) => r.document);
  const world: WorldState = {
    ...row.state,
    ownerId,
    version: row.version,
    messages: [],
    appointments: [
      ...new Map(
        [
          ...(initial?.appointments ?? []),
          ...(row.state.appointments ?? []),
          ...projectedAppointments,
        ].map((a) => [a.id, a]),
      ).values(),
    ] as WorldState['appointments'],
  };
  const common = {
    schemaVersion: 1 as const,
    id: eventId,
    ownerId,
    worldId: attempt.worldId,
    commandId: attempt.commandId,
    version,
    occurredAt,
    storyAt,
  };
  let event: WorldHistoryEvent;
  let groupProjection: ReturnType<typeof reduceGroupEvent> | undefined;
  let sceneEntries: SceneEntry[] = [];
  if (channel.kind === 'group') {
    const read = await loadGroupRead(sql, attempt.worldId, channel.threadId, occurredAt);
    if (
      !currentGroupMember(read.group, { kind: 'player' }) ||
      !currentGroupMember(read.group, { kind: 'actor', actorId: attempt.actorId })
    )
      reject('NATIVE_GROUP_SCOPE');
    const text = statements.map((s) => s.text).join('\n');
    if (statements.length && (!text.trim() || text.length > 500)) reject('NATIVE_GROUP_TEXT_LIMIT');
    const groupEvent = {
      ...common,
      type: 'group.turn_resolved' as const,
      data: {
        groupId: channel.threadId,
        actorId: attempt.actorId,
        agentRuntime: transition,
        effects: effects.filter((e) => e.type !== 'message.received'),
        replies: statements.length
          ? [
              {
                actorId: attempt.actorId,
                messageId: nativeAgentProjectionId(eventId, 'group', 0),
                text,
              },
            ]
          : [],
      },
    };
    const context = {
      ...read.context,
      world: { ...world, version },
      events: [...read.context.events, { id: eventId, ownerId, worldId: world.id, version }],
    };
    groupProjection = reduceGroupEvent(context, read.group, groupEvent);
    event = groupEvent;
  } else {
    const current = await loadScene(sql, attempt.worldId, channel.threadId);
    const experience = (
      await sql.query(
        'SELECT current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1 AND owner_id=$2',
        [attempt.worldId, ownerId],
      )
    ).rows[0];
    const present = scenePresent(current.scene, row.version);
    if (
      experience?.current_scene_id !== current.scene.id ||
      current.scene.status !== 'active' ||
      !present.some((p) => p.kind === 'player') ||
      !present.some((p) => p.kind === 'actor' && p.actorId === attempt.actorId) ||
      (current.scene.placeId && world.space?.currentPlaceId !== current.scene.placeId)
    )
      reject('NATIVE_SCENE_SCOPE');
    const oldEvents = (
      await sql.query(
        'SELECT id,version FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2',
        [attempt.worldId, ownerId],
      )
    ).rows.map((r) => ({
      id: String(r.id),
      version: Number(r.version),
      worldId: world.id,
      ownerId,
    }));
    const context: ExperienceContext = {
      world: { ...world, version },
      events: [...oldEvents, { id: eventId, version, worldId: world.id, ownerId }],
    };
    sceneEntries = statements.map((s, index) => {
      if (!s.text.trim() || s.text.length > 4000) reject('NATIVE_SCENE_TEXT_LIMIT');
      const entry: SceneEntry = {
        id: nativeAgentProjectionId(eventId, 'scene', index),
        worldId: world.id,
        ownerId,
        sceneId: current.scene.id,
        sourceEventId: eventId,
        sourceVersion: version,
        kind: 'dialogue',
        speaker: { kind: 'actor', actorId: attempt.actorId },
        text: s.text,
        observableTo: present,
      };
      assertSceneEntry(context, current.scene, entry, current.actions);
      return entry;
    });
    event = {
      ...common,
      type: 'scene.reaction_recorded' as const,
      data: {
        sceneId: current.scene.id,
        actorId: attempt.actorId,
        agentRuntime: transition,
        effects: effects.filter((e) => e.type !== 'message.received'),
        dialogues: sceneEntries,
        presenceUnchanged: true,
      },
    };
  }
  const { state: next, jobs } = applyWorldHistoryEvent(world, event);
  // Until the root native-effects replay hook is present, fail instead of saving
  // a calendar projection that replay would silently lose.
  for (const effect of effects)
    if (
      effect.type === 'appointment.proposed' &&
      !next.appointments.some(
        (a) => a.id === effect.id && a.sourceEventId === eventId && a.status === 'proposed',
      )
    )
      reject('NATIVE_EFFECT_REPLAY_UNSUPPORTED');
  const compact = compactWorldState(next);
  await sql.query(
    "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
    [
      attempt.commandId,
      world.id,
      ownerId,
      row.version,
      attempt.inputHash,
      { channel: channel.kind, threadId: channel.threadId, inputReceiptId: receipt.id, event },
    ],
  );
  await sql.query(
    'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [eventId, world.id, ownerId, version, attempt.commandId, event, occurredAt],
  );
  for (const message of groupProjection?.messages ?? [])
    await sql.query(
      'INSERT INTO parallel_life.world_group_messages(id,world_id,owner_id,group_id,source_event_id,source_version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [message.id, world.id, ownerId, channel.threadId, eventId, version, message],
    );
  for (const entry of sceneEntries)
    await sql.query(
      "INSERT INTO parallel_life.scene_items(id,world_id,owner_id,scene_id,source_event_id,kind,document) VALUES($1,$2,$3,$4,$5,'entry',$6)",
      [entry.id, world.id, ownerId, channel.threadId, eventId, entry],
    );
  for (const appointment of next.appointments.filter((a) => a.sourceEventId === eventId))
    await sql.query(
      'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
      [appointment.id, world.id, ownerId, appointment],
    );
  for (const job of jobs)
    await sql.query(
      'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [job.id, world.id, ownerId, eventId, job],
    );
  await sql.query(
    'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1 AND owner_id=$4',
    [world.id, version, compact, ownerId],
  );
  await sql.query(
    "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2 AND owner_id=$5",
    [world.id, attempt.commandId, eventId, compact, ownerId],
  );
}
