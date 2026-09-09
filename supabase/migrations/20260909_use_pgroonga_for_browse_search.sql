-- 一覧ページの検索をPGroongaの一致演算子(&@)に切り替える。
--
-- ILIKE '%語%' のままでは「愛」「未来」のような1〜2文字の日本語検索が
-- pg_trgmの適用外(3文字未満)となり、track 812,813行の全走査で
-- statement timeoutになっていた。20260909_add_browse_search_indexes.sql で
-- 張ったPGroongaインデックス(2-gram)を使う形に置き換える。
--
-- 注意: このファイルの適用は Supabase の SQL Editor から手動で行った。
-- 作業時にMCP接続が読み取り専用に切り替わり、ツール経由でDDLを流せなかったため。

DROP FUNCTION IF EXISTS browse_track_artists(text, integer, integer);

CREATE FUNCTION browse_track_artists(
  p_query TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  image_url TEXT,
  matched_by_name BOOLEAN,
  total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH title_matched AS (
    SELECT DISTINCT t.artist_id
    FROM track t
    WHERE p_query IS NOT NULL AND p_query <> ''
      AND t.artist_id IS NOT NULL
      AND t.title &@ p_query
  )
  SELECT
    a.id, a.name, a.image_url,
    (p_query IS NOT NULL AND p_query <> '' AND a.name &@ p_query) AS matched_by_name,
    count(*) OVER() AS total_count
  FROM artist a
  WHERE a.has_tracks
    AND (
      p_query IS NULL OR p_query = ''
      OR a.name &@ p_query
      OR a.id IN (SELECT artist_id FROM title_matched)
    )
  ORDER BY a.sort_key
  LIMIT p_limit OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION browse_albums(
  p_query TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'kana',
  p_limit INT DEFAULT 60,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  title_kana TEXT,
  jacket_url TEXT,
  release_date DATE,
  streaming_status TEXT,
  artist_name TEXT,
  total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    al.id, al.title, al.title_kana, al.jacket_url, al.release_date, al.streaming_status,
    ar.name AS artist_name,
    count(*) OVER() AS total_count
  FROM album al
  LEFT JOIN artist ar ON ar.id = al.artist_id
  WHERE al.primary_album_id IS NULL
    AND (
      p_query IS NULL OR p_query = ''
      OR al.title &@ p_query
      OR al.title_kana &@ p_query
      OR ar.name &@ p_query
    )
    AND (
      p_status IS NULL OR p_status = 'all'
      OR (p_status = 'unreleased' AND COALESCE(al.streaming_status, '') IN ('none', 'unreleased'))
      OR (p_status = 'streaming' AND COALESCE(al.streaming_status, '') NOT IN ('none', 'unreleased'))
    )
  ORDER BY
    CASE WHEN p_sort = 'release' THEN 1 ELSE 0 END,
    CASE WHEN p_sort = 'release' THEN NULL ELSE al.sort_key END ASC,
    CASE WHEN p_sort = 'release' THEN al.release_date END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
$$;
