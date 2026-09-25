-- supabase/migrations/20260921123954_allow_null_featured_artist_review_artist.sql
--
-- 誤抽出として却下(rejectFeaturedArtist)した際、自動作成したartist行を削除
-- できるようにするための変更。featured_artist_review.artist_idがNOT NULLの
-- FK参照のままだと、レビュー行自身が参照しているため削除がFK違反で失敗する
-- (実際にテストで確認した)。先にこの列をNULLにしてから削除できるよう、
-- NULL許容+ON DELETE SET NULLに変更する。
ALTER TABLE featured_artist_review ALTER COLUMN artist_id DROP NOT NULL;

ALTER TABLE featured_artist_review DROP CONSTRAINT featured_artist_review_artist_id_fkey;
ALTER TABLE featured_artist_review
  ADD CONSTRAINT featured_artist_review_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES artist(id) ON DELETE SET NULL;
