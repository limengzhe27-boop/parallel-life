-- Media has its own lifecycle; importing a photo must not change narrative version.
ALTER TABLE parallel_life.assets ADD CONSTRAINT asset_world_owner_unique UNIQUE(id,world_id,owner_id);
CREATE TABLE parallel_life.world_album (
 asset_id uuid PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL,
 command_id uuid NOT NULL, request_hash text NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 80),
 story_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(world_id,command_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,world_id,owner_id) REFERENCES parallel_life.assets(id,world_id,owner_id) ON DELETE CASCADE
);
CREATE INDEX world_album_by_world ON parallel_life.world_album(world_id,created_at DESC);
ALTER TABLE parallel_life.world_album ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_album FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_album TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,DELETE ON parallel_life.world_album TO pl_app;
REVOKE ALL ON parallel_life.world_album FROM PUBLIC;
