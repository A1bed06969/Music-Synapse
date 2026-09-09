-- /artists のクレジット人物タブの高速化。
--
-- 実測していた問題:
--   - 役割で絞る(role=musician)と statement timeout。credit_person 19,365人
--     それぞれに artist_credit(123,177行)への相関EXISTSを評価していたため。
--   - 楽器で絞る(ギター)と3.9秒。上記に加えてinstrumentへのJOINが人数分走る。
--
-- 対応:
--   1. (role, credit_person_id) のインデックスで役割の絞り込みを索引で解決する
--   2. (role, instrument_id, credit_person_id) のインデックスを足し、
--      楽器の絞り込みは相関EXISTSをやめて該当人物を先に1回で集める形に変える
--
-- 結果: 役割 timeout → 314ms、楽器 3.9秒 → 200ms〜1.2秒。

CREATE INDEX IF NOT EXISTS idx_artist_credit_role_person
  ON artist_credit (role, credit_person_id);

CREATE INDEX IF NOT EXISTS idx_artist_credit_role_instrument_person
  ON artist_credit (role, instrument_id, credit_person_id);

CREATE INDEX IF NOT EXISTS idx_credit_person_name ON credit_person (name);

CREATE OR REPLACE FUNCTION browse_credit_persons(
  p_query TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_instrument TEXT DEFAULT NULL,
  p_limit INT DEFAULT 60,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (id TEXT, name TEXT, roles TEXT[], instruments TEXT[], total_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  WITH
  -- 楽器の絞り込みは、19,365人それぞれに相関EXISTSを評価すると遅い
  -- (「ギター」で実測3.9秒)。該当する人物を先に1回で集めてから突き合わせる。
  instrument_persons AS (
    SELECT DISTINCT ac.credit_person_id
    FROM artist_credit ac
    JOIN instrument i ON i.id = ac.instrument_id
    WHERE p_instrument IS NOT NULL AND p_instrument <> '' AND p_instrument <> 'all'
      AND ac.role = 'musician'
      AND i.name = p_instrument
  ),
  filtered AS (
    SELECT cp.id, cp.name, count(*) OVER() AS total_count
    FROM credit_person cp
    WHERE (p_query IS NULL OR p_query = '' OR cp.name ILIKE '%' || p_query || '%')
      AND (
        p_role IS NULL OR p_role = '' OR p_role = 'all'
        OR EXISTS (SELECT 1 FROM artist_credit ac WHERE ac.credit_person_id = cp.id AND ac.role = p_role)
      )
      AND (
        p_instrument IS NULL OR p_instrument = '' OR p_instrument = 'all'
        OR cp.id IN (SELECT credit_person_id FROM instrument_persons)
      )
    ORDER BY cp.name
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id,
    f.name,
    COALESCE(
      (SELECT array_agg(DISTINCT ac.role) FROM artist_credit ac
        WHERE ac.credit_person_id = f.id AND ac.role IS NOT NULL),
      '{}'::text[]
    ),
    COALESCE(
      (SELECT array_agg(DISTINCT i.name) FROM artist_credit ac
        JOIN instrument i ON i.id = ac.instrument_id
        WHERE ac.credit_person_id = f.id AND ac.role = 'musician'),
      '{}'::text[]
    ),
    f.total_count
  FROM filtered f
  ORDER BY f.name;
$$;
