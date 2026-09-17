-- rankingには「順位あり(年間ベストアルバムTOP100等)」と「順位なしの選出企画
-- (Up Next、NME新鋭100、FenderNEXT等、順不同のピックアップ)」が混在するため、
-- 種別を明示するカラムを追加する。選出企画のエントリーに架空の順位を
-- 割り振らずに済むよう、ranking_entry.rankもNULL許容にする。
ALTER TABLE ranking ADD COLUMN IF NOT EXISTS list_type TEXT NOT NULL DEFAULT 'ranked'
  CHECK (list_type IN ('ranked', 'selection'));

ALTER TABLE ranking_entry ALTER COLUMN rank DROP NOT NULL;
