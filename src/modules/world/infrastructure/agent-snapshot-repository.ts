import { readActorObservationInbox } from './actor-observation-inbox.ts';
import { readActorEpisodeResults } from './episode-result-context-repository.ts';
import { readEpisodeLifecycleContext } from './episode-lifecycle-repository.ts';
import { selectPlayerEpisodeManifest } from './player-episode-manifest-repository.ts';
import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt, ActorAgentState, AgentSource } from '../domain/agent-runtime.ts';
import { emptyActorAgentState } from '../domain/agent-runtime.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { actorContext } from '../application/actor-context.ts';
import type { ActorContext } from '../application/ports.ts';
import type { WorldState } from '../domain/types.ts';
import { loadActorMemories } from '../../memory/infrastructure/memory-store.ts';
import { readPublicationActorModules } from '../../settings/infrastructure/publication-social-repository.ts';
import { selectActorPersona } from '../domain/actor-situation.ts';
import { readActorSituation } from './actor-situation-repository.ts';
import { DomainError } from '../domain/errors.ts';
import { authorizedAgentState } from '../domain/agent-kernel.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { readActorStrategyBasis } from './agent-source-resolver.ts';
import { PostgresWorldAwarenessRepository } from './world-awareness-repository.ts';
import { awarenessLocalTime } from '../domain/world-awareness.ts';
import { MemoryRecordSchema } from '../../../contracts/memory.ts';
import { NPC_AGENT_CAPABILITIES } from '../domain/agent-capabilities.ts';
import { isEpisodeConsiderationInput } from './agent-episode-attention.ts';
import {
  parseEpisodeConsiderationIntent,
  validateEpisodeConsiderationInputInTransaction,
} from './agent-narrative-repository.ts';
import { readActorEpisodeIntentsInTransaction } from './actor-episode-intent-repository.ts';

export function agentDefinitionRef(
  world: Pick<WorldState, 'id' | 'actors'>,
  actorId: string,
): string {
  const actor = world.actors.find((item) => item.id === actorId);
  if (!actor) throw new DomainError('INVALID_COMMAND');
  return createHash('sha256')
    .update(JSON.stringify([world.id, actor.id, actor.persona, actor.relationship]))
    .digest('hex');
}

/** Explicit migration input, never a side effect of reading a character context. */
export function seedAgentFromVerifiedContext(
  context: ActorContext,
  sources: AgentSource[],
  definitionRef: string,
): ActorAgentState {
  const state = emptyActorAgentState(
    { worldId: context.worldId, actorId: context.actor.id },
    definitionRef,
    context.worldVersion,
  );
  const available = new Set(sources.map((source) => source.id));
  state.knowledgeSourceIds = context.facts
    .map((fact) => `fact:${fact.id}`)
    .filter((id) => available.has(id));
  state.memoryIds = (context.retrievedMemories ?? []).map((memory) => memory.id);
  for (const appointment of context.appointments) {
    const sourceId = `appointment:${appointment.id}`;
    if (!available.has(sourceId) || !['proposed', 'confirmed'].includes(appointment.status ?? ''))
      continue;
    const id = `appointment:${appointment.id}`;
    state.goals.push({
      id,
      summary: appointment.title,
      sourceIds: [sourceId],
      status: 'active',
      resultIds: [],
    });
    state.responsibilities.push({
      id,
      summary: appointment.title,
      subject: { kind: 'appointment', id: appointment.id },
      sourceIds: [sourceId],
      status: appointment.status === 'proposed' ? 'waiting' : 'open',
      waitingOn: appointment.status === 'proposed' ? 'player' : 'self',
      // Appointment time is not automatically a deadline for answering its invitation.
      nextCheck:
        appointment.status === 'confirmed'
          ? [{ kind: 'at_or_after', at: appointment.at, sourceId }]
          : [],
    });
  }
  return state;
}

