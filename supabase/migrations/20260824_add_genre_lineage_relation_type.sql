-- ジャンル進化グラフで「主な派生(実線)」「影響(点線)」「クロスオーバー(破線)」を
-- 区別して表示するための列。既存行(全てderivationの意味合い)はデフォルト値のまま。
ALTER TABLE genre_lineage ADD COLUMN relation_type TEXT NOT NULL DEFAULT 'derivation'
  CHECK (relation_type IN ('derivation', 'influence', 'crossover'));
