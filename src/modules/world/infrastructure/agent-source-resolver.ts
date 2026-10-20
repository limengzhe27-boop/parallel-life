import { readActorNarrativeObservationSourcesInTransaction } from './actor-narrative-observation-sources.ts';
import {
  readVerifiedPublicationGenesisEvidence,
  verifiedPublicationGenesisRecord,
} from './verified-publication-genesis-evidence.ts';
import { readActorGroupObservationSourcesInTransaction } from './actor-group-observation-sources.ts';
import { readConsumedSceneObservationSourcesInTransaction } from './actor-observation-consumption-repository.ts';
import { readActorSceneObservationSourcesInTransaction } from './actor-scene-observation-sources.ts';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState, AgentSource } from '../domain/agent-runtime.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import { ACTOR_EPISODE_INTENT_PREFIX } from '../domain/actor-episode-intent.ts';
import { readActorEpisodeIntentsInTransaction } from './actor-episode-intent-repository.ts';
import { isDeepStrictEqual } from 'node:util';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import type { ActorMediaResultContext } from '../domain/actor-media-result-context.ts';
import { readActorMediaResultContextInTransaction } from './actor-media-result-context-repository.ts';

/** Own persistent strategy provenance, not permission to disclose private transcripts to a channel. */
export async function readActorStrategyBasis(
  sql: SqlClient,
  ownerId: string,
  state: ActorAgentState,
  worldVersion: number,
  storyAt: string,
  options: {
    omitEpisodeIntents?: boolean;
    /** Same-transaction packet already read by the private snapshot reader. */
    narrative?: Awaited<ReturnType<typeof readActorNarrativeObservationSourcesInTransaction>>;
    blockedSources?: ReadonlySet<string>;
    /** The caller already verified the world head; an empty media result needs no second head read. */
    skipEmptyMediaHeadCheck?: boolean;
  } = {},
): Promise<AgentSource[]> {
  const handles = [
    ...new Set([
      ...state.knowledgeSourceIds,
      ...[...state.goals, ...state.plans, ...state.actions, ...state.responsibilities].flatMap(
        (x) => x.sourceIds,
      ),
      ...state.decisions.map((x) => x.sourceId),
      ...(state.episodeParticipations ?? []).flatMap((x) => x.sourceIds),
      ...state.responsibilities.flatMap((r) => (r.deadline ? [r.deadline.sourceId] : [])),
      ...(state.focus?.questionSourceId ? [state.focus.questionSourceId] : []),
      ...(state.questions ?? []).flatMap((q) => [
        q.sourceId,
        ...(q.resolution ? [q.resolution.sourceId] : []),
      ]),
      ...[
        ...state.plans.flatMap((x) => x.triggers),
        ...state.actions.flatMap((x) => x.preconditions),
        ...state.responsibilities.flatMap((x) => x.nextCheck),
      ].flatMap((x) => ('sourceId' in x ? [x.sourceId] : [])),
    ]),
  ];
  const media = await readActorMediaCompletionContextInTransaction(
    sql,
    ownerId,
    { state, worldVersion, storyAt },
    {
      referencedSourceIds: handles,
      ...(options.skipEmptyMediaHeadCheck ? { skipEmptyHeadCheck: true } : {}),
    },
  );
  const narrative =
    options.narrative ??
    (await readActorNarrativeObservationSourcesInTransaction(sql, ownerId, {
      worldId: state.worldId,
      actorId: state.actorId,
      worldVersion,
      storyAt,
      ...(options.blockedSources ? { blockedSources: options.blockedSources } : {}),
    }));
  if (!handles.length) return [...media.sources, ...narrative.sources];
  const blocked =
    options.blockedSources ??
    (await forgottenAgentSourceIds(sql, ownerId, state.worldId, state.actorId));
  const sources = new Map<string, AgentSource>(
    [...media.sources, ...narrative.sources].map((source) => [source.id, source]),
  );
  const add = (
    id: string,
    kind: AgentSource['kind'],
    recordId: string,
    version: number,
    at: string,
    aliases: string[] = [],
    contentHash?: string,
  ) => {
    if (
      !handles.includes(id) ||
      !Number.isSafeInteger(worldVersion) ||
      worldVersion < 0 ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      !Number.isFinite(Date.parse(storyAt)) ||
      [id, recordId, ...aliases].some((x) => blocked.has(x)) ||
      version > worldVersion ||
      Date.parse(at) > Date.parse(storyAt) ||
      !Number.isFinite(Date.parse(at))
    )
      return;
    sources.set(id, {
      id,
      kind,
      recordId,
      worldVersion: version,
      at,
      usage: 'private_strategy',
      ...(contentHash ? { contentHash } : {}),
    });
  };
  const needsInitial = handles.some((handle) =>
    /^(definition|message|opening|fact|appointment):/.test(handle),
  );
  const initial = needsInitial
    ? (
        await sql.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
          [state.worldId, ownerId],
        )
      ).rows[0]?.state
    : undefined;
  const publicationGenesis = needsInitial
    ? await readVerifiedPublicationGenesisEvidence(sql, ownerId, {
        worldId: state.worldId,
        actorId: state.actorId,
        worldVersion,
        storyAt,
      })
    : null;
  if (initial) {
    add(`definition:${state.definitionRef}`, 'authored', state.definitionRef, 0, initial.time);
    // Publication messages use exactly the same authenticated display-time
    // projection as the private snapshot. Legacy genesis retains its old times.
    const initialMessages = [
      ...(initial.messages ?? []).filter((m: { sourceEventId: string }) =>
        String(m.sourceEventId).startsWith('genesis:'),
      ),
      ...(publicationGenesis?.messages ?? []),
    ];
    for (const m of initialMessages)
      if (
        m.actorId === state.actorId &&
        (String(m.sourceEventId).startsWith('genesis:') ||
          verifiedPublicationGenesisRecord(publicationGenesis, 'message', m))
      )
        for (const prefix of ['message:', 'opening:'])
          add(prefix + m.id, 'private_message', m.id, 0, m.at, [m.sourceEventId]);
    for (const f of initial.facts ?? [])
      if (
        f.visibility?.kind === 'world' ||
        (f.visibility?.kind === 'actors' && f.visibility.actorIds.includes(state.actorId))
      )
        if (
          (!f.believedByActorId || f.believedByActorId === state.actorId) &&
          (!String(f.sourceEventId).startsWith('publication-genesis:') ||
            verifiedPublicationGenesisRecord(publicationGenesis, 'fact', f))
        )
          add('fact:' + f.id, 'world_event', f.sourceEventId, 0, initial.time, [f.id]);
    for (const a of initial.appointments ?? [])
      if (
        a.participantIds.includes(state.actorId) &&
        (!String(a.sourceEventId).startsWith('publication-genesis:') ||
          verifiedPublicationGenesisRecord(publicationGenesis, 'appointment', a))
      )
        add('appointment:' + a.id, 'world_event', a.sourceEventId, 0, initial.time, [
          a.id,
          ...(a.sourceMessageId ? [a.sourceMessageId] : []),
        ]);
  }
  const inputCandidates = handles.filter(
    (handle) =>
      !/^(definition|message|opening|memory|fact|appointment|media-result|action-result|group|scene|calendar-response|knowledge|self-position|episode-result|narrative|episode-intent):/.test(
        handle,
      ),
  );
  const inputs = inputCandidates.length
    ? (
        await sql.query(
          `SELECT id,document FROM parallel_life.agent_input_receipts
    WHERE world_id=$1 AND owner_id=$2 AND id=ANY($3::text[]) AND document->>'channel'='private'
      AND document->>'recipientActorId'=$4 AND (document->>'expectedWorldVersion')::integer<=$5`,
          [state.worldId, ownerId, inputCandidates, state.actorId, worldVersion],
        )
      ).rows
    : [];
  for (const row of inputs)
    add(row.id, 'accepted_input', row.id, row.document.expectedWorldVersion, row.document.storyAt);
  const messageIds = handles
    .filter((h) => /^(message|opening):/.test(h))
    .map((h) => h.replace(/^(message|opening):/, ''));
  const messages = messageIds.length
    ? (
        await sql.query(
          `SELECT m.id,m.document,e.id AS event_id,e.version
    FROM parallel_life.world_messages m JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.id=m.document->>'sourceEventId'
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=$3 AND m.id=ANY($4::text[]) AND e.version<=$5`,
          [state.worldId, ownerId, state.actorId, messageIds, worldVersion],
        )
      ).rows
    : [];
  for (const row of messages)
    for (const prefix of ['message:', 'opening:'])
      add(prefix + row.id, 'private_message', row.id, row.version, row.document.at, [row.event_id]);
  const memoryIds = handles.filter((h) => /^memory:[0-9a-f-]{36}$/i.test(h)).map((h) => h.slice(7));
  const memories = memoryIds.length
    ? (
        await sql.query(
          `SELECT r.id,r.text,r.source_ids,MAX(e.version) AS source_version,MAX(m.document->>'at') AS source_at
    FROM parallel_life.memory_records r JOIN parallel_life.world_messages m ON m.world_id=$1 AND m.owner_id=r.owner_id AND m.actor_id=$3
      AND (r.source_ids ? m.id OR r.source_ids ? (m.document->>'sourceEventId'))
    JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.id=m.document->>'sourceEventId' AND e.version<=$5
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE r.owner_id=$2 AND r.character_id=$3 AND r.scope_type='character' AND (r.branch_id=$1 OR r.branch_id IS NULL)
      AND r.status='active' AND r.id=ANY($4::text[])
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(r.source_ids) q(id) WHERE NOT EXISTS(
        SELECT 1 FROM parallel_life.world_messages p JOIN parallel_life.world_events pe ON pe.world_id=p.world_id AND pe.id=p.document->>'sourceEventId'
          JOIN parallel_life.commands pc ON pc.world_id=pe.world_id AND pc.id=pe.command_id AND pc.status='succeeded' AND pc.result_event_id=pe.id
          WHERE p.world_id=$1 AND p.owner_id=$2 AND p.actor_id=$3 AND (p.id=q.id OR pe.id=q.id) AND pe.version<=$5))
    GROUP BY r.id,r.text,r.source_ids`,
          [state.worldId, ownerId, state.actorId, memoryIds, worldVersion],
        )
      ).rows
    : [];
  for (const row of memories)
    add(
      'memory:' + row.id,
      'world_event',
      'memory:' + row.id,
      Number(row.source_version),
      row.source_at,
      row.source_ids,
      createHash('sha256').update(row.text).digest('hex'),
    );
  // Calendar/fact payloads are not copied: only the owning NPC's verified structured state survives.
  const facts = handles.some((h) => h.startsWith('fact:'))
    ? (
        await sql.query(
          `SELECT f.id,f.document,e.id AS event_id,e.version,e.payload->>'storyAt' AS at FROM parallel_life.world_facts f
    JOIN parallel_life.world_events e ON e.world_id=f.world_id AND e.id=f.document->>'sourceEventId'
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE f.world_id=$1 AND f.owner_id=$2 AND ('fact:'||f.id)=ANY($3::text[]) AND e.version<=$5
    AND (f.document->'visibility'->>'kind'='world' OR (f.document->'visibility'->>'kind'='actors' AND f.document->'visibility'->'actorIds' ? $4))
    AND (NOT(f.document?'believedByActorId') OR f.document->>'believedByActorId'=$4)`,
          [state.worldId, ownerId, handles, state.actorId, worldVersion],
        )
      ).rows
    : [];
  for (const row of facts) add('fact:' + row.id, 'world_event', row.event_id, row.version, row.at);
  const appointments = handles.some((h) => h.startsWith('appointment:'))
    ? (
        await sql.query(
          `SELECT p.id,p.document,e.id AS event_id,e.version,e.payload->>'storyAt' AS at FROM parallel_life.world_appointments p
    JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.id=p.document->>'sourceEventId'
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE p.world_id=$1 AND p.owner_id=$2 AND ('appointment:'||p.id)=ANY($3::text[]) AND p.document->'participantIds' ? $4 AND e.version<=$5`,
          [state.worldId, ownerId, handles, state.actorId, worldVersion],
        )
      ).rows
    : [];
  for (const row of appointments)
    add('appointment:' + row.id, 'world_event', row.event_id, row.version, row.at);
  const calendar = handles.some((h) => h.startsWith('calendar-response:'))
    ? (
        await sql.query(
          `SELECT e.id,e.version,e.payload FROM parallel_life.world_events e
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$4 AND ('calendar-response:'||e.id)=ANY($3::text[])
      AND e.payload->>'type'='invitation.responded' AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'agentProjections') p WHERE p->>'actorId'=$5)`,
          [state.worldId, ownerId, handles, worldVersion, state.actorId],
        )
      ).rows
    : [];
  for (const row of calendar)
    add('calendar-response:' + row.id, 'world_event', row.id, row.version, row.payload.storyTime);
  await readNativeStrategyBasis(sql, ownerId, state, handles, worldVersion, storyAt, add);
  const intentRequests = handles
    .filter((handle) => handle.startsWith(ACTOR_EPISODE_INTENT_PREFIX))
    .map((handle) => handle.slice(ACTOR_EPISODE_INTENT_PREFIX.length));
  if (intentRequests.length && !options.omitEpisodeIntents) {
    const views = await readActorEpisodeIntentsInTransaction(
      sql,
      ownerId,
      {
        worldId: state.worldId,
        actorId: state.actorId,
        worldVersion,
        storyAt,
      },
      intentRequests,
      { historical: true },
    );
    for (const view of views.values())
      if (view)
        add(
          view.source.id,
          view.source.kind,
          view.source.recordId,
          view.source.worldVersion,
          view.source.at,
          [],
          view.source.contentHash,
        );
  }
  const missingScenes = handles.filter((h) => h.startsWith('scene:') && !sources.has(h));
  if (missingScenes.length) {
    const control = (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
        [state.worldId, ownerId],
      )
    ).rows[0];
    if (control?.engine_epoch >= 2) {
      const consumed = await readConsumedSceneObservationSourcesInTransaction(sql, ownerId, {
        worldId: state.worldId,
        actorId: state.actorId,
        engineEpoch: control.engine_epoch,
        worldVersion,
      });
      const done = new Set(consumed.map((c) => c.sourceId + ':' + c.contentHash));
      const sceneRows = (
        await sql.query(
          `SELECT DISTINCT scene_id FROM parallel_life.scene_items WHERE world_id=$1 AND owner_id=$2 AND ('scene:'||id)=ANY($3::text[])`,
          [state.worldId, ownerId, missingScenes],
        )
      ).rows;
      for (const scene of sceneRows) {
        const packet = await readActorSceneObservationSourcesInTransaction(sql, ownerId, {
          worldId: state.worldId,
          actorId: state.actorId,
          sceneId: scene.scene_id,
          worldVersion,
          storyAt,
          sourceIds: missingScenes,
          maxBytes: 1000000,
          maxEntries: 500,
        });
        for (const source of packet.sources)
          if (done.has(source.id + ':' + source.contentHash))
            add(
              source.id,
              source.kind,
              source.recordId,
              source.worldVersion,
              source.at,
              [],
              source.contentHash,
            );
      }
    }
  }
  const missingGroups = handles.filter((h) => h.startsWith('group:') && !sources.has(h));
  if (missingGroups.length) {
    const control = (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
        [state.worldId, ownerId],
      )
    ).rows[0];
    if (control?.engine_epoch >= 2) {
      const consumed = await readConsumedSceneObservationSourcesInTransaction(sql, ownerId, {
        worldId: state.worldId,
        actorId: state.actorId,
        engineEpoch: control.engine_epoch,
        worldVersion,
      });
      const done = new Set(consumed.map((c) => c.sourceId + ':' + c.contentHash));
      const groups = (
        await sql.query(
          `SELECT DISTINCT group_id FROM parallel_life.world_group_messages
         WHERE world_id=$1 AND owner_id=$2 AND ('group:'||id)=ANY($3::text[])`,
          [state.worldId, ownerId, missingGroups],
        )
      ).rows;
      for (const group of groups) {
        const packet = await readActorGroupObservationSourcesInTransaction(sql, ownerId, {
          worldId: state.worldId,
          actorId: state.actorId,
          engineEpoch: control.engine_epoch,
          worldVersion,
          storyAt,
          groupId: group.group_id,
          sourceIds: missingGroups,
          maxBytes: 1000000,
          maxEntries: 500,
        });
        for (const source of packet.sources)
          if (done.has(source.id + ':' + source.contentHash))
            add(
              source.id,
              source.kind,
              source.recordId,
              source.worldVersion,
              source.at,
              [],
              source.contentHash,
            );
      }
    }
  }
  return [...sources.values()];
}

