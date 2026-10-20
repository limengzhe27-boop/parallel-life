import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSource } from '../domain/agent-runtime.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { Participant, MembershipInterval } from '../domain/experience-rules.ts';
import { canReadGroupMessage } from '../domain/experience-rules.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { loadGroupRead } from './group-repository.ts';
import { isStreamPrefixWorldVersion } from './npc-stream-segment-repository.ts';

export type ActorGroupObservationFrame = {
  worldId: string;
  actorId: string;
  engineEpoch: number;
  worldVersion: number;
  storyAt: string;
  groupId: string;
  sourceIds?: readonly string[];
  consumedSources?: readonly { sourceId: string; contentHash: string }[];
  maxBytes?: number;
  maxEntries?: number;
};
export type ActorGroupObservationSources = {
  sources: AgentSource[];
  observations: AgentSnapshot['observations'];
  omittedSourceIds: string[];
  groupIds: string[];
  status: 'complete' | 'budget_limited';
};
const key = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(s);
const hash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const fail = (code: string): never => {
  throw Object.assign(Error(code), { code });
};
const sameParticipant = (a: Participant, b: Participant) => isDeepStrictEqual(a, b);

/**
 * Actual historical hearers only. This is private recall material, not a new group/scene disclosure
 * grant, verified location, pending queue, or ACK. Caller owns the original transaction and fences.
 */
