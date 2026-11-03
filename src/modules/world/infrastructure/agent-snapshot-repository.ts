import { readRetainedActorEpisodeBriefs } from './actor-episode-intent-repository.ts';
import { summaryReplacedMessages } from '../../memory/infrastructure/conversation-summary.ts';
import {
  canEstablishInitialPosition,
  INITIAL_POSITION_POLICY,
  initialPositionPolicySourceId,
} from '../domain/agent-initial-position.ts';
import { stickerMessageMeaning } from '../domain/sticker-expression.ts';
import { readActorNarrativeObservationSourcesInTransaction } from './actor-narrative-observation-sources.ts';
import {
  readVerifiedPublicationGenesisEvidence,
  verifiedPublicationGenesisRecord,
} from './verified-publication-genesis-evidence.ts';
import { readActorObservationInbox } from './actor-observation-inbox.ts';
import { readActorEpisodeResults } from './episode-result-context-repository.ts';
import { readEpisodeLifecycleContext } from './episode-lifecycle-repository.ts';
import { selectPlayerEpisodeManifest } from './player-episode-manifest-repository.ts';
import { createHash } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt, ActorAgentState, AgentSource } from '../domain/agent-runtime.ts';
import { emptyActorAgentState } from '../domain/agent-runtime.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { actorContext } from '../application/actor-context.ts';
import { actorRetrievalQueries } from '../application/actor-retrieval-queries.ts';
import type { ActorContext } from '../application/ports.ts';
import type { PrivateChatWorld } from '../application/chat-context-read.ts';
import type { WorldState } from '../domain/types.ts';
import { loadActorMemories } from '../../memory/infrastructure/memory-store.ts';
import { readPublicationActorModules } from '../../settings/infrastructure/publication-social-repository.ts';
import { selectActorPersona } from '../domain/actor-situation.ts';
import { actorSnapshotPersona } from '../domain/actor-public-premise.ts';
import { readActorSituation } from './actor-situation-repository.ts';
import { DomainError } from '../domain/errors.ts';
import { authorizedAgentState } from '../domain/agent-kernel.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import {
  readActorStrategyBasis,
  readActorMediaCompletionContextInTransaction,
} from './agent-source-resolver.ts';
import { PostgresWorldAwarenessRepository } from './world-awareness-repository.ts';
import { selfPositionSourceId, awarenessLocalTime } from '../domain/world-awareness.ts';
import { MemoryRecordSchema } from '../../../contracts/memory.ts';
import { NPC_AGENT_CAPABILITIES } from '../domain/agent-capabilities.ts';
import { isEpisodeConsiderationInput } from './agent-episode-attention.ts';
import {
  parseEpisodeConsiderationIntent,
  validateEpisodeConsiderationInputInTransaction,
} from './agent-narrative-repository.ts';
import { readActorEpisodeIntentsInTransaction } from './actor-episode-intent-repository.ts';

export { actorDefinitionRef as agentDefinitionRef } from './actor-definition-ref.ts';
import { actorDefinitionRef as agentDefinitionRef } from './actor-definition-ref.ts';
import { readActorDefinitionSources } from './actor-definition-sources.ts';

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

const IMMUTABLE_ACTOR_MODULES_CACHE_MAX = 256;
const immutableActorModulesCache = new Map<
  string,
  { value: Awaited<ReturnType<typeof readPublicationActorModules>> }
>();
let immutableActorModulesCacheHits = 0;

export function readSnapshotCacheMetrics() {
  return {
    actorModulesCacheSize: immutableActorModulesCache.size,
    actorModulesCacheHits: immutableActorModulesCacheHits,
  };
}

export function clearSnapshotImmutableCaches() {
  immutableActorModulesCache.clear();
  immutableActorModulesCacheHits = 0;
}

function singleTransactionDb(
  ownerId: string,
  sql: SqlClient,
  fallbackDb: PostgresDatabase,
): PostgresDatabase {
  return {
    pool: fallbackDb.pool,
    close: () => fallbackDb.close(),
    async transaction<T>(
      requestedOwner: string,
      run: (client: SqlClient) => Promise<T>,
    ): Promise<T> {
      if (requestedOwner !== ownerId) {
        return fallbackDb.transaction(requestedOwner, run);
      }
      return run(sql);
    },
  } as PostgresDatabase;
}

