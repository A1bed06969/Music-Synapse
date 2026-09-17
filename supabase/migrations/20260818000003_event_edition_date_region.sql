-- SUMMER SONICのように同じ日程で東京・大阪など複数都市が同時開催される
-- フェスに対応するため、event_edition_dateに都市名(任意)を追加する。
-- venue名からの自動判定は他のフェスに汎用的に使えないため、
-- event.prefecture/music_event.prefectureと同じく管理画面での手入力とする。
ALTER TABLE event_edition_date ADD COLUMN region TEXT;