export async function readActorGroupObservationSourcesInTransaction(
  sql: SqlClient,
  owner: string,
  frame: ActorGroupObservationFrame,
): Promise<ActorGroupObservationSources> {
  const maxBytes = frame.maxBytes ?? 16000;
  const maxEntries = frame.maxEntries ?? 80;
  if (
    ![owner, frame.worldId, frame.actorId, frame.groupId].every(key) ||
    !integer(frame.engineEpoch) ||
    frame.engineEpoch < 2 ||
    !integer(frame.worldVersion) ||
    !Number.isFinite(Date.parse(frame.storyAt)) ||
    !integer(maxBytes) ||
    maxBytes > 1_000_000 ||
    !integer(maxEntries) ||
    maxEntries > 500 ||
    (frame.sourceIds !== undefined &&
      (frame.sourceIds.length > 1000 || !frame.sourceIds.every(key))) ||
    (frame.consumedSources !== undefined &&
      (frame.consumedSources.length > 10000 ||
        !frame.consumedSources.every((s) => key(s.sourceId) && hash(s.contentHash))))
  )
    fail('ACTOR_GROUP_OBSERVATION_INVALID_FRAME');
  const world = (
    await sql.query(
      `SELECT w.version,w.state,c.engine_epoch FROM parallel_life.worlds w
     JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
     WHERE w.id=$1 AND w.owner_id=$2`,
      [frame.worldId, owner],
    )
  ).rows[0];
  if (
    !world ||
    world.state.id !== frame.worldId ||
    world.state.ownerId !== owner ||
    !world.state.actors.some((a: { id: string }) => a.id === frame.actorId)
  )
    fail('ACTOR_GROUP_OBSERVATION_FORBIDDEN');
  const isPrefix =
    world &&
    (await isStreamPrefixWorldVersion(
      sql,
      owner,
      frame.worldId,
      frame.actorId,
      frame.worldVersion,
      world.version,
    ));
  if (
    (world.version !== frame.worldVersion && !isPrefix) ||
    world.engine_epoch !== frame.engineEpoch ||
    Date.parse(frame.storyAt) < Date.parse(world.state.time)
  )
    fail('ACTOR_GROUP_OBSERVATION_VERSION_CONFLICT');
  const read = await loadGroupRead(sql, frame.worldId, frame.groupId, new Date().toISOString());
  if (
    read.group.worldId !== frame.worldId ||
    read.group.ownerId !== owner ||
    read.world.id !== frame.worldId ||
    read.world.ownerId !== owner ||
    (read.world.version !== frame.worldVersion && !isPrefix)
  )
    fail('ACTOR_GROUP_OBSERVATION_FORBIDDEN');
  const committed = (
    await sql.query(
      `SELECT e.id,e.version,e.payload,
       EXISTS(SELECT 1 FROM parallel_life.agent_attempts a WHERE a.world_id=e.world_id AND a.owner_id=e.owner_id
         AND a.event_id=e.id AND a.command_id=e.command_id AND a.status='committed'
         AND a.actor_id=e.payload->'data'->>'actorId' AND a.expected_world_version<e.version
         AND c.expected_version=e.version-1
         AND a.engine_epoch=(e.payload->'data'->'agentRuntime'->>'engineEpoch')::integer) AS native_committed
     FROM parallel_life.world_events e JOIN parallel_life.commands c
       ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
       AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 AND e.payload->'data'->>'groupId'=$4
     ORDER BY e.version`,
      [frame.worldId, owner, frame.worldVersion, frame.groupId],
    )
  ).rows;
  const events = new Map(
    committed
      .filter(
        (r) =>
          r.payload?.id === r.id &&
          r.payload?.version === r.version &&
          r.payload?.worldId === frame.worldId &&
          r.payload?.ownerId === owner,
      )
      .map((r) => [r.id as string, r]),
  );
  const origin = events.get(read.group.sourceEventId);
  if (
    !origin ||
    origin.version !== read.group.sourceVersion ||
    origin.payload.type !== 'group.created' ||
    origin.payload.data.groupId !== frame.groupId
  )
    fail('ACTOR_GROUP_OBSERVATION_GROUP_PROOF_REQUIRED');
  const intervalProof = (membership: MembershipInterval) => {
    const joined = events.get(membership.sourceEventId);
    if (
      !joined ||
      joined.version !== membership.sourceVersion ||
      joined.version !== membership.joinedVersion ||
      !(
        (joined.payload.type === 'group.created' &&
          (membership.participant.kind === 'player' ||
            joined.payload.data.actorIds?.includes(membership.participant.actorId))) ||
        (joined.payload.type === 'group.membership_changed' &&
          joined.payload.data.action === 'join' &&
          sameParticipant(joined.payload.data.participant, membership.participant))
      )
    )
      fail('ACTOR_GROUP_OBSERVATION_MEMBERSHIP_PROOF_REQUIRED');
    if (membership.leftVersion !== undefined) {
      const left = committed.find((r) => r.version === membership.leftVersion && events.has(r.id));
      if (
        !left ||
        membership.leftVersion <= membership.joinedVersion ||
        left.payload.type !== 'group.membership_changed' ||
        left.payload.data.action !== 'leave' ||
        !sameParticipant(left.payload.data.participant, membership.participant)
      )
        fail('ACTOR_GROUP_OBSERVATION_MEMBERSHIP_PROOF_REQUIRED');
    }
    // Stable historical acquisition identity; later departures do not change what was heard.
    return {
      sourceEventId: joined.id as string,
      sourceVersion: joined.version as number,
      joinedVersion: membership.joinedVersion,
      participant: membership.participant,
    };
  };
  const observer: Participant = { kind: 'actor', actorId: frame.actorId };
  const ownMemberships = read.group.memberships.filter((m) =>
    sameParticipant(m.participant, observer),
  );
  for (const membership of ownMemberships) intervalProof(membership);
  const blocked = await forgottenAgentSourceIds(sql, owner, frame.worldId, frame.actorId);
  const requested = frame.sourceIds === undefined ? null : new Set(frame.sourceIds);
  const consumed = new Set(
    (frame.consumedSources ?? []).map((s) => JSON.stringify([s.sourceId, s.contentHash])),
  );
  const messageRows = (
    await sql.query(
      'SELECT id,source_event_id,source_version,document FROM parallel_life.world_group_messages WHERE world_id=$1 AND owner_id=$2 AND group_id=$3',
      [frame.worldId, owner, frame.groupId],
    )
  ).rows;
  const rowsById = new Map(messageRows.map((r) => [r.id as string, r]));
  const authorized: { source: AgentSource; observation: AgentSnapshot['observations'][number] }[] =
    [];
  for (const parsed of read.messages) {
    const stored = rowsById.get(parsed.id);
    if (!stored || stored.document.id !== stored.id || typeof stored.document.text !== 'string')
      continue;
    // The legacy UI schema trims text. Provenance and recall must retain the original full bytes.
    const message = { ...parsed, text: stored.document.text as string };
    const id = 'group:' + message.id;
    // Own successful speech is traceable history, not fresh external input to wake oneself again.
    if (!requested && message.sender.kind === 'actor' && message.sender.actorId === frame.actorId)
      continue;
    if (
      (requested && !requested.has(id)) ||
      message.ownerId !== owner ||
      message.worldId !== frame.worldId ||
      message.conversationId !== frame.groupId ||
      message.sourceVersion > frame.worldVersion ||
      [id, message.id, message.sourceEventId].some((alias) => blocked.has(alias))
    )
      continue;
    const row = rowsById.get(message.id);
    const event = events.get(message.sourceEventId);
    if (
      !row ||
      !event ||
      row.source_event_id !== message.sourceEventId ||
      row.source_version !== message.sourceVersion ||
      event.version !== message.sourceVersion ||
      !Number.isFinite(Date.parse(event.payload.storyAt)) ||
      !Number.isFinite(Date.parse(event.payload.occurredAt)) ||
      Date.parse(event.payload.storyAt) > Date.parse(frame.storyAt)
    )
      continue;
    const membership = ownMemberships.find(
      (m) =>
        m.joinedVersion <= message.sourceVersion &&
        (m.leftVersion === undefined || message.sourceVersion < m.leftVersion),
    );
    if (!membership || !canReadGroupMessage(read.context, read.group, message, observer)) continue;
    const sender = read.group.memberships.find(
      (m) =>
        sameParticipant(m.participant, message.sender) &&
        m.joinedVersion <= message.sourceVersion &&
        (m.leftVersion === undefined || message.sourceVersion < m.leftVersion),
    );
    if (!sender) continue;
    const senderProof = intervalProof(sender);
    const data = event.payload.data;
    let matches: boolean;
    if (message.sender.kind === 'player') {
      matches =
        event.payload.type === 'group.message_sent' &&
        data.text === message.text &&
        (data.messageId ?? event.id) === message.id;
    } else {
      const actorId = message.sender.actorId;
      const replies = Array.isArray(data.replies)
        ? data.replies.filter(
            (r: { actorId: string; text: string; messageId?: string }) =>
              r.actorId === actorId &&
              r.text === message.text &&
              (r.messageId ?? event.id) === message.id,
          )
        : [];
      matches =
        event.payload.type === 'group.turn_resolved' &&
        replies.length === 1 &&
        (!data.agentRuntime ||
          (event.native_committed &&
            data.actorId === actorId &&
            data.agentRuntime.stateAfter?.actorId === actorId &&
            data.agentRuntime.stateAfter?.worldId === frame.worldId));
    }
    // Current group writer supports text only; never turn a fabricated media reference into an image.
    if (!matches || !isDeepStrictEqual(message.media, [])) continue;
    const contentHash = createHash('sha256')
      .update(
        authoredMaterialCanonicalJson({
          message,
          eventId: event.id,
          eventVersion: event.version,
          eventType: event.payload.type,
          heard: intervalProof(membership),
          sender: senderProof,
        }),
      )
      .digest('hex');
    if (consumed.has(JSON.stringify([id, contentHash]))) continue;
    authorized.push({
      source: {
        id,
        kind: 'group_message',
        recordId: message.id,
        worldVersion: message.sourceVersion,
        at: event.payload.storyAt,
        contentHash,
      },
      observation: {
        sourceId: id,
        kind: 'speech',
        text: message.text,
        evidenceKind: message.sender.kind === 'player' ? 'player_report' : 'actor_report',
        eventOccurredAt: event.payload.occurredAt,
        storyAt: event.payload.storyAt,
        learnedAt: event.payload.storyAt,
        retrievedAt: frame.storyAt,
      },
    });
  }
  const selected: typeof authorized = [],
    omittedSourceIds: string[] = [];
  let bytes = 0;
  for (const entry of [...authorized].reverse()) {
    const size = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    if (selected.length >= maxEntries || bytes + size > maxBytes) {
      omittedSourceIds.unshift(entry.source.id);
      continue;
    }
    bytes += size;
    selected.unshift(entry);
  }
  return {
    sources: selected.map((r) => r.source),
    observations: selected.map((r) => r.observation),
    omittedSourceIds,
    groupIds: ownMemberships.length ? [frame.groupId] : [],
    status: omittedSourceIds.length ? 'budget_limited' : 'complete',
  };
}
