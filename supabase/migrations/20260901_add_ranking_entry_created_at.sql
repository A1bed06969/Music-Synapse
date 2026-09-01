-- 新着情報ダイジェスト機能: ranking_entry(タワレコメン等の個々のエントリ)には
-- これまで追加日時のカラムが無く、「いつ追加されたか」を判定できなかった。
alter table public.ranking_entry
  add column created_at timestamptz not null default now();

-- ADD COLUMN ... DEFAULT now()は既存の全行に「実行時刻」を一律で書き込んで
-- しまい、新着情報ダイジェストが初回だけ既存エントリを全部「今日の新着」と
-- 誤検出する。period_dateの方が実態に近いため、既存行はそちらで置き換える。
update public.ranking_entry
set created_at = period_date::timestamptz
where created_at::date = current_date;
