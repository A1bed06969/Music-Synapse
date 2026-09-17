-- アルバム一覧(/albums)・トラック一覧(/tracks)のサーバー側ページネーション用。
--
-- どちらも全件をサーバーで読んでブラウザへ渡す作りだったため、実測で
-- /albums は完了まで36秒・HTML 107.9MB、/tracks は232秒(track 81万件を
-- 1000件ずつ813回逐次取得していた)かかっていた。

-- 並び替えキー(かな優先)。PostgRESTは式でのORDER BYを直接指定できないため生成列にする。
ALTER TABLE album ADD COLUMN sort_key TEXT
  GENERATED ALWAYS AS (COALESCE(title_kana, title)) STORED;

CREATE INDEX IF NOT EXISTS idx_album_sort_key ON album (sort_key);
CREATE INDEX IF NOT EXISTS idx_album_release_date ON album (release_date DESC NULLS LAST);

-- アルバム一覧。絞り込み(タイトル/かな/アーティスト名)と配信状況、
-- 並び替え(かな順/リリース日順)をDB側で行う。
-- streaming_statusの'none'/'unreleased'を「未解禁」とする扱いは
-- app/albums/AlbumBrowseClient.tsx の従来ロジックと同じ。
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
      OR al.title ILIKE '%' || p_query || '%'
      OR al.title_kana ILIKE '%' || p_query || '%'
      OR ar.name ILIKE '%' || p_query || '%'
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

-- トラック一覧はアーティスト単位のグループ表示なので、アーティストでページングする。
-- 絞り込み語はアーティスト名またはそのアーティストの曲名にヒットすれば対象
-- (従来のブラウザ側フィルタと同じ)。名前でヒットしたかどうかを返すのは、
-- 曲名ヒットの場合だけ曲を絞り込むという従来の挙動を呼び出し側で再現するため。
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
  SELECT
    a.id, a.name, a.image_url,
    (p_query IS NOT NULL AND p_query <> '' AND a.name ILIKE '%' || p_query || '%') AS matched_by_name,
    count(*) OVER() AS total_count
  FROM artist a
  WHERE EXISTS (SELECT 1 FROM track t WHERE t.artist_id = a.id)
    AND (
      p_query IS NULL OR p_query = ''
      OR a.name ILIKE '%' || p_query || '%'
      OR EXISTS (SELECT 1 FROM track t WHERE t.artist_id = a.id AND t.title ILIKE '%' || p_query || '%')
    )
  ORDER BY a.sort_key
  LIMIT p_limit OFFSET p_offset;
$$;
