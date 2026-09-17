-- /artistsページで「本人名義のリリースがあるか」を判定するために、
-- album/trackの全行(track だけで131,000件超)を1000件ずつ逐次ページングして
-- artist_idを集めていた(132回の逐次往復が発生し、ページ生成に50秒以上かかる
-- 原因になっていた)。Postgres側でDISTINCTした結果だけを1回で返す関数に置き換える。
CREATE OR REPLACE FUNCTION distinct_album_artist_ids()
RETURNS TABLE(artist_id TEXT) AS $$
  SELECT DISTINCT artist_id FROM album WHERE artist_id IS NOT NULL;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION distinct_track_artist_ids()
RETURNS TABLE(artist_id TEXT) AS $$
  SELECT DISTINCT artist_id FROM track WHERE artist_id IS NOT NULL;
$$ LANGUAGE sql STABLE;
