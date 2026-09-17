-- event_editionは開催期間(start_date〜end_date)と会場(venue)を1件ずつしか
-- 持てないため、サマーソニックのように日によって会場が異なるフェスや、
-- 複数都市を回るライブツアーを正しく表現できなかった(既存データでは
-- 複数会場名を1つのvenueテキストに無理やり詰め込んでいた)。
-- event_edition_dateで、開催回に対して日付+会場のペアを個別に複数登録できる
-- ようにする。アーティストの出演情報(event_appearance)とは独立して登録できる。
CREATE TABLE event_edition_date (
  id TEXT PRIMARY KEY DEFAULT generate_ms_id('EED_DATE'::text),
  event_edition_id TEXT NOT NULL REFERENCES event_edition(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  venue TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_edition_date_edition_id ON event_edition_date(event_edition_id);

-- 公開ページ(カレンダー・/events/[id])から読むため、他のevent系テーブルと
-- 同じく公開read policyを付ける(insert/update/deleteはservice_role経由の
-- 管理画面からのみ)。
ALTER TABLE event_edition_date ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON event_edition_date FOR SELECT TO public USING (true);
