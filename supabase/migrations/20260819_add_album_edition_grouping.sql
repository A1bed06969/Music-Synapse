-- supabase/migrations/20260819_add_album_edition_grouping.sql
-- デラックス版・地域別版・ボーナス版などの「版違い」アルバムを、代表版(最速
-- リリース日のもの)+その他の版、という形にグループ化するための下準備。
-- 新テーブルは作らず、自己参照の1カラムで「代表1件+その他」の木構造を表す。
ALTER TABLE album ADD COLUMN primary_album_id TEXT REFERENCES album(id) ON DELETE SET NULL;
ALTER TABLE album ADD COLUMN edition_group_manual_override BOOLEAN NOT NULL DEFAULT false;

-- primary_album_idでの絞り込み(is null / eq)が複数ページのクエリで頻出するため
CREATE INDEX idx_album_primary_album_id ON album(primary_album_id);
