-- /admin/data/artists/review の「かな・英語表記未確定」タブ用。
-- name列に非ASCII文字(漢字・かな等)を含み、まだ確認スキップされておらず、
-- name_kana/name_enのどちらかが未入力のアーティストをページング付きで返す。
-- PostgRESTからは正規表現フィルタを直接掛けにくい(かつ1000件上限もあるため
-- 必ずページングが要る)ので、件数と一緒に1回のRPCで返せるようにする。
CREATE OR REPLACE FUNCTION artists_needing_name_review(p_limit INT, p_offset INT)
RETURNS TABLE(id TEXT, name TEXT, name_kana TEXT, name_en TEXT, total_count BIGINT) AS $$
  SELECT id, name, name_kana, name_en, count(*) OVER() AS total_count
  FROM artist
  WHERE name ~ '[^\x00-\x7F]'
    AND name_reading_skipped_at IS NULL
    AND (name_kana IS NULL OR name_en IS NULL)
  ORDER BY name
  LIMIT p_limit OFFSET p_offset;
$$ LANGUAGE sql STABLE;