/** Private-channel reader. No writes, hidden progress initialization, director call, or model call. */
export async function readPrivateAgentSnapshot(
  db: PostgresDatabase,
  ownerId: string,
  world: WorldState,
  actorId: string,
  input: AgentInputReceipt | null,
  storyAt: string,
  state: ActorAgentState | null,
): Promise<{ snapshot: AgentSnapshot; seed: ActorAgentState | null }> {
  if (
    world.ownerId !== ownerId ||
    (input &&
      (input.worldId !== world.id ||
        input.channel !== 'private' ||
        input.recipientActorId !== actorId ||
        input.expectedWorldVersion > world.version))
  )
    throw new DomainError('INVALID_COMMAND');
  const memories = await db.transaction(ownerId, (sql) =>
    loadActorMemories(sql, ownerId, { worldId: world.id, actorId }),
  );
  // Forget authorization is not capped by the recall/ranking window.
  memories.blockedSources = await db.transaction(ownerId, (sql) =>
    forgottenAgentSourceIds(sql, ownerId, world.id, actorId),
  );
  const context = actorContext(
    { ...world, time: storyAt },
    actorId,
    input?.text ?? '',
    memories.records,
    memories.blockedSources,
  );
  const [modules, situation] = await Promise.all([
    readPublicationActorModules(db, ownerId, world.id, actorId),
    readActorSituation(db, ownerId, context),
  ]);
  const eventIds = [
    ...new Set(
      [...context.messages, ...context.facts, ...context.appointments]
        .map((item) => item.sourceEventId)
        .filter((id) => !id.startsWith('genesis:')),
    ),
  ];
  const eventVersions = await db.transaction(
    ownerId,
    async (sql) =>
      new Map<string, number>(
        (
          await sql.query(
            `SELECT e.id,e.version FROM parallel_life.world_events e
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=ANY($3::text[]) AND e.version<=$4`,
            [world.id, ownerId, eventIds, world.version],
          )
        ).rows.map((row) => [String(row.id), Number(row.version)]),
      ),
  );
  const sources = new Map<string, AgentSource>();
  const observations: AgentSnapshot['observations'] = [];
  const add = (
    handle: string,
    kind: AgentSource['kind'],
    recordId: string,
    eventId: string,
    at: string,
    text: string,
    observationKind: AgentSnapshot['observations'][number]['kind'],
  ) => {
    const version = eventId.startsWith('genesis:') ? 0 : eventVersions.get(eventId);
    if (version === undefined || Date.parse(at) > Date.parse(storyAt)) return;
    sources.set(handle, { id: handle, kind, recordId, worldVersion: version, at });
    observations.push({ sourceId: handle, text, kind: observationKind });
  };
  for (const fact of context.facts) {
    if (fact.believedByActorId && fact.believedByActorId !== actorId) continue;
    add(
      `fact:${fact.id}`,
      'world_event',
      fact.sourceEventId,
      fact.sourceEventId,
      world.time,
      fact.text,
      fact.kind === 'canonical' && !fact.believedByActorId ? 'fact' : 'belief',
    );
  }
  for (const message of context.messages)
    add(
      `message:${message.id}`,
      'private_message',
      message.id,
      message.sourceEventId,
      message.at,
      `${message.role === 'user' ? '主角' : context.actor.name}：${message.text}`,
      'speech',
    );
  for (const appointment of context.appointments)
    add(
      `appointment:${appointment.id}`,
      'world_event',
      appointment.sourceEventId,
      appointment.sourceEventId,
      world.time,
      `约定「${appointment.title}」，时刻${appointment.at}，实际状态${appointment.status ?? 'unknown'}。约定不是到场证明。`,
      'fact',
    );
  const durableMemoryIds = state
    ? [
        ...state.goals,
        ...state.plans,
        ...state.actions,
        ...state.responsibilities,
        ...(state.episodeParticipations ?? []),
      ]
        .flatMap((item) => item.sourceIds)
        .filter((id) => /^memory:[0-9a-f-]{36}$/i.test(id))
        .map((id) => id.slice(7))
    : [];
  const missingMemoryIds = [...new Set(durableMemoryIds)].filter(
    (id) => !memories.records.some((record) => record.id === id),
  );
  if (missingMemoryIds.length) {
    const rows = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            "SELECT * FROM parallel_life.memory_records WHERE owner_id=$1 AND scope_type='character' AND character_id=$2 AND (branch_id=$3 OR branch_id IS NULL) AND status='active' AND id=ANY($4::text[])",
            [ownerId, actorId, world.id, missingMemoryIds],
          )
        ).rows,
    );
    for (const row of rows)
      memories.records.push(
        MemoryRecordSchema.parse({
          id: row.id,
          ownerId: row.owner_id,
          scopeType: row.scope_type,
          scopeId: row.scope_id,
          branchId: row.branch_id ?? undefined,
          characterId: row.character_id ?? undefined,
          kind: row.kind,
          text: row.text,
          key: row.key ?? undefined,
          sourceType: row.source_type,
          sourceIds: row.source_ids,
          status: row.status,
          importance: Number(row.importance),
          createdAt: new Date(row.created_at).toISOString(),
        }),
      );
  }
  const ownMemories = memories.records.filter(
    (record) =>
      record.scopeType === 'character' &&
      record.characterId === actorId &&
      (!record.branchId || record.branchId === world.id) &&
      !record.key?.startsWith('actor_event_progress_v1:') &&
      record.sourceIds.every((id) => !memories.blockedSources.has(id)),
  );
  const stateHandles = state
    ? [
        ...state.goals,
        ...state.plans,
        ...state.actions,
        ...state.responsibilities,
        ...(state.episodeParticipations ?? []),
      ]
        .flatMap((item) => item.sourceIds)
        .concat(
          (state.questions ?? []).flatMap((q) => [
            q.sourceId,
            ...(q.resolution ? [q.resolution.sourceId] : []),
          ]),
        )
    : [];
  const privateProofIds = [
    ...new Set([
      ...ownMemories.flatMap((record) => record.sourceIds),
      ...stateHandles.filter((id) => id.startsWith('message:')).map((id) => id.slice(8)),
    ]),
  ];
  const proofRows = await db.transaction(
    ownerId,
    async (sql) =>
      (
        await sql.query(
          `SELECT m.id,m.document,e.id AS event_id,e.version FROM parallel_life.world_messages m
     JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.id=m.document->>'sourceEventId'
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=$3 AND (m.id=ANY($4::text[]) OR e.id=ANY($4::text[])) AND e.version<=$5`,
          [world.id, ownerId, actorId, privateProofIds, world.version],
        )
      ).rows,
  );
  const proofs = new Map<string, { version: number; at: string; eventId: string }>();
  for (const row of proofRows)
    if (
      !memories.blockedSources.has(row.id) &&
      !memories.blockedSources.has(row.event_id) &&
      Date.parse(row.document.at) <= Date.parse(storyAt)
    ) {
      const proof = {
        version: Number(row.version),
        at: String(row.document.at),
        eventId: String(row.event_id),
      };
      proofs.set(row.id, proof);
      proofs.set(row.event_id, proof);
      const handle = `message:${row.id}`;
      if (stateHandles.includes(handle))
        sources.set(handle, {
          id: handle,
          kind: 'private_message',
          recordId: row.id,
          worldVersion: proof.version,
          at: proof.at,
        });
    }
  const recalledIds = new Set((context.retrievedMemories ?? []).map((record) => record.id));
  for (const memory of ownMemories)
    if (memory.sourceIds.length && memory.sourceIds.every((id) => proofs.has(id))) {
      const proof = memory.sourceIds
        .map((id) => proofs.get(id)!)
        .sort((a, b) => b.version - a.version)[0]!;
      const handle = `memory:${memory.id}`;
      sources.set(handle, {
        id: handle,
        kind: 'world_event',
        recordId: proof.eventId,
        worldVersion: proof.version,
        at: proof.at,
        contentHash: createHash('sha256').update(memory.text).digest('hex'),
      });
      if (recalledIds.has(memory.id))
        observations.push({
          sourceId: handle,
          text: memory.text,
          kind: memory.kind === 'commitment' ? 'plan' : 'belief',
        });
    }
  if (situation)
    add(
      `opening:${situation.opening.sourceMessageId}`,
      'private_message',
      situation.opening.sourceMessageId,
      situation.opening.sourceEventId,
      situation.opening.deliveredAt,
      situation.opening.direction,
      'plan',
    );
  if (input)
    sources.set(input.id, {
      id: input.id,
      kind: 'accepted_input',
      recordId: input.id,
      worldVersion: input.expectedWorldVersion,
      at: input.storyAt,
    });
  // Retain source handles used by durable state even when their messages aged out of recent context.
  // Reading a source never restores its forgotten text or crosses another NPC's private inbox.
  if (state) {
    const handles = [
      ...new Set(
        [
          ...state.goals,
          ...state.plans,
          ...state.actions,
          ...state.responsibilities,
          ...(state.episodeParticipations ?? []),
        ]
          .flatMap((item) => item.sourceIds)
          .concat(state.decisions.map((item) => item.sourceId))
          .concat(
            (state.questions ?? []).flatMap((q) => [
              q.sourceId,
              ...(q.resolution ? [q.resolution.sourceId] : []),
            ]),
          ),
      ),
    ];
    const rows = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            `SELECT r.id,r.document,ARRAY(
          SELECT alias FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
          CROSS JOIN LATERAL (SELECT e.id AS alias UNION ALL SELECT m.id FROM parallel_life.world_messages m WHERE m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.actor_id=$4 AND m.document->>'sourceEventId'=e.id) aliases
          WHERE e.world_id=r.world_id AND e.owner_id=r.owner_id AND e.payload->'data'->>'actorId'=$4
            AND e.payload->'data'->'agentRuntime'->>'inputReceiptId'=r.id AND e.version<=$5
        ) AS aliases FROM parallel_life.agent_input_receipts r WHERE r.owner_id=$1 AND r.world_id=$2 AND r.id=ANY($3::text[])
       AND r.document->>'channel'='private' AND r.document->>'recipientActorId'=$4
       AND (r.document->>'expectedWorldVersion')::integer<=$5`,
            [ownerId, world.id, handles, actorId, world.version],
          )
        ).rows,
    );
    for (const row of rows) {
      if (
        memories.blockedSources.has(row.id) ||
        (row.aliases as string[]).some((id) => memories.blockedSources.has(id))
      )
        continue;
      sources.set(row.id, {
        id: row.id,
        kind: 'accepted_input',
        recordId: row.id,
        worldVersion: row.document.expectedWorldVersion,
        at: row.document.storyAt,
      });
    }
  }
  const definitionRef = agentDefinitionRef(world, actorId);
  const seeded =
    state ?? seedAgentFromVerifiedContext(context, [...sources.values()], definitionRef);
  if (
    seeded.worldId !== world.id ||
    seeded.actorId !== actorId ||
    seeded.definitionRef !== definitionRef
  )
    throw new DomainError('VERSION_CONFLICT', '人物定义需要先同步。');
  if (state) {
    const strategy = await db.transaction(ownerId, (sql) =>
      readActorStrategyBasis(sql, ownerId, state, world.version, storyAt),
    );
    for (const source of strategy)
      if (!sources.has(source.id)) {
        sources.set(source.id, source);
        observations.push({
          sourceId: source.id,
          kind: 'plan',
          text: '此来源支持本人已保存的目标、计划或决定；原私聊不在本次上下文中。',
        });
      }
  }
  const initialAt = await db.transaction(
    ownerId,
    async (sql) =>
      (
        await sql.query(
          "SELECT state->>'time' AS time FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2",
          [world.id, ownerId],
        )
      ).rows[0]?.time,
  );
  const definitionSourceId = `definition:${definitionRef}`;
  sources.set(definitionSourceId, {
    id: definitionSourceId,
    kind: 'authored',
    recordId: definitionRef,
    worldVersion: 0,
    at: initialAt ?? world.time,
  });
  if (input && isEpisodeConsiderationInput(input)) {
    const intent = parseEpisodeConsiderationIntent(input.text);
    const views = await db.transaction(ownerId, async (sql) => {
      await validateEpisodeConsiderationInputInTransaction(sql, ownerId, input, definitionRef);
      return readActorEpisodeIntentsInTransaction(
        sql,
        ownerId,
        {
          worldId: world.id,
          actorId,
          worldVersion: world.version,
          storyAt,
        },
        [intent.requestId],
      );
    });
    if (!views.has(intent.requestId))
      throw Object.assign(Error('INPUT_SCOPE_FORBIDDEN'), { code: 'INPUT_SCOPE_FORBIDDEN' });
    const view = views.get(intent.requestId);
    if (view) {
      sources.set(view.source.id, view.source);
      observations.push(view.observation);
    }
  }
  const playerEpisode =
    input?.origin === 'player'
      ? await db.transaction(ownerId, (sql) =>
          selectPlayerEpisodeManifest(
            sql,
            ownerId,
            { worldId: world.id, actorId, worldVersion: world.version, storyAt },
            input,
          ),
        )
      : null;
  if (playerEpisode) {
    sources.set(playerEpisode.view.source.id, playerEpisode.view.source);
    // Fresh authority replaces only the same source's redacted strategy placeholder.
    for (let i = observations.length - 1; i >= 0; i--)
      if (observations[i]!.sourceId === playerEpisode.view.source.id) observations.splice(i, 1);
    observations.push(playerEpisode.view.observation);
  }
  const selectedModules = selectActorPersona(modules, input?.text ?? '');
  const result: { seed: ActorAgentState | null; snapshot: AgentSnapshot } = {
    seed: state ? null : seeded,
    snapshot: {
      state: seeded,
      ...(playerEpisode ? { episodeManifest: playerEpisode.manifest } : {}),
      ...authorizedAgentState(seeded, new Set(sources.keys())),
      worldVersion: world.version,
      storyAt,
      sources: [...sources.values()],
      observations,
      actor: {
        name: context.actor.name,
        persona: JSON.stringify({
          persona: context.actor.persona,
          relationship: context.actor.relationship,
          modules: selectedModules,
        }),
        boundaries: '只代表本人；计划和承诺不是已执行事实；不替玩家决定，不公开未授权私密信息。',
        definitionRef: seeded.definitionRef,
      },
      channel: {
        kind: 'private' as const,
        threadId: actorId,
        audienceActorIds: [actorId],
        allowedCapabilities: ['appointment.propose', 'plan.record'],
      },
      input: input
        ? { sourceId: input.id, text: input.text, origin: input.origin }
        : { sourceId: definitionSourceId, text: '', origin: 'wake' },
    },
  };
  result.snapshot = await attachAgentWorldContext(db, ownerId, result.snapshot);
  return result;
}

