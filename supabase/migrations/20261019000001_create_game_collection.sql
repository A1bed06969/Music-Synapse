-- ジャケット神経衰弱ゲーム(/game)の図鑑とプレイ記録。
-- このサイトは全体がBasic認証で、使うのは基本1人なので、図鑑は「全員で1つ」として保存する
-- (スマホとPCで同じ図鑑が見える)。複数人で公開する場合は、人ごとの図鑑に作り替える必要がある。

-- 集めたジャケット。1アルバムにつき1行(同じものを集め直しても増えない)
CREATE TABLE game_collection (
  album_id     TEXT PRIMARY KEY REFERENCES album(id) ON DELETE CASCADE,
  -- 最初に集めたテーマ(ディスクガイドのid)
  theme_id     TEXT NOT NULL,
  -- 神経衰弱のペアとして集めたか、ミスなしクリアのレア枠でもらったか
  source       TEXT NOT NULL DEFAULT 'pair' CHECK (source IN ('pair', 'rare')),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_game_collection_theme_id ON game_collection (theme_id);

-- 1プレイごとの記録(連続プレイ日数・ベスト記録に使う)
CREATE TABLE game_play_log (
  id         TEXT PRIMARY KEY DEFAULT generate_ms_id('GPL'::text),
  theme_id   TEXT NOT NULL,
  cleared    BOOLEAN NOT NULL,
  stars      INTEGER NOT NULL DEFAULT 0,
  misses     INTEGER NOT NULL DEFAULT 0,
  moves      INTEGER NOT NULL DEFAULT 0,
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_game_play_log_played_at ON game_play_log (played_at);

ALTER TABLE game_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_play_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON game_collection FOR SELECT USING (true);
CREATE POLICY "Public read access" ON game_play_log FOR SELECT USING (true);
