-- 各局のラジオ/TV番組PP(パワープレイ)・推薦曲の履歴データ。
-- ユーザーが個人で蓄積してきたスプレッドシート(HRPPシート)からの一括インポート用。
-- artist/track本体との自動紐付けは行わず、Apple Musicの候補IDのみ保持する
-- (件数が多く誤マッチのリスクがあるため、紐付けは将来人力確認前提の候補として扱う)
CREATE TABLE radio_airplay_pick (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('RAP'::text),
  region TEXT NOT NULL,
  station_name TEXT NOT NULL,
  campaign_name TEXT,
  picked_date DATE NOT NULL,
  artist_name TEXT,
  track_title TEXT,
  is_domestic BOOLEAN,
  candidate_track_id BIGINT,
  candidate_track_name TEXT,
  candidate_artist_name TEXT,
  candidate_collection_id BIGINT,
  candidate_collection_name TEXT,
  candidate_artwork_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_radio_airplay_pick_station ON radio_airplay_pick (station_name);
CREATE INDEX idx_radio_airplay_pick_picked_date ON radio_airplay_pick (picked_date);

ALTER TABLE radio_airplay_pick ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON radio_airplay_pick
  FOR SELECT USING (true);
