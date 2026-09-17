-- ジャンル年表: Wikipediaから取り込む発祥地情報、ジャンル間の派生関係、
-- 代表アーティスト/作品を保持するためのカラム・テーブルを追加する。

ALTER TABLE genre ADD COLUMN origin_country TEXT;
ALTER TABLE genre ADD COLUMN origin_city TEXT;
ALTER TABLE genre ADD COLUMN wikipedia_url TEXT;

-- 1ジャンルの起源・派生は複数ありうる(例: Technoは House/electro/synth-pop等
-- 複数ジャンルに由来する)ため、単一のparent_genre_id列ではなく多対多の
-- 中間テーブルにする。
CREATE TABLE genre_lineage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  child_genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  UNIQUE (parent_genre_id, child_genre_id)
);

-- ジャンル(またはサブジャンル)ごとの代表アーティスト/作品。disc_guide_selectionと
-- 同じ「人間が選んで登録する」パターン。
CREATE TABLE genre_highlight (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  genre_id TEXT NOT NULL REFERENCES genre(id) ON DELETE CASCADE,
  artist_id TEXT REFERENCES artist(id) ON DELETE CASCADE,
  album_id TEXT REFERENCES album(id) ON DELETE CASCADE,
  note TEXT,
  CHECK (artist_id IS NOT NULL OR album_id IS NOT NULL)
);
