-- タイアップ曲を、使われた「期・クール・劇場版」ごとに仕分けるための列。
-- part_label: 区分の名前(例: 第1期 / 第2期第1クール / 劇場版 / OVA)。区分が無い作品や不明なものは NULL
-- air_year / air_month: その区分の放送(公開)が始まった年月。ページに書かれているときだけ入れる(推測しない)
ALTER TABLE sync_candidate
  ADD COLUMN IF NOT EXISTS part_label text,
  ADD COLUMN IF NOT EXISTS air_year integer,
  ADD COLUMN IF NOT EXISTS air_month integer;
ALTER TABLE sync_entry
  ADD COLUMN IF NOT EXISTS part_label text,
  ADD COLUMN IF NOT EXISTS air_year integer,
  ADD COLUMN IF NOT EXISTS air_month integer;
