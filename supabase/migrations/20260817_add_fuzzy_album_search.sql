-- pg_trgm: トライグラム類似度によるファジー検索。ディスクガイドOCR抽出結果は
-- 1文字の誤読・空白の有無などでilikeの部分一致が0件になりやすいため、
-- 完全一致に頼らないマッチングに切り替える。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_album_title_trgm ON album USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artist_name_trgm ON artist USING gin (name gin_trgm_ops);

-- タイトル・アーティスト名それぞれの類似度(0-1)を計算し、両方の合計でランキングする。
-- どちらか一方が閾値を超えていれば候補に含める(OCRはタイトル・アーティスト名の
-- どちらか一方だけ大きく崩れることがあるため、両方に閾値を課すと取りこぼす)。
CREATE OR REPLACE FUNCTION search_albums_fuzzy(
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
  artist_similarity float
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
    similarity(ar.name, search_artist) AS artist_similarity
  FROM album a
  JOIN artist ar ON ar.id = a.artist_id
  WHERE similarity(a.title, search_title) > similarity_threshold
     OR similarity(ar.name, search_artist) > similarity_threshold
  ORDER BY (similarity(a.title, search_title) + similarity(ar.name, search_artist)) DESC
  LIMIT result_limit;
$$;
