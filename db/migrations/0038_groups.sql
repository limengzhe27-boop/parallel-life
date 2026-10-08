-- Group projections share the authoritative World events/versions and existing queue.
CREATE TABLE parallel_life.world_groups (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
 source_event_id text NOT NULL, source_version integer NOT NULL CHECK(source_version>0),
 UNIQUE(world_id,id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.world_group_memberships (
 world_id text NOT NULL, owner_id text NOT NULL, group_id text NOT NULL,
 member_key text NOT NULL, participant jsonb NOT NULL,
 joined_version integer NOT NULL CHECK(joined_version>0), left_version integer,
 source_event_id text NOT NULL, left_event_id text,
 PRIMARY KEY(group_id,member_key,joined_version),
 CHECK(left_version IS NULL OR left_version>joined_version),
 CHECK((left_version IS NULL)=(left_event_id IS NULL)),
 CHECK((participant->>'kind'='player' AND member_key='player' AND participant=jsonb_build_object('kind','player')) OR
 (participant->>'kind'='actor' AND member_key=participant->>'actorId' AND participant=jsonb_build_object('kind','actor','actorId',member_key))),
 FOREIGN KEY(world_id,group_id,owner_id) REFERENCES parallel_life.world_groups(world_id,id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,left_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX one_live_group_membership ON parallel_life.world_group_memberships(group_id,member_key) WHERE left_version IS NULL;
CREATE TABLE parallel_life.world_group_messages (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, group_id text NOT NULL,
 source_event_id text NOT NULL, source_version integer NOT NULL CHECK(source_version>0), document jsonb NOT NULL,
 UNIQUE(world_id,id,owner_id),
 FOREIGN KEY(world_id,group_id,owner_id) REFERENCES parallel_life.world_groups(world_id,id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id) ON DELETE CASCADE
);
CREATE INDEX group_message_history ON parallel_life.world_group_messages(group_id,source_version,id);
CREATE TABLE parallel_life.world_group_reads (
 world_id text NOT NULL, owner_id text NOT NULL, group_id text PRIMARY KEY,
 last_read_version integer NOT NULL CHECK(last_read_version>0), source_event_id text NOT NULL,
 FOREIGN KEY(world_id,group_id,owner_id) REFERENCES parallel_life.world_groups(world_id,id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id) ON DELETE CASCADE
);
CREATE FUNCTION parallel_life.group_read_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM parallel_life.world_group_messages m WHERE m.group_id=NEW.group_id AND m.world_id=NEW.world_id AND m.owner_id=NEW.owner_id AND m.source_event_id=NEW.source_event_id AND m.source_version=NEW.last_read_version) OR
 (TG_OP='UPDATE' AND (NEW.last_read_version<OLD.last_read_version OR NEW.world_id IS DISTINCT FROM OLD.world_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id)) THEN RAISE EXCEPTION 'INVALID_GROUP_READ_SOURCE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_read_guard BEFORE INSERT OR UPDATE ON parallel_life.world_group_reads FOR EACH ROW EXECUTE FUNCTION parallel_life.group_read_guard();

CREATE FUNCTION parallel_life.group_projection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
   (ev->>'type'='group.turn_resolved' AND sender_key IS DISTINCT FROM 'player' AND EXISTS(SELECT 1 FROM jsonb_array_elements(ev->'data'->'replies') r WHERE r->>'actorId'=sender_key AND r->>'text'=NEW.document->>'text' AND r->>'messageId'=NEW.id))) THEN RAISE EXCEPTION 'INVALID_GROUP_MESSAGE_AUTHOR' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'IMMUTABLE_GROUP_MESSAGE' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER group_creation_guard BEFORE INSERT ON parallel_life.world_groups FOR EACH ROW EXECUTE FUNCTION parallel_life.group_projection_guard();
CREATE TRIGGER group_membership_guard BEFORE INSERT OR UPDATE ON parallel_life.world_group_memberships FOR EACH ROW EXECUTE FUNCTION parallel_life.group_projection_guard();
CREATE TRIGGER group_message_guard BEFORE INSERT OR UPDATE ON parallel_life.world_group_messages FOR EACH ROW EXECUTE FUNCTION parallel_life.group_projection_guard();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['world_groups','world_group_memberships','world_group_messages'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_access ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
  EXECUTE format('CREATE POLICY group_leased_worker ON parallel_life.%I TO pl_worker USING(parallel_life.worker_owns(owner_id) AND EXISTS(SELECT 1 FROM parallel_life.tasks q WHERE q.id::text=current_setting(''app.task_id'',true) AND q.scope_kind=''world'' AND q.scope_id=world_id AND q.input->>''channel''=''group'')) WITH CHECK(parallel_life.worker_owns(owner_id) AND EXISTS(SELECT 1 FROM parallel_life.tasks q WHERE q.id::text=current_setting(''app.task_id'',true) AND q.scope_kind=''world'' AND q.scope_id=world_id AND q.input->>''channel''=''group''))',t);
 END LOOP;
END $$;
-- Owner RLS additionally filters messages at their historical player membership boundary.
DROP POLICY owner_access ON parallel_life.world_group_messages;
CREATE POLICY group_owner_read ON parallel_life.world_group_messages FOR SELECT TO pl_app USING(owner_id=current_setting('app.user_id',true) AND EXISTS(SELECT 1 FROM parallel_life.world_group_memberships m WHERE m.group_id=world_group_messages.group_id AND m.member_key='player' AND m.joined_version<=source_version AND (m.left_version IS NULL OR source_version<m.left_version)));
CREATE POLICY group_owner_write ON parallel_life.world_group_messages FOR INSERT TO pl_app WITH CHECK(owner_id=current_setting('app.user_id',true) AND document->'sender'->>'kind'='player');
GRANT SELECT,INSERT ON parallel_life.world_groups TO pl_app;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_group_memberships TO pl_app;
GRANT SELECT,INSERT ON parallel_life.world_group_messages TO pl_app;
GRANT SELECT ON parallel_life.world_groups,parallel_life.world_group_memberships TO pl_worker;
GRANT SELECT,INSERT ON parallel_life.world_group_messages TO pl_worker;
REVOKE ALL ON FUNCTION parallel_life.group_projection_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.group_projection_guard() TO pl_app,pl_worker;
ALTER TABLE parallel_life.world_group_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_group_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY group_read_owner ON parallel_life.world_group_reads TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_group_reads TO pl_app;
REVOKE ALL ON FUNCTION parallel_life.group_read_guard() FROM PUBLIC;
-- Invoker trigger only: worker still has no table privileges or read-marker policy.
GRANT EXECUTE ON FUNCTION parallel_life.group_read_guard() TO pl_app,pl_worker;
