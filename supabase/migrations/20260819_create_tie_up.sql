-- supabase/migrations/20260819_create_tie_up.sql
-- アーティスト年表機能の一部。タイアップ(アニメ/ドラマ/CM等での楽曲使用)は
-- MusicBrainz/Wikidataに日本国内向けの情報がほぼ無く自動取込が難しいため、
-- 管理画面からの手動入力専用テーブルとする。track単位で紐づける
-- (「この曲がアニメOPに使われた」という粒度の情報のため)。

CREATE TABLE tie_up (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('TIE'::text),
  track_id TEXT NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('anime', 'drama', 'movie', 'cm', 'game', 'other')),
  work_title TEXT NOT NULL,
  year INTEGER,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_tie_up_track_id ON tie_up(track_id);

-- 公開ページ(アーティスト年表)から読むため、event_edition_date等と同じく
-- 公開read policyを付ける(insert/update/deleteは管理画面のservice_role経由のみ)。
ALTER TABLE tie_up ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON tie_up FOR SELECT TO public USING (true);
