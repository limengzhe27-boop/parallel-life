import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { ActorContext } from '../application/ports.ts';
import type { ActorSituation } from '../domain/actor-situation.ts';
import type { StoryPlan, StorySource } from '../../settings/domain/publication-story.ts';
import { DomainError } from '../domain/errors.ts';

/** A snapshot-bound read; only this actor's successfully delivered direction can cross this boundary. */
export function readActorSituation(
  db: PostgresDatabase,
  ownerId: string,
  context: ActorContext,
): Promise<ActorSituation | undefined> {
  return db.transaction(ownerId, async (sql) => {
    const world = (
      await sql.query(
        'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR SHARE',
        [context.worldId, ownerId],
      )
    ).rows[0];
    if (!world) throw new DomainError('NOT_FOUND');
    if (world.version !== context.worldVersion) throw new DomainError('VERSION_CONFLICT');
    // Ordinary private chats have no delivered authored direction. Skip the
    // seven-way proof join unless this actor actually has a delivery row.
    const delivery = (
      await sql.query(
        `SELECT EXISTS(
           SELECT 1 FROM parallel_life.publication_opening_deliveries d
           WHERE d.world_id=$1 AND d.owner_id=$2 AND d.actor_id=$3 AND d.status='delivered'
         ) AS has_delivery`,
        [context.worldId, ownerId, context.actor.id],
      )
    ).rows[0];
    if (!delivery?.has_delivery) return undefined;
    const rows = (
      await sql.query(
        `SELECT d.brief,d.actor_id,d.source_event_id,d.source_message_id,
      b.source_hash,b.node_key,p.document AS plan,m.document AS message,e.version,
      n.outcome
      FROM parallel_life.publication_opening_deliveries d
      JOIN parallel_life.publication_opening_batches b ON b.world_id=d.world_id AND b.owner_id=d.owner_id
      JOIN parallel_life.publication_story_plans p ON p.world_id=d.world_id AND p.owner_id=d.owner_id
      JOIN parallel_life.world_events e ON e.world_id=d.world_id AND e.owner_id=d.owner_id AND e.id=d.source_event_id
      JOIN parallel_life.world_messages m ON m.world_id=d.world_id AND m.owner_id=d.owner_id AND m.id=d.source_message_id AND m.actor_id=d.actor_id
      JOIN parallel_life.commands c ON c.world_id=d.world_id AND c.owner_id=d.owner_id AND c.id=d.command_id::text
        AND c.status='succeeded' AND c.result_event_id=e.id AND e.command_id=c.id
      LEFT JOIN parallel_life.publication_story_nodes n ON n.world_id=d.world_id AND n.owner_id=d.owner_id AND n.node_key=b.node_key
      WHERE d.world_id=$1 AND d.owner_id=$2 AND d.actor_id=$3 AND d.status='delivered'
        AND e.version<=$4 AND e.version=d.expected_version+1 AND c.expected_version=d.expected_version
        AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'origin'='director'
        AND e.payload->'data'->>'actorId'=$3 AND m.document->>'role'='assistant'
        AND m.document->>'actorId'=$3 AND m.document->>'id'=m.id
        AND m.document->>'sourceEventId'=e.id AND m.document->'sourceVersion'=to_jsonb(e.version)
        AND NOT (m.document ? 'history')
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'effects') x
          WHERE x->>'type'='message.received' AND x->>'id'=m.id AND x->>'actorId'=$3 AND x->>'text'=m.document->>'text')
        AND NOT EXISTS(SELECT 1 FROM parallel_life.memory_records r WHERE r.owner_id=d.owner_id AND r.status='forgotten'
          AND ((r.scope_type='character' AND r.character_id=$3) OR (r.scope_type='branch' AND r.scope_id=$1 AND r.kind<>'episode'))
          AND (r.source_ids ? m.id OR r.source_ids ? e.id))`,
        [context.worldId, ownerId, context.actor.id, context.worldVersion],
      )
    ).rows;
    if (!rows.length) return undefined;
    const row = rows[0],
      plan = row.plan as StoryPlan;
    if (
      plan.openingEventKey !== row.node_key ||
      !Number.isFinite(Date.parse(context.time)) ||
      !Number.isFinite(Date.parse(row.message.at)) ||
      Date.parse(row.message.at) > Date.parse(context.time)
    )
      return undefined;
    const raw = (
      await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [
        context.worldId,
      ])
    ).rows[0]?.source as StorySource | null;
    if (!raw || JSON.stringify(raw.origin) !== JSON.stringify(plan.origin)) return undefined;
    const node = plan.nodes.find((n) => n.key === row.node_key);
    if (!node || node.intent.kind !== 'director_event') return undefined;
    const delivered = (
      await sql.query(
        'SELECT actor_id FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND owner_id=$2',
        [context.worldId, ownerId],
      )
    ).rows.map((r) => r.actor_id);
    const ordered = node.actorKeys.length
      ? node.actorKeys.flatMap((key) => plan.actors.filter((a) => a.key === key))
      : plan.actors;
    const actors = ordered.filter((a) => delivered.includes(a.id)).map((a) => a.id);
    if (
      !actors.includes(context.actor.id) ||
      createHash('sha256')
        .update(JSON.stringify([raw.origin, node.key, actors]))
        .digest('hex') !== row.source_hash
    )
      return undefined;
    return {
      worldVersion: context.worldVersion,
      storyAt: context.time,
      opening: {
        nodeKey: row.node_key,
        direction: row.brief,
        sourceMessageId: row.source_message_id,
        sourceEventId: row.source_event_id,
        deliveredAt: row.message.at,
        sourceVersion: row.version,
      },
      eventOutcome: row.outcome ?? null,
    };
  });
}
