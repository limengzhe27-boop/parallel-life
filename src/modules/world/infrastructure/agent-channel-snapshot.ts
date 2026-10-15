import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { ActorAgentState, AgentInputReceipt, AgentSource } from '../domain/agent-runtime.ts';
import type { WorldState } from '../domain/types.ts';
import { authorizedAgentState } from '../domain/agent-kernel.ts';
import { groupHistory, currentGroupMember } from '../domain/group-runtime.ts';
import { sceneContextEntries, scenePresent, scenePrivateThought } from '../domain/scene-runtime.ts';
import { DomainError } from '../domain/errors.ts';
import { loadGroupRead } from './group-repository.ts';
import { loadScene } from './scene-repository.ts';
import { agentDefinitionRef, attachAgentWorldContext } from './agent-snapshot-repository.ts';
import { readActorStrategyBasis } from './agent-source-resolver.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { readPublicationActorModules } from '../../settings/infrastructure/publication-social-repository.ts';
import { selectActorPersona } from '../domain/actor-situation.ts';

function forbidden(): never {
  throw new DomainError('INVALID_COMMAND', 'NATIVE_SOURCE_FORBIDDEN');
}

/** Actual accepted native input, not an arbitrary accepted text or a fabricated player turn. */
async function inputProof(
  sql: SqlClient,
  ownerId: string,
  world: WorldState,
  actorId: string,
  receipt: AgentInputReceipt,
  storyAt: string,
): Promise<{ eventId: string; recordId: string }> {
  if (
    receipt.worldId !== world.id ||
    receipt.expectedWorldVersion > world.version ||
    Date.parse(receipt.storyAt) > Date.parse(storyAt) ||
    (receipt.recipientActorId !== null && receipt.recipientActorId !== actorId)
  )
    forbidden();
  const row = (
    await sql.query(
      `SELECT e.id,e.version,e.payload FROM parallel_life.world_events e
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
       AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE e.world_id=$1 AND e.owner_id=$2 AND e.command_id=$3 AND e.version=$4`,
      [world.id, ownerId, receipt.commandId, receipt.expectedWorldVersion],
    )
  ).rows[0];
  if (!row || (row.payload.storyAt ?? row.payload.storyTime) !== receipt.storyAt) forbidden();
  if (receipt.channel === 'group') {
    const read = await loadGroupRead(sql, world.id, receipt.threadId, receipt.receivedAt);
    if (
      !currentGroupMember(read.group, { kind: 'player' }) ||
      !currentGroupMember(read.group, { kind: 'actor', actorId })
    )
      forbidden();
    const visible = groupHistory({ ...read.context, world }, read.group, read.messages, {
      kind: 'actor',
      actorId,
    });
    const message = visible.find(
      (m) => m.sourceEventId === row.id && m.sender.kind === 'player' && m.text === receipt.text,
    );
    if (
      receipt.origin !== 'player' ||
      row.payload.type !== 'group.message_sent' ||
      row.payload.data.groupId !== receipt.threadId ||
      row.payload.data.text !== receipt.text ||
      !message
    )
      forbidden();
    return { eventId: String(row.id), recordId: message.id };
  }
  if (receipt.channel !== 'scene') forbidden();
  const scene = await loadScene(sql, world.id, receipt.threadId);
  const present = scenePresent(scene.scene, world.version);
  const originPresent = scenePresent(scene.scene, receipt.expectedWorldVersion);
  const experience = (
    await sql.query(
      'SELECT current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1 AND owner_id=$2',
      [world.id, ownerId],
    )
  ).rows[0];
  const action = scene.actions.find((a) => a.sourceEventId === row.id && a.text === receipt.text);
  const entry = scene.entries.find(
    (e) =>
      e.kind === 'user_action' &&
      e.actionId === action?.id &&
      e.sourceEventId === row.id &&
      e.text === receipt.text &&
      e.observableTo.some((p) => p.kind === 'actor' && p.actorId === actorId),
  );
  if (
    receipt.origin !== 'player' ||
    row.payload.type !== 'scene.input_recorded' ||
    row.payload.data.sceneId !== receipt.threadId ||
    row.payload.data.privateThought ||
    scenePrivateThought(receipt.text) ||
    !action ||
    !entry ||
    scene.scene.status !== 'active' ||
    experience?.current_scene_id !== scene.scene.id ||
    !present.some((p) => p.kind === 'actor' && p.actorId === actorId) ||
    !present.some((p) => p.kind === 'player') ||
    !originPresent.some((p) => p.kind === 'actor' && p.actorId === actorId) ||
    !originPresent.some((p) => p.kind === 'player')
  )
    forbidden();
  return { eventId: String(row.id), recordId: entry.id };
}

