-- CORE(そのジャンルを直接形成したアーティスト/作品) vs INFLUENCE(ジャンルの語法・精神を
-- 取り入れているが正式なサブジャンルではない)を区別するための列。
-- 既存行は全てCOREとして扱う(デフォルト値、書き換え不要)。
ALTER TABLE genre_highlight
  ADD COLUMN classification TEXT NOT NULL DEFAULT 'core' CHECK (classification IN ('core', 'influence'));
