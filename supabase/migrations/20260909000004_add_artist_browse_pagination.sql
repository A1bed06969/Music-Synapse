-- アーティスト一覧(/artists)のサーバー側ページネーション用。
-- 20260909_add_artist_browse_kind.sql の続き。

-- PostgRESTは式(COALESCE(name_kana, name))でのORDER BYを直接指定できないため、
-- 並び替えキーを生成列として持たせる。既存の式インデックスもこの列に張り替える。
ALTER TABLE artist ADD COLUMN sort_key TEXT
  GENERATED ALWAYS AS (COALESCE(name_kana, name)) STORED;

DROP INDEX IF EXISTS idx_artist_browse_kind_sort;
CREATE INDEX idx_artist_browse_kind_sort ON artist (browse_kind, sort_key);

-- クレジット人物タブ。全件(credit_person 19,365件 × artist_credit 123,177行)を
-- 集計してから絞り込むと実測5秒かかるため、EXISTSで先に該当者だけに絞り、
-- そのページ分(既定60件)についてのみ役割・楽器を集計する。
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
  WITH filtered AS (
    SELECT cp.id, cp.name, count(*) OVER() AS total_count
    FROM credit_person cp
    WHERE (p_query IS NULL OR p_query = '' OR cp.name ILIKE '%' || p_query || '%')
      AND (
        p_role IS NULL OR p_role = '' OR p_role = 'all'
        OR EXISTS (SELECT 1 FROM artist_credit ac WHERE ac.credit_person_id = cp.id AND ac.role = p_role)
      )
      AND (
        p_instrument IS NULL OR p_instrument = '' OR p_instrument = 'all'
        OR EXISTS (
          SELECT 1 FROM artist_credit ac
          JOIN instrument i ON i.id = ac.instrument_id
          WHERE ac.credit_person_id = cp.id AND ac.role = 'musician' AND i.name = p_instrument
        )
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

-- 楽器の絞り込みプルダウン用。使用件数の多い順。
-- 内容がほぼ変わらないためアプリ側(unstable_cache)でキャッシュして使う。
CREATE OR REPLACE FUNCTION credit_instrument_options()
RETURNS TABLE (name TEXT, usage_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT i.name, count(*) AS usage_count
  FROM artist_credit ac
  JOIN instrument i ON i.id = ac.instrument_id
  WHERE ac.role = 'musician'
  GROUP BY i.name
  ORDER BY count(*) DESC, i.name;
$$;
