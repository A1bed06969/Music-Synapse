-- サンプリング元などが、カタログに無いとき(曲名・アーティスト名だけ分かるとき)の記録欄。
-- related_track_id が NULL の行で、元の曲の名前を持てるようにする。
ALTER TABLE track_relation ADD COLUMN IF NOT EXISTS original_title text;
ALTER TABLE track_relation ADD COLUMN IF NOT EXISTS original_artist text;
DROP INDEX IF EXISTS idx_track_relation_unique;
CREATE UNIQUE INDEX idx_track_relation_unique ON track_relation (track_id, COALESCE(related_track_id, ''), relation_type, source, COALESCE(original_title, ''));