type StrategyAdder = (
  id: string,
  kind: AgentSource['kind'],
  recordId: string,
  version: number,
  at: string,
  aliases?: string[],
) => void;
/** Historical direct perception/own speech, never current membership or a transcript disclosure grant. */
async function readNativeStrategyBasis(
  sql: SqlClient,
  owner: string,
  state: ActorAgentState,
  handles: string[],
  worldVersion: number,
  storyAt: string,
  add: StrategyAdder,
) {
  if (
    !Number.isSafeInteger(worldVersion) ||
    worldVersion < 0 ||
    !Number.isFinite(Date.parse(storyAt))
  )
    return;
  const permissions = (
    await sql.query(`SELECT
    has_table_privilege(current_user,'parallel_life.agent_attempts','SELECT') AS attempts,
    has_table_privilege(current_user,'parallel_life.world_group_messages','SELECT') AS groups,
    has_table_privilege(current_user,'parallel_life.scene_items','SELECT') AS scenes`)
  ).rows[0];
  if (!permissions?.attempts) return;
  // Only protected metadata is projected out of saved requests. No observations, input text or raw response.
  const history = (
    await sql.query(
      `SELECT a.input_receipt_id AS input_id,r.command_id AS input_command,
    r.document->>'channel' AS channel,r.document->>'threadId' AS thread_id,
    r.document->>'storyAt' AS input_at,(r.document->>'expectedWorldVersion')::integer AS input_version,
    e.id AS output_event,e.version AS output_version,e.payload->>'storyAt' AS output_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',source->>'id','kind',source->>'kind',
      'recordId',source->>'recordId','worldVersion',source->'worldVersion','at',source->>'at'))
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.response->'snapshot'->'sources')='array'
        THEN a.response->'snapshot'->'sources' ELSE '[]'::jsonb END) source
      WHERE source->>'id'=ANY($4::text[]) AND source->>'kind' IN ('group_message','scene_entry')
        AND COALESCE(source->>'usage','channel_context')='channel_context'
        AND (source->>'worldVersion')::integer<=a.expected_world_version
        AND (source->>'at')::timestamptz<=(a.response->'snapshot'->>'storyAt')::timestamptz), '[]'::jsonb) AS seen
    FROM parallel_life.agent_attempts a
    JOIN parallel_life.agent_input_receipts r ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
    JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id AND e.command_id=a.command_id
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3 AND a.status='committed'
      AND e.version<=$5 AND e.version=a.expected_world_version+1 AND c.expected_version=a.expected_world_version
      AND a.engine_epoch>=2 AND (e.payload->'data'->'agentRuntime'->>'engineEpoch')::integer=a.engine_epoch
      AND a.response_hash IS NOT NULL AND a.response->>'kind'='npc_agent_completion' AND a.response->'schemaVersion'='1'::jsonb
      AND a.response->'snapshot'->'state'->>'worldId'=a.world_id AND a.response->'snapshot'->'state'->>'actorId'=a.actor_id
      AND (a.response->'snapshot'->'state'->>'revision')::integer=a.expected_actor_revision
      AND (a.response->'snapshot'->>'worldVersion')::integer=a.expected_world_version
      AND (a.response->'snapshot'->>'storyAt')::timestamptz<=$6::timestamptz AND (e.payload->>'storyAt')::timestamptz<=$6::timestamptz
      AND a.response->'snapshot'->'input'->>'sourceId'=r.id
      AND a.response->'snapshot'->'input'->>'text'=r.document->>'text'
      AND a.response->'snapshot'->'input'->>'origin'=r.document->>'origin'
      AND a.response->'snapshot'->'channel'->>'kind'=r.document->>'channel'
      AND a.response->'snapshot'->'channel'->>'threadId'=r.document->>'threadId'
      AND (r.document->>'recipientActorId' IS NULL OR r.document->>'recipientActorId'=a.actor_id)
      AND (r.document->>'expectedWorldVersion')::integer<=a.expected_world_version
      AND e.payload->'data'->>'actorId'=a.actor_id
      AND e.payload->'data'->'agentRuntime'->>'inputReceiptId'=r.id
      AND e.payload->'data'->'agentRuntime'->'stateAfter'->>'worldId'=a.world_id
      AND e.payload->'data'->'agentRuntime'->'stateAfter'->>'actorId'=a.actor_id
      AND (e.payload->'data'->'agentRuntime'->'stateAfter'->>'revision')::integer=a.expected_actor_revision+1
      AND (e.payload->'data'->'agentRuntime'->'stateAfter'->>'projectedWorldVersion')::integer=e.version`,
      [state.worldId, owner, state.actorId, handles, worldVersion, storyAt],
    )
  ).rows;
  if (!history.length) return;
  const observed = new Map<string, { channel: string; thread: string; source: AgentSource }[]>();
  for (const row of history)
    for (const source of row.seen as AgentSource[]) {
      const list = observed.get(source.id) ?? [];
      list.push({ channel: row.channel, thread: row.thread_id, source });
      observed.set(source.id, list);
    }
  const ownEvents = new Map(history.map((row) => [row.output_event, row]));
  const ownSpeech = (event: string, channel: string, thread: string) => {
    const proof = ownEvents.get(event);
    return proof?.channel === channel && proof.thread_id === thread;
  };
  const inputCommands = history
    .filter((row) => handles.includes(row.input_id))
    .map((row) => row.input_command);
  const ownObserved = (
    id: string,
    channel: string,
    thread: string,
    record: string,
    version: number,
    at: string,
  ) =>
    observed
      .get(id)
      ?.some(
        (proof) =>
          proof.channel === channel &&
          proof.thread === thread &&
          proof.source.kind === (channel === 'group' ? 'group_message' : 'scene_entry') &&
          proof.source.recordId === record &&
          proof.source.worldVersion === version &&
          Date.parse(proof.source.at) === Date.parse(at),
      );
  const processed = (
    row: {
      command_id: string;
      thread_id: string;
      version: number;
      at: string;
      input_ids: string[];
    },
    channel: string,
  ) => {
    for (const h of history)
      if (
        h.channel === channel &&
        h.thread_id === row.thread_id &&
        h.input_command === row.command_id &&
        h.input_version === row.version &&
        Date.parse(h.input_at) === Date.parse(row.at) &&
        row.input_ids.includes(h.input_id)
      )
        add(h.input_id, 'accepted_input', h.input_id, row.version, row.at, [
          row.command_id,
          ...row.input_ids,
        ]);
  };
  if (permissions.groups) {
    const rows = (
      await sql.query(
        `SELECT m.id,m.group_id AS thread_id,e.id AS event_id,e.command_id,e.version,
      e.payload->>'storyAt' AS at,m.document->'sender'->>'actorId' AS speaker,
      ARRAY(SELECT r.id FROM parallel_life.agent_input_receipts r WHERE r.world_id=m.world_id AND r.owner_id=m.owner_id
        AND r.command_id=e.command_id AND r.document->>'channel'='group' AND r.document->>'threadId'=m.group_id
        AND (r.document->>'expectedWorldVersion')::integer=e.version AND r.document->>'text'=m.document->>'text') AS input_ids
      FROM parallel_life.world_group_messages m
      JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.source_event_id AND e.version=m.source_version
      JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
      WHERE m.world_id=$1 AND m.owner_id=$2 AND e.version<=$5 AND (e.payload->>'storyAt')::timestamptz<=$6::timestamptz
        AND (('group:'||m.id)=ANY($4::text[]) OR e.command_id=ANY($7::text[]))
        AND m.document->>'worldId'=m.world_id AND m.document->>'ownerId'=m.owner_id AND m.document->>'id'=m.id
        AND m.document->>'conversationId'=m.group_id AND m.document->>'sourceEventId'=e.id AND (m.document->>'sourceVersion')::integer=e.version
        AND e.payload->'data'->>'groupId'=m.group_id
        AND EXISTS(SELECT 1 FROM parallel_life.world_group_memberships member WHERE member.world_id=m.world_id AND member.owner_id=m.owner_id
          AND member.group_id=m.group_id AND member.member_key=$3 AND member.joined_version<=e.version
          AND (member.left_version IS NULL OR e.version<member.left_version)
          AND EXISTS(SELECT 1 FROM parallel_life.world_events joined JOIN parallel_life.commands jc
            ON jc.world_id=joined.world_id AND jc.owner_id=joined.owner_id AND jc.id=joined.command_id AND jc.status='succeeded' AND jc.result_event_id=joined.id
            WHERE joined.world_id=member.world_id AND joined.owner_id=member.owner_id AND joined.id=member.source_event_id AND joined.version=member.joined_version
              AND joined.payload->'data'->>'groupId'=member.group_id
              AND ((joined.payload->>'type'='group.created' AND joined.payload->'data'->'actorIds' ? $3)
                OR (joined.payload->>'type'='group.membership_changed' AND joined.payload->'data'->>'action'='join'
                  AND joined.payload->'data'->'participant'=jsonb_build_object('kind','actor','actorId',$3::text)))))
        AND ((m.document->'sender'->>'kind'='player' AND e.payload->>'type'='group.message_sent' AND e.payload->'data'->>'text'=m.document->>'text'
          AND COALESCE(e.payload->'data'->>'messageId',e.id)=m.id)
          OR (m.document->'sender'->>'kind'='actor' AND e.payload->>'type'='group.turn_resolved'
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'replies') reply WHERE reply->>'actorId'=m.document->'sender'->>'actorId'
              AND reply->>'text'=m.document->>'text' AND COALESCE(reply->>'messageId',e.id)=m.id)))`,
        [state.worldId, owner, state.actorId, handles, worldVersion, storyAt, inputCommands],
      )
    ).rows;
    for (const row of rows) {
      const aliases = [row.event_id, row.command_id, ...row.input_ids];
      if (
        ownObserved('group:' + row.id, 'group', row.thread_id, row.id, row.version, row.at) ||
        (row.speaker === state.actorId && ownSpeech(row.event_id, 'group', row.thread_id))
      )
        add('group:' + row.id, 'group_message', row.id, row.version, row.at, aliases);
      processed(row, 'group');
    }
  }
  if (permissions.scenes) {
    const rows = (
      await sql.query(
        `SELECT item.id,item.scene_id AS thread_id,e.id AS event_id,e.command_id,e.version,
      e.payload->>'storyAt' AS at,item.document->'speaker'->>'actorId' AS speaker,
      ARRAY(SELECT r.id FROM parallel_life.agent_input_receipts r WHERE r.world_id=item.world_id AND r.owner_id=item.owner_id
        AND r.command_id=e.command_id AND r.document->>'channel'='scene' AND r.document->>'threadId'=item.scene_id
        AND (r.document->>'expectedWorldVersion')::integer=e.version AND r.document->>'text'=item.document->>'text') AS input_ids
      FROM parallel_life.scene_items item
      JOIN parallel_life.scene_sessions scene ON scene.world_id=item.world_id AND scene.owner_id=item.owner_id AND scene.id=item.scene_id
      JOIN parallel_life.world_events e ON e.world_id=item.world_id AND e.owner_id=item.owner_id AND e.id=item.source_event_id
      JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
      WHERE item.world_id=$1 AND item.owner_id=$2 AND item.kind='entry' AND e.version<=$5
        AND (e.payload->>'storyAt')::timestamptz<=$6::timestamptz AND (('scene:'||item.id)=ANY($4::text[]) OR e.command_id=ANY($7::text[]))
        AND item.document->>'worldId'=item.world_id AND item.document->>'ownerId'=item.owner_id AND item.document->>'id'=item.id
        AND item.document->>'sceneId'=item.scene_id AND item.document->>'sourceEventId'=e.id AND (item.document->>'sourceVersion')::integer=e.version
        AND e.payload->'data'->>'sceneId'=item.scene_id
        AND item.document->'observableTo' @> jsonb_build_array(jsonb_build_object('kind','actor','actorId',$3::text))
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(scene.document->'presence') presence
          WHERE presence->'participant'=jsonb_build_object('kind','actor','actorId',$3::text)
            AND (presence->>'joinedVersion')::integer<=e.version AND (NOT(presence?'leftVersion') OR e.version<(presence->>'leftVersion')::integer)
            AND EXISTS(SELECT 1 FROM parallel_life.world_events joined JOIN parallel_life.commands jc
              ON jc.world_id=joined.world_id AND jc.owner_id=joined.owner_id AND jc.id=joined.command_id AND jc.status='succeeded' AND jc.result_event_id=joined.id
              WHERE joined.world_id=scene.world_id AND joined.owner_id=scene.owner_id AND joined.id=presence->>'sourceEventId'
                AND joined.version=(presence->>'sourceVersion')::integer AND joined.version=(presence->>'joinedVersion')::integer
                AND joined.payload->'data'->>'sceneId'=scene.id
                AND joined.payload->>'type' IN ('scene.entered','scene.opened','scene.action_resolved','scene.reaction_recorded')))
        AND ((item.document->>'kind'='user_action' AND e.payload->>'type'='scene.input_recorded' AND COALESCE(e.payload->'data'->>'privateThought','false')='false'
          AND e.payload->'playerInput'->>'text'=item.document->>'text'
          AND EXISTS(SELECT 1 FROM parallel_life.scene_items action WHERE action.world_id=item.world_id AND action.owner_id=item.owner_id
            AND action.scene_id=item.scene_id AND action.source_event_id=e.id AND action.kind='action' AND action.id=item.document->>'actionId' AND action.document->>'text'=item.document->>'text'))
          OR (item.document->>'kind'='dialogue' AND item.document->'speaker'->>'kind'='actor' AND e.payload->>'type' IN ('scene.opened','scene.action_resolved','scene.reaction_recorded')
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(e.payload->'data'->'proposal'->'dialogues',e.payload->'data'->'dialogues','[]'::jsonb)) dialogue
              WHERE dialogue->>'text'=item.document->>'text' AND COALESCE(dialogue->>'actorId',dialogue->'speaker'->>'actorId')=item.document->'speaker'->>'actorId'))
          OR (item.document->>'kind'='narration' AND e.payload->>'type' IN ('scene.opened','scene.action_resolved','scene.reaction_recorded') AND e.payload->'data'->'proposal'->>'narration'=item.document->>'text')
          OR (item.document->>'kind'='adjudicated_result' AND e.payload->>'type'='scene.action_resolved' AND e.payload->'data'->'proposal'->>'observation'=item.document->>'text'))`,
        [state.worldId, owner, state.actorId, handles, worldVersion, storyAt, inputCommands],
      )
    ).rows;
    for (const row of rows) {
      const aliases = [row.event_id, row.command_id, ...row.input_ids];
      if (
        ownObserved('scene:' + row.id, 'scene', row.thread_id, row.id, row.version, row.at) ||
        (row.speaker === state.actorId && ownSpeech(row.event_id, 'scene', row.thread_id))
      )
        add('scene:' + row.id, 'scene_entry', row.id, row.version, row.at, aliases);
      processed(row, 'scene');
    }
  }
}

