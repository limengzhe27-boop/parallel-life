-- Authored history is committed through the immutable publication genesis receipt,
-- independently of later runtime event/command receipts.
CREATE FUNCTION parallel_life.publication_moment_genesis_confirmed(w text,rule jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; confirm_actor_id text; confirmation text; story_now timestamptz;
BEGIN
 ctx:=parallel_life.publication_moments_context(w);
 IF ctx IS NULL OR jsonb_typeof(rule)<>'object' OR rule->>'kind' IS DISTINCT FROM 'after_statement' THEN RETURN false; END IF;
 confirmation:=btrim(rule->>'statement',E' \t\n\r');
 IF confirmation IS NULL OR length(confirmation)<1 OR length(confirmation)>500 THEN RETURN false; END IF;
 SELECT contact->>'actorId' INTO confirm_actor_id FROM jsonb_array_elements(ctx->'opening'->'contacts') contact
 WHERE contact->>'actorKey'=rule->>'actorKey';
 IF confirm_actor_id IS NULL THEN RETURN false; END IF;
 story_now:=(ctx->>'storyNow')::timestamptz;
 RETURN EXISTS(
  SELECT 1 FROM parallel_life.publication_world_bindings b
  JOIN parallel_life.publication_world_receipts receipt ON receipt.binding_id=b.id
   AND receipt.kind=b.kind AND receipt.requester=b.requester
  JOIN parallel_life.world_initial_snapshots snapshot ON snapshot.world_id=b.world_id AND snapshot.owner_id=b.owner_id
  JOIN parallel_life.approved_seeds seed ON seed.id=b.seed_id AND seed.owner_id=b.owner_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(snapshot.state->'messages','[]'::jsonb)) message
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ctx->'content'->'phone'->'messages','[]'::jsonb)) authored
  WHERE b.world_id=w AND b.owner_id=ctx->>'ownerId' AND b.work_id=(ctx->>'workId')::uuid
   AND receipt.result->>'worldId'=w AND receipt.result->>'seedId'=b.seed_id::text
   AND receipt.result->'origin'=ctx->'opening'->'origin'
   AND snapshot.state->>'id'=w AND snapshot.state->>'ownerId'=b.owner_id
   AND snapshot.state->'version'='0'::jsonb AND snapshot.state->'schemaVersion'='1'::jsonb
   AND (snapshot.state->>'time')::timestamptz<=story_now AND (ctx->>'worldVersion')::bigint>=0
   AND snapshot.approved_seed=seed.document
   AND seed.document->'source'=jsonb_build_object('kind',CASE WHEN b.kind='trial' THEN 'publication_trial' ELSE 'published_work' END)||(ctx->'opening'->'origin')
   AND authored->>'actorKey'=rule->>'actorKey' AND authored->>'origin'='history'
   AND COALESCE(authored->>'speaker','actor')='actor'
   AND message->>'actorId'=confirm_actor_id AND message->>'role'='assistant'
   AND message->>'sourceEventId'='publication-genesis:'||w
   AND message->'history'->'version'='1'::jsonb AND message->'initialRead'='true'::jsonb
   AND message->'history'->>'key'=authored->>'key'
   AND message->>'text'=authored->>'text' AND btrim(message->>'text',E' \t\n\r')=confirmation
   AND (message->>'at')::timestamptz=(authored->>'at')::timestamptz
   AND (message->>'at')::timestamptz<=story_now
 );
END $$;


