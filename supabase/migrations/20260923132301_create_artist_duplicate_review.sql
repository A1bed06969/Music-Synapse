-- supabase/migrations/20260923132301_create_artist_duplicate_review.sql
--
-- 同名で複数行存在するartistのうち、apple_music_artist_idが2種類以上ある
-- グループ(=同一人物の重複登録か、同名の別人かを機械的に判定できないもの)を
-- 人力でレビューするための画面(app/admin/data/artists/duplicate-review)向け。
-- 「別人として確定」した組み合わせだけをここに記録し、以後のレビュー一覧から
-- 除外する(統合した場合はマージ後に重複自体が解消されるため記録不要)。
CREATE TABLE artist_duplicate_review (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('ADR'::text),
  artist_name TEXT NOT NULL,
  artist_ids TEXT[] NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artist_duplicate_review_name ON artist_duplicate_review (artist_name);

ALTER TABLE artist_duplicate_review ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON artist_duplicate_review
  FOR SELECT USING (true);
