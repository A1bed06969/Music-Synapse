-- 同じアーティストを同じアルバムに重複して紐付けるのを防ぐ。
-- album_artistテーブル自体・role/billing_order列・RLS・CHECK制約は
-- 既に存在しているため、このマイグレーションではUNIQUE制約のみ追加する。
ALTER TABLE album_artist ADD CONSTRAINT album_artist_album_id_artist_id_key
  UNIQUE (album_id, artist_id);
