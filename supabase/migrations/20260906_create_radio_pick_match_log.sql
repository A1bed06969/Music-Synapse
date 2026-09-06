-- パワープレイ選曲(radio_airplay_pick)のGemini自動マッチング判定ログ。
-- artist_match_log/album_match_logと同じ形。actionで「未マッチへの候補設定」と
-- 「既存候補の再検証(→本登録 or 候補クリア)」の2種類の判定を区別する。
CREATE TABLE radio_pick_match_log (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('RPL'::text),
  pick_id TEXT NOT NULL REFERENCES radio_airplay_pick(id),
  action TEXT NOT NULL CHECK (action IN ('set_candidate', 'verify_register')),
  stub_artist_name TEXT NOT NULL,
  stub_track_title TEXT NOT NULL,
  station_name TEXT NOT NULL,
  campaign_name TEXT,
  chosen_track_id BIGINT,
  chosen_collection_id BIGINT,
  chosen_label TEXT,
  chosen_artist_name TEXT,
  confidence NUMERIC NOT NULL,
  reasoning TEXT NOT NULL,
  candidates_json JSONB,
  auto_applied BOOLEAN NOT NULL DEFAULT false,
  reverted BOOLEAN NOT NULL DEFAULT false,
  reverted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_radio_pick_match_log_pick ON radio_pick_match_log (pick_id);
CREATE INDEX idx_radio_pick_match_log_action ON radio_pick_match_log (action, auto_applied, reverted);

ALTER TABLE radio_pick_match_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON radio_pick_match_log
  FOR SELECT USING (true);
