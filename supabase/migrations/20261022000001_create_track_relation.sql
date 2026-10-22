-- 曲どうしの関係(Sampling & Mash-Up Anatomy 用): リミックス・エディット・マッシュアップなど。
--   track_id: 派生した曲(リミックス版・マッシュアップ)
--   related_track_id: 元の曲(カタログに見つかったときだけ。マッシュアップ・ブートレッグで元が特定できないものは NULL)
--   relation_type: remix / edit / bootleg / mashup
--   note: リミックスをした人・版の名前(例「Burak Yeter Remix」)
--   source: 関係の出どころ(catalog_title = カタログの曲名から。ほかは genius / wikipedia などを後で足す)
CREATE TABLE IF NOT EXISTS track_relation (
  id text PRIMARY KEY DEFAULT generate_ms_id('TRL'),
  track_id text NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  related_track_id text REFERENCES track(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type IN ('remix', 'edit', 'bootleg', 'mashup', 'sample')),
  note text,
  source text NOT NULL DEFAULT 'catalog_title',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_relation_unique ON track_relation (track_id, COALESCE(related_track_id, ''), relation_type, source);
CREATE INDEX IF NOT EXISTS idx_track_relation_track ON track_relation (track_id);
CREATE INDEX IF NOT EXISTS idx_track_relation_related ON track_relation (related_track_id);
ALTER TABLE track_relation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON track_relation FOR SELECT USING (true);
