-- supabase/migrations/20260921123741_create_featured_artist_review.sql
--
-- feat.アーティストの自動登録(utils/featuringBillingOrder.tsのextractFeaturedNames
-- + app/admin/import/actions.tsのlinkOrStubFeaturedArtists)を、完全一致する
-- 既存artistが無い場合はスキップする方式から、新規artistを自動作成した上で
-- このテーブルに記録してレビュー待ちにする方式に変更する(2026-09-21)。
--
-- カンマ/アンパサンド区切りの抽出名は「Tyler, The Creator」のような単一
-- アーティスト名を誤って分割してしまうことがあるため(2026-09-14に一度
-- 自動作成を実装したが、この理由で撤回した経緯がある)、無条件で確定扱いには
-- せず、人力での確認(confirmed/rejected)を挟めるようにする。
CREATE TABLE featured_artist_review (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('FAR'::text),
  artist_id TEXT NOT NULL REFERENCES artist(id),
  track_id TEXT NOT NULL REFERENCES track(id),
  extracted_name TEXT NOT NULL,
  source_title TEXT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  rejected BOOLEAN NOT NULL DEFAULT false,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_featured_artist_review_pending ON featured_artist_review (created_at)
  WHERE confirmed = false AND rejected = false;

ALTER TABLE featured_artist_review ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON featured_artist_review
  FOR SELECT USING (true);
