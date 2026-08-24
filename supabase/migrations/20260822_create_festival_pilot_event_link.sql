-- festival-pilotの各出演者データ(key単位)を、一度解決できたら以後は名前一致に頼らず
-- 直接その event.id を使うよう固定するためのマッピング。
--
-- 背景: findOrCreateFestivalEdition は event.name と picks[].festivalName の
-- 一致(大小文字・前後空白を無視)でイベントを特定していたが、後から event.name を
-- 統合・改名した場合や、picks側のfestivalName表記が元々ズレていた場合、次に
-- そのkeyから出演登録するたびに一致せず新しい空のイベントが重複作成されてしまう
-- 不具合が実際に発生した(Coachella、風とロック芋煮会で発生・修正済み)。
-- 一度でも解決できたevent_idをkeyごとに恒久的に記録し、以後はそれを最優先で使うことで
-- 名前のズレに関わらず重複作成を防ぐ。festival_pilot_dataset.key(DB管理データ)にも
-- 静的スクレイピング(例: 'glastonbury'、対応するdatasetレコードが無い)にも
-- 同じ仕組みで対応できるよう、festival_pilot_dataset本体とは独立したテーブルにする。
CREATE TABLE festival_pilot_event_link (
  key TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
