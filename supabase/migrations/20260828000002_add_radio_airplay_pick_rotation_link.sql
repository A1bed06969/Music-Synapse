-- HRPP候補(radio_airplay_pick)を実際にradio_rotation(パワープレイ&ヘビロテ公開ページの
-- データ元)へ本登録した際のリンク先を記録する。NULLのままなら未登録(候補のまま)。
ALTER TABLE radio_airplay_pick
  ADD COLUMN registered_rotation_id TEXT REFERENCES radio_rotation(id);
