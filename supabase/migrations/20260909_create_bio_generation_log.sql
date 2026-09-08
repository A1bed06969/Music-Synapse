-- supabase/migrations/20260909_create_bio_generation_log.sql
--
-- アーティスト紹介文(bio)のGemini自動生成ログ。生成のたびに旧文/新文を記録し、
-- 管理画面から取り消せるようにする(radio_pick_match_log等と同じ監査ログの形)。
-- スキップ(ソース無し/Geminiが情報不足と判断)・エラーはここに記録しない。
-- 空欄bio+biography_statusの状態だけで次回実行時に自然に再挑戦できるため、
-- 恒久的な記録が必要なのはappliedとその取消(reverted)だけで十分。
CREATE TABLE bio_generation_log (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('BGL'::text),
  artist_id TEXT NOT NULL REFERENCES artist(id),
  artist_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('article_context', 'wikidata')),
  source_excerpt TEXT NOT NULL,
  previous_bio TEXT,
  generated_bio TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'reverted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at TIMESTAMPTZ
);

CREATE INDEX idx_bio_generation_log_artist ON bio_generation_log (artist_id);
CREATE INDEX idx_bio_generation_log_status ON bio_generation_log (status);

ALTER TABLE bio_generation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON bio_generation_log
  FOR SELECT USING (true);
