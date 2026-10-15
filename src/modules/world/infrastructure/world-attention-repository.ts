import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import {
  validClockConversationFocus,
  type ClockConversationFocus,
} from '../domain/clock-activity.ts';
import type { DirectorSnapshot } from '../domain/director-runtime.ts';
export type WorldAttention = {
  focus: DirectorSnapshot['focus'];
  conversationWithoutTarget: boolean;
};
type Input = { worldId: string; worldVersion: number; realNow?: string };
/** A single read statement keeps world, client leases and business membership on the same snapshot. */
async function frame(
  sql: SqlClient,
  ownerId: string,
  input: Input,
  target: ClockConversationFocus | null = null,
) {
  const realNow = input.realNow ?? new Date().toISOString();
  if (
    !ownerId ||
    !input.worldId ||
    !Number.isSafeInteger(input.worldVersion) ||
    input.worldVersion < 0 ||
    !Number.isFinite(Date.parse(realNow))
  )
    throw new DomainError('INVALID_COMMAND');
  const row = (
    await sql.query(
      `
 WITH w AS (
  SELECT id,owner_id,version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2
 ), leases AS (
  SELECT a.focus FROM parallel_life.world_clock_activity a JOIN w ON w.id=a.world_id AND w.owner_id=a.owner_id
  WHERE a.mode='conversation' AND a.expires_at>$3::timestamptz
 ), targets AS (
  SELECT DISTINCT focus FROM leases WHERE focus IS NOT NULL
  UNION SELECT $4::jsonb WHERE $4::jsonb IS NOT NULL
 )
 SELECT w.id,w.version,current_setting('app.user_id',true) AS identity,
  COALESCE((SELECT jsonb_agg(a->>'id') FROM jsonb_array_elements(w.state->'actors') a),'[]'::jsonb) actor_ids,
  c.paused,c.managed,c.active_until,
  COALESCE((SELECT jsonb_agg(focus) FROM leases),'[]'::jsonb) leases,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('target',t.focus,
   'members',COALESCE((SELECT jsonb_agg(m.participant) FROM parallel_life.world_groups g
    JOIN parallel_life.world_events ge ON ge.world_id=g.world_id AND ge.owner_id=g.owner_id AND ge.id=g.source_event_id AND ge.version=g.source_version
    JOIN parallel_life.commands gc ON gc.world_id=ge.world_id AND gc.id=ge.command_id AND gc.status='succeeded' AND gc.result_event_id=ge.id
    JOIN parallel_life.world_group_memberships m ON m.world_id=g.world_id AND m.owner_id=g.owner_id AND m.group_id=g.id
    JOIN parallel_life.world_events me ON me.world_id=m.world_id AND me.owner_id=m.owner_id AND me.id=m.source_event_id AND me.version=m.joined_version
    JOIN parallel_life.commands mc ON mc.world_id=me.world_id AND mc.id=me.command_id AND mc.status='succeeded' AND mc.result_event_id=me.id
    WHERE t.focus->>'channel'='group' AND g.world_id=w.id AND g.owner_id=w.owner_id AND g.id=t.focus->>'threadId'
    AND g.source_version<=w.version AND m.joined_version<=w.version AND (m.left_version IS NULL OR m.left_version>w.version)),'[]'::jsonb),
   'scene',(SELECT jsonb_build_object('status',s.document->>'status','current',x.current_scene_id=s.id,
      'presence',COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(s.document->'presence') p
       JOIN parallel_life.world_events pe ON pe.world_id=s.world_id AND pe.owner_id=s.owner_id AND pe.id=p->>'sourceEventId' AND pe.version=(p->>'sourceVersion')::integer
       JOIN parallel_life.commands pc ON pc.world_id=pe.world_id AND pc.id=pe.command_id AND pc.status='succeeded' AND pc.result_event_id=pe.id
       WHERE pe.version<=w.version AND pe.payload->'data'->>'sceneId'=s.id),'[]'::jsonb))
     FROM parallel_life.scene_sessions s JOIN parallel_life.player_experiences x ON x.world_id=s.world_id AND x.owner_id=s.owner_id
     JOIN parallel_life.world_events se ON se.world_id=s.world_id AND se.owner_id=s.owner_id AND se.id=s.source_event_id
     JOIN parallel_life.commands sc ON sc.world_id=se.world_id AND sc.id=se.command_id AND sc.status='succeeded' AND sc.result_event_id=se.id
     WHERE t.focus->>'channel'='scene' AND s.world_id=w.id AND s.owner_id=w.owner_id AND s.id=t.focus->>'threadId' AND se.version<=w.version)
  )) FROM targets t),'[]'::jsonb) targets
 FROM w LEFT JOIN parallel_life.world_clock c ON c.world_id=w.id AND c.owner_id=w.owner_id`,
      [input.worldId, ownerId, realNow, target ? JSON.stringify(target) : null],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  if (row.identity !== ownerId) throw new DomainError('NOT_FOUND');
  if (Number(row.version) !== input.worldVersion) throw new DomainError('VERSION_CONFLICT');
  return { row, realNow };
}
function resolve(
  row: any,
  target: ClockConversationFocus,
): DirectorSnapshot['focus'][number] | null {
  const actors = new Set<string>(row.actor_ids);
  if (target.channel === 'private')
    return actors.has(target.threadId) ? { ...target, actorIds: [target.threadId] } : null;
  const evidence = row.targets.find(
    (v: any) => v.target?.channel === target.channel && v.target?.threadId === target.threadId,
  );
  if (!evidence) return null;
  if (target.channel === 'group') {
    if (!evidence.members.some((p: any) => p.kind === 'player')) return null;
    const actorIds = evidence.members
      .filter((p: any) => p.kind === 'actor' && actors.has(p.actorId))
      .map((p: any) => p.actorId);
    return { ...target, actorIds: [...new Set<string>(actorIds)].sort() };
  }
  const scene = evidence.scene;
  if (!scene || !scene.current || scene.status !== 'active') return null;
  const present = scene.presence.filter(
    (p: any) =>
      Number.isSafeInteger(p.joinedVersion) &&
      p.joinedVersion <= row.version &&
      (p.leftVersion === undefined || p.leftVersion > row.version),
  );
  if (!present.some((p: any) => p.participant.kind === 'player')) return null;
  const actorIds = present
    .filter((p: any) => p.participant.kind === 'actor' && actors.has(p.participant.actorId))
    .map((p: any) => p.participant.actorId);
  return { ...target, actorIds: [...new Set<string>(actorIds)].sort() };
}
/** For clock update under the existing world lock. This never grants location or action authority. */
export async function resolveWorldConversationFocusInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: Input & { focus: ClockConversationFocus },
): Promise<DirectorSnapshot['focus'][number] | null> {
  if (!validClockConversationFocus(input.focus)) throw new DomainError('INVALID_COMMAND');
  return resolve((await frame(sql, ownerId, input, input.focus)).row, input.focus);
}
/** Director-only structured attention, never last-message inference or a real position/decision. */
export async function readWorldAttentionInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: Input,
): Promise<WorldAttention> {
  const { row, realNow } = await frame(sql, ownerId, input);
  if (
    !row.managed ||
    row.paused ||
    !row.active_until ||
    Date.parse(row.active_until) <= Date.parse(realNow)
  )
    return { focus: [], conversationWithoutTarget: false };
  const found = new Map<string, DirectorSnapshot['focus'][number]>();
  let conversationWithoutTarget = false;
  for (const target of row.leases) {
    const focus = validClockConversationFocus(target) ? resolve(row, target) : null;
    if (focus) found.set(JSON.stringify([focus.channel, focus.threadId]), focus);
    else conversationWithoutTarget = true;
  }
  return {
    focus: [...found.values()].sort(
      (a, b) => a.channel.localeCompare(b.channel) || a.threadId.localeCompare(b.threadId),
    ),
    conversationWithoutTarget,
  };
}
