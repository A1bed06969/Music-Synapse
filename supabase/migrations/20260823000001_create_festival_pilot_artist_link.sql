-- フェス出演者収集ページで、スクレイピング/データセットの出演者名(pick_name)が
-- 実際に登録されたartist行と紐付いた記録を保存する。
--
-- 背景: iTunesの検索結果はアーティスト名がローカライズされることがあり
-- (例: "ALANIS MORISSETTE" → "アラニス・モリセット")、フェス側の表記と
-- カタログ上の名前が完全一致しなくなる。festival-pilotページは表記の完全一致
-- でしか「登録済み」を判定できないため、一度登録してもリロードのたびに
-- 「未登録」に戻って見えてしまう不具合があった(実例: Loyle Carner/ロイル・
-- カーナー、Alanis Morissette/アラニス・モリセット)。
-- 一度でも解決できたpick_name→artist_idの対応をdataset_key単位で記録し、
-- 以後は名前の完全一致に頼らずこちらを優先して「登録済み」判定に使う。
CREATE TABLE festival_pilot_artist_link (
  dataset_key TEXT NOT NULL,
  pick_name TEXT NOT NULL,
  artist_id TEXT NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_key, pick_name)
);
