-- One server-owned visible set controls both posts and their private photograph URLs.
-- Internal source functions are not executable by application/publisher roles.
CREATE OR REPLACE FUNCTION parallel_life.publication_moments_context(w text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; c jsonb; o jsonb; x parallel_life.worlds%ROWTYPE; story_now timestamptz;
BEGIN
 SELECT binding.* INTO b FROM parallel_life.publication_world_bindings binding
 JOIN parallel_life.worlds owned ON owned.id=binding.world_id AND owned.owner_id=binding.owner_id
 WHERE binding.world_id=w AND binding.owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO x FROM parallel_life.worlds WHERE id=w AND owner_id=b.owner_id;
 SELECT r.content INTO c FROM parallel_life.publication_draft_revisions r
 WHERE r.work_id=b.work_id AND r.version=b.draft_version AND r.content_hash=b.content_hash;
 IF c IS NULL THEN RETURN NULL; END IF;
 IF b.kind='published_work' AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_versions v
  WHERE v.work_id=b.work_id AND v.version=b.publication_version AND v.draft_version=b.draft_version
   AND v.content_hash=b.content_hash AND v.content=c) THEN RETURN NULL; END IF;
 SELECT wb.opening INTO o FROM parallel_life.world_builds wb
 WHERE wb.world_id=w AND wb.owner_id=b.owner_id AND wb.seed_id=b.seed_id;
 IF o IS NULL OR o->'origin' IS DISTINCT FROM jsonb_build_object('workId',b.work_id,
  'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash)
 THEN RETURN NULL; END IF;
 story_now:=COALESCE(parallel_life.publication_story_clock(w),(x.state->>'time')::timestamptz);
 RETURN jsonb_build_object('content',c,'opening',o,'workId',b.work_id,'ownerId',b.owner_id,'worldVersion',x.version,'storyNow',story_now);
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
   AND (e.payload->>'storyAt')::timestamptz<=story_now AND e.version<=(ctx->>'worldVersion')::bigint);
END $$;

