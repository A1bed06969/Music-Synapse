-- /search と TOPページの検索ボックス用。アーティスト・アルバム・曲を1往復で引く。
--
-- これまで検索はアーティストとアルバムだけで、曲名検索は存在しなかった
-- (/tracks の絞り込みが唯一の手段だった)。track 812,813行への部分一致は
-- ILIKEでは間に合わないため、20260909_add_browse_search_indexes.sql で張った
-- PGroongaの2-gramインデックスを使う。
--
-- ヒット数が多い語(「愛」2,512曲、「LOVE」26,887曲)では、全ヒットを取り出して
-- からORDER BYすると3秒の制限に触れるため、候補を200件で打ち切ってから
-- 並べ替える。並び順は完全一致→前方一致→名前順。
--
-- メンバー種別のアーティスト(自身名義のリリースが無い人)は browse_kind で
-- DB側から除外する(従来は取得後にJSでgetMemberArtistIdsAmongを使って
-- 絞り込んでおり、往復が1回余分だった)。

CREATE OR REPLACE FUNCTION search_catalog(p_query TEXT, p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH
  artist_candidates AS (
    SELECT a.id, a.name, a.name_kana, a.name_en, a.sort_key
    FROM artist a
    WHERE p_query IS NOT NULL AND p_query <> ''
      AND a.browse_kind = 'artist'
      AND a.name &@ p_query
    LIMIT 200
  ),
  album_candidates AS (
    SELECT al.id, al.title, al.title_kana, al.jacket_url, al.artist_id, al.sort_key
    FROM album al
    WHERE p_query IS NOT NULL AND p_query <> ''
      AND al.primary_album_id IS NULL
      AND al.title &@ p_query
    LIMIT 200
  ),
  track_candidates AS (
    SELECT t.id, t.title, t.artist_id, t.album_id
    FROM track t
    WHERE p_query IS NOT NULL AND p_query <> ''
      AND t.title &@ p_query
    LIMIT 200
  )
  SELECT jsonb_build_object(
    'artists', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT c.id, c.name, c.name_kana, c.name_en
        FROM artist_candidates c
        ORDER BY (c.name = p_query) DESC, (c.name ILIKE p_query || '%') DESC, c.sort_key
        LIMIT p_limit
      ) x), '[]'::jsonb),
    'albums', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT c.id, c.title, c.title_kana, c.jacket_url,
               CASE WHEN ar.id IS NULL THEN NULL
                    ELSE jsonb_build_object('id', ar.id, 'name', ar.name) END AS artist
        FROM album_candidates c
        LEFT JOIN artist ar ON ar.id = c.artist_id
        ORDER BY (c.title = p_query) DESC, (c.title ILIKE p_query || '%') DESC, c.sort_key
        LIMIT p_limit
      ) x), '[]'::jsonb),
    'tracks', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT c.id, c.title,
               CASE WHEN ar.id IS NULL THEN NULL
                    ELSE jsonb_build_object('id', ar.id, 'name', ar.name) END AS artist,
               CASE WHEN al.id IS NULL THEN NULL
                    ELSE jsonb_build_object('id', al.id, 'title', al.title) END AS album
        FROM track_candidates c
        LEFT JOIN artist ar ON ar.id = c.artist_id
        LEFT JOIN album al ON al.id = c.album_id
        ORDER BY (c.title = p_query) DESC, (c.title ILIKE p_query || '%') DESC, c.title
        LIMIT p_limit
      ) x), '[]'::jsonb)
  );
$$;
