-- ニュースをDBにキャッシュするためのテーブル。
--
-- これまでトップページ・/media/news・アーティスト詳細ページ・イベント詳細ページの
-- 4箇所がそれぞれリクエストのたびに9媒体のRSSを取得していた。Next.jsの
-- fetchキャッシュ(revalidate: 1800)はあったが、キャッシュ切れの瞬間に
-- 踏んだリクエストは9媒体分のRSS取得完了(失敗した媒体はタイムアウトまで待つ)を
-- 待たされ、トップページで実測3.9秒かかっていた。
-- Vercel Cronで定期的にRSSを取得しこのテーブルへ書き込み、各ページは
-- このテーブルを読むだけにする(app/api/cron/refresh-news/route.ts参照)。

CREATE TABLE news_item (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  author TEXT,
  category TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_news_item_published_at ON news_item (published_at DESC);

ALTER TABLE news_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON news_item
  FOR SELECT USING (true);
