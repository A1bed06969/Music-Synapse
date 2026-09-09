import { NEWS_SOURCES } from '@/utils/newsFeeds'
import { fetchAllNews, formatRelativeTime } from '@/utils/newsParser'

const NEWS_PREVIEW_COUNT = 8

/** トップページのニュース一覧。9媒体のRSSを外部から取得するため、
 * ページ本体のレンダリングを待たせないようSuspense境界の内側に置く
 * (取得に失敗する媒体があるとタイムアウトまで待つことになり、
 * 以前はトップページ全体が3.9秒かかっていた)。 */
export default async function LatestNews() {
  const { items } = await fetchAllNews(NEWS_SOURCES)
  const latestNews = items.slice(0, NEWS_PREVIEW_COUNT)

  if (latestNews.length === 0) {
    return <p className="mt-6 text-sm text-white/40">現在ニュースを取得できませんでした。</p>
  }

  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {latestNews.map((item) => (
        <a key={item.id} href={item.link} target="_blank" rel="noopener noreferrer" className="group block">
          <div className="aspect-video overflow-hidden rounded-md bg-white/5">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">No Image</div>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-medium group-hover:opacity-70">{item.title}</p>
          <p className="mt-0.5 text-xs text-white/30">
            {item.source} · {formatRelativeTime(item.publishedAt)}
          </p>
        </a>
      ))}
    </div>
  )
}

/** ニュース取得中に出すプレースホルダー。実際のカードと同じ形にして
 * 読み込み後のレイアウトのずれを防ぐ。 */
export function LatestNewsSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: NEWS_PREVIEW_COUNT }, (_, i) => (
        <div key={i}>
          <div className="aspect-video animate-pulse rounded-md bg-white/5" />
          <div className="mt-2 h-4 animate-pulse rounded bg-white/5" />
          <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-white/5" />
        </div>
      ))}
    </div>
  )
}