/** App path only. No private transcript/memory loading, source writes, location inference or model calls. */
export async function readNativeAgentSnapshot(
  db: PostgresDatabase,
  ownerId: string,
  world: WorldState,
  actorId: string,
  input: AgentInputReceipt,
  storyAt: string,
  state: ActorAgentState,
): Promise<AgentSnapshot> {
  if (
    !['group', 'scene'].includes(input.channel) ||
    world.ownerId !== ownerId ||
    state.worldId !== world.id ||
    state.actorId !== actorId ||
    state.definitionRef !== agentDefinitionRef(world, actorId) ||
    !Number.isFinite(Date.parse(storyAt)) ||
    Date.parse(storyAt) < Date.parse(world.time)
  )
    forbidden();
  const actor = world.actors.find((a) => a.id === actorId);
  if (!actor) forbidden();
  const modules = await readPublicationActorModules(db, ownerId, world.id, actorId);
  const snapshot = await db.transaction(ownerId, async (sql): Promise<AgentSnapshot> => {
    const current = (
      await sql.query('SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
        world.id,
        ownerId,
      ])
    ).rows[0];
    if (current?.version !== world.version) throw new DomainError('VERSION_CONFLICT');
    const storedState = (
      await sql.query(
        'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
        [world.id, ownerId, actorId],
      )
    ).rows[0]?.document;
    if (!isDeepStrictEqual(state, storedState)) throw new DomainError('VERSION_CONFLICT');
    const stored = (
      await sql.query(
        'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
        [world.id, ownerId, input.id],
      )
    ).rows[0]?.document;
    if (!isDeepStrictEqual(stored, input)) forbidden();
    const original = await inputProof(sql, ownerId, world, actorId, input, storyAt);
    const blocked = await forgottenAgentSourceIds(sql, ownerId, world.id, actorId);
    // Expand native message/entry/event/receipt aliases without a recall-window limit.
    let priorBlockedSize = -1;
    while (blocked.size && priorBlockedSize !== blocked.size) {
      priorBlockedSize = blocked.size;
      const aliases = (
        await sql.query(
          `SELECT r.id,array_agg(DISTINCT e.id) AS events FROM parallel_life.agent_input_receipts r
         JOIN parallel_life.world_events e ON e.world_id=r.world_id AND e.owner_id=r.owner_id
          AND (e.command_id=r.command_id OR e.payload->'data'->'agentRuntime'->>'inputReceiptId'=r.id)
         WHERE r.world_id=$1 AND r.owner_id=$2 AND r.document->>'channel'=$3 AND r.document->>'threadId'=$4
         AND (r.id=ANY($5::text[]) OR e.id=ANY($5::text[])
          OR EXISTS(SELECT 1 FROM parallel_life.world_group_messages m WHERE m.world_id=e.world_id AND m.source_event_id=e.id AND m.id=ANY($5::text[]))
          OR EXISTS(SELECT 1 FROM parallel_life.scene_items s WHERE s.world_id=e.world_id AND s.source_event_id=e.id AND s.id=ANY($5::text[]))) GROUP BY r.id`,
          [world.id, ownerId, input.channel, input.threadId, [...blocked]],
        )
      ).rows;
      for (const alias of aliases) {
        blocked.add(String(alias.id));
        for (const id of alias.events ?? []) blocked.add(String(id));
      }
    }
    if ([input.id, original.eventId, original.recordId].some((id) => blocked.has(id))) forbidden();
    const sources = new Map<string, AgentSource>();
    const observations: AgentSnapshot['observations'] = [];
    const add = (
      source: AgentSource,
      text?: string,
      kind: AgentSnapshot['observations'][number]['kind'] = 'speech',
    ) => {
      if (
        source.worldVersion > world.version ||
        Date.parse(source.at) > Date.parse(storyAt) ||
        blocked.has(source.id) ||
        blocked.has(source.recordId)
      )
        return;
      sources.set(source.id, { ...source, usage: 'channel_context' });
      if (text !== undefined) observations.push({ sourceId: source.id, text, kind });
    };
    const nativeEvents = (
      await sql.query(
        `SELECT e.id,e.version,jsonb_build_object('id',e.id,'type',e.payload->>'type',
          'storyAt',e.payload->>'storyAt','storyTime',e.payload->>'storyTime',
          'data',jsonb_build_object('groupId',e.payload->'data'->'groupId','sceneId',e.payload->'data'->'sceneId',
            'text',e.payload->'data'->'text','replies',e.payload->'data'->'replies',
            'privateThought',e.payload->'data'->'privateThought','dialogues',e.payload->'data'->'dialogues',
            'proposal',jsonb_build_object('narration',e.payload->'data'->'proposal'->'narration',
              'observation',e.payload->'data'->'proposal'->'observation','dialogues',e.payload->'data'->'proposal'->'dialogues'))) AS payload
       FROM parallel_life.world_events e JOIN parallel_life.commands c
       ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
       WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 AND (
        ($4='group' AND e.payload->>'type' IN ('group.message_sent','group.turn_resolved') AND e.payload->'data'->>'groupId'=$5)
        OR ($4='scene' AND e.payload->>'type' IN ('scene.input_recorded','scene.opened','scene.action_resolved','scene.reaction_recorded') AND e.payload->'data'->>'sceneId'=$5)
        OR e.id=ANY($6::text[]))`,
        [
          world.id,
          ownerId,
          world.version,
          input.channel,
          input.threadId,
          world.facts
            .filter(
              (f) =>
                f.kind === 'canonical' && f.visibility.kind === 'world' && !f.believedByActorId,
            )
            .map((f) => f.sourceEventId),
        ],
      )
    ).rows;
    const events = new Map(nativeEvents.map((e) => [String(e.id), e]));
    const stateHandles = [
      ...new Set(
        [...state.goals, ...state.plans, ...state.actions, ...state.responsibilities]
          .flatMap((item) => item.sourceIds)
          .concat(state.decisions.map((d) => d.sourceId)),
      ),
    ];
    if (input.channel === 'group') {
      const read = await loadGroupRead(sql, world.id, input.threadId, input.receivedAt);
      const visible = groupHistory({ ...read.context, world }, read.group, read.messages, {
        kind: 'actor',
        actorId,
      });
      for (const message of visible.filter(
        (m, index) => index >= visible.length - 80 || stateHandles.includes(`group:${m.id}`),
      )) {
        const event = events.get(message.sourceEventId);
        if (!event || event.version !== message.sourceVersion || blocked.has(message.sourceEventId))
          continue;
        const raw = event.payload;
        const matches =
          message.sender.kind === 'player'
            ? raw.type === 'group.message_sent' && raw.data.text === message.text
            : raw.type === 'group.turn_resolved' &&
              raw.data.replies?.some(
                (r: { actorId: string; text: string; messageId?: string }) =>
                  message.sender.kind === 'actor' &&
                  r.actorId === message.sender.actorId &&
                  r.text === message.text &&
                  (r.messageId ?? raw.id) === message.id,
              );
        if (!matches || raw.data.groupId !== input.threadId) continue;
        add(
          {
            id: `group:${message.id}`,
            kind: 'group_message',
            recordId: message.id,
            worldVersion: message.sourceVersion,
            at: raw.storyAt,
          },
          message.text,
        );
      }
    } else {
      const scene = await loadScene(sql, world.id, input.threadId);
      const visible = sceneContextEntries(scene.entries, { kind: 'actor', actorId });
      for (const entry of visible.filter(
        (e, index) => index >= visible.length - 80 || stateHandles.includes(`scene:${e.id}`),
      )) {
        const event = events.get(entry.sourceEventId);
        const heard = scenePresent(scene.scene, entry.sourceVersion).some(
          (p) => p.kind === 'actor' && p.actorId === actorId,
        );
        if (
          !event ||
          event.version !== entry.sourceVersion ||
          blocked.has(entry.sourceEventId) ||
          !heard ||
          (entry.kind === 'user_action' && scenePrivateThought(entry.text)) ||
          !('text' in entry)
        )
          continue;
        const raw = event.payload;
        const matches =
          entry.kind === 'user_action'
            ? raw.type === 'scene.input_recorded' &&
              !raw.data.privateThought &&
              scene.actions.some(
                (a) =>
                  a.id === entry.actionId && a.text === entry.text && a.sourceEventId === raw.id,
              )
            : entry.kind === 'dialogue'
              ? (raw.data.proposal?.dialogues ?? raw.data.dialogues ?? []).some(
                  (d: {
                    actorId?: string;
                    speaker?: { kind: string; actorId?: string };
                    text: string;
                  }) =>
                    entry.speaker.kind === 'actor' &&
                    d.text === entry.text &&
                    (d.actorId ?? d.speaker?.actorId) === entry.speaker.actorId,
                )
              : entry.kind === 'narration'
                ? raw.data.proposal?.narration === entry.text
                : entry.kind === 'adjudicated_result' &&
                  raw.type === 'scene.action_resolved' &&
                  raw.data.proposal?.observation === entry.text;
        if (!matches || raw.data.sceneId !== input.threadId) continue;
        add(
          {
            id: `scene:${entry.id}`,
            kind: 'scene_entry',
            recordId: entry.id,
            worldVersion: entry.sourceVersion,
            at: event.payload.storyAt,
          },
          entry.text,
          entry.kind === 'adjudicated_result'
            ? 'result'
            : entry.kind === 'narration'
              ? 'fact'
              : 'speech',
        );
      }
    }
    // Only actual public facts; a player's report of a location stays speech above.
    const initial = (
      await sql.query(
        'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
        [world.id, ownerId],
      )
    ).rows[0]?.state as WorldState | undefined;
    for (const fact of world.facts.filter(
      (f) => f.kind === 'canonical' && f.visibility.kind === 'world' && !f.believedByActorId,
    )) {
      if (
        fact.sourceEventId === `genesis:${world.id}` &&
        initial?.facts.some((f) => isDeepStrictEqual(f, fact))
      ) {
        add(
          {
            id: `fact:${fact.id}`,
            kind: 'authored',
            recordId: fact.id,
            worldVersion: 0,
            at: initial.time,
          },
          fact.text,
          'fact',
        );
        continue;
      }
      const event = events.get(fact.sourceEventId);
      if (!event || blocked.has(event.id) || blocked.has(fact.id)) continue;
      add(
        {
          id: `fact:${fact.id}`,
          kind: 'world_event',
          recordId: event.id,
          worldVersion: Number(event.version),
          at: event.payload.storyAt ?? event.payload.storyTime,
        },
        fact.text,
        'fact',
      );
    }
    const oldInputs = (
      await sql.query(
        `SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=ANY($3::text[])
       AND document->>'channel'=$4 AND document->>'threadId'=$5`,
        [world.id, ownerId, stateHandles, input.channel, input.threadId],
      )
    ).rows;
    for (const row of oldInputs) {
      const receipt = row.document as AgentInputReceipt;
      if (blocked.has(receipt.id)) continue;
      try {
        const proof = await inputProof(sql, ownerId, world, actorId, receipt, storyAt);
        if (blocked.has(proof.eventId) || blocked.has(proof.recordId)) continue;
        add({
          id: receipt.id,
          kind: 'accepted_input',
          recordId: receipt.id,
          worldVersion: receipt.expectedWorldVersion,
          at: receipt.storyAt,
        });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
      }
    }
    add({
      id: input.id,
      kind: 'accepted_input',
      recordId: input.id,
      worldVersion: input.expectedWorldVersion,
      at: input.storyAt,
    });
    // Own structured strategy can cross channels without importing private speech.
    // Existing channel sources retain their channel_context usage.
    for (const basis of await readActorStrategyBasis(sql, ownerId, state, world.version, storyAt)) {
      if (!sources.has(basis.id) && !blocked.has(basis.id) && !blocked.has(basis.recordId))
        sources.set(basis.id, basis);
    }
    return {
      state,
      ...authorizedAgentState(state, new Set(sources.keys())),
      worldVersion: world.version,
      storyAt,
      sources: [...sources.values()],
      observations,
      actor: {
        name: actor.name,
        persona: JSON.stringify({
          persona: actor.persona,
          relationship: actor.relationship,
          modules: selectActorPersona(modules, input.text),
        }),
        boundaries: '只代表本人，不公开未授权私人材料；语言和邀约不是执行结果。',
        definitionRef: state.definitionRef,
      },
      channel: {
        kind: input.channel as 'group' | 'scene',
        threadId: input.threadId,
        audienceActorIds:
          input.channel === 'group'
            ? (
                await loadGroupRead(sql, world.id, input.threadId, input.receivedAt)
              ).group.memberships
                .filter((m) => m.leftVersion === undefined && m.participant.kind === 'actor')
                .flatMap((m) => (m.participant.kind === 'actor' ? [m.participant.actorId] : []))
            : scenePresent(
                (await loadScene(sql, world.id, input.threadId)).scene,
                world.version,
              ).flatMap((p) => (p.kind === 'actor' ? [p.actorId] : [])),
        allowedCapabilities: ['plan.record', 'appointment.propose'],
      },
      input: { sourceId: input.id, text: input.text, origin: input.origin },
    };
  });
  const contextual = await attachAgentWorldContext(db, ownerId, snapshot);
  return {
    ...contextual,
    ...authorizedAgentState(state, new Set(contextual.sources.map((s) => s.id))),
  };
}
