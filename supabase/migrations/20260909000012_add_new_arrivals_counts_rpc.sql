-- ホームページと/new-arrivalsページの新着件数集計を高速化する。
--
-- 従来は5テーブル(artist/album/track/event_appearance_artist/ranking_entry)へ
-- created_atで絞ったcount(*)を並列発行していた。ホームページはこれに加えて
-- fetchUpcomingAlbums・fetchUpcomingFestivals(3並列)・fetchMonthlyPowerPlayTop・
-- news_itemの読み取りも同時に発火しており、1リクエストで10件以上のSupabase
-- 呼び出しが同時に飛ぶことになっていた。個々のクエリ自体は速くても、
-- これだけ同時に飛ばすと詰まり、実測でトップページの完了まで3〜4秒かかっていた。
--
-- どの5テーブルにもcreated_atのインデックスが無かったため
-- (1本にまとめて初めて発覚。track 812,813行のフルスキャンでタイムアウトした)、
-- まずインデックスを追加し、その上で5並列を1本のRPCにまとめる。

CREATE INDEX IF NOT EXISTS idx_artist_created_at ON artist (created_at);
CREATE INDEX IF NOT EXISTS idx_album_created_at ON album (created_at);
CREATE INDEX IF NOT EXISTS idx_track_created_at ON track (created_at);
CREATE INDEX IF NOT EXISTS idx_event_appearance_artist_created_at ON event_appearance_artist (created_at);
CREATE INDEX IF NOT EXISTS idx_ranking_entry_created_at ON ranking_entry (created_at);

CREATE OR REPLACE FUNCTION new_arrivals_counts(p_boundary TIMESTAMPTZ)
RETURNS TABLE (
  artist_count BIGINT,
  album_count BIGINT,
  track_count BIGINT,
  event_count BIGINT,
  curation_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (SELECT count(*) FROM artist WHERE created_at >= p_boundary),
    (SELECT count(*) FROM album WHERE created_at >= p_boundary),
    (SELECT count(*) FROM track WHERE created_at >= p_boundary),
    (SELECT count(*) FROM event_appearance_artist WHERE created_at >= p_boundary),
    (SELECT count(*) FROM ranking_entry WHERE created_at >= p_boundary);
$$;
