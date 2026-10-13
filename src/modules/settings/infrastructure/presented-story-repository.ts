import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { presentedStoryThreads } from '../domain/presented-story-context.ts';

/** No lazy mutation, author prose, other actors' messages, or future plot enters this read. */
export function readPresentedActorStory(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  actorId: string,
  worldVersion: number,
  storyNow: string,
) {
  return db.transaction(ownerId, async (sql) => {
    const result = await sql.query(
      `SELECT m.document AS opening
       FROM parallel_life.publication_story_nodes n
       JOIN parallel_life.publication_story_plans p ON p.world_id=n.world_id AND p.owner_id=n.owner_id
       JOIN parallel_life.world_messages m ON m.world_id=n.world_id AND m.owner_id=n.owner_id
         AND m.id=n.source_message_id AND m.actor_id=n.actor_id
       JOIN parallel_life.world_events e ON e.world_id=n.world_id AND e.owner_id=n.owner_id AND e.id=n.source_event_id
       JOIN parallel_life.commands cmd ON cmd.world_id=n.world_id AND cmd.owner_id=n.owner_id
         AND cmd.id=n.command_id::text AND cmd.result_event_id=e.id AND cmd.status='succeeded' AND e.command_id=cmd.id
       WHERE n.world_id=$1 AND n.owner_id=$2 AND n.actor_id=$3 AND n.status='presented' AND n.outcome IS NULL
         AND e.version <= $4 AND e.version=n.expected_version+1
         AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'actorId'=$3
         AND m.document->>'role'='assistant' AND m.document->>'actorId'=$3
         AND m.document->>'sourceEventId'=e.id
         AND m.document->>'id'=m.id AND m.document->'sourceVersion'=to_jsonb(e.version)
         AND NOT EXISTS(SELECT 1 FROM parallel_life.memory_records r
           WHERE r.owner_id=n.owner_id AND r.status='forgotten'
             AND ((r.scope_type='character' AND r.character_id=$3)
               OR (r.scope_type='branch' AND r.scope_id=$1 AND r.kind<>'episode'))
             AND (r.source_ids ? m.id OR r.source_ids ? e.id))
         AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.document->'nodes') node
           WHERE node->>'key'=n.node_key AND node->'intent'->>'kind'='director_event')
       ORDER BY e.version DESC,m.ordinal DESC LIMIT 2`,
      [worldId, ownerId, actorId, worldVersion],
    );
    return presentedStoryThreads(result.rows, actorId, worldVersion, storyNow);
  });
}
