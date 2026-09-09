-- /tracks の検索が「何なん」のような短い語でstatement timeoutになる問題の修正。
--
-- 旧実装は artist 17,349行それぞれに対して
-- EXISTS (SELECT 1 FROM track WHERE artist_id = a.id AND title ILIKE ...) を評価しており、
-- ヒット候補が多い語では track 812,813行への走査が何度も走ってタイムアウトしていた。
-- 曲名検索を先に1回だけ実行(track.titleのトライグラムインデックスが効く)して
-- 該当アーティストIDを集めてから artist 側を絞る。

CREATE OR REPLACE FUNCTION browse_track_artists(
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
      AND t.title ILIKE '%' || p_query || '%'
  )
  SELECT
    a.id, a.name, a.image_url,
    (p_query IS NOT NULL AND p_query <> '' AND a.name ILIKE '%' || p_query || '%') AS matched_by_name,
    count(*) OVER() AS total_count
  FROM artist a
  WHERE a.has_own_release
    AND EXISTS (SELECT 1 FROM track t WHERE t.artist_id = a.id)
    AND (
      p_query IS NULL OR p_query = ''
      OR a.name ILIKE '%' || p_query || '%'
      OR a.id IN (SELECT artist_id FROM title_matched)
    )
  ORDER BY a.sort_key
  LIMIT p_limit OFFSET p_offset;
$$;

-- 表示するアーティスト(既定20組)の曲だけを、1組あたり上限付きで取得する。
-- 上限を設けるのは、コンピレーション等で数千曲ぶら下がるアーティストがいると
-- PostgRESTの1000行上限に達し、後続アーティストの曲が丸ごと欠落するため
-- (実際に1組で1000曲を占有し、20組中7組しか表示されない状態が発生した)。
-- 並び順はランキング掲載・オンエア実績あり→トラック番号→曲名で、
-- app/tracks/page.tsx の従来ロジックと同じ。
CREATE OR REPLACE FUNCTION browse_artist_tracks(
  p_artist_ids TEXT[],
  p_query TEXT DEFAULT NULL,
  p_only_matching BOOLEAN DEFAULT false,
  p_per_artist INT DEFAULT 30
)
RETURNS TABLE (
  artist_id TEXT,
  id TEXT,
  title TEXT,
  duration_seconds INT,
  ranked BOOLEAN,
  on_air BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  SELECT x.artist_id, x.id, x.title, x.duration_seconds, x.ranked, x.on_air
  FROM unnest(p_artist_ids) AS a(artist_id)
  CROSS JOIN LATERAL (
    SELECT
      t.artist_id,
      t.id,
      t.title,
      t.duration_seconds,
      EXISTS (SELECT 1 FROM ranking_entry re WHERE re.track_id = t.id) AS ranked,
      EXISTS (SELECT 1 FROM radio_rotation rr WHERE rr.track_id = t.id) AS on_air
    FROM track t
    WHERE t.artist_id = a.artist_id
      AND (
        NOT p_only_matching
        OR p_query IS NULL OR p_query = ''
        OR t.title ILIKE '%' || p_query || '%'
      )
    ORDER BY
      (EXISTS (SELECT 1 FROM ranking_entry re WHERE re.track_id = t.id)
        OR EXISTS (SELECT 1 FROM radio_rotation rr WHERE rr.track_id = t.id)) DESC,
      COALESCE(t.track_no, 2147483647),
      t.title
    LIMIT p_per_artist
  ) AS x;
$$;