CREATE OR REPLACE FUNCTION parallel_life.publication_moment_confirmed(w text,rule jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; confirm_actor_id text; confirmation text; story_now timestamptz;
BEGIN
 ctx:=parallel_life.publication_moments_context(w);
 IF ctx IS NULL OR jsonb_typeof(rule)<>'object' OR rule->>'kind' IS DISTINCT FROM 'after_statement' THEN RETURN false; END IF;
 confirmation:=btrim(rule->>'statement',E' \t\n\r');
 IF confirmation IS NULL OR length(confirmation)<1 OR length(confirmation)>500 THEN RETURN false; END IF;
 SELECT contact->>'actorId' INTO confirm_actor_id FROM jsonb_array_elements(ctx->'opening'->'contacts') contact
 WHERE contact->>'actorKey'=rule->>'actorKey';
 IF confirm_actor_id IS NULL THEN RETURN false; END IF;
 story_now:=(ctx->>'storyNow')::timestamptz;
 RETURN EXISTS(SELECT 1 FROM parallel_life.world_messages m
  JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.document->>'sourceEventId'
  JOIN parallel_life.commands cmd ON cmd.world_id=e.world_id AND cmd.owner_id=e.owner_id AND cmd.id=e.command_id AND cmd.result_event_id=e.id AND cmd.status='succeeded'
  WHERE m.world_id=w AND m.owner_id=ctx->>'ownerId' AND m.actor_id=confirm_actor_id
   AND m.document->>'actorId'=confirm_actor_id AND m.document->>'role'='assistant'
   AND btrim(m.document->>'text',E' \t\n\r')=confirmation AND (m.document->>'at')::timestamptz<=story_now
   AND COALESCE((e.payload->>'storyAt')::timestamptz,(m.document->>'at')::timestamptz)<=story_now
   AND e.version<=(ctx->>'worldVersion')::bigint)
 OR EXISTS(SELECT 1 FROM parallel_life.scene_items item
  JOIN parallel_life.world_events e ON e.world_id=item.world_id AND e.owner_id=item.owner_id AND e.id=item.source_event_id
  JOIN parallel_life.commands cmd ON cmd.world_id=e.world_id AND cmd.owner_id=e.owner_id AND cmd.id=e.command_id AND cmd.result_event_id=e.id AND cmd.status='succeeded'
  WHERE item.world_id=w AND item.owner_id=ctx->>'ownerId' AND item.kind='entry'
   AND item.document->>'kind'='dialogue' AND item.document->'speaker'->>'kind'='actor'
   AND item.document->'speaker'->>'actorId'=confirm_actor_id AND btrim(item.document->>'text',E' \t\n\r')=confirmation
   AND item.document->'observableTo' @> '[{"kind":"player"}]'::jsonb
   AND item.document->>'sourceEventId'=e.id AND (item.document->>'sourceVersion')::bigint=e.version
   AND (e.payload->>'storyAt')::timestamptz<=story_now AND e.version<=(ctx->>'worldVersion')::bigint)
 OR EXISTS(SELECT 1 FROM parallel_life.world_group_messages msg
  JOIN parallel_life.world_events e ON e.world_id=msg.world_id AND e.owner_id=msg.owner_id AND e.id=msg.source_event_id
  JOIN parallel_life.commands cmd ON cmd.world_id=e.world_id AND cmd.owner_id=e.owner_id AND cmd.id=e.command_id AND cmd.result_event_id=e.id AND cmd.status='succeeded'
  JOIN parallel_life.world_group_memberships hearer ON hearer.world_id=msg.world_id AND hearer.owner_id=msg.owner_id AND hearer.group_id=msg.group_id AND hearer.member_key='player'
   AND hearer.joined_version<=msg.source_version AND (hearer.left_version IS NULL OR msg.source_version<hearer.left_version)
  WHERE msg.world_id=w AND msg.owner_id=ctx->>'ownerId' AND msg.document->'sender'->>'kind'='actor'
   AND msg.document->'sender'->>'actorId'=confirm_actor_id AND btrim(msg.document->>'text',E' \t\n\r')=confirmation
   AND msg.document->>'sourceEventId'=e.id AND msg.source_version=e.version AND (msg.document->>'sourceVersion')::bigint=e.version
   AND (e.payload->>'storyAt')::timestamptz<=story_now AND e.version<=(ctx->>'worldVersion')::bigint)
 OR parallel_life.publication_moment_genesis_confirmed(w,rule);
END $$;

REVOKE ALL ON FUNCTION parallel_life.publication_moment_genesis_confirmed(text,jsonb),parallel_life.publication_moment_confirmed(text,jsonb) FROM PUBLIC,pl_app,pl_publisher,pl_worker;
