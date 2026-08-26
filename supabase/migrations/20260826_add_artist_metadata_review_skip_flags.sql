-- 「確認待ちアーティスト」一覧(/admin/data/artists/review)で、管理者が
-- 「Apple Musicに該当なし」「読み方不明」と明示的に判断した項目を二度と
-- 一覧に出さないようにするためのフラグ。値がnullのままの項目とは区別する
-- (単にimage_url/name_kana/name_enが未入力なだけなのか、確認済みで
-- あえて空欄なのかを見分けられないと、確認したはずの項目が何度も
-- 一覧に出続けてしまう)
ALTER TABLE artist
  ADD COLUMN IF NOT EXISTS image_match_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS name_reading_skipped_at TIMESTAMPTZ;