type MediaCompletionFrame = Pick<AgentSnapshot, 'state' | 'worldVersion' | 'storyAt'>;
/** The enqueue's story timestamp is lineage, not the time this external result became known. */
function mediaCompletionPacket(result: ActorMediaResultContext, observedAtStory: string) {
  const source: AgentSource = {
    id: result.id,
    kind: 'action_result',
    recordId: result.requestId,
    worldVersion: result.source.sourceWorldVersion,
    at: result.source.sourceStoryAt,
    contentHash: result.source.contentHash,
    usage: 'private_strategy',
  };
  const observation: AgentSnapshot['observations'][number] = {
    sourceId: source.id,
    kind: 'result',
    text: JSON.stringify({
      kind: 'own_media_completion',
      requestId: result.requestId,
      actionId: result.actionId,
      enqueueResultId: result.enqueueResultId,
      mediaType: result.mediaType,
      phase: 'completed',
      asset: result.asset,
      completedAtReal: result.completedAtReal,
      sourceStoryAt: result.source.sourceStoryAt,
      observedAtStory,
      chatProjection: result.chatProjection.status,
      meaning:
        '真实生成已完成；原请求时间不是完成时间，聊天投影不是玩家阅读回执，不能据此认定整个目标或事件完成。此为本人执行上下文，不授权向其他渠道公开原私人内容。',
    }),
  };
  return { source, observation };
}

