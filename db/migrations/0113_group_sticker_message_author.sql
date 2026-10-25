-- Group sticker replies are two independent projections: the text message and a
-- second message whose text is the [[sticker:id]] marker. The original 0038 guard
-- only matched reply.text/messageId, so any NPC sticker message failed with
-- INVALID_GROUP_MESSAGE_AUTHOR. This replaces the function without adding tables,
-- columns or changing authorization; player messages keep the original branch.
CREATE OR REPLACE FUNCTION parallel_life.group_projection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ev jsonb; ev_version integer; gid text; sender_key text; actor_exists boolean;
BEGIN
 SELECT payload,version INTO ev,ev_version FROM parallel_life.world_events WHERE id=NEW.source_event_id AND world_id=NEW.world_id AND owner_id=NEW.owner_id;
 gid:=CASE WHEN TG_TABLE_NAME='world_groups' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'group_id' END;
 IF ev IS NULL OR ev->'data'->>'groupId' IS DISTINCT FROM gid THEN RAISE EXCEPTION 'INVALID_GROUP_SOURCE' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='world_groups' THEN
  IF ev_version IS DISTINCT FROM NEW.source_version OR ev->>'type' IS DISTINCT FROM 'group.created' OR ev->'data'->>'title' IS DISTINCT FROM NEW.title THEN RAISE EXCEPTION 'INVALID_GROUP_CREATION' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='world_group_memberships' THEN
  IF ev_version IS DISTINCT FROM NEW.joined_version THEN RAISE EXCEPTION 'INVALID_GROUP_JOIN_SOURCE' USING ERRCODE='23514'; END IF;
  IF NEW.participant->>'kind'='actor' THEN
   SELECT EXISTS(SELECT 1 FROM parallel_life.worlds w,jsonb_array_elements(w.state->'actors') a WHERE w.id=NEW.world_id AND w.owner_id=NEW.owner_id AND a->>'id'=NEW.member_key) INTO actor_exists;
   IF NOT actor_exists THEN RAISE EXCEPTION 'UNKNOWN_GROUP_ACTOR' USING ERRCODE='23514'; END IF;
  END IF;
  IF NOT ((ev->>'type'='group.created' AND (NEW.member_key='player' OR ev->'data'->'actorIds' ? NEW.member_key)) OR
   (ev->>'type'='group.membership_changed' AND ev->'data'->>'action'='join' AND ev->'data'->'participant'=NEW.participant)) THEN RAISE EXCEPTION 'INVALID_GROUP_JOIN' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM parallel_life.world_group_memberships m WHERE m.group_id=NEW.group_id AND m.member_key=NEW.member_key AND m.joined_version IS DISTINCT FROM NEW.joined_version AND m.joined_version<coalesce(NEW.left_version,2147483647) AND NEW.joined_version<coalesce(m.left_version,2147483647)) THEN RAISE EXCEPTION 'OVERLAPPING_GROUP_MEMBERSHIP' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (OLD.source_event_id IS DISTINCT FROM NEW.source_event_id OR OLD.joined_version IS DISTINCT FROM NEW.joined_version OR OLD.participant IS DISTINCT FROM NEW.participant OR OLD.group_id IS DISTINCT FROM NEW.group_id OR OLD.owner_id IS DISTINCT FROM NEW.owner_id OR OLD.world_id IS DISTINCT FROM NEW.world_id OR OLD.left_version IS NOT NULL) THEN RAISE EXCEPTION 'IMMUTABLE_GROUP_MEMBERSHIP' USING ERRCODE='23514'; END IF;
  IF NEW.left_version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM parallel_life.world_events e WHERE e.id=NEW.left_event_id AND e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.version=NEW.left_version AND e.payload->>'type'='group.membership_changed' AND e.payload->'data'->>'groupId'=NEW.group_id AND e.payload->'data'->>'action'='leave' AND e.payload->'data'->'participant'=NEW.participant) THEN RAISE EXCEPTION 'INVALID_GROUP_LEAVE' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.source_version IS DISTINCT FROM ev_version OR NEW.document->>'id' IS DISTINCT FROM NEW.id OR NEW.document->>'ownerId' IS DISTINCT FROM NEW.owner_id OR NEW.document->>'worldId' IS DISTINCT FROM NEW.world_id OR NEW.document->>'conversationId' IS DISTINCT FROM NEW.group_id OR NEW.document->>'sourceEventId' IS DISTINCT FROM NEW.source_event_id OR (NEW.document->>'sourceVersion')::integer IS DISTINCT FROM ev_version OR jsonb_array_length(NEW.document->'media') IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'INVALID_GROUP_MESSAGE_SOURCE' USING ERRCODE='23514'; END IF;
  sender_key:=CASE WHEN NEW.document->'sender'->>'kind'='player' THEN 'player' ELSE NEW.document->'sender'->>'actorId' END;
  IF NOT EXISTS(SELECT 1 FROM parallel_life.world_group_memberships m WHERE m.group_id=NEW.group_id AND m.member_key=sender_key AND m.joined_version<=ev_version AND (m.left_version IS NULL OR ev_version<m.left_version)) THEN RAISE EXCEPTION 'NOT_GROUP_MEMBER' USING ERRCODE='23514'; END IF;
  IF NOT ((ev->>'type'='group.message_sent' AND sender_key='player' AND ev->'data'->>'text'=NEW.document->>'text' AND ev->'data'->>'messageId'=NEW.id) OR
   (ev->>'type'='group.turn_resolved' AND sender_key IS DISTINCT FROM 'player' AND EXISTS(SELECT 1 FROM jsonb_array_elements(ev->'data'->'replies') r WHERE r->>'actorId'=sender_key AND ((r->>'text'=NEW.document->>'text' AND r->>'messageId'=NEW.id) OR (r ? 'stickerId' AND NEW.document->>'text'='[[sticker:' || (r->>'stickerId') || ']]' AND coalesce(r->>'stickerMessageId',r->>'messageId')=NEW.id))))) THEN RAISE EXCEPTION 'INVALID_GROUP_MESSAGE_AUTHOR' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'IMMUTABLE_GROUP_MESSAGE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
