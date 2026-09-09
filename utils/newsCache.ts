import { createClient } from '@/utils/Supabase/server'
import { NEWS_SOURCES } from '@/utils/newsFeeds'
import type { NewsCategory, NewsItem } from '@/utils/newsParser'

type NewsItemRow = {
  id: string
  source: string
  title: string
  link: string
  thumbnail_url: string | null
  published_at: string
  author: string | null
  category: string
}

/** news_itemテーブル(Vercel Cronがapp/api/cron/refresh-news/route.tsで
 * 定期的に書き込む)から読むだけの版。トップページ・/media/news・
 * アーティスト/イベント詳細ページの関連ニュースが、リクエストのたびに
 * 9媒体のRSSを取得・パースしていた従来方式(失敗した媒体の分だけ余計に
 * 待たされ、トップページで3.9秒かかっていた)を避ける。
 * failedSourcesは「一度も取得できたことがない媒体」を指す
 * (直近1回の取得失敗ではなく、キャッシュに1件も無い媒体)。 */
export async function fetchCachedNews(): Promise<{ items: NewsItem[]; failedSources: string[] }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('news_item')
    .select('id, source, title, link, thumbnail_url, published_at, author, category')
    .order('published_at', { ascending: false })
    .limit(200)

  const rows = (data ?? []) as NewsItemRow[]
  const items: NewsItem[] = rows.map((r) => ({
    id: r.id,
    source: r.source,
    title: r.title,
    link: r.link,
    thumbnailUrl: r.thumbnail_url,
    publishedAt: r.published_at,
    author: r.author,
    category: r.category as NewsCategory,
  }))

  const presentSources = new Set(items.map((i) => i.source))
  const failedSources = NEWS_SOURCES.map((s) => s.name).filter((name) => !presentSources.has(name))

  return { items, failedSources }
}
