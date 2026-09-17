-- ユーザーの手元資料(ジャンル・ムード×国名×エリア表)を取り込むための列。
-- 既存のorigin_country/origin_cityは国・都市単位だが、こちらは大陸/地域単位
-- (南米・アフリカ・ヨーロッパ等)の粗い区分を別軸として持たせる。
ALTER TABLE genre ADD COLUMN IF NOT EXISTS origin_area TEXT;
