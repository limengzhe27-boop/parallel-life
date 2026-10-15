import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState, AgentSource } from '../domain/agent-runtime.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';

/** Own persistent strategy provenance, not permission to disclose private transcripts to a channel. */
export async function readActorStrategyBasis(
  sql: SqlClient,
  ownerId: string,
  state: ActorAgentState,
  worldVersion: number,
  storyAt: string,
): Promise<AgentSource[]> {
  const handles = [
    ...new Set([
      ...state.knowledgeSourceIds,
      ...[...state.goals, ...state.plans, ...state.actions, ...state.responsibilities].flatMap(
        (x) => x.sourceIds,
      ),
      ...state.decisions.map((x) => x.sourceId),
      ...[
        ...state.plans.flatMap((x) => x.triggers),
        ...state.actions.flatMap((x) => x.preconditions),
        ...state.responsibilities.flatMap((x) => x.nextCheck),
      ].flatMap((x) => ('sourceId' in x ? [x.sourceId] : [])),
    ]),
  ];
  if (!handles.length) return [];
  const blocked = await forgottenAgentSourceIds(sql, ownerId, state.worldId, state.actorId);
  const sources = new Map<string, AgentSource>();
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
  const initial = (
    await sql.query(
      'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
      [state.worldId, ownerId],
    )
  ).rows[0]?.state;
  if (initial) {
    for (const m of initial.messages ?? [])
      if (m.actorId === state.actorId && String(m.sourceEventId).startsWith('genesis:'))
        for (const prefix of ['message:', 'opening:'])
          add(prefix + m.id, 'private_message', m.id, 0, m.at, [m.sourceEventId]);
    for (const f of initial.facts ?? [])
      if (
        f.visibility?.kind === 'world' ||
        (f.visibility?.kind === 'actors' && f.visibility.actorIds.includes(state.actorId))
      )
        if (!f.believedByActorId || f.believedByActorId === state.actorId)
          add('fact:' + f.id, 'world_event', f.sourceEventId, 0, initial.time);
    for (const a of initial.appointments ?? [])
      if (a.participantIds.includes(state.actorId))
        add('appointment:' + a.id, 'world_event', a.sourceEventId, 0, initial.time);
  }
  const inputs = (
    await sql.query(
      `SELECT id,document FROM parallel_life.agent_input_receipts
    WHERE world_id=$1 AND owner_id=$2 AND id=ANY($3::text[]) AND document->>'channel'='private'
      AND document->>'recipientActorId'=$4 AND (document->>'expectedWorldVersion')::integer<=$5`,
      [state.worldId, ownerId, handles, state.actorId, worldVersion],
    )
  ).rows;
  for (const row of inputs)
    add(row.id, 'accepted_input', row.id, row.document.expectedWorldVersion, row.document.storyAt);
  const messageIds = handles
    .filter((h) => /^(message|opening):/.test(h))
    .map((h) => h.replace(/^(message|opening):/, ''));
  const messages = (
    await sql.query(
      `SELECT m.id,m.document,e.id AS event_id,e.version
    FROM parallel_life.world_messages m JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.id=m.document->>'sourceEventId'
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=$3 AND m.id=ANY($4::text[]) AND e.version<=$5`,
      [state.worldId, ownerId, state.actorId, messageIds, worldVersion],
    )
  ).rows;
  for (const row of messages)
    for (const prefix of ['message:', 'opening:'])
      add(prefix + row.id, 'private_message', row.id, row.version, row.document.at, [row.event_id]);
  const memoryIds = handles.filter((h) => /^memory:[0-9a-f-]{36}$/i.test(h)).map((h) => h.slice(7));
  const memories = (
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
  ).rows;
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
  const facts = (
    await sql.query(
      `SELECT f.id,f.document,e.id AS event_id,e.version,e.payload->>'storyAt' AS at FROM parallel_life.world_facts f
    JOIN parallel_life.world_events e ON e.world_id=f.world_id AND e.id=f.document->>'sourceEventId'
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE f.world_id=$1 AND f.owner_id=$2 AND ('fact:'||f.id)=ANY($3::text[]) AND e.version<=$5
    AND (f.document->'visibility'->>'kind'='world' OR (f.document->'visibility'->>'kind'='actors' AND f.document->'visibility'->'actorIds' ? $4))
    AND (NOT(f.document?'believedByActorId') OR f.document->>'believedByActorId'=$4)`,
      [state.worldId, ownerId, handles, state.actorId, worldVersion],
    )
  ).rows;
  for (const row of facts) add('fact:' + row.id, 'world_event', row.event_id, row.version, row.at);
  const appointments = (
    await sql.query(
      `SELECT p.id,p.document,e.id AS event_id,e.version,e.payload->>'storyAt' AS at FROM parallel_life.world_appointments p
    JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.id=p.document->>'sourceEventId'
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE p.world_id=$1 AND p.owner_id=$2 AND ('appointment:'||p.id)=ANY($3::text[]) AND p.document->'participantIds' ? $4 AND e.version<=$5`,
      [state.worldId, ownerId, handles, state.actorId, worldVersion],
    )
  ).rows;
  for (const row of appointments)
    add('appointment:' + row.id, 'world_event', row.event_id, row.version, row.at);
  return [...sources.values()];
}
