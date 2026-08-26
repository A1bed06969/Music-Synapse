-- フェス(event)の恒久的な会場情報(名称+住所)。複数会場のフェスに対応するため
-- 1対多で持たせる。開催年ごとに会場が変わる場合の記録は既存のevent_edition/
-- event_edition_dateが担当するため、こちらはフェス本体に紐づく参考情報として扱う。
CREATE TABLE event_venue (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('EVN'::text),
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_venue_event_id ON event_venue (event_id);

ALTER TABLE event_venue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON event_venue
  FOR SELECT USING (true);
