-- supabase/migrations/20260911_create_youtube_mv_backfill_log.sql
--
-- トラックのMV(youtube_video_id)をYouTubeから自動特定するバックフィルパイプラインの
-- 実行ログ。radio_pick_match_log/bio_generation_logと同じ監査ログの形だが、こちらは
-- 「アーティスト単位で1回試行したら結果を問わず記録する」(radio_pick_match_log式)。
-- YouTube検索(search.list)はアーティスト1件あたり100ユニット消費する高コストな
-- 操作のため、チャンネルが見つからなかった/曖昧だった場合も記録し、次回実行時に
-- 同じアーティストへ検索を再投下しない(bio_generation_logのような「空欄なら次回も
-- 自然に再挑戦」という設計は、ここでは無料枠を毎回浪費させてしまうため採用しない)。
CREATE TABLE youtube_mv_backfill_log (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('YML'::text),
  artist_id TEXT NOT NULL REFERENCES artist(id),
  artist_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'no_channel', 'channel_ambiguous', 'error')),
  resolved_channel_id TEXT,
  resolved_channel_title TEXT,
  channel_confidence NUMERIC,
  channel_reasoning TEXT,
  tracks_total INTEGER NOT NULL,
  tracks_matched INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_youtube_mv_backfill_log_artist ON youtube_mv_backfill_log (artist_id);
CREATE INDEX idx_youtube_mv_backfill_log_status ON youtube_mv_backfill_log (status);

ALTER TABLE youtube_mv_backfill_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON youtube_mv_backfill_log
  FOR SELECT USING (true);
