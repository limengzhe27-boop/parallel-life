import type { SqlClient } from '../../storage/infrastructure/postgres.ts';

/** Denial-only lineage. Aliases can suppress a source; they never grant knowledge or read rights. */
export async function forgottenAgentSourceIds(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  actorId: string,
): Promise<Set<string>> {
  const rows = (
    await sql.query(
      `SELECT id,source_ids FROM parallel_life.memory_records WHERE owner_id=$1 AND status='forgotten'
    AND ((scope_type='character' AND character_id=$2 AND (branch_id=$3 OR branch_id IS NULL))
      OR (scope_type='branch' AND scope_id=$3 AND kind<>'episode'))`,
      [ownerId, actorId, worldId],
    )
  ).rows;
  const blocked = new Set<string>(
    rows.flatMap((row) => [
      `memory:${row.id}`,
      ...(Array.isArray(row.source_ids)
        ? row.source_ids.filter((id: unknown): id is string => typeof id === 'string')
        : []),
    ]),
  );
  if (!blocked.size) return blocked;
  // Normalize only known source wrappers, never thread/group/scene container identity.
  const wrappers = [
    'message:',
    'opening:',
    'event:',
    'input:',
    'accepted-input:',
    'group:',
    'group-message:',
    'scene:',
    'scene-entry:',
    'scene-action:',
    'fact:',
    'appointment:',
    'calendar-response:',
    'self-position:',
    'action-result:',
  ];
  for (const id of [...blocked]) {
    const prefix = wrappers.find((p) => id.startsWith(p));
    if (prefix && id.length > prefix.length) blocked.add(id.slice(prefix.length));
    const knowledge = /^knowledge:([^:]+):/.exec(id);
    if (knowledge?.[1]) blocked.add(knowledge[1]);
  }
  const graph = new Map<string, Set<string>>();
  const edge = (a: unknown, b: unknown) => {
    if (typeof a !== 'string' || !a || typeof b !== 'string' || !b) return;
    if (!graph.has(a)) graph.set(a, new Set());
    if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a)!.add(b);
    graph.get(b)!.add(a);
  };
  const events = (
    await sql.query(
      `SELECT id,command_id,payload->'data'->'agentRuntime'->>'inputReceiptId' AS input_id
    FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2`,
      [worldId, ownerId],
    )
  ).rows;
  const byCommand = new Map<string, string[]>();
  for (const event of events) {
    edge(event.id, event.input_id);
    edge(`event:${event.id}`, event.id);
    const ids = byCommand.get(event.command_id) ?? [];
    ids.push(event.id);
    byCommand.set(event.command_id, ids);
  }
  for (const row of (
    await sql.query(
      `SELECT id,document->>'sourceEventId' AS event_id FROM parallel_life.world_messages
    WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3`,
      [worldId, ownerId, actorId],
    )
  ).rows) {
    edge(row.id, row.event_id);
    edge(`message:${row.id}`, row.id);
    edge(`opening:${row.id}`, row.id);
  }
  // Older worker paths do not have new-runtime table grants. Respect them; do not widen privileges.
  const permissions = (
    await sql.query(
      `SELECT
    has_table_privilege(current_user,'parallel_life.agent_input_receipts','SELECT') AS inputs,
    has_table_privilege(current_user,'parallel_life.world_group_messages','SELECT') AS groups,
    has_table_privilege(current_user,'parallel_life.scene_items','SELECT') AS scenes,
    has_table_privilege(current_user,'parallel_life.actor_position_knowledge','SELECT') AS knowledge,
    has_table_privilege(current_user,'parallel_life.world_authoritative_positions','SELECT') AS positions`,
      [],
    )
  ).rows[0]!;
  if (permissions.inputs)
    for (const row of (
      await sql.query(
        `SELECT id,command_id FROM parallel_life.agent_input_receipts
    WHERE world_id=$1 AND owner_id=$2 AND (document->>'recipientActorId'=$3 OR document->>'channel' IN ('group','scene'))`,
        [worldId, ownerId, actorId],
      )
    ).rows) {
      edge(`input:${row.id}`, row.id);
      edge(`accepted-input:${row.id}`, row.id);
      for (const eventId of byCommand.get(row.command_id) ?? []) edge(row.id, eventId);
    }
  // Native aliases are deliberately only a conservative denial graph, not an audience resolver.
  if (permissions.groups)
    for (const row of (
      await sql.query(
        `SELECT id,source_event_id FROM parallel_life.world_group_messages
    WHERE world_id=$1 AND owner_id=$2`,
        [worldId, ownerId],
      )
    ).rows) {
      edge(row.id, row.source_event_id);
      edge(`group:${row.id}`, row.id);
      edge(`group-message:${row.id}`, row.id);
    }
  if (permissions.scenes)
    for (const row of (
      await sql.query(
        `SELECT id,source_event_id,document->>'sourceEventId' AS event_id,
    document->'resolution'->>'sourceEventId' AS resolution_id FROM parallel_life.scene_items WHERE world_id=$1 AND owner_id=$2`,
        [worldId, ownerId],
      )
    ).rows) {
      edge(row.id, row.source_event_id);
      edge(row.id, row.event_id);
      edge(row.id, row.resolution_id);
      for (const prefix of ['scene:', 'scene-entry:', 'scene-action:'])
        edge(prefix + row.id, row.id);
    }
  if (permissions.knowledge)
    for (const row of (
      await sql.query(
        `SELECT source_event_id,document->'evidence'->>'inputReceiptId' AS input_id,
    document->'subject'->>'kind' AS subject_kind,document->'subject'->>'actorId' AS subject_actor,kind
    FROM parallel_life.actor_position_knowledge WHERE world_id=$1 AND owner_id=$2 AND observer_actor_id=$3`,
        [worldId, ownerId, actorId],
      )
    ).rows) {
      edge(row.source_event_id, row.input_id);
      const subject = row.subject_kind === 'player' ? 'player' : row.subject_actor;
      if (subject)
        edge(`knowledge:${row.source_event_id}:${subject}:${row.kind}`, row.source_event_id);
    }
  if (permissions.positions)
    for (const row of (
      await sql.query(
        `SELECT source_event_id FROM parallel_life.world_authoritative_positions
    WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3`,
        [worldId, ownerId, `actor:${actorId}`],
      )
    ).rows)
      if (row.source_event_id) edge(`self-position:${row.source_event_id}`, row.source_event_id);
  const queue = [...blocked];
  for (let i = 0; i < queue.length; i++)
    for (const id of graph.get(queue[i]!) ?? [])
      if (!blocked.has(id)) {
        blocked.add(id);
        queue.push(id);
      }
  return blocked;
}
