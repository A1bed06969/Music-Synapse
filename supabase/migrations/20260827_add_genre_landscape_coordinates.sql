-- ミュージックランドスケープの座標算出を、手動アンカー(lib/landscape/genreAnchors.ts)
-- からgenre_lineageの派生・影響・クロスオーバー関係を使ったUMAP埋め込みへ
-- 置き換えるためのステップ2。UMAPは重いためリクエスト時には計算せず、
-- scripts/compute-genre-landscape-coordinates.pyでオフライン一括計算した
-- 結果をここに保存する(未計算のジャンルはNULLのままとし、既存の手動
-- アンカー/キーワード推定にフォールバックする)。
ALTER TABLE genre ADD COLUMN IF NOT EXISTS landscape_x DOUBLE PRECISION;
ALTER TABLE genre ADD COLUMN IF NOT EXISTS landscape_y DOUBLE PRECISION;
