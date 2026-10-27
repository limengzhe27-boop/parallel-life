-- Retire the 20 hand-drawn text/smiley stickers. Existing projections and
-- initial snapshots become readable text; immutable world_events keep their
-- original payload and remain parseable through the legacy sticker id set.
CREATE OR REPLACE FUNCTION parallel_life.retire_text_sticker(document jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN document ? 'stickerId' AND document->>'stickerId' = ANY (ARRAY[
      'wole','xswl','wuyu','zhende','jiuzhe','bailan','chong','zaima','shuile','e',
      'kun','moyu','jiayou','keyi','juele','hao','zan','a','bie','wanan'
    ]) THEN
      (document - 'stickerId') || jsonb_build_object(
        'text',
        CASE
          WHEN coalesce(document->>'text', '') <> '' THEN document->>'text'
          WHEN document->>'stickerId' = 'wole' THEN '我裂开了'
          WHEN document->>'stickerId' = 'xswl' THEN '笑死我了'
          WHEN document->>'stickerId' = 'wuyu' THEN '无语'
          WHEN document->>'stickerId' = 'zhende' THEN '真的假的'
          WHEN document->>'stickerId' = 'jiuzhe' THEN '就这？'
          WHEN document->>'stickerId' = 'bailan' THEN '摆烂'
          WHEN document->>'stickerId' = 'chong' THEN '冲！'
          WHEN document->>'stickerId' = 'zaima' THEN '在吗'
          WHEN document->>'stickerId' = 'shuile' THEN '睡了'
          WHEN document->>'stickerId' = 'e' THEN '饿了'
          WHEN document->>'stickerId' = 'kun' THEN '困'
          WHEN document->>'stickerId' = 'moyu' THEN '摸鱼中'
          WHEN document->>'stickerId' = 'jiayou' THEN '加油'
          WHEN document->>'stickerId' = 'keyi' THEN '可以'
          WHEN document->>'stickerId' = 'juele' THEN '绝了'
          WHEN document->>'stickerId' = 'hao' THEN '好'
          WHEN document->>'stickerId' = 'zan' THEN '赞'
          WHEN document->>'stickerId' = 'a' THEN '啊？'
          WHEN document->>'stickerId' = 'bie' THEN '别'
          WHEN document->>'stickerId' = 'wanan' THEN '晚安'
          ELSE ''
        END
      )
    ELSE document
  END
$$;

UPDATE parallel_life.world_messages
SET document = parallel_life.retire_text_sticker(document)
WHERE document ? 'stickerId';

UPDATE parallel_life.world_group_messages
SET document = parallel_life.retire_text_sticker(document)
WHERE document ? 'stickerId';

UPDATE parallel_life.worlds
SET state = jsonb_set(
  state,
  '{messages}',
  (
    SELECT coalesce(jsonb_agg(parallel_life.retire_text_sticker(value) ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(state->'messages') WITH ORDINALITY AS x(value, ord)
  )
)
WHERE jsonb_typeof(state->'messages') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(state->'messages') value
    WHERE value ? 'stickerId'
  );

UPDATE parallel_life.world_initial_snapshots
SET state = jsonb_set(
  state,
  '{messages}',
  (
    SELECT coalesce(jsonb_agg(parallel_life.retire_text_sticker(value) ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(state->'messages') WITH ORDINALITY AS x(value, ord)
  )
)
WHERE jsonb_typeof(state->'messages') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(state->'messages') value
    WHERE value ? 'stickerId'
  );