/**
 * Own completed work is available even before a model has copied its handle into knowledge.
 * No state, acknowledgement, delivery, or goal completion is written by this read.
 */
export async function readActorMediaCompletionContextInTransaction(
  sql: SqlClient,
  owner: string,
  frame: MediaCompletionFrame,
  options: {
    referencedSourceIds?: readonly string[];
    expectedSources?: readonly AgentSource[];
    /** Caller already checked the world head; skip a second head read when no media exists. */
    skipEmptyHeadCheck?: boolean;
  } = {},
): Promise<{ sources: AgentSource[]; observations: AgentSnapshot['observations'] }> {
  const control = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
      [frame.state.worldId, owner],
    )
  ).rows[0];
  if (!control || control.engine_epoch < 2) return { sources: [], observations: [] };
  const input = {
    worldId: frame.state.worldId,
    actorId: frame.state.actorId,
    engineEpoch: Number(control.engine_epoch),
    worldVersion: frame.worldVersion,
    ...(options.skipEmptyHeadCheck ? { skipEmptyHeadCheck: true } : {}),
  };
  const completed = new Map<string, ActorMediaResultContext>();
  if (!options.expectedSources) {
    const recent = await readActorMediaResultContextInTransaction(sql, owner, input);
    for (const result of recent.completed) completed.set(result.id, result);
  }
  const referenced = (options.referencedSourceIds ?? []).filter((id) =>
    id.startsWith('media-result:'),
  );
  // Only metadata from this actor's protected committed snapshots is used as a lookup hint.
  // The actual execution/asset lineage is independently authenticated again below.
  const historical = referenced.length
    ? (
        await sql.query(
          `SELECT DISTINCT source->>'recordId' AS request_id
           FROM parallel_life.agent_attempts a
           CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.response->'snapshot'->'sources')='array'
             THEN a.response->'snapshot'->'sources' ELSE '[]'::jsonb END) source
           WHERE a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3 AND a.status='committed'
             AND a.engine_epoch=$4 AND a.expected_world_version<=$5
             AND source->>'id'=ANY($6::text[]) AND source->>'kind'='action_result'
             AND source->>'id' LIKE 'media-result:%' AND source->>'recordId' IS NOT NULL`,
          [input.worldId, owner, input.actorId, input.engineEpoch, input.worldVersion, referenced],
        )
      ).rows.map((row) => String(row.request_id))
    : [];
  const requestIds = [
    ...new Set([
      ...historical,
      ...(options.expectedSources ?? []).map((source) => source.recordId),
    ]),
  ];
  for (let offset = 0; offset < requestIds.length; offset += 64) {
    const exact = await readActorMediaResultContextInTransaction(sql, owner, {
      ...input,
      limit: 64,
      requestIds: requestIds.slice(offset, offset + 64),
    });
    for (const result of exact.completed) completed.set(result.id, result);
  }
  const selected = options.expectedSources
    ? new Set(options.expectedSources.map((source) => source.id))
    : null;
  const packets = [...completed.values()]
    .filter(
      (result) =>
        (!selected || selected.has(result.id)) &&
        Date.parse(result.source.sourceStoryAt) <= Date.parse(frame.storyAt),
    )
    .map((result) => mediaCompletionPacket(result, frame.storyAt));
  return {
    sources: packets.map((packet) => packet.source),
    observations: packets.map((packet) => packet.observation),
  };
}

/** Revalidate external completion independently of worldVersion, including observation contents. */
export async function validateActorMediaResultContextInTransaction(
  sql: SqlClient,
  owner: string,
  snapshot: AgentSnapshot,
) {
  const selected = snapshot.sources.filter((source) => source.id.startsWith('media-result:'));
  if (!selected.length) return; // Pre-upgrade protected paid snapshots remain resumable.
  const current = await readActorMediaCompletionContextInTransaction(sql, owner, snapshot, {
    expectedSources: selected,
  });
  const expectedObservations = snapshot.observations.filter((observation) =>
    selected.some((source) => source.id === observation.sourceId),
  );
  const bySource = (a: { sourceId: string }, b: { sourceId: string }) =>
    a.sourceId.localeCompare(b.sourceId);
  if (
    selected.some((source) => !current.sources.some((item) => isDeepStrictEqual(item, source))) ||
    !isDeepStrictEqual(
      [...expectedObservations].sort(bySource),
      [...current.observations].sort(bySource),
    )
  )
    throw Object.assign(Error('MEDIA_RESULT_SOURCE_CONFLICT'), {
      code: 'MEDIA_RESULT_SOURCE_CONFLICT',
    });
}
