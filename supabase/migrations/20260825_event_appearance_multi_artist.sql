-- コラボ名義でのフェス出演(例:「THE SPELLBOUND × BOOM BOOM SATELLITES」)は、
-- event_appearance.artist_idが1つしか持てないため、どちらか一方のアーティストにしか
-- 紐づけられなかった。display_nameでフェス表記そのままの合体名義を保持しつつ、
-- event_appearance_artistで実際に紐づく全アーティストを管理できるようにする。
--
-- event_appearance.artist_idは既存コードとの互換性のため代表(先頭)アーティストの
-- ままにする。event_appearance_artistは単独出演も含めて「このevent_appearanceに
-- 紐づく全アーティスト」を統一的に引けるようにするテーブルとして設計し、既存の
-- 全行をartist_id 1件・billing_order 0としてバックフィルする(コラボかどうかは
-- 「2件以上あるか」で判定できる)。

ALTER TABLE event_appearance ADD COLUMN display_name TEXT;

CREATE TABLE event_appearance_artist (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('EA_ART'::text),
  event_appearance_id INTEGER NOT NULL REFERENCES event_appearance(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  billing_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (event_appearance_id, artist_id)
);

CREATE INDEX idx_event_appearance_artist_appearance_id ON event_appearance_artist(event_appearance_id);
CREATE INDEX idx_event_appearance_artist_artist_id ON event_appearance_artist(artist_id);

ALTER TABLE event_appearance_artist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON event_appearance_artist FOR SELECT TO public USING (true);

INSERT INTO event_appearance_artist (event_appearance_id, artist_id, billing_order)
SELECT id, artist_id, 0 FROM event_appearance;