CREATE OR REPLACE FUNCTION parallel_life.publication_visible_moments(w text) RETURNS TABLE(moment jsonb,work_id uuid)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; bound_work_id uuid; post jsonb; a jsonb; contact jsonb; mode text; posted_at timestamptz; story_now timestamptz; urls jsonb; sources jsonb; raw text; matched text[]; url text;
BEGIN
 ctx:=parallel_life.publication_moments_context(w);
 IF ctx IS NULL THEN RETURN; END IF;
 bound_work_id:=(ctx->>'workId')::uuid; work_id:=bound_work_id; story_now:=(ctx->>'storyNow')::timestamptz;
 FOR post IN SELECT value FROM jsonb_array_elements(COALESCE(ctx->'content'->'phone'->'moments','[]'::jsonb)) LOOP
  SELECT value INTO a FROM jsonb_array_elements(ctx->'content'->'actors') WHERE value->>'key'=post->>'actorKey' AND value->'knownAtStart'='true'::jsonb;
  SELECT value INTO contact FROM jsonb_array_elements(ctx->'opening'->'contacts') WHERE value->>'actorKey'=post->>'actorKey';
  IF a IS NULL OR contact IS NULL THEN CONTINUE; END IF;
  posted_at:=(post->>'at')::timestamptz;
  IF posted_at>story_now THEN CONTINUE; END IF;
  mode:=CASE WHEN a->'publicCard' ? 'momentsVisibility' THEN a->'publicCard'->>'momentsVisibility' ELSE 'all' END;
  IF mode IS NULL OR mode NOT IN ('all','three_days') THEN CONTINUE; END IF;
  IF mode='three_days' AND posted_at<story_now-interval '72 hours' THEN CONTINUE; END IF;
  IF post ? 'visibility' AND NOT parallel_life.publication_moment_confirmed(w,post->'visibility') THEN CONTINUE; END IF;
  sources:=CASE WHEN jsonb_typeof(post->'images')='array' THEN post->'images'
   WHEN jsonb_typeof(post->'image')='string' THEN jsonb_build_array(post->'image') ELSE '[]'::jsonb END;
  urls:='[]'::jsonb;
  FOR raw IN SELECT value FROM jsonb_array_elements_text(sources) LOOP
   url:=raw;
   IF raw LIKE '/api/v1/publisher/%' THEN
    matched:=regexp_match(raw,'^/api/v1/publisher/works/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
    IF matched IS NULL OR matched[1]<>bound_work_id::text OR NOT EXISTS(SELECT 1 FROM parallel_life.publication_media_assets asset WHERE asset.id=matched[2]::uuid AND asset.work_id=bound_work_id AND asset.kind='image' AND asset.status='ready') THEN CONTINUE; END IF;
    url:='/api/v1/worlds/'||w||'/media/'||matched[2];
   END IF;
   IF btrim(url)<>'' AND NOT urls ? url THEN urls:=urls||jsonb_build_array(url); END IF;
  END LOOP;
  moment:=jsonb_build_object('key',post->>'key','actorId',contact->>'actorId','name',a->>'name','text',post->>'text','at',post->>'at');
  IF jsonb_array_length(urls)>0 THEN moment:=moment||jsonb_build_object('image',urls->>0,'images',urls); END IF;
  RETURN NEXT;
 END LOOP;
END $$;

-- Model context receives only this actor's own author-chosen confirmation sentences.
CREATE OR REPLACE FUNCTION parallel_life.publication_actor_moment_confirmations(w text,who text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; actor_key text; result jsonb;
BEGIN
 ctx:=parallel_life.publication_moments_context(w);
 IF ctx IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT contact->>'actorKey' INTO actor_key FROM jsonb_array_elements(ctx->'opening'->'contacts') contact WHERE contact->>'actorId'=who;
 IF actor_key IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT COALESCE(jsonb_agg(statement),'[]'::jsonb) INTO result FROM (
  SELECT DISTINCT post->'visibility'->>'statement' AS statement
  FROM jsonb_array_elements(COALESCE(ctx->'content'->'phone'->'moments','[]'::jsonb)) post
  WHERE post->'visibility'->>'kind'='after_statement' AND post->'visibility'->>'actorKey'=actor_key
   AND length(btrim(post->'visibility'->>'statement')) BETWEEN 1 AND 500
  ORDER BY statement LIMIT 4
 ) own;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION parallel_life.publication_social_opening(w text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; posts jsonb; profiles jsonb;
BEGIN
 ctx:=parallel_life.publication_moments_context(w);
 IF ctx IS NULL THEN RETURN jsonb_build_object('moments','[]'::jsonb); END IF;
 SELECT COALESCE(jsonb_agg(moment ORDER BY (moment->>'at')::timestamptz DESC,moment->>'key'),'[]'::jsonb) INTO posts FROM parallel_life.publication_visible_moments(w);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('actorId',contact->>'actorId','momentsVisibility',COALESCE(a->'publicCard'->>'momentsVisibility','all'))),'[]'::jsonb) INTO profiles
 FROM jsonb_array_elements(ctx->'content'->'actors') a JOIN jsonb_array_elements(ctx->'opening'->'contacts') contact ON contact->>'actorKey'=a->>'key'
 WHERE a->'knownAtStart'='true'::jsonb AND COALESCE(a->'publicCard'->>'momentsVisibility','all') IN ('all','three_days');
 RETURN jsonb_build_object('moments',posts,'profiles',profiles);
END $$;

CREATE OR REPLACE FUNCTION parallel_life.publication_media_assert_content(w uuid,c jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE msg jsonb; att jsonb; asset_id uuid; post jsonb; sources jsonb; raw text; matched text[];
BEGIN
 FOR msg IN SELECT value FROM jsonb_array_elements(COALESCE(c->'phone'->'messages','[]'::jsonb)) LOOP
  att:=msg->'attachment';
  IF att IS NULL OR jsonb_typeof(att)='null' THEN CONTINUE; END IF;
  IF jsonb_typeof(att)<>'object' OR att->>'assetId' IS NULL OR att->>'assetId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR att->>'kind' IS NULL OR att->>'kind' NOT IN ('image','video') THEN RAISE EXCEPTION 'PUBLICATION_MEDIA_INVALID' USING ERRCODE='23514'; END IF;
  asset_id:=(att->>'assetId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM parallel_life.publication_media_assets m WHERE m.id=asset_id AND m.work_id=w AND m.kind=att->>'kind' AND m.status='ready') THEN RAISE EXCEPTION 'PUBLICATION_MEDIA_NOT_READY' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR post IN SELECT value FROM jsonb_array_elements(COALESCE(c->'phone'->'moments','[]'::jsonb)) LOOP
  sources:=(CASE WHEN jsonb_typeof(post->'images')='array' THEN post->'images' ELSE '[]'::jsonb END)
   || (CASE WHEN jsonb_typeof(post->'image')='string' THEN jsonb_build_array(post->'image') ELSE '[]'::jsonb END);
  FOR raw IN SELECT value FROM jsonb_array_elements_text(sources) LOOP
   IF raw NOT LIKE '/api/v1/publisher/%' THEN CONTINUE; END IF;
   matched:=regexp_match(raw,'^/api/v1/publisher/works/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
   IF matched IS NULL OR matched[1]<>w::text OR NOT EXISTS(SELECT 1 FROM parallel_life.publication_media_assets m WHERE m.id=matched[2]::uuid AND m.work_id=w AND m.kind='image' AND m.status='ready') THEN RAISE EXCEPTION 'PUBLICATION_MOMENT_MEDIA_INVALID' USING ERRCODE='23514'; END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION parallel_life.publication_media_for_world(w text,a uuid)
 RETURNS TABLE(storage_key text,mime_type text,byte_length bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; c jsonb;
BEGIN
 SELECT binding.* INTO b FROM parallel_life.publication_world_bindings binding JOIN parallel_life.worlds owned ON owned.id=binding.world_id AND owned.owner_id=binding.owner_id
 WHERE binding.world_id=w AND binding.owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN; END IF;
 IF b.kind='trial' THEN SELECT d.content INTO c FROM parallel_life.publication_draft_revisions d WHERE d.work_id=b.work_id AND d.version=b.draft_version AND d.content_hash=b.content_hash;
 ELSE SELECT v.content INTO c FROM parallel_life.publication_versions v WHERE v.work_id=b.work_id AND v.version=b.publication_version AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash; END IF;
 IF c IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT m.storage_key,m.mime_type,m.byte_length FROM parallel_life.publication_media_assets m
 WHERE m.id=a AND m.work_id=b.work_id AND m.status='ready' AND (
  EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c->'phone'->'messages','[]'::jsonb)) msg WHERE msg->'attachment'->>'assetId'=m.id::text AND msg->'attachment'->>'kind'=m.kind)
  OR (m.kind='image' AND EXISTS(SELECT 1 FROM parallel_life.publication_visible_moments(w) visible WHERE visible.work_id=b.work_id AND visible.moment->'images' ? ('/api/v1/worlds/'||w||'/media/'||a::text))));
END $$;

REVOKE ALL ON FUNCTION parallel_life.publication_moments_context(text),parallel_life.publication_moment_confirmed(text,jsonb),parallel_life.publication_visible_moments(text) FROM PUBLIC,pl_app,pl_publisher,pl_worker;
REVOKE ALL ON FUNCTION parallel_life.publication_social_opening(text),parallel_life.publication_media_for_world(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.publication_social_opening(text),parallel_life.publication_media_for_world(text,uuid) TO pl_app;
REVOKE ALL ON FUNCTION parallel_life.publication_actor_moment_confirmations(text,text) FROM PUBLIC,pl_publisher,pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.publication_actor_moment_confirmations(text,text) TO pl_app;
