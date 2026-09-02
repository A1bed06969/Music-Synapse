-- media.power_play_url: 各局のパワープレイ/ヘビーローテーションページURL。
-- ラジオ局PP自動収集(app/api/cron/radio-power-play)が対象局を判定するために使う。
-- URLが判明した局から scripts/backfill-radio-station-urls.ts で埋めていく
-- (nullのままの局は既存の手動HRPPシート運用にフォールバックする)。
ALTER TABLE media ADD COLUMN power_play_url TEXT;