async function readPublicationActorModulesCached(
  txDb: PostgresDatabase,
  ownerId: string,
  worldId: string,
  actorId: string,
  definitionRef: string,
) {
  const cacheKey = `${ownerId}:${worldId}:${actorId}:${definitionRef}`;
  const cached = immutableActorModulesCache.get(cacheKey);
  if (cached) {
    immutableActorModulesCacheHits += 1;
    return cached.value === undefined ? undefined : structuredClone(cached.value);
  }
  const loaded = await readPublicationActorModules(txDb, ownerId, worldId, actorId);
  if (immutableActorModulesCache.size >= IMMUTABLE_ACTOR_MODULES_CACHE_MAX) {
    const oldestKey = immutableActorModulesCache.keys().next().value;
    if (oldestKey !== undefined) immutableActorModulesCache.delete(oldestKey);
  }
  immutableActorModulesCache.set(cacheKey, {
    value: loaded === undefined ? undefined : structuredClone(loaded),
  });
  return loaded;
}

/** Private-channel reader. No writes, hidden progress initialization, director call, or model call. */
export async function readPrivateAgentSnapshot(
  db: PostgresDatabase,
  ownerId: string,
  world: PrivateChatWorld,
  actorId: string,
  input: AgentInputReceipt | null,
  storyAt: string,
  state: ActorAgentState | null,
  options: { referencedSourceIds?: readonly string[] } = {},
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
  const definitionRef = agentDefinitionRef(world, actorId);
  return db.transaction(ownerId, async (sql) => {
    const txDb = singleTransactionDb(ownerId, sql, db);
    const memories = await loadActorMemories(sql, ownerId, { worldId: world.id, actorId });
    // Forget authorization is not capped by the recall/ranking window.
    memories.blockedSources = await forgottenAgentSourceIds(sql, ownerId, world.id, actorId);
    // Read the actor-scoped narrative packet once per snapshot. The strategy basis
    // and the private inbox both need the same packet in this same transaction.
    const narrative = await readActorNarrativeObservationSourcesInTransaction(sql, ownerId, {
      worldId: world.id,
      actorId,
      worldVersion: world.version,
      storyAt,
      blockedSources: memories.blockedSources,
    });
    const context = actorContext(
      { ...world, time: storyAt },
      actorId,
      input?.text ?? '',
      memories.records,
      memories.blockedSources,
      actorRetrievalQueries({
        origin: input?.origin ?? 'wake',
        state,
        actorId,
        threadId: actorId,
        narrative: narrative.observations,
        blockedSources: memories.blockedSources,
      }),
    );
    // readActorSituation locks the world row FOR SHARE and verifies world.version === context.worldVersion
    // before any cached immutable publication actor module is consulted.
    const situation = await readActorSituation(txDb, ownerId, context);
    const modules = await readPublicationActorModulesCached(
      txDb,
      ownerId,
      world.id,
      actorId,
      definitionRef,
    );
    const eventIds = [
      ...new Set(
        [...context.messages, ...context.facts, ...context.appointments]
          .map((item) => item.sourceEventId)
          .filter((id) => !id.startsWith('genesis:')),
      ),
    ];
    const eventVersions = eventIds.length
      ? new Map<string, number>(
          (
            await sql.query(
              `SELECT e.id,e.version FROM parallel_life.world_events e
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=ANY($3::text[]) AND e.version<=$4`,
              [world.id, ownerId, eventIds, world.version],
            )
          ).rows.map((row) => [String(row.id), Number(row.version)]),
        )
      : new Map<string, number>();
    const publicationGenesis = await readVerifiedPublicationGenesisEvidence(sql, ownerId, {
      worldId: world.id,
      actorId,
      worldVersion: world.version,
      storyAt,
    });
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
      verifiedPublicationGenesis = false,
    ) => {
      const version =
        verifiedPublicationGenesis || eventId.startsWith('genesis:')
          ? 0
          : eventVersions.get(eventId);
      if (version === undefined || Date.parse(at) > Date.parse(storyAt)) return;
      sources.set(handle, { id: handle, kind, recordId, worldVersion: version, at });
      observations.push({ sourceId: handle, text, kind: observationKind });
    };
    for (const fact of context.facts) {
      if (fact.narrativeContext) continue; // Authenticated private packet only; never generic channel fact disclosure.
      if (fact.believedByActorId && fact.believedByActorId !== actorId) continue;
      add(
        `fact:${fact.id}`,
        'world_event',
        fact.sourceEventId,
        fact.sourceEventId,
        verifiedPublicationGenesisRecord(publicationGenesis, 'fact', fact)
          ? publicationGenesis!.at
          : world.time,
        fact.text,
        fact.kind === 'canonical' && !fact.believedByActorId ? 'fact' : 'belief',
        verifiedPublicationGenesisRecord(publicationGenesis, 'fact', fact),
      );
    }
    for (const message of context.messages) {
      const before = observations.length;
      add(
        `message:${message.id}`,
        'private_message',
        message.id,
        message.sourceEventId,
        message.at,
        `${message.role === 'user' ? '主角' : context.actor.name}：${stickerMessageMeaning(message.text, message.stickerId)}`,
        'speech',
        verifiedPublicationGenesisRecord(publicationGenesis, 'message', message),
      );
      if (observations.length > before)
        observations[observations.length - 1]!.speaker =
          message.role === 'user' ? { kind: 'player' } : { kind: 'actor', actorId };
    }
    for (const appointment of context.appointments)
      add(
        `appointment:${appointment.id}`,
        'world_event',
        appointment.sourceEventId,
        appointment.sourceEventId,
        verifiedPublicationGenesisRecord(publicationGenesis, 'appointment', appointment)
          ? publicationGenesis!.at
          : world.time,
        `约定「${appointment.title}」，时刻${appointment.at}，实际状态${appointment.status ?? 'unknown'}。约定不是到场证明。`,
        'fact',
        verifiedPublicationGenesisRecord(publicationGenesis, 'appointment', appointment),
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
      const rows = (
        await sql.query(
          "SELECT * FROM parallel_life.memory_records WHERE owner_id=$1 AND scope_type='character' AND character_id=$2 AND (branch_id=$3 OR branch_id IS NULL) AND status='active' AND id=ANY($4::text[])",
          [ownerId, actorId, world.id, missingMemoryIds],
        )
      ).rows;
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
            state.decisions.map((decision) => decision.sourceId),
            state.focus?.questionSourceId ? [state.focus.questionSourceId] : [],
          )
      : [];
    const privateProofIds = [
      ...new Set([
        ...ownMemories.flatMap((record) => record.sourceIds),
        ...stateHandles.filter((id) => id.startsWith('message:')).map((id) => id.slice(8)),
      ]),
    ];
    const proofRows = privateProofIds.length
      ? (
          await sql.query(
            `SELECT m.id,m.document,e.id AS event_id,e.version FROM parallel_life.world_messages m
     JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.id=m.document->>'sourceEventId'
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=$3 AND (m.id=ANY($4::text[]) OR e.id=ANY($4::text[])) AND e.version<=$5`,
            [world.id, ownerId, actorId, privateProofIds, world.version],
          )
        ).rows
      : [];
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
    const preservedMessages = new Set(
      world.messages
        .filter((m) => m.actorId === actorId)
        .slice(-12)
        .map((m) => m.id),
    );
    for (const handle of stateHandles)
      if (handle.startsWith('message:')) preservedMessages.add(handle.slice(8));
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
            memoryTier:
              memory.kind === 'commitment' || memory.kind === 'correction' ? 'exact' : 'fuzzy',
          });
      }
    const summaryCovered = summaryReplacedMessages(
      ownMemories,
      new Set(
        observations
          .filter((o) => o.sourceId.startsWith('memory:'))
          .map((o) => o.sourceId.slice(7)),
      ),
      preservedMessages,
    );
    // Keep source authority and structured task references. Replace old prose only when its summary is present.
    for (let index = observations.length - 1; index >= 0; index--) {
      if (
        summaryCovered.has(observations[index]!.sourceId.replace(/^message:/, '')) &&
        observations[index]!.sourceId.startsWith('message:')
      )
        observations.splice(index, 1);
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
      const rows = handles.length
        ? (
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
          ).rows
        : [];
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
    const seeded =
      state ?? seedAgentFromVerifiedContext(context, [...sources.values()], definitionRef);
    if (
      seeded.worldId !== world.id ||
      seeded.actorId !== actorId ||
      seeded.definitionRef !== definitionRef
    )
      throw new DomainError('VERSION_CONFLICT', '人物定义需要先同步。');
    if (state) {
      const strategy = await readActorStrategyBasis(sql, ownerId, state, world.version, storyAt, {
        narrative,
        blockedSources: memories.blockedSources,
        skipEmptyMediaHeadCheck: true,
      });
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
    const definitionSourceId = `definition:${definitionRef}`;
    const definitionSource = (
      await readActorDefinitionSources(sql, ownerId, world.id, actorId, world.version)
    ).find((s) => s.id === definitionSourceId);
    if (!definitionSource) throw new DomainError('VERSION_CONFLICT', '人物定义来源需要同步。');
    sources.set(definitionSourceId, definitionSource);

    if (input && isEpisodeConsiderationInput(input)) {
      const intent = parseEpisodeConsiderationIntent(input.text);
      await validateEpisodeConsiderationInputInTransaction(sql, ownerId, input, definitionRef);
      const views = await readActorEpisodeIntentsInTransaction(
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
        ? await selectPlayerEpisodeManifest(
            sql,
            ownerId,
            { worldId: world.id, actorId, worldVersion: world.version, storyAt },
            input,
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
          persona: actorSnapshotPersona({
            persona: context.actor.persona,
            relationship: context.actor.relationship,
            modules: selectedModules,
            definitionSourceId,
            topic: input?.text ?? '',
          }),
          boundaries: '只代表本人；计划和承诺不是已执行事实；不替玩家决定，不公开未授权私密信息。',
          definitionRef: seeded.definitionRef,
        },
        channel: {
          kind: 'private' as const,
          threadId: actorId,
          audienceActorIds: [actorId],
          allowedCapabilities: [
            'appointment.propose',
            'plan.record',
            'media.generate_image',
            'media.generate_video',
            'media.share',
          ],
        },
        input: input
          ? { sourceId: input.id, text: input.text, origin: input.origin }
          : { sourceId: definitionSourceId, text: '', origin: 'wake' },
      },
    };
    result.snapshot = await attachAgentWorldContextInTransaction(
      sql,
      txDb,
      ownerId,
      result.snapshot,
      memories.blockedSources,
      narrative,
      options.referencedSourceIds,
    );
    return result;
  });
}

