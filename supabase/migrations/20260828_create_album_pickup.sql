-- ①Discover New Musicの「今週の新譜ピックアップ」用。管理画面から注目アルバムを
-- 紹介文付きで選べるようにする(新譜カレンダーの自動生成データとは別に、
-- 人が選んだハイライトを表示するため)。
CREATE TABLE album_pickup (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('APK'::text),
  album_id TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  blurb TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_album_pickup_sort_order ON album_pickup (sort_order);

ALTER TABLE album_pickup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON album_pickup
  FOR SELECT USING (true);