/** Only this actor's authorized awareness can enter any channel. Reads never project world changes. */
export async function attachAgentWorldContext(
  db: PostgresDatabase,
  ownerId: string,
  snapshot: AgentSnapshot,
): Promise<AgentSnapshot> {
  const awareness = await new PostgresWorldAwarenessRepository(db).readActorAwareness(
    ownerId,
    snapshot.state.worldId,
    snapshot.state.actorId,
  );
  // Late awareness must honor the same source revocation as the earlier private/native loader.
  const blocked = await db.transaction(ownerId, (sql) =>
    forgottenAgentSourceIds(sql, ownerId, snapshot.state.worldId, snapshot.state.actorId),
  );
  const sources = snapshot.sources.filter(
    (source) => !blocked.has(source.id) && !blocked.has(source.recordId),
  );
  const permitted = new Set(sources.map((source) => source.id));
  const observations = snapshot.observations.filter((observation) =>
    permitted.has(observation.sourceId),
  );
  const allowed = new Set(awareness.boundary.placeIds);
  const knowledge = awareness.knowledge
    .filter(
      (k) =>
        k.worldVersion <= snapshot.worldVersion &&
        Date.parse(k.learnedAt) <= Date.parse(snapshot.storyAt) &&
        (k.placeId === null || allowed.has(k.placeId)) &&
        !blocked.has(k.sourceEventId) &&
        !blocked.has(
          `knowledge:${k.sourceEventId}:${k.subject.kind === 'player' ? 'player' : k.subject.actorId}:${k.kind}`,
        ) &&
        (!k.evidence?.inputReceiptId || !blocked.has(k.evidence.inputReceiptId)),
    )
    .map((k) => {
      const subjectKey = k.subject.kind === 'player' ? 'player' : k.subject.actorId;
      const sourceId = `knowledge:${k.sourceEventId}:${subjectKey}:${k.kind}`;
      sources.push({
        id: sourceId,
        kind: 'world_event',
        recordId: k.sourceEventId,
        worldVersion: k.worldVersion,
        at: k.learnedAt,
      });
      observations.push({
        sourceId,
        kind: k.sourceKind === 'direct' ? 'fact' : 'belief',
        text: JSON.stringify({
          subject: k.subject,
          kind: k.kind,
          placeId: k.placeId,
          sourceKind: k.sourceKind,
          occurredAt: k.occurredAt,
          learnedAt: k.learnedAt,
          possiblyStale: true,
          ...(k.sourceKind === 'player_report' && k.evidence?.quote
            ? { reportedQuote: k.evidence.quote }
            : {}),
        }),
      });
      return {
        subject: k.subject,
        kind: k.kind,
        placeId: k.placeId,
        sourceKind: k.sourceKind,
        occurredAt: k.occurredAt,
        learnedAt: k.learnedAt,
        possiblyStale: true as const,
        sourceId,
        ...(k.sourceKind === 'player_report' && k.evidence?.quote
          ? { reportedQuote: k.evidence.quote }
          : {}),
      };
    });
  const own = awareness.ownPosition;
  let selfPosition: NonNullable<AgentSnapshot['worldContext']>['selfPosition'] = {
    status: 'unknown',
    placeId: null,
  };
  if (
    'worldVersion' in own &&
    own.worldVersion <= snapshot.worldVersion &&
    'sourceEventId' in own &&
    !blocked.has(own.sourceEventId) &&
    !blocked.has(`self-position:${own.sourceEventId}`) &&
    'occurredAt' in own &&
    Number.isFinite(Date.parse(own.occurredAt)) &&
    Date.parse(own.occurredAt) <= Date.parse(snapshot.storyAt) &&
    (!own.placeId || allowed.has(own.placeId))
  ) {
    const sourceId = `self-position:${own.sourceEventId}`;
    sources.push({
      id: sourceId,
      kind: 'world_event',
      recordId: own.sourceEventId,
      worldVersion: own.worldVersion,
      at: own.occurredAt,
    });
    selfPosition = {
      status: own.status,
      placeId: own.placeId,
      occurredAt: own.occurredAt,
      sourceId,
    };
  }
  let travelRoutes: NonNullable<AgentSnapshot['worldContext']>['travelRoutes'] = [];
  if (
    selfPosition.status === 'at' &&
    selfPosition.sourceId &&
    awareness.boundary.capabilityIds.includes('travel.begin')
  ) {
    const map = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            `SELECT version,state->'space'->'routes' AS routes,
       EXISTS(SELECT 1 FROM parallel_life.world_clock c WHERE c.world_id=worlds.id AND c.owner_id=$2) AS clock_ready,
       (SELECT jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name'))
        FROM jsonb_array_elements(COALESCE(state->'space'->'places','[]'::jsonb)) p) AS places
       FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2`,
            [snapshot.state.worldId, ownerId],
          )
        ).rows[0],
    );
    if (map?.version !== snapshot.worldVersion) throw new DomainError('VERSION_CONFLICT');
    const places = new Map<string, string>(
      (map.places ?? []).map((p: { id: string; name: string }) => [p.id, p.name]),
    );
    travelRoutes = (map.clock_ready ? (map.routes ?? []) : [])
      .filter(
        (r: import('../domain/space.ts').SpaceRoute) =>
          r.fromPlaceId === selfPosition.placeId && allowed.has(r.toPlaceId),
      )
      .map((r: import('../domain/space.ts').SpaceRoute) => ({
        id: r.id,
        fromPlaceId: r.fromPlaceId,
        toPlaceId: r.toPlaceId,
        toPlaceName: places.get(r.toPlaceId) ?? r.toPlaceId,
        durationMinutes: r.durationMinutes,
        modeLabel: r.modeLabel,
      }));
  }
  const contextual: AgentSnapshot = {
    ...snapshot,
    channel: {
      ...snapshot.channel,
      allowedCapabilities: NPC_AGENT_CAPABILITIES.filter(
        (cap) =>
          awareness.boundary.capabilityIds.includes(cap) &&
          (cap !== 'travel.begin' || !!travelRoutes?.length),
      ),
    },
    ...authorizedAgentState(snapshot.state, new Set(sources.map((s) => s.id))),
    sources: [...new Map(sources.map((s) => [s.id, s])).values()],
    observations,
    worldContext: {
      time: awarenessLocalTime(snapshot.storyAt),
      boundary: {
        actorIds: awareness.boundary.actorIds,
        placeIds: awareness.boundary.placeIds,
        capabilityIds: awareness.boundary.capabilityIds,
        extensionPermission: 'none',
      },
      selfPosition,
      travelRoutes,
      knowledge,
    },
  };
  const inbox = await db.transaction(ownerId, (sql) =>
    readActorObservationInbox(sql, ownerId, contextual),
  );
  if (inbox.context) {
    const ids = new Set(inbox.sources.map((s) => s.id));
    contextual.sources = [...contextual.sources.filter((s) => !ids.has(s.id)), ...inbox.sources];
    contextual.observations = [
      ...contextual.observations.filter((o) => !ids.has(o.sourceId)),
      ...inbox.observations,
    ];
    contextual.actorObservationInbox = inbox.context;
    Object.assign(
      contextual,
      authorizedAgentState(snapshot.state, new Set(contextual.sources.map((s) => s.id))),
    );
  }
  contextual.episodeFollowUps = await db.transaction(ownerId, (sql) =>
    readEpisodeLifecycleContext(sql, ownerId, contextual),
  );
  contextual.episodeResults = await db.transaction(ownerId, (sql) =>
    readActorEpisodeResults(sql, ownerId, contextual),
  );
  return contextual;
}
