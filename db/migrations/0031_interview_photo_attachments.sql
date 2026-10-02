ALTER TABLE parallel_life.interview_messages
  ADD COLUMN photo_asset_id uuid,
  ADD CONSTRAINT interview_photo_user_only CHECK (photo_asset_id IS NULL OR role='user'),
  ADD CONSTRAINT interview_photo_owner_fk
    FOREIGN KEY (photo_asset_id,owner_id) REFERENCES parallel_life.assets(id,owner_id);

-- Preserve the original text while mapping valid historic app photo messages
-- to an explicit asset reference. New messages never infer a photo from text.
UPDATE parallel_life.interview_messages AS message
SET photo_asset_id=asset.id
FROM parallel_life.assets AS asset
WHERE message.owner_id=asset.owner_id
  AND message.role='user'
  AND asset.origin='upload'
  AND asset.world_id IS NULL
  AND asset.status='ready'
  AND (
    lower(message.text)='[照片:/api/v1/assets/'||asset.id::text||']'
    OR starts_with(lower(message.text),'[照片:/api/v1/assets/'||asset.id::text||']'||E'\n')
    OR starts_with(lower(message.text),'[照片:/api/v1/assets/'||asset.id::text||']'||E'\r\n')
  );

CREATE INDEX interview_photo_by_asset ON parallel_life.interview_messages(owner_id,photo_asset_id)
  WHERE photo_asset_id IS NOT NULL;

CREATE FUNCTION parallel_life.validate_interview_photo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.photo_asset_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.role <> 'user' THEN
    RAISE EXCEPTION 'interview photo must belong to a user message' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM parallel_life.assets
    WHERE id=NEW.photo_asset_id AND owner_id=NEW.owner_id
      AND status='ready' AND origin='upload' AND world_id IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'interview photo is unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM parallel_life.profiles
    WHERE owner_id=NEW.owner_id
      AND COALESCE(document->'referenceAssetIds','[]'::jsonb) ? NEW.photo_asset_id::text
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'interview photo is not in the real profile' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER interview_photo_validate
  BEFORE INSERT OR UPDATE OF photo_asset_id,owner_id,role ON parallel_life.interview_messages
  FOR EACH ROW EXECUTE FUNCTION parallel_life.validate_interview_photo();