/** Only this actor's authorized awareness can enter any channel. Reads never project world changes. */
export async function attachAgentWorldContext(
  db: PostgresDatabase,
  ownerId: string,
  snapshot: AgentSnapshot,
): Promise<AgentSnapshot> {
  return db.transaction(ownerId, (sql) =>
    attachAgentWorldContextInTransaction(
      sql,
      singleTransactionDb(ownerId, sql, db),
      ownerId,
      snapshot,
    ),
  );
}

async function attachAgentWorldContextInTransaction(
  sql: SqlClient,
  txDb: PostgresDatabase,
  ownerId: string,
  snapshot: AgentSnapshot,
  preloadedBlocked?: Set<string>,
  preloadedNarrative?: Awaited<
    ReturnType<typeof readActorNarrativeObservationSourcesInTransaction>
  >,
  extraReferencedSourceIds?: readonly string[],
): Promise<AgentSnapshot> {
  const awareness = await new PostgresWorldAwarenessRepository(txDb).readActorAwareness(
    ownerId,
    snapshot.state.worldId,
    snapshot.state.actorId,
  );
  if (awareness.worldVersion !== snapshot.worldVersion) throw new DomainError('VERSION_CONFLICT');
  // Late awareness must honor the same source revocation as the earlier private/native loader.
  const blocked =
    preloadedBlocked ??
    (await forgottenAgentSourceIds(sql, ownerId, snapshot.state.worldId, snapshot.state.actorId));
  const sources = snapshot.sources.filter(
    (source) => !blocked.has(source.id) && !blocked.has(source.recordId),
  );
  const permitted = new Set(sources.map((source) => source.id));
  const observations = snapshot.observations.filter((observation) =>
    permitted.has(observation.sourceId),
  );
  const allowed = new Set<string>(awareness.boundary.placeIds);
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
    (!own.sourceEventId ||
      (!blocked.has(own.sourceEventId) && !blocked.has(`self-position:${own.sourceEventId}`))) &&
    'occurredAt' in own &&
    Number.isFinite(Date.parse(own.occurredAt)) &&
    Date.parse(own.occurredAt) <= Date.parse(snapshot.storyAt) &&
    (!own.placeId || allowed.has(own.placeId))
  ) {
    const sourceId = selfPositionSourceId(snapshot.state.worldId, own.sourceEventId);
    sources.push({
      id: sourceId,
      kind: own.sourceEventId ? 'world_event' : 'authored',
      recordId: own.sourceEventId ?? snapshot.state.worldId,
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
  let initialPlacement: NonNullable<AgentSnapshot['worldContext']>['initialPlacement'];
  if (selfPosition.status === 'unknown' && 'worldVersion' in own && own.worldVersion === 0) {
    const hasJourney = !!(
      await sql.query(
        'SELECT 1 FROM parallel_life.npc_journeys WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 LIMIT 1',
        [snapshot.state.worldId, ownerId, snapshot.state.actorId],
      )
    ).rowCount;
    if (
      canEstablishInitialPosition({
        worldId: snapshot.state.worldId,
        actorId: snapshot.state.actorId,
        ownPosition: own as import('../domain/world-awareness.ts').AuthoritativePosition,
        hasJourney,
        placeIds: [...allowed],
      })
    ) {
      const row = (
        await sql.query(
          `SELECT state->'space'->'places' AS places FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2`,
          [snapshot.state.worldId, ownerId],
        )
      ).rows[0];
      const places = (row?.places ?? [])
        .filter((p: { id: string; name: string }) => allowed.has(p.id))
        .map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }));
      const sourceId = initialPositionPolicySourceId(
        snapshot.state.worldId,
        snapshot.state.actorId,
      );
      if (places.length && !blocked.has(sourceId)) {
        sources.push({
          id: sourceId,
          kind: 'authored',
          recordId: snapshot.state.worldId,
          worldVersion: 0,
          at: snapshot.storyAt,
        });
        initialPlacement = { policy: INITIAL_POSITION_POLICY, sourceId, places };
      }
    }
  }
  const boundaryCapabilities = [
    ...new Set([
      ...awareness.boundary.capabilityIds,
      ...(initialPlacement ? ['position.establish'] : []),
    ]),
  ];
  let travelRoutes: NonNullable<AgentSnapshot['worldContext']>['travelRoutes'] = [];
  if (
    selfPosition.status === 'at' &&
    selfPosition.sourceId &&
    awareness.boundary.capabilityIds.includes('travel.begin')
  ) {
    const map = (
      await sql.query(
        `SELECT version,state->'space'->'routes' AS routes,
       EXISTS(SELECT 1 FROM parallel_life.world_clock c WHERE c.world_id=worlds.id AND c.owner_id=$2) AS clock_ready,
       (SELECT jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name'))
        FROM jsonb_array_elements(COALESCE(state->'space'->'places','[]'::jsonb)) p) AS places
       FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2`,
        [snapshot.state.worldId, ownerId],
      )
    ).rows[0];
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
  // Item provenance here is audit metadata, not a global world_event source.
  // A proposal still needs its original authorized input/plan basis, and the kernel
  // independently checks actual current possession before any transfer/use.
  const ownedItems = awareness.ownedItems.filter((item) => !blocked.has(item.sourceEventId));
  // Only offer actions this channel/state can actually use. This keeps the
  // response schema and permission manual small without removing a capability
  // from the kernel or from a channel that genuinely needs it.
  const hasLiveAppointment = snapshot.state.responsibilities.some(
    (responsibility) =>
      responsibility.subject.kind === 'appointment' &&
      !['fulfilled', 'withdrawn', 'expired'].includes(responsibility.status),
  );
  const contextual: AgentSnapshot = {
    ...snapshot,
    channel: {
      ...snapshot.channel,
      allowedCapabilities: NPC_AGENT_CAPABILITIES.filter(
        (cap) =>
          boundaryCapabilities.includes(cap) &&
          (cap !== 'position.establish' || !!initialPlacement) &&
          (cap !== 'travel.begin' || !!travelRoutes?.length) &&
          (!['item.deliver', 'item.use'].includes(cap) || ownedItems.length > 0) &&
          (![
            'appointment.accept',
            'appointment.cancel',
            'appointment.fulfill',
            'appointment.reschedule',
          ].includes(cap) ||
            hasLiveAppointment) &&
          (cap !== 'activity.participate' || snapshot.channel.kind !== 'private'),
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
        capabilityIds: boundaryCapabilities,
        extensionPermission: 'none',
      },
      selfPosition,
      ...(initialPlacement ? { initialPlacement } : {}),
      travelRoutes,
      ownedItems,
      knowledge,
    },
  };
  const inbox = await readActorObservationInbox(sql, ownerId, contextual, {
    ...(preloadedNarrative ? { narrative: preloadedNarrative } : {}),
    blockedSources: blocked,
  });
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
  // A consumed notification remains known. Recall does not create inbox work or a new wake.
  if (contextual.channel.kind === 'private') {
    const recall =
      preloadedNarrative ??
      (await readActorNarrativeObservationSourcesInTransaction(sql, ownerId, {
        worldId: contextual.state.worldId,
        actorId: contextual.state.actorId,
        worldVersion: contextual.worldVersion,
        storyAt: contextual.storyAt,
        blockedSources: blocked,
      }));
    const ids = new Set(recall.sources.map((s) => s.id));
    contextual.sources = [...contextual.sources.filter((s) => !ids.has(s.id)), ...recall.sources];
    contextual.observations = [
      ...contextual.observations.filter((o) => !ids.has(o.sourceId)),
      ...recall.observations,
    ];
    Object.assign(
      contextual,
      authorizedAgentState(snapshot.state, new Set(contextual.sources.map((s) => s.id))),
    );
  }
  const media = await readActorMediaCompletionContextInTransaction(sql, ownerId, contextual, {
    referencedSourceIds: [
      ...new Set([
        ...contextual.sources.map((source) => source.id),
        ...(extraReferencedSourceIds ?? []),
      ]),
    ],
    skipEmptyHeadCheck: true,
  });
  if (media.sources.length) {
    const ids = new Set(media.sources.map((source) => source.id));
    contextual.sources = [
      ...contextual.sources.filter((source) => !ids.has(source.id)),
      ...media.sources,
    ];
    contextual.observations = [
      ...contextual.observations.filter((observation) => !ids.has(observation.sourceId)),
      ...media.observations,
    ];
    Object.assign(
      contextual,
      authorizedAgentState(snapshot.state, new Set(contextual.sources.map((s) => s.id))),
    );
  }
  contextual.episodeFollowUps = await readEpisodeLifecycleContext(sql, ownerId, contextual);
  const retainedBriefs = await readRetainedActorEpisodeBriefs(sql, ownerId, contextual);
  if (retainedBriefs.length) {
    const bySource = new Map(retainedBriefs.map((o) => [o.sourceId, o]));
    contextual.observations = contextual.observations.map((o) => bySource.get(o.sourceId) ?? o);
  }
  contextual.episodeResults = await readActorEpisodeResults(sql, ownerId, contextual, blocked);
  return contextual;
}
