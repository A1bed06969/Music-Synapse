-- ディスクガイド確認画面でマッチ候補にジャケット画像を表示できるよう、
-- search_albums_fuzzyの戻り値にjacket_urlを追加する。戻り値の型(カラム構成)が
-- 変わるためCREATE OR REPLACEでは不可(PostgreSQLの制約)、先にDROPする。
DROP FUNCTION IF EXISTS search_albums_fuzzy(text, text, double precision, integer);

CREATE FUNCTION search_albums_fuzzy(
  search_title text,
  search_artist text,
  similarity_threshold float DEFAULT 0.25,
  result_limit int DEFAULT 5
)
RETURNS TABLE (
  id text,
  title text,
  artist_id text,
  artist_name text,
  title_similarity float,
  artist_similarity float,
  jacket_url text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.id,
    a.title,
    ar.id AS artist_id,
    ar.name AS artist_name,
    similarity(a.title, search_title) AS title_similarity,
    similarity(ar.name, search_artist) AS artist_similarity,
    a.jacket_url
  FROM album a
  JOIN artist ar ON ar.id = a.artist_id
  WHERE similarity(a.title, search_title) > similarity_threshold
     OR similarity(ar.name, search_artist) > similarity_threshold
  ORDER BY (similarity(a.title, search_title) + similarity(ar.name, search_artist)) DESC
  LIMIT result_limit;
$$;
